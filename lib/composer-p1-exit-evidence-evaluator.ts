import { createHash } from "node:crypto";

import { assertComposerObservationLedgerAuthorityResultV1, type ComposerBlindArtifactV1, type ComposerObservationLedgerAuthorityResultV1 } from "./composer-observation-ledger-authority";
import { FROZEN_BASELINE_SET_DESCRIPTOR_V1 } from "./frozen-v1-observation-snapshot-authority";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GATE_KEYS = ["observationCoverage", "sevenBoundaryIsolation", "v1ShadowEquality", "behaviorStability", "traceability", "humanBlindReview", "safetyAndEpisode", "latencyConfidence", "budgetCandidate"] as const;
const BOOTSTRAP_SEED = 1729;
const BOOTSTRAP_REPLICATES = 1000;
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const canonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key])}`).join(",")}}`;
};
const hash = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value as Json)).digest("hex")}`;
const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

type GateResult = Readonly<{ status: "pass" | "pending" | "fail"; reason: string }>;
export type ComposerP1ExitEvidenceEvaluatorResultV1 = Readonly<{
  schemaVersion: "composer_p1_exit_evidence_evaluator_result_v1";
  evaluatorVersion: "composer_p1_exit_evidence_evaluator_v1";
  definitionHash: string;
  ledgerHash: string;
  gates: Readonly<Record<typeof GATE_KEYS[number], GateResult>>;
  overallStatus: "pending";
  resultHash: string;
}>;

const EXPECTED_GATES = freeze({
  observationCoverage: { status: "pass", reason: "authoritative_ledger_coverage_complete" },
  sevenBoundaryIsolation: { status: "pending", reason: "trusted_production_background_and_low_privilege_authorities_missing" },
  v1ShadowEquality: { status: "pending", reason: "trusted_shadow_on_off_equality_authority_missing" },
  behaviorStability: { status: "pending", reason: "trusted_behavior_stability_authority_missing" },
  traceability: { status: "pass", reason: "authoritative_ledger_traceability_complete" },
  humanBlindReview: { status: "pending", reason: "trusted_human_review_authority_missing" },
  safetyAndEpisode: { status: "pass", reason: "authoritative_safety_ineligible_and_episode_hit_miss_covered" },
  latencyConfidence: { status: "pending", reason: "trusted_latency_authority_missing" },
  budgetCandidate: { status: "pending", reason: "trusted_latency_authority_missing" },
} as const);
const DEFINITION_HASH = hash({ version: "composer_p1_exit_evidence_evaluator_v1", gateOrder: GATE_KEYS, gates: EXPECTED_GATES, input: "strict_composer_observation_ledger_authority_result_v1_only", externalEvidenceUpgrade: "forbidden" });

export const createComposerP1ExitEvidenceEvaluatorResultV1 = ({ ledger }: { ledger: ComposerObservationLedgerAuthorityResultV1 }): ComposerP1ExitEvidenceEvaluatorResultV1 => {
  assertComposerObservationLedgerAuthorityResultV1(ledger);
  const caseIds = new Set(ledger.entries.map((entry) => entry.observation.caseId));
  const safetyValid = FROZEN_BASELINE_SET_DESCRIPTOR_V1.safetyCaseIds.every((caseId) => ledger.entries.some((entry) => entry.observation.caseId === caseId && entry.observation.shadowStatus === "not_invoked" && entry.observation.ineligibleReason === "safety_owned"));
  if (!safetyValid || !caseIds.has("ordinary-episode-hit") || !caseIds.has("ordinary-episode-empty")) throw new Error("p1_ledger_safety_episode_contract");
  const body = freeze({ schemaVersion: "composer_p1_exit_evidence_evaluator_result_v1" as const, evaluatorVersion: "composer_p1_exit_evidence_evaluator_v1" as const, definitionHash: DEFINITION_HASH, ledgerHash: ledger.ledgerHash, gates: EXPECTED_GATES, overallStatus: "pending" as const });
  return freeze({ ...body, resultHash: hash(body) });
};

export const assertComposerP1ExitEvidenceEvaluatorResultV1 = (result: ComposerP1ExitEvidenceEvaluatorResultV1) => {
  if (!record(result) || !exactKeys(result, ["schemaVersion", "evaluatorVersion", "definitionHash", "ledgerHash", "gates", "overallStatus", "resultHash"]) || result.schemaVersion !== "composer_p1_exit_evidence_evaluator_result_v1" || result.evaluatorVersion !== "composer_p1_exit_evidence_evaluator_v1" || result.definitionHash !== DEFINITION_HASH || !SHA256.test(result.ledgerHash) || canonical(result.gates as Json) !== canonical(EXPECTED_GATES) || result.overallStatus !== "pending" || !SHA256.test(result.resultHash)) throw new Error("p1_evaluator_result_shape");
  const { resultHash: ignored, ...body } = result;
  void ignored;
  if (result.resultHash !== hash(body)) throw new Error("p1_evaluator_result_hash");
};

export const buildComposerP1ExitEvidenceReportV1 = (result: ComposerP1ExitEvidenceEvaluatorResultV1) => {
  assertComposerP1ExitEvidenceEvaluatorResultV1(result);
  return `${canonical(result as Json)}\n`;
};

export type ComposerHumanBlindMechanismArtifactV1 = Readonly<{
  schemaVersion: "composer_human_blind_mechanism_artifact_v1";
  rows: readonly Readonly<{ observationId: string; blindIdHash: string; randomizedPosition: number; candidateAHash: string; candidateBHash: string; randomizationCommitmentHash: string; reviewerIdHash: string; ratingsPresent: boolean }>[];
}>;

export const checkComposerHumanBlindMechanismV1 = ({ ledger, blindArtifact, humanArtifact }: { ledger: ComposerObservationLedgerAuthorityResultV1; blindArtifact: ComposerBlindArtifactV1; humanArtifact: ComposerHumanBlindMechanismArtifactV1 }) => {
  assertComposerObservationLedgerAuthorityResultV1(ledger);
  if (!record(blindArtifact) || !exactKeys(blindArtifact, ["schemaVersion", "artifactIdHash", "rows"]) || blindArtifact.schemaVersion !== "composer_blind_artifact_v1" || !SHA256.test(blindArtifact.artifactIdHash) || !Array.isArray(blindArtifact.rows) || !record(humanArtifact) || !exactKeys(humanArtifact, ["schemaVersion", "rows"]) || humanArtifact.schemaVersion !== "composer_human_blind_mechanism_artifact_v1" || !Array.isArray(humanArtifact.rows)) throw new Error("p1_human_mechanism_shape");
  const ledgerIds = new Set(ledger.entries.filter((entry) => entry.observation.expectedSafetyOwnership === "ordinary").map((entry) => entry.observation.observationId));
  const blindByObservation = new Map<string, ComposerBlindArtifactV1["rows"][number]>();
  const positions = new Set<number>();
  for (const row of blindArtifact.rows) {
    if (!record(row) || !exactKeys(row, ["observationId", "blindIdHash", "randomizedPosition", "candidateAHash", "candidateBHash", "humanRatingsPresent"])) throw new Error("p1_blind_mechanism_binding");
    const checked = row as ComposerBlindArtifactV1["rows"][number];
    if (typeof checked.observationId !== "string" || !ledgerIds.has(checked.observationId) || ![checked.blindIdHash, checked.candidateAHash, checked.candidateBHash].every((value) => typeof value === "string" && SHA256.test(value)) || !integer(checked.randomizedPosition) || checked.humanRatingsPresent !== false || blindByObservation.has(checked.observationId) || positions.has(checked.randomizedPosition)) throw new Error("p1_blind_mechanism_binding");
    blindByObservation.set(checked.observationId, checked); positions.add(checked.randomizedPosition);
  }
  const reviewed = new Set<string>();
  for (const row of humanArtifact.rows) {
    if (!record(row) || !exactKeys(row, ["observationId", "blindIdHash", "randomizedPosition", "candidateAHash", "candidateBHash", "randomizationCommitmentHash", "reviewerIdHash", "ratingsPresent"])) throw new Error("p1_human_mechanism_binding");
    const checked = row as ComposerHumanBlindMechanismArtifactV1["rows"][number];
    const blind = blindByObservation.get(checked.observationId);
    const expectedCommitment = hash({ observationId: checked.observationId, blindIdHash: checked.blindIdHash, randomizedPosition: checked.randomizedPosition, candidateAHash: checked.candidateAHash, candidateBHash: checked.candidateBHash });
    if (!blind || blind.blindIdHash !== checked.blindIdHash || blind.randomizedPosition !== checked.randomizedPosition || blind.candidateAHash !== checked.candidateAHash || blind.candidateBHash !== checked.candidateBHash || checked.randomizationCommitmentHash !== expectedCommitment || !SHA256.test(checked.reviewerIdHash) || typeof checked.ratingsPresent !== "boolean" || reviewed.has(checked.observationId)) throw new Error("p1_human_mechanism_binding");
    reviewed.add(checked.observationId);
  }
  const mechanismPassed = ledgerIds.size > 0 && ledgerIds.size === reviewed.size && [...ledgerIds].every((id) => reviewed.has(id));
  return freeze({ schemaVersion: "composer_human_blind_mechanism_result_v1" as const, mechanismPassed, evidencePassed: false as const, reason: "trusted_human_review_authority_missing" as const });
};

const percentile = (sorted: readonly number[], probability: number) => sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
export const computeComposerP1BootstrapMechanismV1 = (values: readonly number[]) => {
  if (values.length < 200 || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("p1_bootstrap_input");
  let state = BOOTSTRAP_SEED >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; };
  const estimates: number[] = [];
  for (let replicate = 0; replicate < BOOTSTRAP_REPLICATES; replicate += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]).sort((a, b) => a - b);
    estimates.push(percentile(sample, 0.95));
  }
  estimates.sort((a, b) => a - b);
  const p95Ms = percentile([...values].sort((a, b) => a - b), 0.95);
  const lower95Ms = percentile(estimates, 0.025);
  const upper95Ms = percentile(estimates, 0.975);
  const halfWidthRatio = p95Ms === 0 ? (upper95Ms === lower95Ms ? 0 : Number.POSITIVE_INFINITY) : (upper95Ms - lower95Ms) / 2 / p95Ms;
  return freeze({ schemaVersion: "composer_bootstrap_mechanism_result_v1" as const, method: "percentile_bootstrap_nearest_rank_v1" as const, seed: BOOTSTRAP_SEED, replicates: BOOTSTRAP_REPLICATES, sampleCount: values.length, p95Ms, lower95Ms, upper95Ms, halfWidthRatio, mechanismPassed: true as const, evidencePassed: false as const, reason: "trusted_latency_authority_missing" as const });
};

export const checkComposerBehaviorThreeRunMechanismV1 = (ledger: ComposerObservationLedgerAuthorityResultV1, attemptIdHashes: readonly string[]) => {
  assertComposerObservationLedgerAuthorityResultV1(ledger);
  const ordinary = ledger.entries.filter((entry) => entry.observation.expectedSafetyOwnership === "ordinary");
  const unique = new Set(attemptIdHashes);
  const mechanismPassed = ordinary.length === 36 && attemptIdHashes.length === ordinary.length && unique.size === ordinary.length && attemptIdHashes.every((value) => SHA256.test(value));
  return freeze({ schemaVersion: "composer_behavior_three_run_mechanism_result_v1" as const, mechanismPassed, evidencePassed: false as const, reason: "trusted_behavior_stability_authority_missing" as const });
};

export const hashComposerP1EvidenceValueV1 = hash;
