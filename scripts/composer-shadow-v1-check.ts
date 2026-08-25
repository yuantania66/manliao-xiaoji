import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  InMemoryHashCountObservationSinkV1,
  buildHashCountObservationV1,
  buildComposerShadowInputFromSnapshotV1,
  buildPairedDeterministicReportV1,
  assertComposerShadowInputV1,
  deepFreezeComposerValue,
  hashComposerValue,
  parseComposerShadowOutputV1,
  runComposerShadowV1,
  evaluateComposerShadowCaseV1,
  type ComposerShadowInputV1,
  type MonotonicClock,
  type ShadowProviderV1,
  type V1ResultSnapshot,
} from "../lib/composer-shadow-v1";
import {
  SYNTHETIC_BASELINE_CASES_V1,
  SYNTHETIC_BASELINE_SAMPLE_HASH,
  buildHotColdP0Report,
  buildHotColdP0RunConfigHash,
  type HotColdP0ObservationV1,
} from "./hot-cold-p0-frozen-replay";
import { createFrozenV1ObservationSnapshotV1, type FrozenV1ExecutionMetricsV1 } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";

class StepClock implements MonotonicClock {
  private value = 0;
  nowMs() { this.value += 5; return this.value; }
}

const ordinaryCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === "ordinary-episode-hit")!;
const committedMetrics: FrozenV1ExecutionMetricsV1 = { resultStatus: "COMMITTED", committedWinnerHash: hashComposerValue("winner"), failureCategory: null, retryable: false, blockingQwenCalls: 3, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 125, episodeSelectedIdHash: hashComposerValue("episode"), committedEdge: "opens", writeSetHash: hashComposerValue("writes") };
const snapshotFor = (caseId: string, execution = committedMetrics) => createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId, executionOutcome: createV1ExecutionOutcomeIntegrityResultV1(execution), fixtureOwner: "synthetic_v1_fixture_runner_v1" });
const ordinarySnapshot = snapshotFor(ordinaryCase.caseId);
const input: ComposerShadowInputV1 = buildComposerShadowInputFromSnapshotV1(ordinarySnapshot, "shadow-run-1");

const output = {
  schemaVersion: "composer_shadow_output_v1",
  turnId: input.turnId,
  purpose: "accompany",
  reply: "听起来这次又勾起了之前那种消耗。你愿意说说这次发生了什么吗？",
  episodeRef: "episode-work",
  groundingRefs: [],
  eventRef: null,
};

const stream = (chunks: readonly string[]): AsyncIterable<string> => ({
  async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
});

const providerFrom = (...attempts: readonly string[]): ShadowProviderV1 => async ({ attempt }) =>
  stream([attempts[attempt - 1].slice(0, 20), attempts[attempt - 1].slice(20, 53), attempts[attempt - 1].slice(53)]);
const requireInvoked = <T>(value: T | null): T => {
  assert(value, "ordinary baseline case must invoke Shadow");
  return value;
};

