import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { getAiProvider, getDefaultAiModel } from "../services/ai/modelProvider";
import type { AiConversationMessage } from "../services/ai/types";
import {
  TRAJECTORY_REPORT_PATH,
  TRAJECTORY_RUNNER_VERSION,
  buildTrajectoryChecks,
  buildTurnResult,
  computeRelevantSourceFingerprint,
  getCurrentCommit,
  locateRepeatedOpeningSkeletons,
  loadTrajectoryDataset,
  renderTrajectoryReport,
  type TrajectoryRunMode,
  type TrajectoryRunResult,
} from "./conversation-trajectory-eval-lib";
import {
  GROUNDEDNESS_VARIANTS,
  applyGroundednessHistoryAdapter,
  getGroundednessExperimentDataset,
  getGroundednessPromptAdapter,
  type GroundednessExperimentVariant,
} from "./conversation-trajectory-experiment-adapters";

loadEnvConfig(process.cwd());

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = (modeArg?.split("=")[1] ?? "replay") as TrajectoryRunMode;
if (mode !== "real" && mode !== "replay") throw new Error(`Unsupported trajectory run mode: ${mode}`);
const repeatArg = process.argv.find((arg) => arg.startsWith("--repeat="));
const repeatCount = Number.parseInt(repeatArg?.split("=")[1] ?? "1", 10);
if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 10) {
  throw new Error(`Trajectory repeat count must be an integer from 1 to 10: ${repeatArg}`);
}
const variantArg = process.argv.find((arg) => arg.startsWith("--variant="));
const variant = variantArg?.split("=")[1]?.trim() || "canonical";
const experimentArg = process.argv.find((arg) => arg.startsWith("--experiment="));
const experiment = experimentArg?.split("=")[1]?.trim() || "canonical";
const isGroundednessExperiment = experiment === "exp-bl-012a";
if (experiment !== "canonical" && !isGroundednessExperiment) {
  throw new Error(`Experiment ${experiment} is not registered.`);
}
if (!isGroundednessExperiment && variant !== "canonical") {
  throw new Error(`Variant ${variant} is not registered for the canonical dataset.`);
}
if (isGroundednessExperiment && !GROUNDEDNESS_VARIANTS.includes(variant as GroundednessExperimentVariant)) {
  throw new Error(`Variant ${variant} is not registered for ${experiment}.`);
}
if (isGroundednessExperiment && mode !== "real") {
  throw new Error(`${experiment} is a real-model comparison and does not support replay mode.`);
}

const groundednessVariant = (isGroundednessExperiment ? variant : "a0") as GroundednessExperimentVariant;
const promptAdapter = isGroundednessExperiment ? getGroundednessPromptAdapter(groundednessVariant) : null;
const outputPath = isGroundednessExperiment
  ? `docs/evals/conversation-trajectory-${experiment}-${variant}.local.md`
  : TRAJECTORY_REPORT_PATH;

const run = async () => {
  const dataset = isGroundednessExperiment ? getGroundednessExperimentDataset() : loadTrajectoryDataset();
  const results: TrajectoryRunResult[] = [];

  for (let runIndex = 1; runIndex <= repeatCount; runIndex += 1) {
    for (const trajectory of dataset.trajectories) {
      const recentMessages: AiConversationMessage[] = [...trajectory.initialMessages];
      const turns = [];

      for (const turn of trajectory.turns) {
        recentMessages.push({ role: "user", content: turn.user });

        if (mode === "replay") {
          const replayTurn = buildTurnResult({ turn, assistant: turn.observedAssistant ?? null, mode });
          turns.push(replayTurn);
          if (turn.observedAssistant) recentMessages.push({ role: "assistant", content: turn.observedAssistant });
          continue;
        }

        try {
          const adaptedRecentMessages = isGroundednessExperiment
            ? applyGroundednessHistoryAdapter(groundednessVariant, recentMessages.slice(0, -1))
            : recentMessages.slice(0, -1);
          const result = await createChatReply({
            conversationId: `trajectory-eval-${trajectory.id}-run-${runIndex}`,
            userId: "trajectory-eval-user",
            userMessage: turn.user,
            recentMessages: adaptedRecentMessages,
            includeDebugTrace: true,
            evaluationAdapter: promptAdapter,
          });
          const assistant = result.generation.text;
          turns.push(buildTurnResult({ turn, assistant, result, mode }));
          recentMessages.push({ role: "assistant", content: assistant, promptVersion: result.generation.promptVersion });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          turns.push(buildTurnResult({ turn, assistant: null, mode, error: message }));
        }
      }

      results.push({ trajectory, runIndex, turns, ...buildTrajectoryChecks(turns) });
    }
  }

  if (isGroundednessExperiment && repeatCount >= 3) {
    for (const trajectory of dataset.trajectories) {
      const trajectoryResults = results.filter((item) => item.trajectory.id === trajectory.id);
      const crossRunFlags = locateRepeatedOpeningSkeletons(trajectoryResults.flatMap((item) => item.turns));
      if (crossRunFlags.length && trajectoryResults[0]) {
        trajectoryResults[0].trajectoryHeuristicFlags.push(
          ...crossRunFlags.map((flag) => ({ ...flag, rule: "cross_run_opening_skeleton_locator" }))
        );
      }
    }
  }

  const completed = results.flatMap((item) => item.turns).filter((turn) => turn.status === "completed");
  const promptVersion = completed.find((turn) => turn.promptVersion !== "captured")?.promptVersion ?? "captured-replay";
  const provider = mode === "real" ? getAiProvider() : "captured-replay";
  const model = mode === "real" ? process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel() : "captured-replay";
  const report = renderTrajectoryReport(
    {
      datasetVersion: dataset.datasetVersion,
      runnerVersion: TRAJECTORY_RUNNER_VERSION,
      evaluatedCommit: getCurrentCommit(),
      relevantSourceFingerprint: computeRelevantSourceFingerprint(),
      generatedAt: new Date().toISOString(),
      runMode: mode,
      repeatCount,
      variant,
      promptAdapter: promptAdapter?.id ?? "none",
      historyAdapter: groundednessVariant === "a3" ? "drop-unconfirmed-assistant-semantic-history" : "canonical",
      provider,
      model,
      promptVersion,
      freshness: "current",
      staleReason: "",
    },
    results
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, "utf8");

  console.log(
    JSON.stringify(
      {
        mode,
        repeatCount,
        variant,
        experiment,
        promptAdapter: promptAdapter?.id ?? "none",
        historyAdapter: groundednessVariant === "a3" ? "drop-unconfirmed-assistant-semantic-history" : "canonical",
        output: outputPath,
        trajectories: results.length,
        completedTurns: completed.length,
        pendingTurns: results.flatMap((item) => item.turns).filter((turn) => turn.status === "pending_reproduction").length,
        deterministicErrors: results.flatMap((item) => [
          ...item.turns.flatMap((turn) => turn.machineCheckErrors),
          ...item.trajectoryMachineCheckErrors,
        ]),
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
