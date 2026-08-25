import { createHash } from "node:crypto";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const canonicalize = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, Json>)[key])}`).join(",")}}`;
};
const hash = (value: unknown) => `sha256:${createHash("sha256").update(canonicalize(value as Json)).digest("hex")}`;
const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export const V1_EXECUTION_OUTCOME_DEFINITION_V1 = freeze({
  schemaVersion: "v1_execution_outcome_definition_v1",
  authorityVersion: "v1_execution_outcome_integrity_authority_v1",
  exactMetricKeys: ["resultStatus", "committedWinnerHash", "failureCategory", "retryable", "blockingQwenCalls", "plannerAttempts", "surfaceCandidates", "serverElapsedMs", "episodeSelectedIdHash", "committedEdge", "writeSetHash"],
  resultStatuses: ["COMMITTED", "FAILED"],
  committedEdges: ["opens", "fulfills", "supersedes", null],
  committedRule: "winner_sha256_failure_null_retryable_false",
  failedRule: "winner_null_edge_null_failure_nonempty_low_cardinality_retryable_boolean",
  failureCategories: ["SAFETY_BLOCKED", "PLAN_INVALID", "GENERATION_NONCONFORMANT", "PROVIDER_ERROR", "PERSISTENCE_ERROR", "TIMEOUT"],
  episodeRule: "sha256_or_null_for_both_outcomes",
});
export const V1_EXECUTION_OUTCOME_DEFINITION_HASH_V1 = hash(V1_EXECUTION_OUTCOME_DEFINITION_V1);

export type V1ExecutionFailureCategoryV1 = "SAFETY_BLOCKED" | "PLAN_INVALID" | "GENERATION_NONCONFORMANT" | "PROVIDER_ERROR" | "PERSISTENCE_ERROR" | "TIMEOUT";

export type V1ExecutionMetricsV1 = Readonly<{
  resultStatus: "COMMITTED" | "FAILED";
  committedWinnerHash: string | null;
  failureCategory: V1ExecutionFailureCategoryV1 | null;
  retryable: boolean;
  blockingQwenCalls: number;
  plannerAttempts: number;
  surfaceCandidates: number;
  serverElapsedMs: number;
  episodeSelectedIdHash: string | null;
  committedEdge: "opens" | "fulfills" | "supersedes" | null;
  writeSetHash: string;
}>;

export type V1ExecutionOutcomeIntegrityResultV1 = Readonly<{
  schemaVersion: "v1_execution_outcome_integrity_result_v1";
  authorityVersion: "v1_execution_outcome_integrity_authority_v1";
  definitionHash: string;
  inputHash: string;
  outcome: V1ExecutionMetricsV1;
  resultHash: string;
}>;

const assertMetrics = (metrics: V1ExecutionMetricsV1) => {
  if (!isRecord(metrics) || !exactKeys(metrics, V1_EXECUTION_OUTCOME_DEFINITION_V1.exactMetricKeys)) throw new Error("v1_outcome_exact_keys");
  if (metrics.resultStatus !== "COMMITTED" && metrics.resultStatus !== "FAILED") throw new Error("v1_outcome_status");
  if (typeof metrics.retryable !== "boolean") throw new Error("v1_outcome_retryable_type");
  for (const key of ["blockingQwenCalls", "plannerAttempts", "surfaceCandidates", "serverElapsedMs"] as const) if (!Number.isInteger(metrics[key]) || metrics[key] < 0) throw new Error(`v1_outcome_metric_${key}`);
  if (typeof metrics.writeSetHash !== "string" || !SHA256.test(metrics.writeSetHash)) throw new Error("v1_outcome_write_set_hash");
  if (!(metrics.episodeSelectedIdHash === null || (typeof metrics.episodeSelectedIdHash === "string" && SHA256.test(metrics.episodeSelectedIdHash)))) throw new Error("v1_outcome_episode_hash");
  if (!(metrics.committedEdge === null || metrics.committedEdge === "opens" || metrics.committedEdge === "fulfills" || metrics.committedEdge === "supersedes")) throw new Error("v1_outcome_edge");
  if (metrics.resultStatus === "COMMITTED") {
    if (typeof metrics.committedWinnerHash !== "string" || !SHA256.test(metrics.committedWinnerHash) || metrics.failureCategory !== null || metrics.retryable) throw new Error("v1_outcome_committed_invariant");
  } else {
    if (metrics.committedWinnerHash !== null || metrics.committedEdge !== null || typeof metrics.failureCategory !== "string" || !(V1_EXECUTION_OUTCOME_DEFINITION_V1.failureCategories as readonly string[]).includes(metrics.failureCategory)) throw new Error("v1_outcome_failed_invariant");
  }
};

export const createV1ExecutionOutcomeIntegrityResultV1 = (metrics: V1ExecutionMetricsV1): V1ExecutionOutcomeIntegrityResultV1 => {
  assertMetrics(metrics);
  const body = freeze({
    schemaVersion: "v1_execution_outcome_integrity_result_v1" as const,
    authorityVersion: "v1_execution_outcome_integrity_authority_v1" as const,
    definitionHash: V1_EXECUTION_OUTCOME_DEFINITION_HASH_V1,
    inputHash: hash(metrics),
    outcome: freeze(structuredClone(metrics)),
  });
  return freeze({ ...body, resultHash: hash(body) });
};

export const assertV1ExecutionOutcomeIntegrityResultV1 = (result: V1ExecutionOutcomeIntegrityResultV1) => {
  if (!isRecord(result) || !exactKeys(result, ["schemaVersion", "authorityVersion", "definitionHash", "inputHash", "outcome", "resultHash"])) throw new Error("v1_outcome_result_exact_keys");
  if (result.schemaVersion !== "v1_execution_outcome_integrity_result_v1" || result.authorityVersion !== "v1_execution_outcome_integrity_authority_v1" || result.definitionHash !== V1_EXECUTION_OUTCOME_DEFINITION_HASH_V1) throw new Error("v1_outcome_authority_binding");
  if (![result.definitionHash, result.inputHash, result.resultHash].every((value) => typeof value === "string" && SHA256.test(value))) throw new Error("v1_outcome_trace_hash");
  assertMetrics(result.outcome);
  if (result.inputHash !== hash(result.outcome)) throw new Error("v1_outcome_input_hash");
  const { resultHash: ignored, ...body } = result;
  void ignored;
  if (result.resultHash !== hash(body)) throw new Error("v1_outcome_result_hash");
};
