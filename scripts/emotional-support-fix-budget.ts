import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";

loadEnvConfig(process.cwd());

const outputPath = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "";
if (!outputPath) throw new Error("--output is required.");
const RUNS = 5;
const scenarios = [
  { id: "emotion-being-ignored", userMessage: "刚才被忽略的时候挺难受的", supportFunction: "return_focus_control" },
  { id: "relational-challenge-no-history", userMessage: "你一点都不懂我", supportFunction: "acknowledge_current_relational_impact" },
];
const head = execSync("git rev-parse --short HEAD").toString().trim();

const run = async () => {
  const rows: Array<Record<string, unknown> & {
    scenarioId: string;
    passed: boolean;
    finalSource: string;
    regenerateAttempted: boolean;
  }> = [];
  for (const scenario of scenarios) {
    for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
      const reply = await createChatReply({
        conversationId: `emotional-fix-budget:${head}:${scenario.id}:r${runIndex}`,
        currentTurnId: `${scenario.id}:r${runIndex}:t1`,
        userMessage: scenario.userMessage,
        recentMessages: [],
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
      });
      const plan = reply.controlTrace?.responsePlan;
      const contract = plan?.positiveFunctionContract;
      const validations = reply.controlTrace?.validation ?? [];
      const final = validations.at(-1);
      const actualSupportFunction = contract?.action === "offer_emotional_support" ? contract.supportFunction : null;
      const row = {
        scenarioId: scenario.id,
        runIndex,
        actualActions: plan?.responseActions ?? [],
        actualSupportFunction,
        questionPolicy: plan?.questionPolicy.mode ?? null,
        finalSource: reply.finalSource,
        executionPhase: reply.execution.phase,
        regenerateAttempted: reply.regenerateAttempted,
        attemptFailures: validations.map((v) => v.failureReasons),
        finalValidationPassed: final?.passed ?? false,
        promptVersion: reply.generation.promptVersion ?? null,
        reply: reply.generation.text,
      };
      const passed = row.finalValidationPassed &&
        row.finalSource !== "constraint_failure" &&
        row.actualActions.includes("offer_emotional_support") &&
        actualSupportFunction === scenario.supportFunction;
      rows.push({ ...row, passed });
      console.log(JSON.stringify({ scenarioId: row.scenarioId, runIndex, passed, finalSource: row.finalSource, actualSupportFunction, regenerateAttempted: row.regenerateAttempted, attemptFailures: row.attemptFailures }));
    }
  }
  const summary = {
    head,
    runsPerScenario: RUNS,
    total: rows.length,
    passed: rows.filter((r) => r.passed).length,
    constraintFailures: rows.filter((r) => r.finalSource === "constraint_failure").length,
    regenerations: rows.filter((r) => r.regenerateAttempted).length,
    byScenario: Object.fromEntries(scenarios.map((s) => [s.id, {
      passed: rows.filter((r) => r.scenarioId === s.id && r.passed).length,
      regenerations: rows.filter((r) => r.scenarioId === s.id && r.regenerateAttempted).length,
    }])),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.passed === summary.total ? 0 : 1;
};

void run();
