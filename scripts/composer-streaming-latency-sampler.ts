import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  IncrementalReplyDecoderV1,
  hashComposerValue,
  parseComposerShadowOutputV1,
} from "../lib/composer-shadow-v1";
import {
  COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
  COMPOSER_STREAMING_LATENCY_CONFIG_PATH,
  COMPOSER_STREAMING_LATENCY_CONTEXTS_V1,
  COMPOSER_STREAMING_LATENCY_DAY_TARGETS,
  COMPOSER_STREAMING_LATENCY_ENDPOINT_PATH,
  COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR,
  COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN,
  COMPOSER_STREAMING_LATENCY_ROWS_PATH,
  COMPOSER_STREAMING_LATENCY_TIMEOUT_MS,
  assertComposerStreamingLatencyEvidenceV1,
  buildComposerStreamingLatencyRowV1,
  computeComposerStreamingLatencyBootstrapV1,
  createComposerStreamingLatencyRunConfigV1,
  summarizeComposerStreamingLatencyEvidenceV1,
  type ComposerLatencyContextBandV1,
  type ComposerLatencyStatusV1,
  type ComposerStreamingLatencyObservationV1,
  type ComposerStreamingLatencyRunConfigV1,
} from "../lib/composer-streaming-latency-authority";
import {
  COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1,
  buildComposerOutputSchemaPromptV1,
} from "./composer-shadow-qwen-local";

const LOCK_PATH = `${COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR}/collector.lock`;
const BANDS = ["short", "medium", "near_bound"] as const;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_RESPONSE_CHARS = 262_144;
const EXTENDED_DAY_THREE_TARGET = Object.freeze({ short: 184, medium: 52, near_bound: 24 });
type TokenUsage = Readonly<{ promptTokens: number | null; completionTokens: number | null }>;
type AttemptMetrics = Readonly<{
  status: ComposerLatencyStatusV1;
  httpStatusClass: null | "4xx" | "5xx";
  queueDelayMs: number;
  providerFirstByteMs: number | null;
  firstReplyCharMs: number | null;
  firstCompleteCandidateSegmentMs: number | null;
  totalGenerationMs: number | null;
  strictResultMs: number | null;
  segmentCount: number | null;
  usage: TokenUsage;
  outputHash: string | null;
}>;

const shanghaiDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const roundMs = (value: number | null) => value === null ? null : Math.round(value * 1_000) / 1_000;
const integerOrNull = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
const exactConfig = (value: unknown, expected: ComposerStreamingLatencyRunConfigV1): value is ComposerStreamingLatencyRunConfigV1 =>
  hashComposerValue(value) === hashComposerValue(expected);

const endpointFor = (baseUrl: string) => {
  const parsed = new URL(baseUrl);
  assert.equal(parsed.origin, COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN, "streaming_latency_origin_mismatch");
  assert.equal(parsed.username, "", "streaming_latency_url_credentials_forbidden");
  assert.equal(parsed.password, "", "streaming_latency_url_credentials_forbidden");
  assert.equal(parsed.search, "", "streaming_latency_url_query_forbidden");
  assert.equal(parsed.hash, "", "streaming_latency_url_hash_forbidden");
  const basePath = parsed.pathname.replace(/\/$/u, "");
  assert.equal(basePath, "/compatible-mode/v1", "streaming_latency_base_path_mismatch");
  return `${COMPOSER_STREAMING_LATENCY_OFFICIAL_ORIGIN}${COMPOSER_STREAMING_LATENCY_ENDPOINT_PATH}`;
};

const parseSseFrame = (frame: string) => frame
  .split("\n")
  .filter((line) => line.startsWith("data:"))
  .map((line) => line.slice(5).trim())
  .join("\n");

