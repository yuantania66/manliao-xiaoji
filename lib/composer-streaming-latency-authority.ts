import { createHash } from "node:crypto";

import {
  assertComposerShadowInputV1,
  deepFreezeComposerValue,
  hashComposerValue,
  type ComposerShadowInputV1,
} from "./composer-shadow-v1";

export const COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION = "composer_streaming_latency_authority_v1" as const;
export const COMPOSER_STREAMING_LATENCY_RUNNER_VERSION = "composer_streaming_latency_sampler_v1" as const;
export const COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR = "/private/tmp/composer-streaming-latency-v1";
export const COMPOSER_STREAMING_LATENCY_ROWS_PATH = `${COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR}/observations.jsonl`;
export const COMPOSER_STREAMING_LATENCY_CONFIG_PATH = `${COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR}/run-config.json`;
export const COMPOSER_STREAMING_LATENCY_CONTEXT_LIMIT_BYTES = 65_536;
export const COMPOSER_STREAMING_LATENCY_TIMEOUT_MS = 60_000;
export const COMPOSER_STREAMING_LATENCY_BOOTSTRAP_SEED = 1729;
export const COMPOSER_STREAMING_LATENCY_BOOTSTRAP_REPLICATES = 1_000;
export const COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN = "https://dashscope.aliyuncs.com";
export const COMPOSER_STREAMING_LATENCY_ENDPOINT_PATH = "/compatible-mode/v1/chat/completions";

export const COMPOSER_STREAMING_LATENCY_DAY_TARGETS = deepFreezeComposerValue({
  1: { short: 50, medium: 14, near_bound: 6 },
  2: { short: 50, medium: 14, near_bound: 6 },
  3: { short: 42, medium: 12, near_bound: 6 },
} as const);

const BANDS = ["short", "medium", "near_bound"] as const;
export type ComposerLatencyContextBandV1 = (typeof BANDS)[number];
const STATUSES = ["success", "http_4xx", "http_5xx", "provider_error", "timed_out", "malformed", "hard_binding_failed"] as const;
export type ComposerLatencyStatusV1 = (typeof STATUSES)[number];
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nullableNonNegative = (value: unknown) => value === null || nonNegative(value);
const nullableInteger = (value: unknown) => value === null || (Number.isInteger(value) && Number(value) >= 0);

const syntheticTurnText = (index: number, repeats: number) =>
  `合成上下文第${index + 1}段，仅用于本地流式延迟测试，不包含真实用户信息。${"这是合成占位内容。".repeat(repeats)}`;

const buildContext = (band: ComposerLatencyContextBandV1, turnCount: number, repeats: number): ComposerShadowInputV1 => {
  const recentCommittedTurns = Array.from({ length: turnCount }, (_, index) => ({
    messageId: hashComposerValue({ band, index, kind: "synthetic_context_message" }),
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    text: syntheticTurnText(index, repeats),
    replyToMessageId: null,
  }));
  const input: ComposerShadowInputV1 = {
    schemaVersion: "composer_shadow_input_v1",
    shadowRunId: hashComposerValue({ band, kind: "streaming_latency_shadow_run" }),
    caseId: `latency-${band}`,
    sampleSetVersion: "composer_streaming_latency_contexts_v1",
    conversationIdHash: hashComposerValue({ band, kind: "synthetic_conversation" }),
    turnId: hashComposerValue({ band, kind: "synthetic_turn" }),
    currentUserText: band === "short" ? "今天想简单聊聊。" : "看完这些合成上下文后，请自然地回应当前这句话。",
    recentCommittedTurns,
    assistantGrounding: [
      { canonicalFactId: "assistant.displayName", value: "小慢", epistemicStatus: "canonical" },
      { canonicalFactId: "assistant.kind", value: "AI聊天助手", epistemicStatus: "canonical" },
    ],
    activeEvent: null,
    episodeCandidates: [],
    purposeContractVersion: "conversation_purpose_v1",
  };
  assertComposerShadowInputV1(input);
  return deepFreezeComposerValue(input);
};

export const COMPOSER_STREAMING_LATENCY_CONTEXTS_V1 = deepFreezeComposerValue({
  short: buildContext("short", 0, 0),
  medium: buildContext("medium", 12, 55),
  near_bound: buildContext("near_bound", 24, 80),
});

