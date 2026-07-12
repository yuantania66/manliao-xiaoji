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
  loadTrajectoryDataset,
  renderTrajectoryReport,
  type TrajectoryRunMode,
  type TrajectoryRunResult,
} from "./conversation-trajectory-eval-lib";

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
if (variant !== "canonical") {
  throw new Error(`Variant ${variant} is not registered. Child experiments must add an explicit runner adapter.`);
}

const run = async () => {
  const dataset = loadTrajectoryDataset();
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
          const result = await createChatReply({
            conversationId: `trajectory-eval-${trajectory.id}-run-${runIndex}`,
            userId: "trajectory-eval-user",
            userMessage: turn.user,
            recentMessages: recentMessages.slice(0, -1),
            includeDebugTrace: true,
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
      provider,
      model,
      promptVersion,
      freshness: "current",
      staleReason: "",
    },
    results
  );

  mkdirSync(dirname(TRAJECTORY_REPORT_PATH), { recursive: true });
  writeFileSync(TRAJECTORY_REPORT_PATH, report, "utf8");

  console.log(
    JSON.stringify(
      {
        mode,
        repeatCount,
        variant,
        output: TRAJECTORY_REPORT_PATH,
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