const main = async () => {
assert.equal(Object.isFrozen(SYNTHETIC_BASELINE_CASES_V1), true);
assert.equal(Object.isFrozen(SYNTHETIC_BASELINE_CASES_V1[0]), true);
assert.equal(SYNTHETIC_BASELINE_SAMPLE_HASH, hashComposerValue(SYNTHETIC_BASELINE_CASES_V1));
assert.equal(hashComposerValue({ b: 1, a: 2 }), hashComposerValue({ a: 2, b: 1 }));
deepFreezeComposerValue(input);
assert.equal(Object.isFrozen(input.episodeCandidates[0].confirmedFacts), true);
assert.doesNotThrow(() => assertComposerShadowInputV1(input));
assert.throws(() => assertComposerShadowInputV1({ ...input, forbiddenV1WinnerText: "hidden" }), /invalid_shadow_input_root/);

assert.equal(parseComposerShadowOutputV1(JSON.stringify(output), input).ok, true);
assert.deepEqual(parseComposerShadowOutputV1(JSON.stringify({ ...output, extra: true }), input), { ok: false, kind: "schema", reason: "non_exact_keys" });
assert.deepEqual(parseComposerShadowOutputV1(JSON.stringify({ ...output, turnId: "wrong" }), input), { ok: false, kind: "binding", reason: "turn" });
assert.deepEqual(parseComposerShadowOutputV1(JSON.stringify({ ...output, groundingRefs: ["unknown"] }), input), { ok: false, kind: "binding", reason: "grounding" });
assert.deepEqual(parseComposerShadowOutputV1(JSON.stringify({ ...output, episodeRef: "unknown" }), input), { ok: false, kind: "binding", reason: "episode" });
assert.deepEqual(parseComposerShadowOutputV1(JSON.stringify({ ...output, eventRef: "unknown" }), input), { ok: false, kind: "binding", reason: "event" });
await assert.rejects(() => runComposerShadowV1({ snapshot: ordinarySnapshot, input: { ...input, currentUserText: "tampered" }, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() }), /baseline_input_binding_mismatch/);
await assert.rejects(() => runComposerShadowV1({ snapshot: ordinarySnapshot, input: { ...input, recentCommittedTurns: [] }, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() }), /baseline_input_binding_mismatch/);
await assert.rejects(() => runComposerShadowV1({ snapshot: ordinarySnapshot, input: { ...input, episodeCandidates: [] }, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() }), /baseline_input_binding_mismatch/);

const v1: V1ResultSnapshot = deepFreezeComposerValue({ resultStatus: "COMMITTED", committedWinnerHash: committedMetrics.committedWinnerHash, committedEdge: "opens", writeSetHash: committedMetrics.writeSetHash });
const v1Before = hashComposerValue(v1);

const success = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() }));
assert.equal(success.invocationStatus, "success");
assert.equal(success.calls, 1);
assert.equal(success.timings.segmentCount, 2);
assert(success.timings.queueDelayMs >= 0);
assert(success.timings.firstReplyCharMs !== null);
assert(success.timings.firstCompleteCandidateSegmentMs !== null);
assert.equal(hashComposerValue(v1), v1Before);

const repaired = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: providerFrom("{bad", JSON.stringify(output)), clock: new StepClock() }));
assert.equal(repaired.invocationStatus, "success");
assert.equal(repaired.calls, 2);
assert.equal(repaired.repairUsed, true);

let calls = 0;
const alwaysMalformed: ShadowProviderV1 = async () => { calls += 1; return stream(["{bad"]); };
const malformed = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: alwaysMalformed, clock: new StepClock() }));
assert.equal(malformed.invocationStatus, "malformed");
assert.equal(calls, 2, "repair budget is exactly one retry");

const providerFailure = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: async () => { throw new Error("synthetic provider failure"); }, clock: new StepClock() }));
assert.equal(providerFailure.invocationStatus, "provider_failed");
assert.equal(providerFailure.calls, 1);

const controller = new AbortController();
controller.abort();
const cancelled = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: async () => stream([JSON.stringify(output)]), clock: new StepClock(), externalSignal: controller.signal }));
assert.equal(cancelled.invocationStatus, "cancelled");
const processExit = new AbortController();
processExit.abort("process_exit");
const interrupted = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: providerFrom(JSON.stringify(output)), clock: new StepClock(), externalSignal: processExit.signal }));
assert.equal(interrupted.invocationStatus, "cancelled", "injectable process-exit interruption remains observation-local");

const timeout = requireInvoked(await runComposerShadowV1({
  snapshot: ordinarySnapshot,
  input,
  provider: async ({ signal }) => ({ async *[Symbol.asyncIterator]() {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    yield JSON.stringify(output);
  }}),
  clock: new StepClock(),
  timeoutMs: 1,
}));
assert.equal(timeout.invocationStatus, "timed_out");

