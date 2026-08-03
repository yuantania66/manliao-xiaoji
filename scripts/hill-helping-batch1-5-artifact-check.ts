import assert from "node:assert/strict";

import type { ResponsePlan } from "../conversation-os/control";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { loadChatGateDataset, readChatGateRunArtifact } from "./chat-gate-v0-lib";

const inputPath = process.argv.find((item) => item.startsWith("--input="))?.slice("--input=".length);
if (!inputPath) throw new Error("--input is required.");

const asRecord = (value: unknown): Record<string, unknown> => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};

const debugProjection = (value: unknown) => {
  const debug = asRecord(value);
  const control = asRecord(debug.conversationControl);
  const responsePlan = asRecord(control.responsePlan);
  const helping = asRecord(debug.helpingLogic);
  const provider = asRecord(helping.provider);
  const route = asRecord(debug.route);
  return {
    responsePlan: responsePlan as unknown as ResponsePlan,
    actions: responsePlan.responseActions as string[],
    behaviorSource: responsePlan.behaviorSource,
    helpingProviderAttempted: provider.attempted,
    finalSource: route.finalSource,
  };
};

const artifact = readChatGateRunArtifact(inputPath);
const dataset = loadChatGateDataset();
assert.equal(artifact.datasetVersion, dataset.datasetVersion);
assert.equal(artifact.episodeRuns.length, dataset.gateContract.episodeRunsPerSide);

const turns = artifact.episodeRuns.flatMap((run) => run.turns);
assert.equal(turns.length, 18);
assert(turns.every((turn) => turn.executionStatus === "committed"));
assert(turns.every((turn) => turn.assistantMessage?.content.trim()));

const projected = turns.map((turn) => debugProjection(turn.debugTrace));
assert(projected.every((item) =>
  item.behaviorSource === "ordinary_conversation" || item.behaviorSource === "legacy_compat"
));
assert(projected.every((item) => item.helpingProviderAttempted === false));
assert(projected.every((item) => item.finalSource !== "fallback" && item.finalSource !== "constraint_failure"));

const numericRuns = artifact.episodeRuns.filter((run) => run.episodeId.includes("NUMERIC"));
const numericTurns = numericRuns.flatMap((run) => run.turns);
assert.equal(numericTurns.length, 12);
const numericActions = numericTurns.map((turn) => debugProjection(turn.debugTrace).actions);
assert(numericTurns.every((turn) => debugProjection(turn.debugTrace).behaviorSource === "ordinary_conversation"));
assert(numericActions.every((actions) =>
  actions.includes("invite_low_pressure_calibration") ||
  actions.includes("offer_neutral_conversation_entry")
));
assert(numericActions.every((actions) => !actions.includes("acknowledge_without_psychologizing")));

const multiRuns = artifact.episodeRuns.filter((run) => run.episodeId === "EP-20260712-NUMERIC-001");
assert.equal(multiRuns.length, 3);
for (const run of multiRuns) {
  assert.deepEqual(run.turns.map((turn) => debugProjection(turn.debugTrace).actions[0]), [
    "invite_low_pressure_calibration",
    "offer_neutral_conversation_entry",
    "invite_low_pressure_calibration",
  ]);
}

const emotionalRuns = artifact.episodeRuns.filter((run) => run.episodeId === "EP-20260712-REFLECT-001");
const repairRuns = artifact.episodeRuns.filter((run) => run.episodeId === "EP-20260712-REPAIR-001");
assert.equal(emotionalRuns.length, 3);
assert.equal(repairRuns.length, 3);
assert([...emotionalRuns, ...repairRuns].every((run) =>
  run.turns.every((turn) => turn.executionStatus === "committed")
));
const qualityRetentionFailures = [...emotionalRuns, ...repairRuns].flatMap((run) =>
  run.turns.flatMap((turn) => {
    const reply = turn.assistantMessage?.content ?? "";
    const plan = debugProjection(turn.debugTrace).responsePlan;
    const validation = validateResponsePlanOutput({ plan, reply });
    return validation.passed ? [] : [{
      episodeId: run.episodeId,
      runIndex: run.runIndex,
      reply,
      failureReasons: validation.failureReasons,
    }];
  })
);
assert.deepEqual(
  qualityRetentionFailures,
  [],
  `Batch 1.5 visible-quality preservation failed: ${JSON.stringify(qualityRetentionFailures)}`
);

const latencies = turns.map((turn) => turn.latencyMs).sort((left, right) => left - right);
const percentile = (ratio: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * ratio))];

console.log(JSON.stringify({
  input: inputPath,
  turns: turns.length,
  committed: turns.filter((turn) => turn.executionStatus === "committed").length,
  failed: turns.filter((turn) => turn.executionStatus === "failed").length,
  numericTurnsWithFunctionalHandoff: numericTurns.length,
  emotionalNonFallbackRuns: emotionalRuns.length,
  evidenceLimitedRepairNonFallbackRuns: repairRuns.length,
  qualityRetentionFailures: qualityRetentionFailures.length,
  helpingProviderCalls: projected.filter((item) => item.helpingProviderAttempted).length,
  latencyMs: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: latencies.at(-1),
  },
}, null, 2));
