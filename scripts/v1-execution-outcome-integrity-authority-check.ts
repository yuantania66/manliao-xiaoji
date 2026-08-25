import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  assertV1ExecutionOutcomeIntegrityResultV1,
  createV1ExecutionOutcomeIntegrityResultV1,
  type V1ExecutionMetricsV1,
  type V1ExecutionOutcomeIntegrityResultV1,
} from "../lib/v1-execution-outcome-integrity-authority";

const h = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const canonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key])}`).join(",")}}`;
};
const hashValue = (value: unknown) => h(canonical(value as Json));
const committed: V1ExecutionMetricsV1 = { resultStatus: "COMMITTED", committedWinnerHash: h("winner"), failureCategory: null, retryable: false, blockingQwenCalls: 3, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 120, episodeSelectedIdHash: h("episode"), committedEdge: "opens", writeSetHash: h("writes") };
const failed: V1ExecutionMetricsV1 = { resultStatus: "FAILED", committedWinnerHash: null, failureCategory: "PROVIDER_ERROR", retryable: true, blockingQwenCalls: 2, plannerAttempts: 1, surfaceCandidates: 0, serverElapsedMs: 210, episodeSelectedIdHash: h("episode-before-failure"), committedEdge: null, writeSetHash: h("failed-writes") };

for (const metrics of [committed, failed]) {
  const result = createV1ExecutionOutcomeIntegrityResultV1(metrics);
  assert.doesNotThrow(() => assertV1ExecutionOutcomeIntegrityResultV1(result));
  assert(Object.isFrozen(result) && Object.isFrozen(result.outcome));
}
const timeout = createV1ExecutionOutcomeIntegrityResultV1({ ...failed, failureCategory: "TIMEOUT" });
assert.equal(timeout.outcome.failureCategory, "TIMEOUT");
assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...failed, committedEdge: "opens" }), /v1_outcome_failed_invariant/);
assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...committed, failureCategory: "ERROR" } as unknown as V1ExecutionMetricsV1), /v1_outcome_committed_invariant/);
assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...committed, retryable: true }), /v1_outcome_committed_invariant/);
assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...failed, failureCategory: "free form failure category that is too broad" } as unknown as V1ExecutionMetricsV1), /v1_outcome_failed_invariant/);
for (const failureCategory of ["PROVIDER_ERROR_USER_000001", "PROVIDER_ERROR_USER_000002", "ARBITRARY_UNREGISTERED_CODE"] as const) {
  assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...failed, failureCategory } as unknown as V1ExecutionMetricsV1), /v1_outcome_failed_invariant/);
}
assert.throws(() => createV1ExecutionOutcomeIntegrityResultV1({ ...committed, blockingQwenCalls: 1.5 }), /v1_outcome_metric_blockingQwenCalls/);

const forged = structuredClone(createV1ExecutionOutcomeIntegrityResultV1(committed)) as unknown as Record<string, unknown> & { outcome: Record<string, unknown>; inputHash: string; resultHash: string };
forged.outcome.resultStatus = "BOGUS";
forged.inputHash = hashValue(forged.outcome);
const { resultHash: ignored, ...body } = forged;
void ignored;
forged.resultHash = hashValue(body);
assert.throws(() => assertV1ExecutionOutcomeIntegrityResultV1(forged as unknown as V1ExecutionOutcomeIntegrityResultV1), /v1_outcome_status/);
const extra = { ...createV1ExecutionOutcomeIntegrityResultV1(committed), extra: true } as unknown as V1ExecutionOutcomeIntegrityResultV1;
assert.throws(() => assertV1ExecutionOutcomeIntegrityResultV1(extra), /v1_outcome_result_exact_keys/);

console.log(JSON.stringify({ status: "PASS", normalCommitted: true, normalFailed: true, failedEdgeRejected: true, committedFailureRejected: true, committedRetryableRejected: true, tamperRejected: true, qwenCalled: false }, null, 2));
