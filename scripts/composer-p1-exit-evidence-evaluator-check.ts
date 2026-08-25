import assert from "node:assert/strict";

import { createComposerObservationLedgerAuthorityResultV1, createEventNonPublicationSourceAuditV1, type ComposerBlindArtifactV1, type ComposerObservationLedgerEntryV1 } from "../lib/composer-observation-ledger-authority";
import { assertComposerP1ExitEvidenceEvaluatorResultV1, buildComposerP1ExitEvidenceReportV1, checkComposerBehaviorThreeRunMechanismV1, checkComposerHumanBlindMechanismV1, computeComposerP1BootstrapMechanismV1, createComposerP1ExitEvidenceEvaluatorResultV1, hashComposerP1EvidenceValueV1, type ComposerHumanBlindMechanismArtifactV1 } from "../lib/composer-p1-exit-evidence-evaluator";
import { buildComposerShadowInputFromSnapshotV1, buildHashCountObservationV1, hashComposerValue } from "../lib/composer-shadow-v1";
import { createFrozenV1ObservationSnapshotV1 } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const runConfigHash = hashComposerValue("p1-exit-evaluator-config");
const metrics = createV1ExecutionOutcomeIntegrityResultV1({ resultStatus: "COMMITTED", committedWinnerHash: hashComposerValue("winner"), failureCategory: null, retryable: false, blockingQwenCalls: 3, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 120, episodeSelectedIdHash: null, committedEdge: null, writeSetHash: hashComposerValue("writes") });
const observationFor = (caseId: string, slot: 1 | 2 | 3) => {
  const baselineCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === caseId)!;
  const snapshot = createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId, executionOutcome: metrics, fixtureOwner: "ledger_synthetic_fixture_v1" });
  const input = buildComposerShadowInputFromSnapshotV1(snapshot, `p1-${caseId}-${slot}`);
  return buildHashCountObservationV1({ observationId: `composer-observation:${caseId}:slot:${slot}`, runConfigHash, snapshot, input, shadow: null, notInvokedReason: baselineCase.expectedSafetyOwnership === "safety" ? "safety_owned" : "feature_disabled" });
};
const entries: ComposerObservationLedgerEntryV1[] = SYNTHETIC_BASELINE_CASES_V1.flatMap((baselineCase) => {
  const slots = baselineCase.expectedSafetyOwnership === "ordinary" ? [1, 2, 3] as const : [1] as const;
  return slots.map((slot) => ({ slot, observation: observationFor(baselineCase.caseId, slot) }));
});
const ledger = createComposerObservationLedgerAuthorityResultV1({ entries, eventSourceAudit: createEventNonPublicationSourceAuditV1() });
const result = createComposerP1ExitEvidenceEvaluatorResultV1({ ledger });
assert.equal(result.overallStatus, "pending");
assert.equal(Object.keys(result.gates).length, 9);
assert.equal(result.gates.observationCoverage.status, "pass");
assert.equal(result.gates.sevenBoundaryIsolation.status, "pending");
assert.equal(result.gates.v1ShadowEquality.status, "pending");
assert.equal(result.gates.behaviorStability.status, "pending");
assert.equal(result.gates.traceability.status, "pass");
assert.equal(result.gates.humanBlindReview.status, "pending");
assert.equal(result.gates.safetyAndEpisode.status, "pass");
assert.equal(result.gates.latencyConfidence.status, "pending");
assert.equal(result.gates.budgetCandidate.status, "pending");
assert(Object.isFrozen(result) && Object.isFrozen(result.gates));
assertComposerP1ExitEvidenceEvaluatorResultV1(result);
assert.equal(buildComposerP1ExitEvidenceReportV1(result), buildComposerP1ExitEvidenceReportV1(result));

const callerClaims = { humanEvidence: { claimed: true }, latencyEvidence: { claimed: true }, behaviorEvidence: { claimed: true } };
const ignoredClaims = createComposerP1ExitEvidenceEvaluatorResultV1({ ledger, ...callerClaims } as unknown as { ledger: typeof ledger });
assert.deepEqual(ignoredClaims, result, "caller evidence fields cannot upgrade any gate");

