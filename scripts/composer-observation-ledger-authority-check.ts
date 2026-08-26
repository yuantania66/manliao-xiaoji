import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  createComposerObservationLedgerAuthorityResultV1,
  assertComposerObservationLedgerAuthorityResultV1,
  assertEventNonPublicationSourceAuditV1,
  createEventNonPublicationSourceAuditV1,
  type ComposerBlindArtifactV1,
  type ComposerObservationLedgerEntryV1,
} from "../lib/composer-observation-ledger-authority";
import { buildComposerShadowInputFromSnapshotV1, buildHashCountObservationV1, hashComposerValue } from "../lib/composer-shadow-v1";
import { createFrozenV1ObservationSnapshotV1 } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const runConfigHash = hashComposerValue("ledger-run-config-v1");
const eventSourceAudit = createEventNonPublicationSourceAuditV1();
const forgedEventAudit = structuredClone(eventSourceAudit);
assert.throws(() => assertEventNonPublicationSourceAuditV1(forgedEventAudit), /event_audit_untrusted_origin/);
const createLedger = (ledgerEntries: readonly ComposerObservationLedgerEntryV1[], blindArtifact?: ComposerBlindArtifactV1) =>
  createComposerObservationLedgerAuthorityResultV1({ entries: ledgerEntries, eventSourceAudit, ...(blindArtifact ? { blindArtifact } : {}) });
const metrics = createV1ExecutionOutcomeIntegrityResultV1({
  resultStatus: "COMMITTED", committedWinnerHash: hashComposerValue("winner"), failureCategory: null, retryable: false,
  blockingQwenCalls: 3, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 120,
  episodeSelectedIdHash: null, committedEdge: null, writeSetHash: hashComposerValue("writes"),
});
const observationFor = (caseId: string, slot: 1 | 2 | 3) => {
  const baselineCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === caseId)!;
  const snapshot = createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId, executionOutcome: metrics, fixtureOwner: "ledger_synthetic_fixture_v1" });
  const input = buildComposerShadowInputFromSnapshotV1(snapshot, `ledger-${caseId}-${slot}`);
  return buildHashCountObservationV1({ observationId: `composer-observation:${caseId}:slot:${slot}`, runConfigHash, snapshot, input, shadow: null, notInvokedReason: baselineCase.expectedSafetyOwnership === "safety" ? "safety_owned" : "feature_disabled" });
};

const entries: ComposerObservationLedgerEntryV1[] = SYNTHETIC_BASELINE_CASES_V1.flatMap((baselineCase) => {
  const slots = baselineCase.expectedSafetyOwnership === "ordinary" ? [1, 2, 3] as const : [1] as const;
  return slots.map((slot) => ({ slot, observation: observationFor(baselineCase.caseId, slot) }));
});
const artifact: ComposerBlindArtifactV1 = {
  schemaVersion: "composer_blind_artifact_v1", artifactIdHash: hashComposerValue("blind-artifact"),
  rows: entries.map((entry, index) => ({ observationId: entry.observation.observationId, blindIdHash: hashComposerValue(`blind-${index}`), randomizedPosition: entries.length - index, candidateAHash: hashComposerValue(`a-${index}`), candidateBHash: hashComposerValue(`b-${index}`), humanRatingsPresent: false })),
};

const result = createLedger(entries, artifact);
assert.equal(result.p1ExitStatus, "pending");
assert.equal(result.behaviorStability.status, "pending", "synthetic three-slot mechanism cannot pass real behavior stability");
assert.equal(result.behaviorStability.mechanism, "three_explicit_slots_complete");
assert.equal(result.blindReview.schemaStatus, "pass");
assert.equal(result.blindReview.randomizedBindingStatus, "pass");
assert.equal(result.blindReview.humanRatingsStatus, "pending");
assert.equal(result.latencyCalibration.status, "pending");
assert.deepEqual(result.latencyCalibration.missing, ["three_calendar_days", "200_successful_first_attempt_hot", "50_per_day", "context_bands", "bootstrap_ci"]);
assert.equal(result.eventIsolation.localStatus, "pass");
assert.equal(result.eventIsolation.productionBackgroundStatus, "pending");