export const runComposerStreamingAttemptMechanismV1 = async ({
  apiKey,
  baseUrl,
  model,
  contextBand,
  fetchImpl = fetch,
}: Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
  contextBand: ComposerLatencyContextBandV1;
  fetchImpl?: typeof fetch;
}>): Promise<AttemptMetrics> => {
  assert(apiKey && model, "streaming_latency_credentials_or_model_missing");
  const input = COMPOSER_STREAMING_LATENCY_CONTEXTS_V1[contextBand];
  const prompt = buildComposerOutputSchemaPromptV1({ input, attempt: 1, priorFailure: null });
  const eligibleAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), COMPOSER_STREAMING_LATENCY_TIMEOUT_MS);
  const dispatchAt = performance.now();
  let firstByteAt: number | null = null;
  let providerDoneAt: number | null = null;
  let raw = "";
  let usage: TokenUsage = { promptTokens: null, completionTokens: null };
  const decoder = new IncrementalReplyDecoderV1({ nowMs: () => performance.now() });
  try {
    const response = await fetchImpl(endpointFor(baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Request-Tag": "composer-shadow-local-synthetic-streaming-latency-v1",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
        temperature: 0,
        stream: true,
        stream_options: { include_usage: true },
        enable_thinking: false,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const status = response.status >= 500 ? "http_5xx" as const : "http_4xx" as const;
      return {
        status,
        httpStatusClass: status === "http_5xx" ? "5xx" : "4xx",
        queueDelayMs: roundMs(dispatchAt - eligibleAt)!,
        providerFirstByteMs: null,
        firstReplyCharMs: null,
        firstCompleteCandidateSegmentMs: null,
        totalGenerationMs: null,
        strictResultMs: null,
        segmentCount: null,
        usage,
        outputHash: null,
      };
    }
    assert(response.body, "streaming_latency_missing_response_body");
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    let buffer = "";
    const processFrame = (frame: string) => {
      const data = parseSseFrame(frame);
      if (!data || data === "[DONE]") return;
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        raw += content;
        if (raw.length > MAX_RESPONSE_CHARS) throw new Error("streaming_latency_response_too_large");
        decoder.push(content);
      }
      if (parsed.usage) usage = { promptTokens: integerOrNull(parsed.usage.prompt_tokens), completionTokens: integerOrNull(parsed.usage.completion_tokens) };
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > 0) firstByteAt ??= performance.now();
      buffer += textDecoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/gu, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        processFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += textDecoder.decode();
    if (buffer.trim()) processFrame(buffer);
    decoder.finish();
    providerDoneAt = performance.now();
    const strict = parseComposerShadowOutputV1(raw, input);
    const parseDoneAt = performance.now();
    const common = {
      queueDelayMs: roundMs(dispatchAt - eligibleAt)!,
      providerFirstByteMs: roundMs(firstByteAt === null ? null : firstByteAt - dispatchAt),
      firstReplyCharMs: roundMs(decoder.firstReplyCharAt === null ? null : decoder.firstReplyCharAt - dispatchAt),
      firstCompleteCandidateSegmentMs: roundMs(decoder.firstSegmentAt === null ? null : decoder.firstSegmentAt - dispatchAt),
      totalGenerationMs: roundMs(providerDoneAt - dispatchAt),
      strictResultMs: roundMs(parseDoneAt - dispatchAt),
      segmentCount: decoder.segmentCount,
      usage,
    };
    if (!strict.ok) return { ...common, status: strict.kind === "binding" ? "hard_binding_failed" : "malformed", httpStatusClass: null, outputHash: null };
    return { ...common, status: "success", httpStatusClass: null, outputHash: hashComposerValue(strict.output) };
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    return {
      status: timedOut ? "timed_out" : "provider_error",
      httpStatusClass: null,
      queueDelayMs: roundMs(dispatchAt - eligibleAt)!,
      providerFirstByteMs: roundMs(firstByteAt === null ? null : firstByteAt - dispatchAt),
      firstReplyCharMs: roundMs(decoder.firstReplyCharAt === null ? null : decoder.firstReplyCharAt - dispatchAt),
      firstCompleteCandidateSegmentMs: roundMs(decoder.firstSegmentAt === null ? null : decoder.firstSegmentAt - dispatchAt),
      totalGenerationMs: roundMs(providerDoneAt === null ? null : providerDoneAt - dispatchAt),
      strictResultMs: null,
      segmentCount: decoder.segmentCount || null,
      usage,
      outputHash: null,
    };
  } finally {
    clearTimeout(timer);
  }
};

