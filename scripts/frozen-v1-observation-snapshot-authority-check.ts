import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildComposerShadowInputFromSnapshotV1, hashComposerValue } from "../lib/composer-shadow-v1";
import {
  assertFrozenV1ObservationSnapshotV1,
  createFrozenV1ObservationSnapshotV1,
  hashFrozenObservationValue,
  type FrozenV1ExecutionMetricsV1,
  type FrozenV1ObservationSnapshotV1,
} from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const h = (value: string) => hashFrozenObservationValue(value);
const committed: FrozenV1ExecutionMetricsV1 = {
  resultStatus: "COMMITTED", committedWinnerHash: h("winner"), failureCategory: null, retryable: false,
  blockingQwenCalls: 3, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 125,
  episodeSelectedIdHash: h("episode"), committedEdge: "opens", writeSetHash: h("writes"),
};
const create = (caseId: string, execution = committed) => createFrozenV1ObservationSnapshotV1({
  baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId, executionOutcome: createV1ExecutionOutcomeIntegrityResultV1(execution), fixtureOwner: "synthetic_v1_fixture_runner_v1",
});

const ordinary = create("ordinary-episode-hit");
assert.doesNotThrow(() => assertFrozenV1ObservationSnapshotV1(ordinary));
assert(Object.isFrozen(ordinary) && Object.isFrozen(ordinary.baselineCase) && Object.isFrozen(ordinary.canonicalGrounding.availableFacts));
assert.equal(ordinary.sampleSetHash, hashFrozenObservationValue(SYNTHETIC_BASELINE_CASES_V1));
assert.equal(ordinary.baselineCaseHash, hashFrozenObservationValue(ordinary.baselineCase));
assert.equal(ordinary.executionHash, hashFrozenObservationValue(committed));
assert.deepEqual(Object.values(ordinary.isolation).map((item) => item.status).sort(), ["pass", "pass", "pass", "pass", "pass", "pending", "pending"].sort());

const inputA = buildComposerShadowInputFromSnapshotV1(ordinary, "run-a");
const inputB = buildComposerShadowInputFromSnapshotV1(ordinary, "run-a");
assert.equal(hashComposerValue(inputA), hashComposerValue(inputB));
assert.deepEqual(inputA.assistantGrounding.map((fact) => fact.value), ["小慢", "AI聊天助手"]);
assert.equal(inputA.purposeContractVersion, ordinary.purposeContract.version);
assert.equal(inputA.currentUserText, ordinary.baselineCase.currentUserTurn);

const safety = create("safety-current-danger", { ...committed, committedEdge: null, episodeSelectedIdHash: null });
const safetyInput = buildComposerShadowInputFromSnapshotV1(safety, "safety-run");
assert.equal(safetyInput.currentUserText, safety.baselineCase.currentUserTurn, "Safety must bind the full real baseline before eligibility");
assert.equal(safety.baselineCase.expectedSafetyOwnership, "safety");

const failed = create("ordinary-provider-failure", {
  resultStatus: "FAILED", committedWinnerHash: null, failureCategory: "PROVIDER_ERROR", retryable: true,
  blockingQwenCalls: 2, plannerAttempts: 1, surfaceCandidates: 0, serverElapsedMs: 220,
  episodeSelectedIdHash: null, committedEdge: null, writeSetHash: h("failed-writes"),
});
assert.equal(failed.execution.resultStatus, "FAILED");
assert.throws(() => create("ordinary-greeting", { ...committed, committedWinnerHash: null }), /v1_outcome_committed_invariant/);
assert.throws(() => create("ordinary-greeting", { ...failed.execution, failureCategory: null }), /v1_outcome_failed_invariant/);
assert.throws(() => createFrozenV1ObservationSnapshotV1({ baselineSet: [...SYNTHETIC_BASELINE_CASES_V1, SYNTHETIC_BASELINE_CASES_V1[0]], caseId: SYNTHETIC_BASELINE_CASES_V1[0].caseId, executionOutcome: createV1ExecutionOutcomeIntegrityResultV1(committed), fixtureOwner: "fixture" }), /authoritative_sample_set_hash_mismatch/);
assert.throws(() => createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1.map((item, index) => index === 0 ? { ...item, category: "forged" } : item), caseId: SYNTHETIC_BASELINE_CASES_V1[0].caseId, executionOutcome: createV1ExecutionOutcomeIntegrityResultV1(committed), fixtureOwner: "fixture" }), /authoritative_sample_set_hash_mismatch/);

