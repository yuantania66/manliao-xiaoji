import assert from "node:assert/strict";

import { hashComposerValue } from "../lib/composer-shadow-v1";
import {
  COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
  COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1,
  COMPOSER_STREAMING_LATENCY_DAY_TARGETS,
  COMPOSER_STREAMING_LATENCY_DEFINITION_HASH_V1,
  assertComposerStreamingLatencyEvidenceV1,
  assertComposerStreamingLatencyObservationV1,
  buildComposerStreamingLatencyRowV1,
  computeComposerStreamingLatencyBootstrapV1,
  createComposerStreamingLatencyRunConfigV1,
  type ComposerLatencyContextBandV1,
  type ComposerStreamingLatencyObservationV1,
} from "../lib/composer-streaming-latency-authority";
import { COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1 } from "./composer-shadow-qwen-local";
import { runComposerStreamingAttemptMechanismV1 } from "./composer-streaming-latency-sampler";

const main = async () => {
const config = createComposerStreamingLatencyRunConfigV1({ model: "qwen3.7-max", promptHash: COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1 });
assert.equal(config.definitionHash, COMPOSER_STREAMING_LATENCY_DEFINITION_HASH_V1);
assert.equal(config.stream, true);
assert.equal(config.enableThinking, false);
assert.equal(config.temperature, 0);
assert(COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1.short.inputBytes < 4_096);
assert(COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1.medium.inputBytes >= 16_384 && COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1.medium.inputBytes <= 24_576);
assert(COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1.near_bound.inputBytes >= 56_000 && COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1.near_bound.inputBytes < 65_536);

const dates = ["2026-08-26", "2026-08-27", "2026-08-28"] as const;
const rows: ComposerStreamingLatencyObservationV1[] = [];
const add = ({ date, dayIndex, processHash, processIndex, role, band, latency = 600 }: {
  date: string;
  dayIndex: 1 | 2 | 3;
  processHash: string;
  processIndex: number;
  role: "warmup" | "hot";
  band: ComposerLatencyContextBandV1;
  latency?: number;
}) => {
  const body = {
    schemaVersion: "composer_streaming_latency_observation_v1" as const,
    authorityVersion: COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
    sequence: rows.length + 1,
    processInstanceHash: processHash,
    processObservationIndex: processIndex,
    sampleRole: role,
    processTemperature: role === "warmup" ? "cold" as const : "hot" as const,
    createdAt: `${date}T02:00:00.000Z`,
    sampleDate: date,
    dayIndex,
    runConfigHash: config.runConfigHash,
    modelHash: config.modelHash,
    contextBand: band,
    contextInputHash: config.contextBands[band].inputHash,
    inputBytes: config.contextBands[band].inputBytes,
    attemptIdHash: hashComposerValue({ date, processIndex, band, role }),
    stream: true as const,
    firstAttempt: true as const,
    calls: 1 as const,
    repairUsed: false as const,
    status: "success" as const,
    httpStatusClass: null,
    queueDelayMs: 0.1,
    providerFirstByteMs: 10,
    firstReplyCharMs: 100,
    firstCompleteCandidateSegmentMs: latency,
    totalGenerationMs: latency + 100,
    strictResultMs: latency + 101,
    segmentCount: 1,
    promptTokens: 10,
    completionTokens: 8,
    outputHash: hashComposerValue({ date, processIndex, band }),
    previousRowHash: rows.at(-1)?.rowHash ?? null,
  };
  rows.push(buildComposerStreamingLatencyRowV1(body));
};

for (const [dateOffset, date] of dates.entries()) {
  const dayIndex = (dateOffset + 1) as 1 | 2 | 3;
  const processHash = hashComposerValue({ date, kind: "process" });
  add({ date, dayIndex, processHash, processIndex: 1, role: "warmup", band: "short" });
  let processIndex = 2;
  for (const band of ["short", "medium", "near_bound"] as const) {
    for (let index = 0; index < COMPOSER_STREAMING_LATENCY_DAY_TARGETS[dayIndex][band]; index += 1) {
      add({ date, dayIndex, processHash, processIndex, role: "hot", band });
      processIndex += 1;
    }
  }
}

assert.equal(rows.filter((row) => row.sampleRole === "hot").length, 200);
assertComposerStreamingLatencyEvidenceV1(rows, config);
const bootstrap = computeComposerStreamingLatencyBootstrapV1(rows, config);
assert.equal(bootstrap.status, "stable");
assert.equal(bootstrap.sampleCount, 200);
assert.equal(bootstrap.p95Ms, 600);
assert.equal(bootstrap.budgetCandidateMs, 700);
assert.equal(bootstrap.p1OverallUpgraded, false);

assert.throws(() => computeComposerStreamingLatencyBootstrapV1(rows.slice(0, -1), config), /bootstrap_gate/u);
const hot = rows.find((row) => row.sampleRole === "hot")!;
const { rowHash: ignoredRowHash, ...hotBody } = hot;
void ignoredRowHash;
const invalidStream = buildComposerStreamingLatencyRowV1({ ...hotBody, stream: false } as never);
assert.throws(() => assertComposerStreamingLatencyObservationV1(invalidStream, config), /call_contract/u);
const invalidRepair = buildComposerStreamingLatencyRowV1({ ...hotBody, repairUsed: true, calls: 2 } as never);
assert.throws(() => assertComposerStreamingLatencyObservationV1(invalidRepair, config), /call_contract/u);
const invalidConfig = buildComposerStreamingLatencyRowV1({ ...hotBody, runConfigHash: hashComposerValue("changed") } as never);
assert.throws(() => assertComposerStreamingLatencyObservationV1(invalidConfig, config), /observation_config/u);

const strictOutput = JSON.stringify({
  schemaVersion: "composer_shadow_output_v1",
  turnId: hashComposerValue({ band: "short", kind: "synthetic_turn" }),
  purpose: "accompany",
  reply: "这是合成流式回复。",
  episodeRef: null,
  groundingRefs: [],
  eventRef: null,
});
const encoder = new TextEncoder();
const events = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: strictOutput.slice(0, 35) } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { content: strictOutput.slice(35) } }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 9 } })}\n\n`,
  "data: [DONE]\n\n",
];
let capturedUrl = "";
let capturedBody: Record<string, unknown> | null = null;
const fetchImpl: typeof fetch = async (input, init) => {
  capturedUrl = String(input);
  capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
};
const streamed = await runComposerStreamingAttemptMechanismV1({
  apiKey: "synthetic-check-key",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3.7-max",
  contextBand: "short",
  fetchImpl,
});
assert.equal(capturedUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
assert(capturedBody !== null);
const requestBody = capturedBody as Record<string, unknown>;
assert.equal(requestBody.stream, true);
assert.equal(requestBody.enable_thinking, false);
assert.deepEqual(requestBody.stream_options, { include_usage: true });
assert.equal(streamed.status, "success");
assert.equal(streamed.usage.promptTokens, 11);
assert.equal(streamed.usage.completionTokens, 9);
assert(streamed.firstCompleteCandidateSegmentMs !== null);
const serialized = JSON.stringify({ config, streamed, bootstrap });
assert(!serialized.includes("synthetic-check-key"));
assert(!serialized.includes("这是合成流式回复"));
assert(!serialized.includes("dashscope.aliyuncs.com"));

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  definitionHash: COMPOSER_STREAMING_LATENCY_DEFINITION_HASH_V1,
  runConfigHash: config.runConfigHash,
  contextBands: COMPOSER_STREAMING_LATENCY_CONTEXT_DESCRIPTORS_V1,
  syntheticHotRows: 200,
  streamRequestVerified: true,
  bootstrapMethodVerified: true,
  plaintextInEvidence: false,
  productionWrites: 0,
  databaseWrites: 0,
})}\n`);
};

void main();
