import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const descriptor = {"version":"composer-real-ledger-ingestion-authority-v1-preaudit","owner":"scripts/composer-shadow-qwen-local.ts#runComposerRealLedgerIngestionV1","authoritativeInputs":{"sampleSetHash":"sha256:77044d3b25e4d504da97f641cd9bba62bdf7d0a292b6c6bfa5bbf880a657d73c","ordinaryCases":12,"ordinarySlots":[1,2,3],"safetyCases":2,"safetySlots":[1],"runConfigHash":"sha256:f58f72971ba6e1132914db84365754b66d97d0a5c55d9355ef1c430299e6e602","officialProviderOrigins":["https://dashscope.aliyuncs.com"]},"trustBoundary":{"realExecutionOwnedByAuthority":true,"callerMayNotSupplyEvidenceSource":true,"callerMayNotSupplyProviderResult":true,"mockResultType":"mechanism_only_uningestable","wallClockDatesAreTraceOnly":true},"artifact":{"schemaVersion":"composer_real_ledger_ingestion_artifact_v1","plaintextFields":0,"secretFields":0,"exactObservationCommitments":true,"canonicalArtifactHash":true,"retainUntilLedgerSeal":true},"ledger":{"authority":"composer_observation_ledger_authority_v1","ordinaryObservationCount":36,"safetyObservationCount":2,"totalObservationCount":38,"behaviorStatus":"candidate_pending_evaluator_authority","latencyStatus":"pending"},"acceptanceIds":["A1:owner_exact","A2:sample_set_hash_exact","A3:run_config_hash_exact","A4:ordinary_12_exact","A5:ordinary_three_slots_exact","A6:safety_two_exact","A7:safety_not_invoked_calls_zero","A8:authority_executes_provider","A9:no_caller_evidence_source","A10:no_caller_provider_result","A11:official_origin_exact","A12:mock_uningestable","A13:observation_exact_schema","A14:input_snapshot_output_binding","A15:strict_success_required","A16:calls_one_or_two","A17:repair_trace_exact","A18:output_and_ref_hashes_only","A19:timing_count_types_exact","A20:created_at_trace_only","A21:no_fake_latency_days","A22:no_reply_plaintext_recursive","A23:no_secret_or_base_url_recursive","A24:artifact_canonical_hash","A25:artifact_tamper_reject","A26:duplicate_missing_mixed_reject","A27:ledger_38_exact","A28:existing_ledger_assert_pass","A29:evaluator_behavior_not_auto_upgraded","A30:no_production_db_or_writer"]} as const;
const descriptorHash = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
assert.equal(descriptorHash, "d80773b400cad630b02fed9d35cbacfd8bd762acbeafe57355d63e8541b1544d");
assert.equal(new Set(descriptor.acceptanceIds).size, 30);

const source = readFileSync("scripts/composer-shadow-qwen-local.ts", "utf8");
assert(source.includes("const runComposerRealLedgerIngestionV1"));
assert(!source.includes("export const runComposerRealLedgerIngestionV1"));
for (const required of ["OFFICIAL_PROVIDER_ORIGIN", "REAL_LEDGER_RUN_CONFIG_HASH", "entries.length, 38", "createComposerObservationLedgerAuthorityResultV1", 'behaviorStability.status, "pending"', 'latencyCalibration.status, "pending"', 'p1ExitStatus, "pending"', "forbiddenPlaintext", 'processTemperature: "production_unknown"', "artifactHash: hashComposerValue(body)", "--allow-synthetic-qwen-ledger-ingestion"]) assert(source.includes(required), required);
for (const forbidden of ["callerEvidenceSource", "callerProviderResult", "callerEntries"]) assert(!source.includes(forbidden), forbidden);
assert(source.includes("createdAt: new Date().toISOString()"));
assert(source.includes("promptTokens === null") && source.includes("completionTokens === null"));
for (const file of ["lib/composer-shadow-v1.ts", "lib/composer-observation-ledger-authority.ts", "lib/composer-p1-exit-evidence-evaluator.ts"]) {
  const content = readFileSync(file, "utf8");
  assert(!content.includes("composer_real_ledger_ingestion_authority_v1"), file);
}
console.log(JSON.stringify({ status: "PASS", descriptorHash, acceptanceIds: 30, authorityOwner: "module_private_runner", realQwenCalls: 0, behaviorEvidence: "pending", latencyEvidence: "pending" }));
