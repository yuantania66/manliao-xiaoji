import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { P5_PREAUDIT_HASH } from "../services/governance/p5DeletionCascadeAuthority";

const descriptor = {"version":"p5-preaudit-gold-v1","authorization":["A1:same_tenant_source_authorized:yes","A2:cross_tenant:no","A3:missing_source:no","A4:unauthorized_actor:no","A5:repeat_same_request:idempotent","A6:same_key_different_target:conflict"],"immediate":["V1:selected_source_visibility:excluded_before_return","V2:p2_draft_plaintext:cleared","V3:p2_final_plaintext:cleared","V4:p2_replay:deleted_no_body","V5:content_deleted_at:set","V6:unrelated_source:unchanged"],"edges":["E1:source_edge:exact_immutable","E2:memory_index_profile:source_bound","E3:relationship_growth:recompute_marked","E4:replay_shadow:source_bound"],"deadlines":["D1:memory_invalidated:le60000ms","D2:index_invalidated:le60000ms","D3:profile_invalidated:le60000ms","D4:relationship_recompute_marked:le86400000ms","D5:growth_recompute_marked:le86400000ms","D6:replay_invalidated:immediate","D7:shadow_text_linkage_removed:le86400000ms"],"execution":["C1:cas_single_owner","C2:live_lease_attach","C3:expired_lease_takeover_attempt_plus1","C4:stale_fence:no_mutation","C5:crash_after_tombstone:resume","C6:crash_mid_cascade:resume","C7:duplicate_delivery:no_duplicate_effect","C8:terminal_failure:stable","C9:concurrency:one_job_identity"],"audit":["N1:exact_low_cardinality_schema","N2:plaintext_canary_absent","N3:ids_hashes_timestamps_only","N4:audit_idempotent","N5:audit_tenant_bound"],"pending":["P1:physical_delete:pending","P2:legal_retention_policy:pending","P3:production_integration:pending","P4:real_user_data:forbidden"]};
const hash = createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
assert.equal(hash, P5_PREAUDIT_HASH);
const ids = Object.values(descriptor).flatMap((value) => Array.isArray(value) ? value.map((entry) => entry.split(":", 1)[0]) : []);
assert.equal(ids.length, 41);
assert.equal(new Set(ids).size, 41);
const service = readFileSync(new URL("../services/governance/p5DeletionCascadeAuthority.ts", import.meta.url), "utf8");
for (const forbidden of ["fetch(", "QWEN_API_KEY", "DASHSCOPE_API_KEY", "createChatReply"]) assert.equal(service.includes(forbidden), false);
console.log(JSON.stringify({ status: "PASS", preauditHash: hash, frozenIds: ids.length, productionIntegration: "pending", physicalDelete: "pending", realUserData: "forbidden" }));