for (const failed of [malformed, providerFailure, cancelled, interrupted, timeout]) {
  assert.equal(hashComposerValue(v1), v1Before, `${failed.invocationStatus} changed V1 snapshot`);
}

const sink = new InMemoryHashCountObservationSinkV1();
const runConfigHash = hashComposerValue({ model: "synthetic", prompt: "composer_shadow_prompt_v1", temperature: 0, schema: "composer_shadow_output_v1", decoder: "incremental_reply_decoder_v1" });
sink.append(buildHashCountObservationV1({ observationId: "obs-ordinary", runConfigHash, snapshot: ordinarySnapshot, input, shadow: success }));
const safetyCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.expectedSafetyOwnership === "safety")!;
const safetySnapshot = snapshotFor(safetyCase.caseId, { ...committedMetrics, committedEdge: null, episodeSelectedIdHash: null });
const safetyInput = buildComposerShadowInputFromSnapshotV1(safetySnapshot, "safety-run");
let safetyProviderCalls = 0;
const safetyShadow = await runComposerShadowV1({
  snapshot: safetySnapshot,
  input: safetyInput,
  provider: async () => { safetyProviderCalls += 1; return stream([JSON.stringify(output)]); },
  clock: new StepClock(),
});
assert.equal(safetyShadow, null);
assert.equal(safetyProviderCalls, 0, "Safety-owned synthetic text must never reach the provider");
assert.throws(() => buildHashCountObservationV1({ observationId: "invalid-safety", runConfigHash, snapshot: safetySnapshot, input: safetyInput, shadow: success }), /safety_owned_shadow_forbidden/);
assert.throws(() => buildHashCountObservationV1({ observationId: "tampered-safety", runConfigHash, snapshot: safetySnapshot, input, shadow: null }), /observation_snapshot_input_binding_mismatch/);
sink.append(buildHashCountObservationV1({ observationId: "obs-safety", runConfigHash, snapshot: safetySnapshot, input: safetyInput, shadow: null }));
assert.equal(sink.all()[1].shadowStatus, "not_invoked");
assert.equal(sink.all()[1].ineligibleReason, "safety_owned");
assert.equal(sink.all()[0].isolation.timingBackground.status, "pending");
assert.equal(sink.all()[0].isolation.telemetryLowPrivilege.status, "pending");

const openBudget = { tryAcquire: () => () => undefined };
const closedBudget = { tryAcquire: () => null };
for (const [reason, evaluation] of [
  ["feature_disabled", await evaluateComposerShadowCaseV1({ snapshot: ordinarySnapshot, input, enabled: false, budget: openBudget, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() })],
  ["budget_exhausted", await evaluateComposerShadowCaseV1({ snapshot: ordinarySnapshot, input, enabled: true, budget: closedBudget, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() })],
  ["invalid_input", await evaluateComposerShadowCaseV1({ snapshot: ordinarySnapshot, input: { bad: true }, enabled: true, budget: openBudget, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() })],
  ["context_overflow", await evaluateComposerShadowCaseV1({ snapshot: ordinarySnapshot, input, enabled: true, budget: openBudget, maxInputBytes: 1, provider: providerFrom(JSON.stringify(output)), clock: new StepClock() })],
] as const) assert.equal(evaluation.notInvokedReason, reason);
const invalidObservation = buildHashCountObservationV1({ observationId: "invalid-input", runConfigHash, snapshot: ordinarySnapshot, input: { bad: true }, shadow: null, notInvokedReason: "invalid_input" });
assert.equal(invalidObservation.shadowStatus, "not_invoked");
assert.equal(invalidObservation.notInvokedReason, "invalid_input");
assert.equal(invalidObservation.conversationIdHash, null);