const mutable = structuredClone(ordinary) as unknown as { snapshotHash: string; execution: { serverElapsedMs: number } };
mutable.execution.serverElapsedMs += 1;
assert.throws(() => assertFrozenV1ObservationSnapshotV1(mutable as unknown as FrozenV1ObservationSnapshotV1), /frozen_snapshot_hash_mismatch/);
const recomputeSnapshotHash = (value: Record<string, unknown>) => {
  const { snapshotHash: ignored, ...body } = value;
  void ignored;
  value.snapshotHash = hashFrozenObservationValue(body);
};
const extra = { ...structuredClone(ordinary), extra: true } as unknown as Record<string, unknown>;
recomputeSnapshotHash(extra);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(extra as unknown as FrozenV1ObservationSnapshotV1), /frozen_snapshot_exact_keys/);
const forgedCase = structuredClone(ordinary) as unknown as Record<string, unknown> & { baselineCase: Record<string, unknown>; baselineCaseHash: string };
forgedCase.baselineCase.category = "forged";
forgedCase.baselineCaseHash = hashFrozenObservationValue(forgedCase.baselineCase);
recomputeSnapshotHash(forgedCase);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgedCase as unknown as FrozenV1ObservationSnapshotV1), /frozen_snapshot_authoritative_set_mismatch/);
const forgedGrounding = structuredClone(ordinary) as unknown as Record<string, unknown> & { canonicalGrounding: { availableFacts: { assistant: { displayName: string } } }; canonicalGroundingHash: string };
forgedGrounding.canonicalGrounding.availableFacts.assistant.displayName = "伪名字";
forgedGrounding.canonicalGroundingHash = hashFrozenObservationValue(forgedGrounding.canonicalGrounding);
recomputeSnapshotHash(forgedGrounding);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgedGrounding as unknown as FrozenV1ObservationSnapshotV1), /frozen_snapshot_grounding_mismatch/);
const forgeExecution = (patch: Record<string, unknown>) => {
  const forged = structuredClone(ordinary) as unknown as Record<string, unknown> & { execution: Record<string, unknown>; executionHash: string };
  Object.assign(forged.execution, patch);
  forged.executionHash = hashFrozenObservationValue(forged.execution);
  recomputeSnapshotHash(forged);
  return forged as unknown as FrozenV1ObservationSnapshotV1;
};
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ serverElapsedMs: 1.5 })), /v1_outcome_metric_serverElapsedMs/);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ resultStatus: "BOGUS" })), /v1_outcome_status/);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ committedEdge: "bad-edge" })), /v1_outcome_edge/);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ retryable: "false" })), /v1_outcome_retryable_type/);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ failureCategory: 7 })), /v1_outcome_committed_invariant/);
assert.throws(() => assertFrozenV1ObservationSnapshotV1(forgeExecution({ committedWinnerHash: 7 })), /v1_outcome_committed_invariant/);

const authoritySource = readFileSync("lib/frozen-v1-observation-snapshot-authority.ts", "utf8");
for (const forbidden of ["@prisma/client", "lib/prisma", "ChatMessage", "AiGeneration", "QWEN_API_KEY"]) assert.equal(authoritySource.includes(forbidden), false);

console.log(JSON.stringify({ status: "PASS", authority: ordinary.authorityVersion, normalBinding: true, safetyFullBinding: true, tamperRejected: true, committedFailedInvariant: true, metricsFixtureOwner: ordinary.fixtureOwner, isolation: { pass: 5, pending: 2 }, qwenCalled: false }, null, 2));
