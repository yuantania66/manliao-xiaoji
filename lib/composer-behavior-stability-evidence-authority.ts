import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { assertComposerObservationLedgerAuthorityResultV1, type ComposerObservationLedgerAuthorityResultV1 } from "./composer-observation-ledger-authority";

const AUTHORITY_VERSION = "composer_behavior_stability_evidence_authority_v1" as const;
const DEFINITION_HASH = "sha256:52d57cdaf286aecab53b58a6251bcd0350ee6fd13dc43f58d99d2f7346b61dcb";
const ARTIFACT_PATH = "/private/tmp/composer-real-ledger-ingestion-v1.json";
const FILE_HASH = "sha256:460832431491eb200f5c22d79b3cd74411e5233d1c81b3d7debc9cb0168dc22c";
const ARTIFACT_HASH = "sha256:389350baf9fa89a549a3567fc473dcd6569c0e5d91e3033aa0f2facdb64da904";
const INGESTION_DESCRIPTOR_HASH = "sha256:d80773b400cad630b02fed9d35cbacfd8bd762acbeafe57355d63e8541b1544d";
const SAMPLE_SET_HASH = "sha256:77044d3b25e4d504da97f641cd9bba62bdf7d0a292b6c6bfa5bbf880a657d73c";
const RUN_CONFIG_HASH = "sha256:f58f72971ba6e1132914db84365754b66d97d0a5c55d9355ef1c430299e6e602";
const ORDINARY_CASE_IDS = ["ordinary-first-contact", "ordinary-greeting", "ordinary-accompany", "ordinary-explore", "ordinary-identity", "ordinary-repair", "ordinary-stop", "ordinary-no-topic", "ordinary-active-event", "ordinary-episode-hit", "ordinary-episode-empty", "ordinary-provider-failure"] as const;
const EXCLUDED_DIMENSIONS = ["output_hash_equality", "purpose_equality", "reference_selection_equality", "reply_length", "segment_count", "timings", "token_values", "created_at"] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const exact = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const canonical = (value: Json): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key])}`).join(",")}}`;
const hash = (value: unknown) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : canonical(value as Json)).digest("hex")}`;
const freeze = <T>(value: T): Readonly<T> => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; };

type CaseResult = Readonly<{ caseId: string; status: "pass" | "fail"; observationCount: number; distinctOutputCount: number; distinctPurposeCount: number; distinctEpisodeRefCount: number; distinctGroundingRefsCount: number; distinctEventRefCount: number; calls1: number; calls2: number; repairs: number; failureReasons: readonly string[] }>;
export type ComposerBehaviorStabilityEvidenceResultV1 = Readonly<{ schemaVersion: "composer_behavior_stability_evidence_result_v1"; authorityVersion: typeof AUTHORITY_VERSION; definitionHash: string; inputFileHash: string; inputArtifactHash: string; ledgerHash: string; runConfigHash: string; includedCaseCount: 12; excludedSafetyCount: 2; caseResults: readonly CaseResult[]; overallStatus: "pass" | "fail"; excludedDimensions: typeof EXCLUDED_DIMENSIONS; gateUpgrades: Readonly<{ behavior: "pass_or_fail_only"; human: "unchanged_pending"; latency: "unchanged_pending"; budget: "unchanged_pending"; p1Overall: "unchanged_pending" }>; resultHash: string }>;

const readTrustedArtifact = () => {
  const bytes = readFileSync(ARTIFACT_PATH);
  if (hash(bytes.toString("utf8")) !== FILE_HASH) throw new Error("behavior_artifact_file_hash");
  const artifact: unknown = JSON.parse(bytes.toString("utf8"));
  if (!record(artifact) || !exact(artifact, ["schemaVersion", "authorityVersion", "descriptorHash", "source", "runConfigHash", "observationCount", "ledger", "artifactHash"]) || artifact.schemaVersion !== "composer_real_ledger_ingestion_artifact_v1" || artifact.authorityVersion !== "composer_real_ledger_ingestion_authority_v1" || artifact.descriptorHash !== INGESTION_DESCRIPTOR_HASH || artifact.source !== "direct_official_provider_execution" || artifact.runConfigHash !== RUN_CONFIG_HASH || artifact.observationCount !== 38 || artifact.artifactHash !== ARTIFACT_HASH) throw new Error("behavior_artifact_root");
  const { artifactHash: ignored, ...body } = artifact;
  void ignored;
  if (hash(body) !== ARTIFACT_HASH) throw new Error("behavior_artifact_canonical_hash");
  const ledger = artifact.ledger as ComposerObservationLedgerAuthorityResultV1;
  assertComposerObservationLedgerAuthorityResultV1(ledger);
  if (ledger.authorityVersion !== "composer_observation_ledger_authority_v1" || ledger.sampleSetHash !== SAMPLE_SET_HASH || ledger.runConfigHash !== RUN_CONFIG_HASH || ledger.observationCount !== 38) throw new Error("behavior_ledger_binding");
  return ledger;
};

const evaluate = (): ComposerBehaviorStabilityEvidenceResultV1 => {
  const ledger = readTrustedArtifact();
  const safety = ledger.entries.filter((entry) => entry.observation.expectedSafetyOwnership === "safety");
  if (safety.length !== 2 || safety.some((entry) => entry.slot !== 1 || entry.observation.shadowStatus !== "not_invoked" || entry.observation.notInvokedReason !== "safety_owned" || entry.observation.calls !== 0 || entry.observation.shadow.calls !== 0)) throw new Error("behavior_safety_exclusion_binding");
  const ordinary = ledger.entries.filter((entry) => entry.observation.expectedSafetyOwnership === "ordinary");
  if (ordinary.length !== 36 || new Set(ordinary.map((entry) => entry.observation.caseId)).size !== 12) throw new Error("behavior_ordinary_coverage");
  const caseResults: CaseResult[] = ORDINARY_CASE_IDS.map((caseId) => {
    const rows = ordinary.filter((entry) => entry.observation.caseId === caseId).sort((a, b) => a.slot - b.slot);
    const failures: string[] = [];
    if (rows.length !== 3 || rows.map((entry) => entry.slot).join(",") !== "1,2,3") failures.push("slots");
    if (rows.some((entry) => entry.observation.runConfigHash !== RUN_CONFIG_HASH)) failures.push("run_config");
    if (rows.some((entry) => entry.observation.shadowStatus !== "success")) failures.push("final_status");
    if (rows.some((entry) => entry.observation.notInvokedReason !== null)) failures.push("not_invoked");
    if (rows.some((entry) => !entry.observation.shadow.schemaValid || !entry.observation.shadow.turnBindingValid || !entry.observation.shadow.groundingRefsValid || !entry.observation.shadow.episodeRefValid || !entry.observation.shadow.eventRefValid)) failures.push("strict_validity");
    if (new Set(rows.map((entry) => canonical(entry.observation.isolation as Json))).size !== 1) failures.push("isolation");
    if (rows.some((entry) => typeof entry.observation.outputHash !== "string" || !SHA256.test(entry.observation.outputHash))) failures.push("output_hash");
    if (rows.some((entry) => entry.observation.calls !== 1 && entry.observation.calls !== 2)) failures.push("calls");
    return freeze({ caseId, status: failures.length === 0 ? "pass" as const : "fail" as const, observationCount: rows.length, distinctOutputCount: new Set(rows.map((entry) => entry.observation.outputHash)).size, distinctPurposeCount: new Set(rows.map((entry) => entry.observation.shadow.purpose)).size, distinctEpisodeRefCount: new Set(rows.map((entry) => entry.observation.shadow.episodeRefHash)).size, distinctGroundingRefsCount: new Set(rows.map((entry) => canonical(entry.observation.shadow.groundingRefIds as Json))).size, distinctEventRefCount: new Set(rows.map((entry) => entry.observation.shadow.eventRefHash)).size, calls1: rows.filter((entry) => entry.observation.calls === 1).length, calls2: rows.filter((entry) => entry.observation.calls === 2).length, repairs: rows.filter((entry) => entry.observation.shadow.repairUsed).length, failureReasons: freeze(failures) });
  });
  const body = freeze({ schemaVersion: "composer_behavior_stability_evidence_result_v1" as const, authorityVersion: AUTHORITY_VERSION, definitionHash: DEFINITION_HASH, inputFileHash: FILE_HASH, inputArtifactHash: ARTIFACT_HASH, ledgerHash: ledger.ledgerHash, runConfigHash: RUN_CONFIG_HASH, includedCaseCount: 12 as const, excludedSafetyCount: 2 as const, caseResults: freeze(caseResults), overallStatus: caseResults.every((item) => item.status === "pass") ? "pass" as const : "fail" as const, excludedDimensions: EXCLUDED_DIMENSIONS, gateUpgrades: freeze({ behavior: "pass_or_fail_only" as const, human: "unchanged_pending" as const, latency: "unchanged_pending" as const, budget: "unchanged_pending" as const, p1Overall: "unchanged_pending" as const }) });
  return freeze({ ...body, resultHash: hash(body) });
};

export const createComposerBehaviorStabilityEvidenceV1 = (): ComposerBehaviorStabilityEvidenceResultV1 => evaluate();

export const assertComposerBehaviorStabilityEvidenceV1 = (result: ComposerBehaviorStabilityEvidenceResultV1) => {
  if (!record(result) || !exact(result, ["schemaVersion", "authorityVersion", "definitionHash", "inputFileHash", "inputArtifactHash", "ledgerHash", "runConfigHash", "includedCaseCount", "excludedSafetyCount", "caseResults", "overallStatus", "excludedDimensions", "gateUpgrades", "resultHash"])) throw new Error("behavior_result_shape");
  const expected = evaluate();
  if (canonical(result as Json) !== canonical(expected as Json)) throw new Error("behavior_result_binding");
};