const adversarialRaw = JSON.stringify({ metadata: { reply: "伪造。" }, note: "escaped \\\"reply\\\":\\\"伪造！\\\"", ...output, reply: "真\\u5b9e。第二段!" });
const adversarialProvider: ShadowProviderV1 = async () => stream([...adversarialRaw].map((char) => char));
const adversarial = requireInvoked(await runComposerShadowV1({ snapshot: ordinarySnapshot, input, provider: adversarialProvider, clock: new StepClock() }));
assert.equal(adversarial.invocationStatus, "malformed", "extra metadata remains strict-schema invalid even if a fake reply appears first");
assert.equal(adversarial.timings.segmentCount, 2, "timing scanner must segment only the decoded top-level reply");

const covered = SYNTHETIC_BASELINE_CASES_V1.map((baselineCase) => {
  const caseSnapshot = snapshotFor(baselineCase.caseId, { ...committedMetrics, committedEdge: null, episodeSelectedIdHash: null });
  const caseInput = buildComposerShadowInputFromSnapshotV1(caseSnapshot, `coverage-${baselineCase.caseId}`);
  return buildHashCountObservationV1({ observationId: `coverage-${baselineCase.caseId}`, runConfigHash, snapshot: caseSnapshot, input: caseInput, shadow: null, notInvokedReason: baselineCase.expectedSafetyOwnership === "safety" ? "safety_owned" : "feature_disabled" });
});
assert.equal(covered.length, SYNTHETIC_BASELINE_CASES_V1.length);
assert(covered.every((row) => row.shadowStatus === "not_invoked" && row.notInvokedReason !== null));
const telemetry = JSON.stringify(sink.all());
assert.equal(telemetry.includes(input.currentUserText), false);
assert.equal(telemetry.includes(output.reply), false);

const reportA = buildPairedDeterministicReportV1(sink.all());
const reportB = buildPairedDeterministicReportV1([...sink.all()].reverse());
assert.equal(reportA, reportB);
assert(reportA.includes('"status": "pending"'));
assert(reportA.includes('"separateCalendarDaysRequired": 3'));

const p0Hash = buildHotColdP0RunConfigHash({ revision: "synthetic-revision", model: "synthetic-v1" });
const p0Rows: HotColdP0ObservationV1[] = ["cold", "hot"].map((processTemperature, index) => ({
  caseId: "ordinary-greeting", sampleSetVersion: "synthetic_hot_cold_p0_v1", sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH,
  processTemperature: processTemperature as "cold" | "hot", processInstanceId: `process-${index}`, runConfigHash: p0Hash,
  resultStatus: "COMMITTED", serverElapsedMs: 100 - index * 10, blockingQwenCalls: 1, plannerAttempts: 1,
  surfaceCandidates: 1, committedWinnerHash: hashComposerValue("p0-winner"), committedEdge: null, retryable: false,
}));
const p0Report = buildHotColdP0Report(p0Rows);
assert(p0Report.includes('"sloClaimed": false'));
assert.notEqual(p0Rows[0].processInstanceId, p0Rows[1].processInstanceId);

const coreSource = readFileSync("lib/composer-shadow-v1.ts", "utf8");
for (const forbidden of ["@prisma/client", "lib/prisma", "chatOrchestrationService", "SemanticMemory", "ChatMessage", "AiGeneration"]) {
  assert.equal(coreSource.includes(forbidden), false, `zero-writer core imported ${forbidden}`);
}

console.log(JSON.stringify({
  status: "PASS",
  syntheticCases: SYNTHETIC_BASELINE_CASES_V1.length,
  strictSchemaAndBinding: true,
  recursiveFreezeAndHash: true,
  incrementalReplyTiming: true,
  maximumCalls: calls,
  isolation: { pass: 5, pending: 2 },
  failureInjection: ["malformed", "provider_failed", "cancelled", "timed_out"],
  telemetry: "hash_count_only",
  safetyOwned: "ineligible",
  timeGate: "pending_3_calendar_days_200_successful_first_attempt_hot",
}, null, 2));
};

void main();