export const COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1 = deepFreezeComposerValue(Object.fromEntries(
  BANDS.map((band) => [band, {
    inputHash: hashComposerValue(COMPOSER_STREAMING_LATENCY_CONTEXTS_V1[band]),
    inputBytes: Buffer.byteLength(JSON.stringify(COMPOSER_STREAMING_LATENCY_CONTEXTS_V1[band])),
  }]),
) as Record<ComposerLatencyContextBandV1, Readonly<{ inputHash: string; inputBytes: number }>>);

export const COMPOSER_STREAMING_LATENCY_DEFINITION_V1 = deepFreezeComposerValue({
  version: "composer_streaming_latency_evidence_authority_v1",
  provider: { origin: COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN, endpointPath: COMPOSER_STREAMING_LATENCY_ENDPOINT_PATH, stream: true, firstAttemptOnly: true, repair: false },
  contextBands: COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1,
  dayTargets: COMPOSER_STREAMING_LATENCY_DAY_TARGETS,
  hotGate: { minimumSuccesses: 200, naturalDays: 3, minimumPerDay: 50 },
  bootstrap: { seed: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_SEED, replicates: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_REPLICATES, method: "percentile_bootstrap_nearest_rank_v1", halfWidthLimit: 0.15, extendTo: 400 },
  evidence: { plaintext: false, productionWrites: false, databaseWrites: false, realUserData: false },
});
export const COMPOSER_STREAMING_LATENCY_DEFINITION_HASH_V1 = hashComposerValue(COMPOSER_STREAMING_LATENCY_DEFINITION_V1);

const contextBytes = COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1;
if (!(contextBytes.short.inputBytes < 4_096 && contextBytes.medium.inputBytes >= 16_384 && contextBytes.medium.inputBytes <= 24_576 && contextBytes.near_bound.inputBytes >= 56_000 && contextBytes.near_bound.inputBytes < COMPOSER_STREAMING_LATENCY_CONTEXT_LIMIT_BYTES)) {
  throw new Error("streaming_latency_context_band_bytes");
}

export type ComposerStreamingLatencyRunConfigV1 = Readonly<{
  schemaVersion: "composer_streaming_latency_run_config_v1";
  authorityVersion: typeof COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION;
  runnerVersion: typeof COMPOSER_STREAMING_LATENCY_RUNNER_VERSION;
  definitionHash: string;
  modelHash: string;
  providerOriginHash: string;
  providerEndpointHash: string;
  promptHash: string;
  schemaOutputVersion: "composer_shadow_output_v1";
  incrementalDecoderVersion: "incremental_reply_decoder_v1";
  temperature: 0;
  stream: true;
  enableThinking: false;
  responseFormat: "json_object";
  timeoutMs: number;
  contextLimitBytes: number;
  contextBands: typeof COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1;
  dayTargets: typeof COMPOSER_STREAMING_LATENCY_DAY_TARGETS;
  bootstrapSeed: 1729;
  bootstrapReplicates: 1000;
  bootstrapMethod: "percentile_bootstrap_nearest_rank_v1";
  runConfigHash: string;
}>;

export const createComposerStreamingLatencyRunConfigV1 = ({ model, promptHash }: { model: string; promptHash: string }): ComposerStreamingLatencyRunConfigV1 => {
  if (!model.trim() || !SHA256.test(promptHash)) throw new Error("streaming_latency_run_config_input");
  const body = deepFreezeComposerValue({
    schemaVersion: "composer_streaming_latency_run_config_v1" as const,
    authorityVersion: COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
    runnerVersion: COMPOSER_STREAMING_LATENCY_RUNNER_VERSION,
    definitionHash: COMPOSER_STREAMING_LATENCY_DEFINITION_HASH_V1,
    modelHash: hashComposerValue(model),
    providerOriginHash: hashComposerValue(COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN),
    providerEndpointHash: hashComposerValue(COMPOSER_STREAMING_LATENCY_ENDPOINT_PATH),
    promptHash,
    schemaOutputVersion: "composer_shadow_output_v1" as const,
    incrementalDecoderVersion: "incremental_reply_decoder_v1" as const,
    temperature: 0 as const,
    stream: true as const,
    enableThinking: false as const,
    responseFormat: "json_object" as const,
    timeoutMs: COMPOSER_STREAMING_LATENCY_TIMEOUT_MS,
    contextLimitBytes: COMPOSER_STREAMING_LATENCY_CONTEXT_LIMIT_BYTES,
    contextBands: COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1,
    dayTargets: COMPOSER_STREAMING_LATENCY_DAY_TARGETS,
    bootstrapSeed: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_SEED as 1729,
    bootstrapReplicates: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_REPLICATES as 1000,
    bootstrapMethod: "percentile_bootstrap_nearest_rank_v1" as const,
  });
  return deepFreezeComposerValue({ ...body, runConfigHash: hashComposerValue(body) });
};

