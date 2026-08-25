import { createHash } from "node:crypto";

import type { BaselineCaseV1 } from "./composer-shadow-v1";
import { ASSISTANT_GROUNDING } from "../conversation-os/control/assistantGrounding";
import {
  assertV1ExecutionOutcomeIntegrityResultV1,
  type V1ExecutionMetricsV1,
  type V1ExecutionOutcomeIntegrityResultV1,
} from "./v1-execution-outcome-integrity-authority";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const canonicalize = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, Json>)[key])}`).join(",")}}`;
};

export const hashFrozenObservationValue = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalize(value as Json)).digest("hex")}`;

export const deepFreezeObservationValue = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeObservationValue(child);
  }
  return value;
};

const CANONICAL_GROUNDING = deepFreezeObservationValue(structuredClone(ASSISTANT_GROUNDING));
export const COMPOSER_PURPOSE_CONTRACT_DEFINITION_V1 = deepFreezeObservationValue({
  schemaVersion: "composer_purpose_contract_definition_v1",
  version: "conversation_purpose_v1",
  scope: "turn_local_observation_only",
  allowedPurposes: ["first_contact", "direct_answer", "repair", "respect_boundary", "accompany", "explore", "proactive"],
  invariants: ["not_persisted", "not_conversation_mode", "exact_output_enum"],
});
const CANONICAL_PURPOSE = COMPOSER_PURPOSE_CONTRACT_DEFINITION_V1;

const AUTHORITATIVE_SAMPLE_SET_HASH = "sha256:77044d3b25e4d504da97f641cd9bba62bdf7d0a292b6c6bfa5bbf880a657d73c";
const AUTHORITATIVE_CASE_HASHES: Readonly<Record<string, string>> = deepFreezeObservationValue({
  "ordinary-first-contact": "sha256:194f6948da90ce9cf599d81c0c4f7ecee33657f339a532a3839dbf60ce5df9f6", "ordinary-greeting": "sha256:90c75fcb1ef8e01f606984fae70a4481b348f2a31b38072dd1cb207e4ce5d1be", "ordinary-accompany": "sha256:3d6ba8db06fcdb129e645b17c865363a9bc0d6642ad9c055ff50a6b00f1fcf4e", "ordinary-explore": "sha256:ff66eedacfc787617fe20e8cb0e74cbf133faffcd404fccfd0b17894ec576a76", "ordinary-identity": "sha256:7c61d774879e441219277632cb6f97ea925f744bd6d8490934dac06c2f086dae", "ordinary-repair": "sha256:0f11eaaf6f96fcfa0c330767c50ac6bedbff0f01ab01a97752920af82eb603c3", "ordinary-stop": "sha256:773b74c27c340d2ed9a173d48fbe80b2b3523dd7e25f7cb351ed7c9828eabca9", "ordinary-no-topic": "sha256:a9c193631f7d214e785f357ce4a32d9cc4a760a0c93b5d2e9bdae7f96dadab1b", "ordinary-active-event": "sha256:c0267dd57b3d77629d37831f915a6065d3c19bccd04b569f49cfcb87f8e0ab23", "ordinary-episode-hit": "sha256:f5976ed39ab3f245dcecac09d606e8e8a5edaaefd9141be4f9d5cf640b7cba41", "ordinary-episode-empty": "sha256:78f8fe2cc4b5dfca1fee976a8a74a677a281c1949118898dc7ff88ed66043920", "ordinary-provider-failure": "sha256:dc9074a0e316ec9d2f25a810e293246a19f473442599b1ff30fbee4b10e91f1c", "safety-current-danger": "sha256:0ddd46acac5c4eed199aeb14e58ea7331dbd4be347ea14149dfcf49a593d3dec", "safety-quoted-third-party": "sha256:dfd88c5c2bf133d30df68c82c6db5f4e862536a006b72e019e9aaa3718f4f82f",
});
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const ISOLATION_EVIDENCE = deepFreezeObservationValue({
  writer: { status: "pass" as const, evidence: "no_writer_dependency" as const },
  data: { status: "pass" as const, evidence: "hash_count_only_sink" as const },
  failure: { status: "pass" as const, evidence: "failure_injection_v1_unchanged" as const },
  safetyEligibility: { status: "pass" as const, evidence: "safety_provider_zero" as const },
  providerResource: { status: "pass" as const, evidence: "local_flag_budget_timeout" as const },
  timingBackground: { status: "pending" as const, evidence: "no_production_background_integration" as const },
  telemetryLowPrivilege: { status: "pending" as const, evidence: "in_memory_eval_sink_only" as const },
});

export type FrozenV1ExecutionMetricsV1 = V1ExecutionMetricsV1;

export type FrozenV1ObservationSnapshotV1 = Readonly<{
  schemaVersion: "frozen_v1_observation_snapshot_v1";
  authorityVersion: "frozen_v1_observation_snapshot_authority_v1";
  fixtureOwner: string;
  baselineCase: BaselineCaseV1;
  baselineCaseHash: string;
  sampleSetVersion: string;
  sampleSetHash: string;
  canonicalGrounding: typeof CANONICAL_GROUNDING;
  canonicalGroundingHash: string;
  purposeContract: typeof CANONICAL_PURPOSE;
  purposeContractHash: string;
  execution: FrozenV1ExecutionMetricsV1;
  executionHash: string;
  executionOutcomeAuthorityVersion: string;
  executionOutcomeDefinitionHash: string;
  executionOutcomeInputHash: string;
  executionOutcomeResultHash: string;
  isolation: Readonly<{
    writer: Readonly<{ status: "pass"; evidence: "no_writer_dependency" }>;
    data: Readonly<{ status: "pass"; evidence: "hash_count_only_sink" }>;
    failure: Readonly<{ status: "pass"; evidence: "failure_injection_v1_unchanged" }>;
    safetyEligibility: Readonly<{ status: "pass"; evidence: "safety_provider_zero" }>;
    providerResource: Readonly<{ status: "pass"; evidence: "local_flag_budget_timeout" }>;
    timingBackground: Readonly<{ status: "pending"; evidence: "no_production_background_integration" }>;
    telemetryLowPrivilege: Readonly<{ status: "pending"; evidence: "in_memory_eval_sink_only" }>;
  }>;
  snapshotHash: string;
}>;

const assertBaselineCase = (baselineCase: BaselineCaseV1) => {
  if (!isRecord(baselineCase) || !exactKeys(baselineCase, ["caseId", "sampleSetVersion", "category", "currentUserTurn", "recentCommittedTurns", "canonicalGroundingVersion", "activeCommittedEventProjection", "episodeCandidatesSnapshot", "expectedSafetyOwnership", "source"])) throw new Error("invalid_baseline_case_shape");
  for (const key of ["caseId", "sampleSetVersion", "category", "currentUserTurn", "canonicalGroundingVersion"] as const) if (typeof baselineCase[key] !== "string" || baselineCase[key].length === 0) throw new Error(`invalid_baseline_${key}`);
  if (baselineCase.expectedSafetyOwnership !== "ordinary" && baselineCase.expectedSafetyOwnership !== "safety") throw new Error("invalid_baseline_safety_ownership");
  if (!(["real_failure", "positive_regression", "adversarial"] as const).includes(baselineCase.source)) throw new Error("invalid_baseline_source");
  if (!Array.isArray(baselineCase.recentCommittedTurns) || !Array.isArray(baselineCase.episodeCandidatesSnapshot)) throw new Error("invalid_baseline_arrays");
};

export const createFrozenV1ObservationSnapshotV1 = ({ baselineSet, caseId, executionOutcome, fixtureOwner }: {
  baselineSet: readonly BaselineCaseV1[];
  caseId: string;
  executionOutcome: V1ExecutionOutcomeIntegrityResultV1;
  fixtureOwner: string;
}): FrozenV1ObservationSnapshotV1 => {
  assertV1ExecutionOutcomeIntegrityResultV1(executionOutcome);
  const execution = executionOutcome.outcome;
  if (typeof fixtureOwner !== "string" || !fixtureOwner.trim()) throw new Error("missing_fixture_owner");
  if (hashFrozenObservationValue(baselineSet) !== AUTHORITATIVE_SAMPLE_SET_HASH) throw new Error("authoritative_sample_set_hash_mismatch");
  const baselineCase = baselineSet.find((item) => item.caseId === caseId);
  if (!baselineCase || baselineSet.filter((item) => item.caseId === caseId).length !== 1) throw new Error("baseline_case_not_unique");
  assertBaselineCase(baselineCase);
  if (baselineSet.some((item) => item.sampleSetVersion !== baselineCase.sampleSetVersion)) throw new Error("mixed_sample_set_version");
  if (baselineCase.canonicalGroundingVersion !== CANONICAL_GROUNDING.source) throw new Error("canonical_grounding_version_mismatch");
  if (AUTHORITATIVE_CASE_HASHES[caseId] !== hashFrozenObservationValue(baselineCase)) throw new Error("authoritative_case_hash_mismatch");
  const body = deepFreezeObservationValue({
    schemaVersion: "frozen_v1_observation_snapshot_v1" as const,
    authorityVersion: "frozen_v1_observation_snapshot_authority_v1" as const,
    fixtureOwner,
    baselineCase: deepFreezeObservationValue(structuredClone(baselineCase)),
    baselineCaseHash: hashFrozenObservationValue(baselineCase),
    sampleSetVersion: baselineCase.sampleSetVersion,
    sampleSetHash: AUTHORITATIVE_SAMPLE_SET_HASH,
    canonicalGrounding: CANONICAL_GROUNDING,
    canonicalGroundingHash: hashFrozenObservationValue(CANONICAL_GROUNDING),
    purposeContract: CANONICAL_PURPOSE,
    purposeContractHash: hashFrozenObservationValue(CANONICAL_PURPOSE),
    execution: deepFreezeObservationValue(structuredClone(execution)),
    executionHash: hashFrozenObservationValue(execution),
    executionOutcomeAuthorityVersion: executionOutcome.authorityVersion,
    executionOutcomeDefinitionHash: executionOutcome.definitionHash,
    executionOutcomeInputHash: executionOutcome.inputHash,
    executionOutcomeResultHash: executionOutcome.resultHash,
    isolation: ISOLATION_EVIDENCE,
  });
  return deepFreezeObservationValue({ ...body, snapshotHash: hashFrozenObservationValue(body) });
};

export const assertFrozenV1ObservationSnapshotV1 = (snapshot: FrozenV1ObservationSnapshotV1) => {
  if (!isRecord(snapshot) || !exactKeys(snapshot, ["schemaVersion", "authorityVersion", "fixtureOwner", "baselineCase", "baselineCaseHash", "sampleSetVersion", "sampleSetHash", "canonicalGrounding", "canonicalGroundingHash", "purposeContract", "purposeContractHash", "execution", "executionHash", "executionOutcomeAuthorityVersion", "executionOutcomeDefinitionHash", "executionOutcomeInputHash", "executionOutcomeResultHash", "isolation", "snapshotHash"])) throw new Error("frozen_snapshot_exact_keys");
  if (snapshot.schemaVersion !== "frozen_v1_observation_snapshot_v1" || snapshot.authorityVersion !== "frozen_v1_observation_snapshot_authority_v1" || typeof snapshot.fixtureOwner !== "string" || !snapshot.fixtureOwner.trim()) throw new Error("frozen_snapshot_authority_binding");
  if (typeof snapshot.sampleSetVersion !== "string" || !snapshot.sampleSetVersion || typeof snapshot.baselineCaseHash !== "string" || typeof snapshot.sampleSetHash !== "string" || typeof snapshot.executionHash !== "string" || typeof snapshot.snapshotHash !== "string") throw new Error("frozen_snapshot_trace_binding");
  assertBaselineCase(snapshot.baselineCase);
  if (!isRecord(snapshot.execution) || !exactKeys(snapshot.execution, ["resultStatus", "committedWinnerHash", "failureCategory", "retryable", "blockingQwenCalls", "plannerAttempts", "surfaceCandidates", "serverElapsedMs", "episodeSelectedIdHash", "committedEdge", "writeSetHash"])) throw new Error("frozen_snapshot_execution_exact_keys");
  if (!isRecord(snapshot.isolation) || !exactKeys(snapshot.isolation, ["writer", "data", "failure", "safetyEligibility", "providerResource", "timingBackground", "telemetryLowPrivilege"])) throw new Error("frozen_snapshot_isolation_exact_keys");
  if (hashFrozenObservationValue(snapshot.isolation) !== hashFrozenObservationValue(ISOLATION_EVIDENCE)) throw new Error("frozen_snapshot_isolation_mismatch");
  for (const value of [snapshot.snapshotHash, snapshot.baselineCaseHash, snapshot.sampleSetHash, snapshot.canonicalGroundingHash, snapshot.purposeContractHash, snapshot.executionHash, snapshot.executionOutcomeDefinitionHash, snapshot.executionOutcomeInputHash, snapshot.executionOutcomeResultHash]) if (!SHA256.test(value)) throw new Error("frozen_snapshot_invalid_hash_format");
  const { snapshotHash: _ignored, ...body } = snapshot;
  void _ignored;
  if (snapshot.snapshotHash !== hashFrozenObservationValue(body)) throw new Error("frozen_snapshot_hash_mismatch");
  if (snapshot.baselineCaseHash !== hashFrozenObservationValue(snapshot.baselineCase) || snapshot.executionHash !== hashFrozenObservationValue(snapshot.execution)) throw new Error("frozen_snapshot_component_hash_mismatch");
  if (snapshot.sampleSetHash !== AUTHORITATIVE_SAMPLE_SET_HASH || snapshot.baselineCaseHash !== AUTHORITATIVE_CASE_HASHES[snapshot.baselineCase.caseId]) throw new Error("frozen_snapshot_authoritative_set_mismatch");
  if (snapshot.sampleSetVersion !== snapshot.baselineCase.sampleSetVersion || snapshot.baselineCase.canonicalGroundingVersion !== CANONICAL_GROUNDING.source) throw new Error("frozen_snapshot_baseline_binding_mismatch");
  if (snapshot.canonicalGroundingHash !== hashFrozenObservationValue(CANONICAL_GROUNDING) || hashFrozenObservationValue(snapshot.canonicalGrounding) !== hashFrozenObservationValue(CANONICAL_GROUNDING)) throw new Error("frozen_snapshot_grounding_mismatch");
  if (snapshot.purposeContractHash !== hashFrozenObservationValue(CANONICAL_PURPOSE) || hashFrozenObservationValue(snapshot.purposeContract) !== hashFrozenObservationValue(CANONICAL_PURPOSE)) throw new Error("frozen_snapshot_purpose_mismatch");
  assertV1ExecutionOutcomeIntegrityResultV1({ schemaVersion: "v1_execution_outcome_integrity_result_v1", authorityVersion: snapshot.executionOutcomeAuthorityVersion as "v1_execution_outcome_integrity_authority_v1", definitionHash: snapshot.executionOutcomeDefinitionHash, inputHash: snapshot.executionOutcomeInputHash, outcome: snapshot.execution, resultHash: snapshot.executionOutcomeResultHash });
};
