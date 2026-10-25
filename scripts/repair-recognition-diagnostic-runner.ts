import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  interpretTurnDeterministically,
  mergeModelInterpretation,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import {
  DIAGNOSTIC_VERSION,
  RUNS_PER_SCENARIO,
  buildClaimlessVerificationScenarios,
  buildDiagnosticScenarios,
  legalTargetsOf,
  projectDiagnosticCell,
  runDeterministicProbes,
  scenarioInputFingerprint,
  summarizeDiagnosticCells,
  type DiagnosticCell,
  type HistoryShape,
} from "./repair-recognition-diagnostic-lib";

const getArg = (name: string) =>
  process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? "";

const side = getArg("side");
const outputPath = getArg("output");
const mode = getArg("mode") || "real";
const historyShape = (getArg("history") || "fixture") as HistoryShape;
if (!side || !outputPath) throw new Error("--side and --output are required.");
if (mode !== "real" && mode !== "probes") throw new Error("--mode must be real or probes.");
if (historyShape !== "fixture" && historyShape !== "committed_claimless") {
  throw new Error("--history must be fixture or committed_claimless.");
}
if (mode === "real" && !process.env.QWEN_API_KEY?.trim()) {
  throw new Error("A configured real AI provider is required.");
}

const sha = (path: string) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

const datasetPath = "clinical-evals/hill-helping-batch1-5-preservation.json";
const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as { scenarios: unknown[] };
const scenarios = historyShape === "committed_claimless"
  ? buildClaimlessVerificationScenarios(dataset.scenarios)
  : buildDiagnosticScenarios(dataset.scenarios);

const merge = (deterministic: unknown, model: unknown, context?: unknown) => mergeModelInterpretation(
  deterministic as Parameters<typeof mergeModelInterpretation>[0],
  model as Parameters<typeof mergeModelInterpretation>[1],
  context as Parameters<typeof mergeModelInterpretation>[2]
);
const interpretDeterministically = (context: unknown) =>
  interpretTurnDeterministically(context as Parameters<typeof interpretTurnDeterministically>[0]);

const sideMetadata = () => ({
  diagnosticVersion: DIAGNOSTIC_VERSION,
  side,
  mode,
  historyShape,
  productHead: git("rev-parse", "HEAD"),
  productDirty: git("status", "--porcelain", "--", "services", "conversation-os", "lib", "prisma"),
  diagnosticLibSha: sha("scripts/repair-recognition-diagnostic-lib.ts"),
  diagnosticRunnerSha: sha("scripts/repair-recognition-diagnostic-runner.ts"),
  datasetSha: sha(datasetPath),
  nodeVersion: process.version,
  scenarioInputs: scenarios.map((scenario) => ({
    id: scenario.id,
    group: scenario.group,
    inputFingerprint: scenarioInputFingerprint(scenario),
  })),
});

const runProbes = () => {
  const probes = scenarios.map((scenario) => {
    const currentTurnId = `repair-diag-probe-${side}-${scenario.id}`;
    const context = assembleConversationControlContext({
      conversationId: `repair-diag-probe:${side}:${scenario.id}`,
      currentTurnId,
      userMessage: scenario.userMessage,
      recentMessages: scenario.recentMessages,
      conversationState: determineConversationState({
        currentUserMessage: scenario.userMessage,
        recentMessages: scenario.recentMessages,
      }),
    });
    const record = context as unknown as Record<string, unknown>;
    const deterministic = interpretDeterministically(context) as unknown as Record<string, unknown>;
    const stateUpdate = deterministic.stateUpdate as Record<string, unknown> | undefined;
    return {
      scenarioId: scenario.id,
      group: scenario.group,
      legalTargets: legalTargetsOf(record),
      deterministicRepairSignal: Boolean(deterministic.repairSignal),
      deterministicRepairProposal: Boolean(stateUpdate?.repairProposal),
      deterministicConfidence: typeof deterministic.confidence === "number" ? deterministic.confidence : null,
      probes: runDeterministicProbes({ context: record, deterministic, merge }),
    };
  });
  writeFileSync(outputPath, `${JSON.stringify({ ...sideMetadata(), probes }, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(JSON.stringify({ outputPath, scenarios: probes.length }));
};

const run = async () => {
  const startedAt = new Date().toISOString();
  const cells: DiagnosticCell[] = [];
  for (const scenario of scenarios) {
    for (let runIndex = 1; runIndex <= RUNS_PER_SCENARIO; runIndex += 1) {
      const currentTurnId = `repair-diag-${side}-${scenario.id}-r${runIndex}`;
      const reply = await createChatReply({
        conversationId: `repair-diag:${side}:${scenario.id}:r${runIndex}`,
        currentTurnId,
        userMessage: scenario.userMessage,
        recentMessages: scenario.recentMessages,
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
      });
      const cell = projectDiagnosticCell({
        scenario,
        runIndex,
        currentTurnId,
        reply,
        interpretDeterministically,
        merge,
      });
      cells.push(cell);
      console.log(JSON.stringify({ side, scenarioId: cell.scenarioId, runIndex, stage: cell.stage }));
    }
  }
  const artifact = {
    ...sideMetadata(),
    model: process.env.AI_MAIN_MODEL?.trim() || "default",
    provider: process.env.AI_PROVIDER?.trim() || "default",
    aiTimeoutMs: process.env.AI_TIMEOUT_MS?.trim() || "default",
    interpreterModelEnabled: process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED?.trim() || "unset",
    helpingOrdinaryHandoff: "forced_true_like_preservation_runner",
    runsPerScenario: RUNS_PER_SCENARIO,
    startedAt,
    completedAt: new Date().toISOString(),
    summary: summarizeDiagnosticCells(cells),
    cells,
  };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ outputPath, ...artifact.summary }, null, 2));
};

if (mode === "probes") {
  runProbes();
} else {
  run().catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "diagnostic_failure");
    process.exitCode = 1;
  });
}