export type ComposerStreamingLatencyObservationV1 = Readonly<{
  schemaVersion: "composer_streaming_latency_observation_v1";
  authorityVersion: typeof COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION;
  sequence: number;
  processInstanceHash: string;
  processObservationIndex: number;
  sampleRole: "warmup" | "hot";
  processTemperature: "cold" | "hot";
  createdAt: string;
  sampleDate: string;
  dayIndex: 1 | 2 | 3;
  runConfigHash: string;
  modelHash: string;
  contextBand: ComposerLatencyContextBandV1;
  contextInputHash: string;
  inputBytes: number;
  attemptIdHash: string;
  stream: true;
  firstAttempt: true;
  calls: 1;
  repairUsed: false;
  status: ComposerLatencyStatusV1;
  httpStatusClass: null | "4xx" | "5xx";
  queueDelayMs: number;
  providerFirstByteMs: number | null;
  firstReplyCharMs: number | null;
  firstCompleteCandidateSegmentMs: number | null;
  totalGenerationMs: number | null;
  strictResultMs: number | null;
  segmentCount: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  outputHash: string | null;
  previousRowHash: string | null;
  rowHash: string;
}>;

const OBSERVATION_KEYS = [
  "schemaVersion", "authorityVersion", "sequence", "processInstanceHash", "processObservationIndex", "sampleRole", "processTemperature",
  "createdAt", "sampleDate", "dayIndex", "runConfigHash", "modelHash", "contextBand", "contextInputHash", "inputBytes", "attemptIdHash",
  "stream", "firstAttempt", "calls", "repairUsed", "status", "httpStatusClass", "queueDelayMs", "providerFirstByteMs", "firstReplyCharMs",
  "firstCompleteCandidateSegmentMs", "totalGenerationMs", "strictResultMs", "segmentCount", "promptTokens", "completionTokens", "outputHash",
  "previousRowHash", "rowHash",
] as const;

