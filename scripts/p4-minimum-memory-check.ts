import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { P4_ELIGIBILITY_READ_GOLD_SHA256, P4_RUNTIME_BOUNDARY } from "../services/memory/p4EligibilityReadIntegrityAuthority";
import { P4_PROFILE_COMMITMENT_GOLD_SHA256 } from "../services/memory/p4ProfileCache";

export const P4_PROFILE_COMMITMENT_GOLD = {"version":"p4-profile-cache-commitment-authority-v1","valid":["V1:legal_project_read:ready","V2:empty_legal_project_read:ready_empty"],"item":["I1:item_field_tamper:empty","I2:item_order_tamper:empty","I3:item_add:empty","I4:item_drop:empty"],"source":["S1:source_list_tamper:empty","S2:source_order_tamper:empty","S3:artifact_tamper:empty","S4:category_tamper:empty","S5:sensitivity_tamper:empty","S6:content_tamper:empty","S7:noncurrent_source:empty","S8:deleted_source:empty"],"envelope":["E1:tenant_tamper:empty","E2:profile_version_tamper:empty","E3:generated_time_tamper:empty","E4:stale_time:empty","E5:payload_extra_key:empty","E6:item_extra_key:empty"],"commitment":["C1:canonical_commitment_exact:required","C2:commitment_tamper:empty","C3:commitment_missing_or_malformed:empty","C4:recomputed_public_sha_forgery:empty"],"boundary":["B1:empty_cache_miss:empty","B2:production_integration:pending","B3:qwen_calls:zero"]} as const;
export const P4_PROFILE_COMMITMENT_EXPECTED_IDS = new Set(Object.entries(P4_PROFILE_COMMITMENT_GOLD).filter(([key]) => key !== "version").flatMap(([, value]) => value));
assert.equal(createHash("sha256").update(JSON.stringify(P4_PROFILE_COMMITMENT_GOLD)).digest("hex"), P4_PROFILE_COMMITMENT_GOLD_SHA256);

export const P4_ELIGIBILITY_READ_GOLD = {"version":"p4-eligibility-read-integrity-v1","eligibility":["A1:ordinary_db_bound:eligible","A2:runtime_caller_mint:reject","A3:decision_extra_key:reject","A4:decision_hash_binding:reject_tamper","A5:evidence_exact_utf16:required","A6:cross_tenant_source:reject","A7:noncurrent_source:reject","A8:deleted_source:reject","A9:safety:ineligible","A10:secret:ineligible","A11:hypothesis:ineligible","A12:category_allowlist:exact"],"consent":["C1:sensitive_explicit_exact:accepted","C2:sensitive_absent:reject","C3:sensitive_semantic_not_explicit:reject","C4:consent_span_hash_tamper:reject","C5:consent_wrong_source:reject","C6:consent_extra_key:reject"],"promotion":["P1:valid_artifact:promote","P2:artifact_hash_tamper:reject","P3:source_content_tamper:reject","P4:category_tamper:reject","P5:sensitivity_tamper:reject","P6:tenant_tamper:reject","P7:stale_or_deleted_source:reject"],"retrieval":["R1:valid_current:visible","R2:memory_content_tamper:hidden","R3:artifact_tamper:hidden","R4:category_or_sensitivity_tamper:hidden","R5:tenant_or_source_tamper:hidden","R6:expired_sensitive:hidden"],"profile":["Q1:valid_item_commitment:ready","Q2:item_payload_tamper:empty","Q3:source_list_tamper:empty","Q4:artifact_tamper:empty","Q5:category_or_sensitivity_tamper:empty","Q6:stale_deleted_source:empty"],"boundary":["B1:injected_local_provider_only","B2:qwen_calls:zero","B3:production_integration:pending","B4:p3_composer_p2:unchanged"]} as const;
export const P4_ELIGIBILITY_READ_EXPECTED_IDS = new Set(Object.entries(P4_ELIGIBILITY_READ_GOLD).filter(([key]) => key !== "version").flatMap(([, value]) => value));
const hash = createHash("sha256").update(JSON.stringify(P4_ELIGIBILITY_READ_GOLD)).digest("hex");
assert.equal(hash, P4_ELIGIBILITY_READ_GOLD_SHA256);
assert.equal(P4_ELIGIBILITY_READ_EXPECTED_IDS.size, 41);
assert.deepEqual(P4_RUNTIME_BOUNDARY, { productionIntegration: "pending", providerCalls: "local_injected_only", qwenCalls: 0 });
for (const path of ["services/ai/p3SafetyTrunk.ts", "services/ai/chatOrchestrationService.ts", "services/chat/assistantPublicationService.ts"]) {
  assert(!readFileSync(path, "utf8").includes("p4EligibilityReadIntegrityAuthority"), path);
}
console.log(JSON.stringify({ status: "PASS", descriptorHash: hash, expectedIds: 41 }));
