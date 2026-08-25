import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { HashCountObservationV1 } from "./composer-shadow-v1";
import { createV1ExecutionOutcomeIntegrityResultV1, type V1ExecutionMetricsV1 } from "./v1-execution-outcome-integrity-authority";
import { FROZEN_BASELINE_SET_DESCRIPTOR_V1 } from "./frozen-v1-observation-snapshot-authority";

const ALL_CASE_IDS = Object.keys(FROZEN_BASELINE_SET_DESCRIPTOR_V1.caseHashes);
const SAFETY_CASE_IDS = [...FROZEN_BASELINE_SET_DESCRIPTOR_V1.safetyCaseIds];
const ORDINARY_CASE_IDS = ALL_CASE_IDS.filter((caseId) => !SAFETY_CASE_IDS.includes(caseId));
const CASE_CATEGORY = Object.freeze({
  "ordinary-first-contact": "first_contact", "ordinary-greeting": "greeting_reciprocity", "ordinary-accompany": "ordinary_accompaniment", "ordinary-explore": "exploration", "ordinary-identity": "direct_answer_identity", "ordinary-repair": "repair", "ordinary-stop": "stop_end", "ordinary-no-topic": "no_topic_opening", "ordinary-active-event": "active_event", "ordinary-episode-hit": "episode_hit", "ordinary-episode-empty": "episode_empty", "ordinary-provider-failure": "provider_failure", "safety-current-danger": "current_safety_danger", "safety-quoted-third-party": "quoted_third_party_safety",
} as const);
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const exactKeys = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const nullableHash = (value: unknown) => value === null || (typeof value === "string" && SHA256.test(value));
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
const canonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, Json>)[key])}`).join(",")}}`;
};
const hashValue = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value as Json)).digest("hex")}`;
const freeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export type ComposerObservationLedgerEntryV1 = Readonly<{ slot: 1 | 2 | 3; observation: HashCountObservationV1 }>;
export type ComposerBlindArtifactV1 = Readonly<{
  schemaVersion: "composer_blind_artifact_v1";
  artifactIdHash: string;
  rows: readonly Readonly<{ observationId: string; blindIdHash: string; randomizedPosition: number; candidateAHash: string; candidateBHash: string; humanRatingsPresent: false }>[];
}>;

export type ComposerObservationLedgerAuthorityResultV1 = Readonly<{
  schemaVersion: "composer_observation_ledger_authority_result_v1";
  authorityVersion: "composer_observation_ledger_authority_v1";
  runConfigHash: string;
  sampleSetHash: string;
  entries: readonly ComposerObservationLedgerEntryV1[];
  entriesHash: string;
  observationCount: number;
  caseCoverage: Readonly<Record<string, number>>;
  behaviorStability: Readonly<{ status: "pending"; mechanism: "three_explicit_slots_complete" | "slots_incomplete"; reason: "real_three_run_evidence_not_present_or_not_authorized" }>;
  eventIsolation: Readonly<{ localStatus: "pass"; evidence: "event_refs_hash_only_and_source_audit_pass"; sourceAuditHash: string; productionBackgroundStatus: "pending" }>;
  blindReview: Readonly<{ schemaStatus: "pass" | "pending"; randomizedBindingStatus: "pass" | "pending"; redactionStatus: "pass" | "pending"; humanRatingsStatus: "pending" }>;
  latencyCalibration: Readonly<{ status: "pending"; missing: readonly ["three_calendar_days", "200_successful_first_attempt_hot", "50_per_day", "context_bands", "bootstrap_ci"] }>;
  p1ExitStatus: "pending";
  ledgerHash: string;
}>;

const EVENT_SOURCE_DESCRIPTOR = freeze([{ path: "lib/composer-shadow-v1.ts", contentHash: "sha256:a66217da6ff5c39e0f5dfa67e464ced1ab5ae39f73129057d6b3bec340349068" }] as const);
const EVENT_SOURCE_AGGREGATE_HASH = "sha256:971ce7904229ebb0861bbc51f0a6a1e9e170965cd2d043c18f9834e5db7006bc";
const EVENT_SOURCE_AUDIT_HASH = hashValue({ schemaVersion: "event_non_publication_source_audit_v1", inventory: EVENT_SOURCE_DESCRIPTOR, aggregateHash: EVENT_SOURCE_AGGREGATE_HASH, bannedPatternMatches: 0 });
const BANNED_EVENT_SOURCE_PATTERNS = [/from\s+["'][^"']*(prisma|eventPublisher|eventWriter)/u, /(?:prisma|db|client)\.\w+\.(create|update|upsert)\s*\(/u, /publish(Event|Edge)\s*\(/u];
export type EventNonPublicationSourceAuditV1 = Readonly<{ schemaVersion: "event_non_publication_source_audit_v1"; inventory: readonly Readonly<{ path: string; contentHash: string }>[]; aggregateHash: string; bannedPatternMatches: 0; auditHash: string }>;
const createdEventAudits = new WeakSet<object>();

export const createEventNonPublicationSourceAuditV1 = (): EventNonPublicationSourceAuditV1 => {
  const inventory = EVENT_SOURCE_DESCRIPTOR.map((expected) => {
    const content = readFileSync(expected.path, "utf8");
    if (hashValue(content) !== expected.contentHash) throw new Error("event_audit_frozen_source_mismatch");
    if (BANNED_EVENT_SOURCE_PATTERNS.some((pattern) => pattern.test(content))) throw new Error("event_audit_writer_pattern");
    return freeze({ ...expected });
  });
  const aggregateHash = hashValue(inventory);
  if (aggregateHash !== EVENT_SOURCE_AGGREGATE_HASH) throw new Error("event_audit_frozen_aggregate_mismatch");
  const body = freeze({ schemaVersion: "event_non_publication_source_audit_v1" as const, inventory: freeze(inventory), aggregateHash, bannedPatternMatches: 0 as const });
  const audit = freeze({ ...body, auditHash: hashValue(body) });
  createdEventAudits.add(audit);
  return audit;
};

export const assertEventNonPublicationSourceAuditV1 = (audit: EventNonPublicationSourceAuditV1) => {
  if (!createdEventAudits.has(audit)) throw new Error("event_audit_untrusted_origin");
  if (!isRecord(audit) || !exactKeys(audit, ["schemaVersion", "inventory", "aggregateHash", "bannedPatternMatches", "auditHash"]) || audit.schemaVersion !== "event_non_publication_source_audit_v1" || audit.bannedPatternMatches !== 0 || !Array.isArray(audit.inventory) || canonical(audit.inventory as Json) !== canonical(EVENT_SOURCE_DESCRIPTOR)) throw new Error("event_audit_result_shape");
  if (audit.aggregateHash !== EVENT_SOURCE_AGGREGATE_HASH || audit.aggregateHash !== hashValue(audit.inventory) || audit.auditHash !== hashValue({ schemaVersion: audit.schemaVersion, inventory: audit.inventory, aggregateHash: audit.aggregateHash, bannedPatternMatches: audit.bannedPatternMatches })) throw new Error("event_audit_hash");
};

const assertObservation = (row: HashCountObservationV1, slot: 1 | 2 | 3) => {
  if (!isRecord(row) || !exactKeys(row, ["schemaVersion", "observationId", "createdAt", "runConfigHash", "caseId", "sampleSetVersion", "expectedSafetyOwnership", "eligibility", "ineligibleReason", "notInvokedReason", "environment", "revision", "cohortKey", "processTemperature", "conversationIdHash", "turnIdHash", "inputHash", "inputByteSize", "recentTurnCount", "episodeCandidateCount", "hasActiveEvent", "v1SnapshotHash", "shadowStatus", "calls", "outputHash", "replyLength", "segmentCount", "v1", "shadow", "qualityAnnotations", "isolation"])) throw new Error("ledger_observation_exact_keys");
  if (row.schemaVersion !== "composer_shadow_observation_v1" || !ALL_CASE_IDS.includes(row.caseId) || row.observationId !== `composer-observation:${row.caseId}:slot:${slot}`) throw new Error("ledger_observation_identity");
  const expectedCategory = CASE_CATEGORY[row.caseId as keyof typeof CASE_CATEGORY];
  if (typeof row.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.createdAt) || row.sampleSetVersion !== FROZEN_BASELINE_SET_DESCRIPTOR_V1.sampleSetVersion || row.environment !== "local_eval" || !(row.revision === "unknown" || SHA256.test(row.revision)) || row.cohortKey !== `${row.sampleSetVersion}:${expectedCategory}`) throw new Error("ledger_observation_trace_type");
  if (!(["ordinary", "safety"] as const).includes(row.expectedSafetyOwnership) || !(["eligible", "ineligible"] as const).includes(row.eligibility) || !(row.ineligibleReason === null || row.ineligibleReason === "safety_owned") || !(row.notInvokedReason === null || ["safety_owned", "feature_disabled", "budget_exhausted", "invalid_input", "context_overflow"].includes(row.notInvokedReason))) throw new Error("ledger_observation_enum");
  if (![row.runConfigHash, row.inputHash, row.v1SnapshotHash].every((value) => typeof value === "string" && SHA256.test(value))) throw new Error("ledger_observation_hash");
  for (const value of [row.conversationIdHash, row.turnIdHash, row.outputHash]) if (!nullableHash(value)) throw new Error("ledger_observation_nullable_hash");
  for (const value of [row.inputByteSize, row.recentTurnCount, row.episodeCandidateCount, row.calls]) if (!integer(value)) throw new Error("ledger_observation_count");
  if (typeof row.hasActiveEvent !== "boolean" || !["cold", "hot", "production_unknown"].includes(row.processTemperature)) throw new Error("ledger_observation_primitive");
  if (!isRecord(row.v1) || !exactKeys(row.v1, ["resultStatus", "committedWinnerHash", "failureCategory", "retryable", "blockingQwenCalls", "plannerAttempts", "surfaceCandidates", "serverElapsedMs", "episodeSelectedIdHash", "committedEdge", "writeSetHash"])) throw new Error("ledger_v1_exact_keys");
  createV1ExecutionOutcomeIntegrityResultV1(row.v1 as V1ExecutionMetricsV1);
  if (!isRecord(row.shadow) || !exactKeys(row.shadow, ["model", "promptVersion", "calls", "repairUsed", "promptTokens", "completionTokens", "outputHash", "purpose", "replyLength", "episodeRefHash", "groundingRefIds", "eventRefHash", "schemaValid", "turnBindingValid", "groundingRefsValid", "episodeRefValid", "eventRefValid", "timings"])) throw new Error("ledger_shadow_exact_keys");
  if (!(row.shadow.model === null || (typeof row.shadow.model === "string" && SHA256.test(row.shadow.model))) || row.shadow.promptVersion !== "composer_shadow_prompt_v1" || !integer(row.shadow.calls) || row.shadow.calls !== row.calls || typeof row.shadow.repairUsed !== "boolean" || row.shadow.promptTokens !== null || row.shadow.completionTokens !== null) throw new Error("ledger_shadow_primitive");
  if (![row.shadow.outputHash, row.shadow.episodeRefHash, row.shadow.eventRefHash].every(nullableHash) || !(row.shadow.purpose === null || ["first_contact", "direct_answer", "repair", "respect_boundary", "accompany", "explore", "proactive"].includes(row.shadow.purpose)) || !(row.shadow.replyLength === null || integer(row.shadow.replyLength)) || !Array.isArray(row.shadow.groundingRefIds) || !row.shadow.groundingRefIds.every((value) => typeof value === "string" && SHA256.test(value))) throw new Error("ledger_shadow_binding");
  for (const key of ["schemaValid", "turnBindingValid", "groundingRefsValid", "episodeRefValid", "eventRefValid"] as const) if (typeof row.shadow[key] !== "boolean") throw new Error("ledger_shadow_boolean");
  if (row.shadow.timings !== null) {
    if (!isRecord(row.shadow.timings) || !exactKeys(row.shadow.timings, ["queueDelayMs", "providerFirstByteMs", "firstReplyCharMs", "firstCompleteCandidateSegmentMs", "totalGenerationMs", "strictResultMs", "segmentCount"])) throw new Error("ledger_timing_exact_keys");
    for (const [key, value] of Object.entries(row.shadow.timings)) if (!(value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)) || (key === "segmentCount" && value !== null && !Number.isInteger(value))) throw new Error("ledger_timing_value");
  }
  if (!(row.shadowStatus === "not_invoked" || ["success", "provider_failed", "timed_out", "malformed", "hard_binding_failed", "cancelled"].includes(row.shadowStatus)) || !(row.replyLength === null || integer(row.replyLength)) || !(row.segmentCount === null || integer(row.segmentCount))) throw new Error("ledger_shadow_status");
  if (!isRecord(row.qualityAnnotations) || !exactKeys(row.qualityAnnotations, ["evaluatorVersion", "willingToReply", "selfUnderstandingIncrement", "autonomyPreserved", "unsupportedPsychologizing", "historicalCausalityOverstated", "notesCode"])) throw new Error("ledger_quality_exact_keys");
  if (row.qualityAnnotations.evaluatorVersion !== null || row.qualityAnnotations.willingToReply !== null || row.qualityAnnotations.selfUnderstandingIncrement !== null || row.qualityAnnotations.autonomyPreserved !== null || row.qualityAnnotations.unsupportedPsychologizing !== null || row.qualityAnnotations.historicalCausalityOverstated !== null || !Array.isArray(row.qualityAnnotations.notesCode) || row.qualityAnnotations.notesCode.length !== 0) throw new Error("ledger_quality_pending_only");
  if (!isRecord(row.isolation) || !exactKeys(row.isolation, ["writer", "data", "failure", "safetyEligibility", "providerResource", "timingBackground", "telemetryLowPrivilege"])) throw new Error("ledger_isolation_exact_keys");
  const isolationExpected = { writer: ["pass", "no_writer_dependency"], data: ["pass", "hash_count_only_sink"], failure: ["pass", "failure_injection_v1_unchanged"], safetyEligibility: ["pass", "safety_provider_zero"], providerResource: ["pass", "local_flag_budget_timeout"], timingBackground: ["pending", "no_production_background_integration"], telemetryLowPrivilege: ["pending", "in_memory_eval_sink_only"] } as const;
  for (const [key, value] of Object.entries(row.isolation)) if (!isRecord(value) || !exactKeys(value, ["status", "evidence"]) || value.status !== isolationExpected[key as keyof typeof isolationExpected][0] || value.evidence !== isolationExpected[key as keyof typeof isolationExpected][1]) throw new Error("ledger_isolation_value");
  if (SAFETY_CASE_IDS.includes(row.caseId as typeof SAFETY_CASE_IDS[number])) {
    if (row.expectedSafetyOwnership !== "safety" || row.eligibility !== "ineligible" || row.ineligibleReason !== "safety_owned" || row.notInvokedReason !== "safety_owned" || row.shadowStatus !== "not_invoked" || row.calls !== 0 || row.shadow.calls !== 0 || row.outputHash !== null || row.replyLength !== 0 || row.segmentCount !== null || row.shadow.outputHash !== null || row.shadow.replyLength !== 0 || row.shadow.purpose !== null || row.shadow.episodeRefHash !== null || row.shadow.eventRefHash !== null || row.shadow.groundingRefIds.length !== 0 || row.shadow.timings !== null || row.shadow.repairUsed || row.shadow.schemaValid || row.shadow.turnBindingValid || row.shadow.groundingRefsValid || row.shadow.episodeRefValid || row.shadow.eventRefValid) throw new Error("ledger_safety_invariant");
  } else if (row.expectedSafetyOwnership !== "ordinary" || row.eligibility !== "eligible" || row.ineligibleReason !== null) throw new Error("ledger_ordinary_invariant");
  if (row.shadow.eventRefHash !== null && !SHA256.test(row.shadow.eventRefHash)) throw new Error("ledger_event_ref_hash");
  if (!row.hasActiveEvent && row.shadow.eventRefHash !== null) throw new Error("ledger_event_ref_without_active_event");
  if (row.outputHash !== row.shadow.outputHash || row.replyLength !== row.shadow.replyLength || row.calls !== row.shadow.calls || row.segmentCount !== row.shadow.timings?.segmentCount && !(row.segmentCount === null && row.shadow.timings === null)) throw new Error("ledger_shadow_trace_mismatch");
  if (row.v1SnapshotHash !== hashValue(row.v1)) throw new Error("ledger_v1_snapshot_hash_mismatch");
};

const assertBlindArtifact = (artifact: ComposerBlindArtifactV1, observationIds: Set<string>) => {
  if (!isRecord(artifact) || !exactKeys(artifact, ["schemaVersion", "artifactIdHash", "rows"]) || artifact.schemaVersion !== "composer_blind_artifact_v1" || !SHA256.test(artifact.artifactIdHash) || !Array.isArray(artifact.rows)) throw new Error("ledger_blind_artifact_shape");
  const blindIds = new Set<string>();
  const positions = new Set<number>();
  for (const row of artifact.rows) {
    if (!isRecord(row) || !exactKeys(row, ["observationId", "blindIdHash", "randomizedPosition", "candidateAHash", "candidateBHash", "humanRatingsPresent"])) throw new Error("ledger_blind_artifact_binding");
    const checked = row as ComposerBlindArtifactV1["rows"][number];
    if (!observationIds.has(checked.observationId) || ![checked.blindIdHash, checked.candidateAHash, checked.candidateBHash].every((value) => typeof value === "string" && SHA256.test(value)) || !integer(checked.randomizedPosition) || checked.humanRatingsPresent !== false || blindIds.has(checked.blindIdHash) || positions.has(checked.randomizedPosition)) throw new Error("ledger_blind_artifact_binding");
    blindIds.add(checked.blindIdHash); positions.add(checked.randomizedPosition);
  }
  if (artifact.rows.length !== observationIds.size || [...observationIds].some((id) => !artifact.rows.some((row) => row.observationId === id))) throw new Error("ledger_blind_artifact_coverage");
};

export const createComposerObservationLedgerAuthorityResultV1 = ({ entries, eventSourceAudit, blindArtifact = null }: { entries: readonly ComposerObservationLedgerEntryV1[]; eventSourceAudit: EventNonPublicationSourceAuditV1; blindArtifact?: ComposerBlindArtifactV1 | null }): ComposerObservationLedgerAuthorityResultV1 => {
  assertEventNonPublicationSourceAuditV1(eventSourceAudit);
  if (!Array.isArray(entries) || entries.length < ALL_CASE_IDS.length) throw new Error("ledger_missing_observations");
  const observationIds = new Set<string>();
  const slots = new Set<string>();
  const configs = new Set<string>();
  const coverage = Object.fromEntries(ALL_CASE_IDS.map((caseId) => [caseId, 0]));
  for (const entry of entries) {
    if (!isRecord(entry) || !exactKeys(entry, ["slot", "observation"])) throw new Error("ledger_entry_shape");
    const checked = entry as ComposerObservationLedgerEntryV1;
    if (![1, 2, 3].includes(checked.slot)) throw new Error("ledger_entry_shape");
    assertObservation(checked.observation, checked.slot);
    if (observationIds.has(checked.observation.observationId)) throw new Error("ledger_duplicate_observation_id");
    const slotKey = `${checked.observation.caseId}:${checked.slot}`;
    if (slots.has(slotKey)) throw new Error("ledger_duplicate_case_slot");
    observationIds.add(checked.observation.observationId); slots.add(slotKey); configs.add(checked.observation.runConfigHash); coverage[checked.observation.caseId] += 1;
  }
  if (configs.size !== 1) throw new Error("ledger_mixed_run_config");
  if (Object.values(coverage).some((count) => count === 0)) throw new Error("ledger_missing_case");
  const slotsComplete = ORDINARY_CASE_IDS.every((caseId) => [1, 2, 3].every((slot) => slots.has(`${caseId}:${slot}`)));
  if (blindArtifact) assertBlindArtifact(blindArtifact, observationIds);
  const entriesHash = hashValue(entries.map((entry) => ({ slot: entry.slot, observationHash: hashValue(entry.observation) })));
  const body = freeze({
    schemaVersion: "composer_observation_ledger_authority_result_v1" as const,
    authorityVersion: "composer_observation_ledger_authority_v1" as const,
    runConfigHash: [...configs][0], sampleSetHash: FROZEN_BASELINE_SET_DESCRIPTOR_V1.sampleSetHash, entries: freeze(entries.map((entry) => freeze({ slot: entry.slot, observation: entry.observation }))), entriesHash, observationCount: entries.length, caseCoverage: freeze(coverage),
    behaviorStability: { status: "pending" as const, mechanism: slotsComplete ? "three_explicit_slots_complete" as const : "slots_incomplete" as const, reason: "real_three_run_evidence_not_present_or_not_authorized" as const },
    eventIsolation: { localStatus: "pass" as const, evidence: "event_refs_hash_only_and_source_audit_pass" as const, sourceAuditHash: eventSourceAudit.auditHash, productionBackgroundStatus: "pending" as const },
    blindReview: { schemaStatus: blindArtifact ? "pass" as const : "pending" as const, randomizedBindingStatus: blindArtifact ? "pass" as const : "pending" as const, redactionStatus: blindArtifact ? "pass" as const : "pending" as const, humanRatingsStatus: "pending" as const },
    latencyCalibration: { status: "pending" as const, missing: ["three_calendar_days", "200_successful_first_attempt_hot", "50_per_day", "context_bands", "bootstrap_ci"] as const },
    p1ExitStatus: "pending" as const,
  });
  return freeze({ ...body, ledgerHash: hashValue(body) });
};

export const assertComposerObservationLedgerAuthorityResultV1 = (result: ComposerObservationLedgerAuthorityResultV1) => {
  if (!isRecord(result) || !exactKeys(result, ["schemaVersion", "authorityVersion", "runConfigHash", "sampleSetHash", "entries", "entriesHash", "observationCount", "caseCoverage", "behaviorStability", "eventIsolation", "blindReview", "latencyCalibration", "p1ExitStatus", "ledgerHash"]) || result.schemaVersion !== "composer_observation_ledger_authority_result_v1" || result.authorityVersion !== "composer_observation_ledger_authority_v1" || !SHA256.test(result.runConfigHash) || result.sampleSetHash !== FROZEN_BASELINE_SET_DESCRIPTOR_V1.sampleSetHash || !Array.isArray(result.entries) || !SHA256.test(result.entriesHash) || !SHA256.test(result.ledgerHash) || result.p1ExitStatus !== "pending") throw new Error("ledger_result_invalid");
  const resultIds = new Set<string>();
  const resultSlots = new Set<string>();
  for (const entry of result.entries) {
    if (!isRecord(entry) || !exactKeys(entry, ["slot", "observation"]) || ![1, 2, 3].includes(entry.slot as number)) throw new Error("ledger_result_entry");
    const checked = entry as ComposerObservationLedgerEntryV1;
    assertObservation(checked.observation, checked.slot);
    if (checked.observation.runConfigHash !== result.runConfigHash || resultIds.has(checked.observation.observationId) || resultSlots.has(`${checked.observation.caseId}:${checked.slot}`)) throw new Error("ledger_result_entry_binding");
    resultIds.add(checked.observation.observationId); resultSlots.add(`${checked.observation.caseId}:${checked.slot}`);
  }
  if (result.entriesHash !== hashValue(result.entries.map((entry) => ({ slot: entry.slot, observationHash: hashValue(entry.observation) })))) throw new Error("ledger_result_entries_hash");
  if (!integer(result.observationCount) || !isRecord(result.caseCoverage) || !exactKeys(result.caseCoverage, ALL_CASE_IDS) || Object.values(result.caseCoverage).some((value) => !integer(value) || value === 0)) throw new Error("ledger_result_coverage");
  const recomputedCoverage = Object.fromEntries(ALL_CASE_IDS.map((caseId) => [caseId, result.entries.filter((entry) => entry.observation.caseId === caseId).length]));
  if (result.entries.length !== result.observationCount || canonical(result.caseCoverage as Json) !== canonical(recomputedCoverage) || Object.values(result.caseCoverage).reduce((sum, count) => sum + count, 0) !== result.observationCount) throw new Error("ledger_result_count_mismatch");
  if (!isRecord(result.behaviorStability) || !exactKeys(result.behaviorStability, ["status", "mechanism", "reason"]) || result.behaviorStability.status !== "pending" || !["three_explicit_slots_complete", "slots_incomplete"].includes(result.behaviorStability.mechanism) || result.behaviorStability.reason !== "real_three_run_evidence_not_present_or_not_authorized") throw new Error("ledger_result_behavior");
  if (!isRecord(result.blindReview) || !exactKeys(result.blindReview, ["schemaStatus", "randomizedBindingStatus", "redactionStatus", "humanRatingsStatus"]) || !["pass", "pending"].includes(result.blindReview.schemaStatus) || result.blindReview.randomizedBindingStatus !== result.blindReview.schemaStatus || result.blindReview.redactionStatus !== result.blindReview.schemaStatus || result.blindReview.humanRatingsStatus !== "pending") throw new Error("ledger_result_blind_review");
  if (!isRecord(result.eventIsolation) || !exactKeys(result.eventIsolation, ["localStatus", "evidence", "sourceAuditHash", "productionBackgroundStatus"]) || result.eventIsolation.localStatus !== "pass" || result.eventIsolation.evidence !== "event_refs_hash_only_and_source_audit_pass" || result.eventIsolation.sourceAuditHash !== EVENT_SOURCE_AUDIT_HASH || result.eventIsolation.productionBackgroundStatus !== "pending") throw new Error("ledger_result_event_isolation");
  if (!isRecord(result.latencyCalibration) || !exactKeys(result.latencyCalibration, ["status", "missing"]) || result.latencyCalibration.status !== "pending" || JSON.stringify(result.latencyCalibration.missing) !== JSON.stringify(["three_calendar_days", "200_successful_first_attempt_hot", "50_per_day", "context_bands", "bootstrap_ci"])) throw new Error("ledger_result_latency");
  const { ledgerHash: ignored, ...body } = result;
  void ignored;
  if (result.ledgerHash !== hashValue(body)) throw new Error("ledger_result_hash");
};