export function assertComposerStreamingLatencyObservationV1(value: unknown, config: ComposerStreamingLatencyRunConfigV1): asserts value is ComposerStreamingLatencyObservationV1 {
  if (!record(value) || !exactKeys(value, OBSERVATION_KEYS)) throw new Error("streaming_latency_observation_shape");
  if (value.schemaVersion !== "composer_streaming_latency_observation_v1" || value.authorityVersion !== COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION) throw new Error("streaming_latency_observation_version");
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1 || !Number.isInteger(value.processObservationIndex) || Number(value.processObservationIndex) < 1) throw new Error("streaming_latency_observation_index");
  if (![value.processInstanceHash, value.runConfigHash, value.modelHash, value.contextInputHash, value.attemptIdHash, value.rowHash].every((item) => typeof item === "string" && SHA256.test(item)) || !(value.previousRowHash === null || (typeof value.previousRowHash === "string" && SHA256.test(value.previousRowHash)))) throw new Error("streaming_latency_observation_hash");
  if (value.runConfigHash !== config.runConfigHash || value.modelHash !== config.modelHash || !BANDS.includes(value.contextBand as ComposerLatencyContextBandV1)) throw new Error("streaming_latency_observation_config");
  const band = value.contextBand as ComposerLatencyContextBandV1;
  if (value.contextInputHash !== config.contextBands[band].inputHash || value.inputBytes !== config.contextBands[band].inputBytes) throw new Error("streaming_latency_observation_context");
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) || typeof value.sampleDate !== "string" || !DATE.test(value.sampleDate) || ![1, 2, 3].includes(Number(value.dayIndex))) throw new Error("streaming_latency_observation_date");
  if (!STATUSES.includes(value.status as ComposerLatencyStatusV1) || value.stream !== true || value.firstAttempt !== true || value.calls !== 1 || value.repairUsed !== false) throw new Error("streaming_latency_observation_call_contract");
  if (!nonNegative(value.queueDelayMs) || ![value.providerFirstByteMs, value.firstReplyCharMs, value.firstCompleteCandidateSegmentMs, value.totalGenerationMs, value.strictResultMs].every(nullableNonNegative) || !nullableInteger(value.segmentCount) || !nullableInteger(value.promptTokens) || !nullableInteger(value.completionTokens)) throw new Error("streaming_latency_observation_metrics");
  if (!((value.httpStatusClass === null) || value.httpStatusClass === "4xx" || value.httpStatusClass === "5xx")) throw new Error("streaming_latency_observation_http_status");
  if (value.status === "success") {
    if (![value.providerFirstByteMs, value.firstReplyCharMs, value.firstCompleteCandidateSegmentMs, value.totalGenerationMs, value.strictResultMs].every(nonNegative) || !SHA256.test(String(value.outputHash)) || value.httpStatusClass !== null || !Number.isInteger(value.segmentCount) || Number(value.segmentCount) < 1) throw new Error("streaming_latency_success_invariant");
    if (!(Number(value.providerFirstByteMs) <= Number(value.firstReplyCharMs) && Number(value.firstReplyCharMs) <= Number(value.firstCompleteCandidateSegmentMs) && Number(value.firstCompleteCandidateSegmentMs) <= Number(value.totalGenerationMs) && Number(value.totalGenerationMs) <= Number(value.strictResultMs))) throw new Error("streaming_latency_timing_order");
  } else if (value.outputHash !== null) throw new Error("streaming_latency_failure_output");
  if ((value.status === "http_4xx") !== (value.httpStatusClass === "4xx") || (value.status === "http_5xx") !== (value.httpStatusClass === "5xx")) throw new Error("streaming_latency_http_binding");
  if (value.sampleRole === "warmup") {
    if (value.processTemperature !== "cold" || value.processObservationIndex !== 1 || value.contextBand !== "short") throw new Error("streaming_latency_warmup_invariant");
  } else if (value.sampleRole === "hot") {
    if (value.processTemperature !== "hot" || Number(value.processObservationIndex) < 2) throw new Error("streaming_latency_hot_invariant");
  } else throw new Error("streaming_latency_sample_role");
  const { rowHash: ignored, ...body } = value;
  void ignored;
  if (value.rowHash !== hashComposerValue(body)) throw new Error("streaming_latency_row_hash");
}

export const assertComposerStreamingLatencyEvidenceV1 = (rows: readonly unknown[], config: ComposerStreamingLatencyRunConfigV1) => {
  let previous: string | null = null;
  const dates: string[] = [];
  const processWarmups = new Map<string, boolean>();
  rows.forEach((row, index) => {
    assertComposerStreamingLatencyObservationV1(row, config);
    if (row.sequence !== index + 1 || row.previousRowHash !== previous) throw new Error("streaming_latency_chain");
    previous = row.rowHash;
    if (!dates.includes(row.sampleDate)) dates.push(row.sampleDate);
    if (dates.length > 3 || [...dates].sort().join("\0") !== dates.join("\0") || row.dayIndex !== dates.indexOf(row.sampleDate) + 1) throw new Error("streaming_latency_day_binding");
    if (row.sampleRole === "warmup") {
      if (processWarmups.has(row.processInstanceHash)) throw new Error("streaming_latency_duplicate_process_warmup");
      processWarmups.set(row.processInstanceHash, row.status === "success");
    } else if (processWarmups.get(row.processInstanceHash) !== true) throw new Error("streaming_latency_hot_without_successful_warmup");
  });
  return deepFreezeComposerValue(rows as readonly ComposerStreamingLatencyObservationV1[]);
};

