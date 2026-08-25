import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildComposerShadowInputFromSnapshotV1, hashComposerValue } from "../lib/composer-shadow-v1";
import { createFrozenV1ObservationSnapshotV1, hashFrozenObservationValue } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { buildComposerOutputSchemaPromptV1, COMPOSER_OUTPUT_SCHEMA_PROMPT_CANONICAL_V1, COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1, COMPOSER_OUTPUT_SCHEMA_PROMPT_PREAUDIT_SHA256 } from "./composer-shadow-qwen-local";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const descriptor = {"version":"composer-output-schema-prompt-authority-v1-preaudit","owner":"scripts/composer-shadow-qwen-local.ts#buildComposerOutputSchemaPromptV1","inputBoundary":"untrusted_composer_shadow_input_json","outputSchema":{"schemaVersion":"composer_shadow_output_v1","exactKeys":["schemaVersion","turnId","purpose","reply","episodeRef","groundingRefs","eventRef"],"purposeEnum":["first_contact","direct_answer","repair","respect_boundary","accompany","explore","proactive"],"fieldRules":{"schemaVersion":"literal_composer_shadow_output_v1","turnId":"exact_input_turnId","purpose":"exact_enum","reply":"non_empty_string","episodeRef":"null_or_input_episodeId","groundingRefs":"unique_array_of_input_canonicalFactId","eventRef":"null_or_exact_input_activeEvent_sourceAssistantEventId"}},"promptRules":{"inputDelimited":true,"inputDeclaredUntrusted":true,"inputCannotOverrideSchema":true,"noExtraKeys":true,"jsonObjectOnly":true,"repairReusesExactSchema":true,"repairIncludesFailureReason":true,"repairDoesNotIncludePriorCandidateText":true},"traceability":{"promptHash":"sha256_canonical_prompt_bytes","runConfigHashIncludesPromptHash":true,"runConfigHashMustChange":true},"sequence":["one_case_real_shape_diagnostic_must_strict_succeed","then_authoritative_12_ordinary_x3"],"evidenceBoundary":{"strictParserChanges":0,"mockCanProveReal":false,"replyPlaintextInObservation":false,"secretsInOutput":false},"acceptanceIds":["A1:owner_exact","A2:seven_keys_exact","A3:purpose_enum_exact","A4:null_and_ref_rules_exact","A5:turn_binding_exact","A6:reply_nonempty","A7:input_delimited","A8:input_untrusted","A9:input_cannot_override_schema","A10:json_only_no_extra_keys","A11:repair_same_schema","A12:repair_failure_reason","A13:repair_no_prior_candidate_plaintext","A14:prompt_hash_bound","A15:run_config_hash_changes","A16:one_case_real_strict_success_first","A17:full_12x3_only_after_diagnostic","A18:strict_parser_unchanged","A19:mock_not_real_evidence","A20:no_reply_plaintext","A21:no_secret_or_base_url_output"]} as const;
assert.equal(createHash("sha256").update(JSON.stringify(descriptor)).digest("hex"), COMPOSER_OUTPUT_SCHEMA_PROMPT_PREAUDIT_SHA256);
assert.equal(new Set(descriptor.acceptanceIds).size, 21);
assert.equal(COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1, `sha256:${createHash("sha256").update(COMPOSER_OUTPUT_SCHEMA_PROMPT_CANONICAL_V1).digest("hex")}`);

const baselineCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.expectedSafetyOwnership === "ordinary")!;
const snapshot = createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId: baselineCase.caseId, fixtureOwner: "explicit_local_v1_fixture", executionOutcome: createV1ExecutionOutcomeIntegrityResultV1({ resultStatus: "COMMITTED", committedWinnerHash: hashFrozenObservationValue("winner"), failureCategory: null, retryable: false, blockingQwenCalls: 1, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 1, episodeSelectedIdHash: null, committedEdge: null, writeSetHash: hashFrozenObservationValue("writes") }) });
const input = buildComposerShadowInputFromSnapshotV1(snapshot, hashComposerValue("prompt-check"));
const first = buildComposerOutputSchemaPromptV1({ input, attempt: 1, priorFailure: null });
const repair = buildComposerOutputSchemaPromptV1({ input, attempt: 2, priorFailure: "non_exact_keys" });
assert.equal(first.system, repair.system);
for (const token of [...descriptor.outputSchema.exactKeys, ...descriptor.outputSchema.purposeEnum, "untrusted", "No extra or missing keys", "non-empty", "unique array"]) assert(first.system.includes(token), token);
assert(first.user.includes("BEGIN_UNTRUSTED_COMPOSER_INPUT_JSON") && first.user.includes("END_UNTRUSTED_COMPOSER_INPUT_JSON"));
assert(repair.user.includes("non_exact_keys") && !repair.user.includes("assistantText"));
const source = readFileSync("scripts/composer-shadow-qwen-local.ts", "utf8");
assert(source.includes("promptHash: COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1"));
assert(source.includes("--allow-synthetic-qwen-diagnostic"));
assert(source.includes('COMPOSER_SHADOW_DIAGNOSTIC_STRICT_SUCCESS, "true"'));
assert(source.includes('behaviorEvidenceStatus: evidenceSource === "real_qwen" ? "candidate_requires_ledger_authority_validation" as const : "mechanism_only_not_evidence" as const'));
for (const forbidden of ["parseComposerShadowOutputV1 =", "QWEN_API_KEY=", "DASHSCOPE_API_KEY="]) assert(!source.includes(forbidden));
console.log(JSON.stringify({ status: "PASS", descriptorSha256: COMPOSER_OUTPUT_SCHEMA_PROMPT_PREAUDIT_SHA256, acceptanceIds: descriptor.acceptanceIds.length, promptHash: COMPOSER_OUTPUT_SCHEMA_PROMPT_HASH_V1, strictParserChanges: 0, realQwenCalls: 0 }));