const readRows = async (config: ComposerStreamingLatencyRunConfigV1) => {
  let text = "";
  try { text = await readFile(COMPOSER_STREAMING_LATENCY_ROWS_PATH, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const rows = text.trim() ? text.trimEnd().split("\n").map((line) => JSON.parse(line) as unknown) : [];
  return assertComposerStreamingLatencyEvidenceV1(rows, config) as readonly ComposerStreamingLatencyObservationV1[];
};

const writeOrAssertConfig = async (config: ComposerStreamingLatencyRunConfigV1) => {
  await mkdir(COMPOSER_STREAMING_LATENCY_EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  try {
    const existing = JSON.parse(await readFile(COMPOSER_STREAMING_LATENCY_CONFIG_PATH, "utf8")) as unknown;
    if (!exactConfig(existing, config)) throw new Error("streaming_latency_run_config_mismatch");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(COMPOSER_STREAMING_LATENCY_CONFIG_PATH, `${JSON.stringify(config)}\n`, { mode: 0o600, flag: "wx" });
  }
};

const appendRow = async (row: ComposerStreamingLatencyObservationV1, config: ComposerStreamingLatencyRunConfigV1) => {
  const before = await readRows(config);
  if (row.sequence !== before.length + 1 || row.previousRowHash !== (before.at(-1)?.rowHash ?? null)) throw new Error("streaming_latency_append_race");
  await appendFile(COMPOSER_STREAMING_LATENCY_ROWS_PATH, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  await readRows(config);
};

const uniqueDates = (rows: readonly ComposerStreamingLatencyObservationV1[]) => [...new Set(rows.map((row) => row.sampleDate))];
const countsFor = (rows: readonly ComposerStreamingLatencyObservationV1[], date: string) => Object.fromEntries(BANDS.map((band) => [band, rows.filter((row) => row.sampleRole === "hot" && row.status === "success" && row.sampleDate === date && row.contextBand === band).length])) as Record<ComposerLatencyContextBandV1, number>;
const meets = (counts: Record<ComposerLatencyContextBandV1, number>, target: Readonly<Record<ComposerLatencyContextBandV1, number>>) => BANDS.every((band) => counts[band] >= target[band]);

const resolveDay = (rows: readonly ComposerStreamingLatencyObservationV1[], today: string) => {
  const dates = uniqueDates(rows);
  if (dates.length === 0) return 1 as const;
  const existing = dates.indexOf(today);
  if (existing >= 0) return (existing + 1) as 1 | 2 | 3;
  const latest = dates.at(-1)!;
  if (today < latest || dates.length >= 3) throw new Error("streaming_latency_calendar_day_closed");
  const priorIndex = dates.length as 1 | 2;
  if (!meets(countsFor(rows, latest), COMPOSER_STREAMING_LATENCY_DAY_TARGETS[priorIndex])) throw new Error("streaming_latency_prior_day_incomplete");
  return (dates.length + 1) as 2 | 3;
};

const plannedTarget = (rows: readonly ComposerStreamingLatencyObservationV1[], config: ComposerStreamingLatencyRunConfigV1, dayIndex: 1 | 2 | 3, today: string) => {
  if (dayIndex !== 3) return COMPOSER_STREAMING_LATENCY_DAY_TARGETS[dayIndex];
  const dates = uniqueDates(rows);
  if (dates.length === 3 && meets(countsFor(rows, today), COMPOSER_STREAMING_LATENCY_DAY_TARGETS[3])) {
    const bootstrap = computeComposerStreamingLatencyBootstrapV1(rows, config);
    if (bootstrap.status === "extend_to_400") return EXTENDED_DAY_THREE_TARGET;
  }
  return COMPOSER_STREAMING_LATENCY_DAY_TARGETS[3];
};

const scheduleFor = (counts: Record<ComposerLatencyContextBandV1, number>, target: Readonly<Record<ComposerLatencyContextBandV1, number>>) => {
  const remaining = Object.fromEntries(BANDS.map((band) => [band, Math.max(0, target[band] - counts[band])])) as Record<ComposerLatencyContextBandV1, number>;
  const schedule: ComposerLatencyContextBandV1[] = [];
  while (BANDS.some((band) => remaining[band] > 0)) for (const band of BANDS) if (remaining[band] > 0) { schedule.push(band); remaining[band] -= 1; }
  return schedule;
};

const publicStatus = (rows: readonly ComposerStreamingLatencyObservationV1[], config: ComposerStreamingLatencyRunConfigV1) => {
  const summary = summarizeComposerStreamingLatencyEvidenceV1(rows, config);
  let bootstrap: ReturnType<typeof computeComposerStreamingLatencyBootstrapV1> | null = null;
  try { bootstrap = computeComposerStreamingLatencyBootstrapV1(rows, config); } catch { /* not eligible yet */ }
  return Object.freeze({
    schemaVersion: "composer_streaming_latency_public_status_v1" as const,
    authorityVersion: COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
    runConfigHash: config.runConfigHash,
    contextBands: config.contextBands,
    dayTargets: config.dayTargets,
    successfulHotCount: summary.successfulHotCount,
    successfulByDateBand: summary.successfulByDateBand,
    failureCounts: summary.failureCounts,
    bootstrap,
    productionWrites: 0 as const,
    databaseWrites: 0 as const,
    realUserRows: 0 as const,
  });
};

const collectToday = async (config: ComposerStreamingLatencyRunConfigV1, credentials: Readonly<{ apiKey: string; baseUrl: string; model: string }>) => {
  const lock = await open(LOCK_PATH, "wx", 0o600);
  try {
    let rows = await readRows(config);
    const today = shanghaiDate();
    const dayIndex = resolveDay(rows, today);
    let target = plannedTarget(rows, config, dayIndex, today);
    let schedule = scheduleFor(countsFor(rows, today), target);
    if (schedule.length === 0) return publicStatus(rows, config);
    const processInstanceHash = hashComposerValue(randomBytes(32).toString("hex"));
    let processObservationIndex = 1;
    const makeRow = (contextBand: ComposerLatencyContextBandV1, sampleRole: "warmup" | "hot", metrics: AttemptMetrics) => buildComposerStreamingLatencyRowV1({
      schemaVersion: "composer_streaming_latency_observation_v1",
      authorityVersion: COMPOSER_STREAMING_LATENCY_AUTHORITY_VERSION,
      sequence: rows.length + 1,
      processInstanceHash,
      processObservationIndex,
      sampleRole,
      processTemperature: sampleRole === "warmup" ? "cold" : "hot",
      createdAt: new Date().toISOString(),
      sampleDate: today,
      dayIndex,
      runConfigHash: config.runConfigHash,
      modelHash: config.modelHash,
      contextBand,
      contextInputHash: config.contextBands[contextBand].inputHash,
      inputBytes: config.contextBands[contextBand].inputBytes,
      attemptIdHash: hashComposerValue({ processInstanceHash, processObservationIndex, contextBand, sampleRole }),
      stream: true,
      firstAttempt: true,
      calls: 1,
      repairUsed: false,
      status: metrics.status,
      httpStatusClass: metrics.httpStatusClass,
      queueDelayMs: metrics.queueDelayMs,
      providerFirstByteMs: metrics.providerFirstByteMs,
      firstReplyCharMs: metrics.firstReplyCharMs,
      firstCompleteCandidateSegmentMs: metrics.firstCompleteCandidateSegmentMs,
      totalGenerationMs: metrics.totalGenerationMs,
      strictResultMs: metrics.strictResultMs,
      segmentCount: metrics.segmentCount,
      promptTokens: metrics.usage.promptTokens,
      completionTokens: metrics.usage.completionTokens,
      outputHash: metrics.outputHash,
      previousRowHash: rows.at(-1)?.rowHash ?? null,
    });
    const warmupMetrics = await runComposerStreamingAttemptMechanismV1({ ...credentials, contextBand: "short" });
    const warmup = makeRow("short", "warmup", warmupMetrics);
    await appendRow(warmup, config);
    rows = [...rows, warmup];
    if (warmup.status !== "success") throw new Error("streaming_latency_warmup_failed");
    processObservationIndex += 1;
    let consecutiveFailures = 0;
    let newlySuccessful = 0;
    while (schedule.length > 0) {
      const contextBand = schedule[0];
      const metrics = await runComposerStreamingAttemptMechanismV1({ ...credentials, contextBand });
      const row = makeRow(contextBand, "hot", metrics);
      await appendRow(row, config);
      rows = [...rows, row];
      processObservationIndex += 1;
      if (row.status === "success") {
        consecutiveFailures = 0;
        newlySuccessful += 1;
        schedule.shift();
        if (newlySuccessful % 10 === 0) {
          const counts = countsFor(rows, today);
          process.stdout.write(`${JSON.stringify({ status: "collecting", runConfigHash: config.runConfigHash, sampleDate: today, dayIndex, successfulToday: Object.values(counts).reduce((sum, value) => sum + value, 0), remainingToday: schedule.length })}\n`);
        }
      } else {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw new Error("streaming_latency_consecutive_failures");
      }
      target = plannedTarget(rows, config, dayIndex, today);
      schedule = scheduleFor(countsFor(rows, today), target);
    }
    return publicStatus(rows, config);
  } finally {
    await lock.close();
    await unlink(LOCK_PATH).catch(() => undefined);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  assert.equal(args.length, 1, "Exactly one local streaming latency mode is required.");
  assert(["--status", "--check-config", "--collect-today", "--finalize"].includes(args[0]), "Unknown streaming latency mode.");
  assert.equal(process.env.COMPOSER_SHADOW_SYNTHETIC_ONLY, "true", "COMPOSER_SHADOW_SYNTHETIC_ONLY=true is required.");
  const apiKey = process.env.QWEN_API_KEY?.trim();
  const baseUrl = process.env.QWEN_BASE_URL?.trim();
  const model = process.env.COMPOSER_SHADOW_QWEN_MODEL?.trim() || "qwen3.7-max";
  assert(apiKey && baseUrl, "Ordinary QWEN_API_KEY and QWEN_BASE_URL are required from local environment.");
  endpointFor(baseUrl);
  const config = createComposerStreamingLatencyRunConfigV1({ model, promptHash: COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1 });
  await writeOrAssertConfig(config);
  const rows = await readRows(config);
  if (args[0] === "--check-config") {
    process.stdout.write(`${JSON.stringify({ status: "config_exact", runConfigHash: config.runConfigHash, contextBands: config.contextBands })}\n`);
    return;
  }
  if (args[0] === "--status") {
    process.stdout.write(`${JSON.stringify(publicStatus(rows, config))}\n`);
    return;
  }
  if (args[0] === "--finalize") {
    const result = computeComposerStreamingLatencyBootstrapV1(rows, config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const status = await collectToday(config, { apiKey, baseUrl, model });
  process.stdout.write(`${JSON.stringify(status)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