const emptyBandCounts = () => ({ short: 0, medium: 0, near_bound: 0 });
export const summarizeComposerStreamingLatencyEvidenceV1 = (rows: readonly ComposerStreamingLatencyObservationV1[], config: ComposerStreamingLatencyRunConfigV1) => {
  assertComposerStreamingLatencyEvidenceV1(rows, config);
  const byDate: Record<string, ReturnType<typeof emptyBandCounts>> = {};
  const failures: Record<Exclude<ComposerLatencyStatusV1, "success">, number> = { http_4xx: 0, http_5xx: 0, provider_error: 0, timed_out: 0, malformed: 0, hard_binding_failed: 0 };
  for (const row of rows) {
    if (row.sampleRole !== "hot") continue;
    if (row.status === "success") {
      byDate[row.sampleDate] ??= emptyBandCounts();
      byDate[row.sampleDate][row.contextBand] += 1;
    } else failures[row.status] += 1;
  }
  const successfulHot = rows.filter((row) => row.sampleRole === "hot" && row.status === "success");
  return deepFreezeComposerValue({
    runConfigHash: config.runConfigHash,
    dates: Object.keys(byDate).sort(),
    successfulHotCount: successfulHot.length,
    successfulByDateBand: byDate,
    failureCounts: failures,
  });
};

const percentile = (sorted: readonly number[], probability: number) => sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
export const computeComposerStreamingLatencyBootstrapV1 = (rows: readonly ComposerStreamingLatencyObservationV1[], config: ComposerStreamingLatencyRunConfigV1) => {
  const summary = summarizeComposerStreamingLatencyEvidenceV1(rows, config);
  const values = rows.filter((row) => row.sampleRole === "hot" && row.status === "success").map((row) => row.firstCompleteCandidateSegmentMs as number);
  if (summary.dates.length !== 3 || values.length < 200 || summary.dates.some((date, index) => Object.values(summary.successfulByDateBand[date]).reduce((sum, count) => sum + count, 0) < 50 || index > 2)) throw new Error("streaming_latency_bootstrap_gate");
  if (BANDS.some((band) => values.length > 0 && rows.filter((row) => row.sampleRole === "hot" && row.status === "success" && row.contextBand === band).length === 0)) throw new Error("streaming_latency_band_coverage");
  let state = COMPOSER_STREAMING_LATENCY_BOOTSTRAP_SEED >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
  const estimates: number[] = [];
  for (let replicate = 0; replicate < COMPOSER_STREAMING_LATENCY_BOOTSTRAP_REPLICATES; replicate += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]).sort((a, b) => a - b);
    estimates.push(percentile(sample, 0.95));
  }
  estimates.sort((a, b) => a - b);
  const p95Ms = percentile([...values].sort((a, b) => a - b), 0.95);
  const lower95Ms = percentile(estimates, 0.025);
  const upper95Ms = percentile(estimates, 0.975);
  const halfWidthRatio = p95Ms === 0 ? (upper95Ms === lower95Ms ? 0 : Number.POSITIVE_INFINITY) : (upper95Ms - lower95Ms) / 2 / p95Ms;
  const needs400 = halfWidthRatio > 0.15 && values.length < 400;
  const unstable = halfWidthRatio > 0.15 && values.length >= 400;
  const budgetCandidateMs = unstable ? null : upper95Ms <= 700 ? 700 : upper95Ms <= 1_200 ? 1_200 : null;
  const body = deepFreezeComposerValue({
    schemaVersion: "composer_streaming_latency_bootstrap_result_v1" as const,
    authorityVersion: COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
    runConfigHash: config.runConfigHash,
    evidenceHash: hashComposerValue(rows),
    method: "percentile_bootstrap_nearest_rank_v1" as const,
    seed: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_SEED,
    replicates: COMPOSER_STREAMING_LATENCY_BOOTSTRAP_REPLICATES,
    sampleCount: values.length,
    p95Ms,
    lower95Ms,
    upper95Ms,
    halfWidthRatio,
    status: needs400 ? "extend_to_400" as const : unstable ? "unstable" as const : "stable" as const,
    budgetCandidateMs,
    p1OverallUpgraded: false as const,
  });
  return deepFreezeComposerValue({ ...body, resultHash: hashComposerValue(body) });
};

export const buildComposerStreamingLatencyRowV1 = (body: Omit<ComposerStreamingLatencyObservationV1, "rowHash">) =>
  deepFreezeComposerValue({ ...body, rowHash: hashComposerValue(body) });

export const sha256Bytes = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