const ordinary = ledger.entries.filter((entry) => entry.observation.expectedSafetyOwnership === "ordinary");
const blindRows = ordinary.map((entry, index) => ({ observationId: entry.observation.observationId, blindIdHash: hashComposerP1EvidenceValueV1(`blind-${index}`), randomizedPosition: ordinary.length - index, candidateAHash: hashComposerP1EvidenceValueV1(`a-${index}`), candidateBHash: hashComposerP1EvidenceValueV1(`b-${index}`), humanRatingsPresent: false as const }));
const blindArtifact: ComposerBlindArtifactV1 = { schemaVersion: "composer_blind_artifact_v1", artifactIdHash: hashComposerP1EvidenceValueV1("blind-artifact"), rows: blindRows };
const humanRows = blindRows.map((row, index) => ({ observationId: row.observationId, blindIdHash: row.blindIdHash, randomizedPosition: row.randomizedPosition, candidateAHash: row.candidateAHash, candidateBHash: row.candidateBHash, randomizationCommitmentHash: hashComposerP1EvidenceValueV1({ observationId: row.observationId, blindIdHash: row.blindIdHash, randomizedPosition: row.randomizedPosition, candidateAHash: row.candidateAHash, candidateBHash: row.candidateBHash }), reviewerIdHash: hashComposerP1EvidenceValueV1(`reviewer-${index}`), ratingsPresent: true }));
const humanArtifact: ComposerHumanBlindMechanismArtifactV1 = { schemaVersion: "composer_human_blind_mechanism_artifact_v1", rows: humanRows };
const humanMechanism = checkComposerHumanBlindMechanismV1({ ledger, blindArtifact, humanArtifact });
assert.equal(humanMechanism.mechanismPassed, true);
assert.equal(humanMechanism.evidencePassed, false);
const tamperedHuman: ComposerHumanBlindMechanismArtifactV1 = { ...humanArtifact, rows: humanArtifact.rows.map((row, index) => index === 0 ? { ...row, candidateAHash: hashComposerValue("tampered") } : row) };
assert.throws(() => checkComposerHumanBlindMechanismV1({ ledger, blindArtifact, humanArtifact: tamperedHuman }), /p1_human_mechanism_binding/);

const behaviorMechanism = checkComposerBehaviorThreeRunMechanismV1(ledger, ordinary.map((_, index) => hashComposerP1EvidenceValueV1(`attempt-${index}`)));
assert.equal(behaviorMechanism.mechanismPassed, true);
assert.equal(behaviorMechanism.evidencePassed, false);
const bootstrapMechanism = computeComposerP1BootstrapMechanismV1(Array.from({ length: 200 }, () => 600));
assert.equal(bootstrapMechanism.mechanismPassed, true);
assert.equal(bootstrapMechanism.evidencePassed, false);
assert.equal(bootstrapMechanism.p95Ms, 600);
assert.equal(bootstrapMechanism.upper95Ms, 600);
assert.throws(() => computeComposerP1BootstrapMechanismV1(Array.from({ length: 199 }, () => 600)), /p1_bootstrap_input/);

const forgedLedger = structuredClone(ledger) as unknown as Record<string, unknown> & { entries: ComposerObservationLedgerEntryV1[]; ledgerHash: string };
forgedLedger.entries[1] = { ...forgedLedger.entries[0] };
const { ledgerHash: ignoredLedgerHash, ...forgedLedgerBody } = forgedLedger;
void ignoredLedgerHash;
forgedLedger.ledgerHash = hashComposerP1EvidenceValueV1(forgedLedgerBody);
assert.throws(() => createComposerP1ExitEvidenceEvaluatorResultV1({ ledger: forgedLedger as unknown as typeof ledger }), /ledger_result_entry_binding/);
const tamperedResult = structuredClone(result) as unknown as Record<string, unknown> & { gates: Record<string, { status: string; reason: string }>; resultHash: string };
tamperedResult.gates.humanBlindReview = { status: "pass", reason: "caller_claim" };
const { resultHash: ignoredResultHash, ...tamperedBody } = tamperedResult;
void ignoredResultHash;
tamperedResult.resultHash = hashComposerP1EvidenceValueV1(tamperedBody);
assert.throws(() => assertComposerP1ExitEvidenceEvaluatorResultV1(tamperedResult as unknown as typeof result), /p1_evaluator_result_shape/);

console.log(JSON.stringify({ status: "PASS", gates: 9, overall: result.overallStatus, authorityInput: "ledger_only", callerEvidenceUpgrade: false, humanMechanismPassed: humanMechanism.mechanismPassed, humanEvidencePassed: humanMechanism.evidencePassed, behaviorMechanismPassed: behaviorMechanism.mechanismPassed, behaviorEvidencePassed: behaviorMechanism.evidencePassed, bootstrapMechanismPassed: bootstrapMechanism.mechanismPassed, latencyEvidencePassed: bootstrapMechanism.evidencePassed, qwenCalled: false }, null, 2));