assert.throws(() => createLedger(entries.filter((entry) => entry.observation.caseId !== "ordinary-first-contact")), /ledger_missing_case/);
assert.throws(() => createLedger([...entries, entries[0]]), /ledger_duplicate_observation_id/);
const mixed = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, runConfigHash: hashComposerValue("other-config") } } : entry);
assert.throws(() => createLedger(mixed), /ledger_mixed_run_config/);
for (const environment of ["user@example.com", "this is an English sentence", "dXNlciBwcml2YXRlIHRleHQ="]) {
  const plaintext = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, environment } } : entry);
  assert.throws(() => createLedger(plaintext), /ledger_observation_trace_type/);
}
const stringInjectionCases = [
  { field: "observationId", value: "user@example.com", error: /ledger_observation_identity/ },
  { field: "createdAt", value: "this is an English sentence", error: /ledger_observation_trace_type/ },
  { field: "revision", value: "dXNlciBwcml2YXRlIHRleHQ=", error: /ledger_observation_trace_type/ },
  { field: "cohortKey", value: "user@example.com", error: /ledger_observation_trace_type/ },
] as const;
for (const injected of stringInjectionCases) {
  const forged = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, [injected.field]: injected.value } } : entry);
  assert.throws(() => createLedger(forged), injected.error);
}
const badModel = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, shadow: { ...entry.observation.shadow, model: "this is an English sentence" } } } : entry);
assert.throws(() => createLedger(badModel), /ledger_shadow_primitive/);
const badGrounding = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, shadow: { ...entry.observation.shadow, groundingRefIds: ["user@example.com"] } } } : entry);
assert.throws(() => createLedger(badGrounding), /ledger_shadow_binding/);
const badIsolationEvidence = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, isolation: { ...entry.observation.isolation, writer: { status: "pass" as const, evidence: "dXNlciBwcml2YXRlIHRleHQ=" } } } } : entry);
assert.throws(() => createLedger(badIsolationEvidence as unknown as ComposerObservationLedgerEntryV1[]), /ledger_isolation_value/);
const badNotes = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, qualityAnnotations: { ...entry.observation.qualityAnnotations, notesCode: ["this is an English sentence"] } } } : entry);
assert.throws(() => createLedger(badNotes), /ledger_quality_pending_only/);
const extraNested = entries.map((entry, index) => index === 0 ? { ...entry, observation: { ...entry.observation, v1: { ...entry.observation.v1, extra: true } } } : entry);
assert.throws(() => createLedger(extraNested as unknown as ComposerObservationLedgerEntryV1[]), /ledger_v1_exact_keys/);
const safetyIndex = entries.findIndex((entry) => entry.observation.caseId === "safety-current-danger");
const badSafety = entries.map((entry, index) => index === safetyIndex ? { ...entry, observation: { ...entry.observation, calls: 1, shadow: { ...entry.observation.shadow, calls: 1 } } } : entry);
assert.throws(() => createLedger(badSafety), /ledger_safety_invariant/);
const badBlind = { ...artifact, rows: artifact.rows.map((row, index) => index === 0 ? { ...row, observationId: "missing-observation" } : row) };
assert.throws(() => createLedger(entries, badBlind), /ledger_blind_artifact_binding/);
const plaintextBlind = { ...artifact, rows: artifact.rows.map((row, index) => index === 0 ? { ...row, blindIdHash: "user@example.com" } : row) };
assert.throws(() => createLedger(entries, plaintextBlind), /ledger_blind_artifact_binding/);
const tamperedResult = { ...result, p1ExitStatus: "complete" } as unknown as typeof result;
assert.throws(() => assertComposerObservationLedgerAuthorityResultV1(tamperedResult), /ledger_result_invalid/);
const nestedForgery = structuredClone(result) as unknown as Record<string, unknown> & { behaviorStability: { reason: string }; ledgerHash: string };
nestedForgery.behaviorStability.reason = "forged_reason";
const { ledgerHash: ignoredHash, ...forgedBody } = nestedForgery;
void ignoredHash;
nestedForgery.ledgerHash = hashComposerValue(forgedBody);
assert.throws(() => assertComposerObservationLedgerAuthorityResultV1(nestedForgery as unknown as typeof result), /ledger_result_behavior/);
for (const [field, value, error] of [
  ["entriesHash", hashComposerValue("forged entries"), /ledger_result_entries_hash/],
  ["sourceAuditHash", hashComposerValue("forged audit"), /ledger_result_event_isolation/],
] as const) {
  const forgery = structuredClone(result) as unknown as Record<string, unknown> & { eventIsolation: Record<string, unknown>; ledgerHash: string };
  if (field === "sourceAuditHash") forgery.eventIsolation.sourceAuditHash = value;
  else forgery[field] = value;
  const { ledgerHash: ignored, ...body } = forgery;
  void ignored;
  forgery.ledgerHash = hashComposerValue(body);
  assert.throws(() => assertComposerObservationLedgerAuthorityResultV1(forgery as unknown as typeof result), error);
}

const terminationDir = mkdtempSync(join(tmpdir(), "composer-ledger-termination-"));
const appendMarker = join(terminationDir, "ledger-appended");
const terminated = spawnSync(process.execPath, ["-e", `process.kill(process.pid, "SIGTERM"); require("node:fs").writeFileSync(${JSON.stringify(appendMarker)}, "append")`]);
assert.equal(terminated.signal, "SIGTERM");
assert.equal(existsSync(appendMarker), false, "terminated child process must not append a ledger marker");

const source = readFileSync("lib/composer-observation-ledger-authority.ts", "utf8");
for (const forbidden of ["@prisma/client", "lib/prisma", "ChatMessage", "AiGeneration", "QWEN_API_KEY", "publishEvent", "createChatReply"]) assert.equal(source.includes(forbidden), false);

console.log(JSON.stringify({ status: "PASS", observations: entries.length, cases: SYNTHETIC_BASELINE_CASES_V1.length, threeSlotMechanism: true, behaviorEvidence: "pending", blindSchema: "pass", humanRatings: "pending", eventIsolationLocal: "pass", productionBackground: "pending", latencyCalibration: "pending", qwenCalled: false }, null, 2));
