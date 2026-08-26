import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  P3_CANONICAL_HARD_FACTS,
  P3_CANONICAL_HARD_FACTS_HASH,
  assertP3HardFactsSurfaceDecision,
  createP3HardFactsSurfaceRequest,
} from "../services/ai/p3HardFactsSurfaceAuthority";

assert.deepEqual(P3_CANONICAL_HARD_FACTS.facts, [
  { factId: "assistant.displayName", value: "小慢" },
  { factId: "assistant.kind", value: "AI聊天助手" },
]);
assert.match(P3_CANONICAL_HARD_FACTS_HASH, /^sha256:[0-9a-f]{64}$/u);

const request = createP3HardFactsSurfaceRequest("segment", "我是小慢。", "我是小慢。", 0);
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const valid = { schemaVersion: "p3_hard_facts_surface_decision_v1", authorityVersion: request.authorityVersion, planHash: request.planHash, scope: request.scope, textHash: request.textHash, replyHash: request.replyHash, utf16Start: request.utf16Start, utf16End: request.utf16End, decision: "consistent", evidence: [{ factId: "assistant.displayName", utf16Start: 0, utf16End: request.utf16End, textHash: request.textHash }] };
assert.equal(assertP3HardFactsSurfaceDecision(request, valid), "consistent");
for (const forged of [
  { ...valid, textHash: P3_CANONICAL_HARD_FACTS_HASH },
  { ...valid, replyHash: P3_CANONICAL_HARD_FACTS_HASH },
  { ...valid, planHash: request.textHash },
  { ...valid, decision: "maybe" },
  { ...valid, extra: true },
  { ...valid, evidence: [] },
  { ...valid, decision: "not_applicable" },
  { ...valid, evidence: [{ ...valid.evidence[0], utf16Start: 2, utf16End: 2, textHash: hash("") }] },
  { ...valid, evidence: [{ ...valid.evidence[0], utf16Start: 3, utf16End: 2 }] },
  { ...valid, evidence: [{ ...valid.evidence[0], utf16End: request.utf16End + 1 }] },
  { ...valid, evidence: [{ ...valid.evidence[0], utf16Start: 0, utf16End: 2, textHash: request.textHash }] },
  { ...valid, evidence: [valid.evidence[0], valid.evidence[0]] },
]) assert.throws(() => assertP3HardFactsSurfaceDecision(request, forged));
assert.equal(assertP3HardFactsSurfaceDecision(request, { ...valid, decision: "not_applicable", evidence: [] }), "not_applicable");
const orderedRequest = createP3HardFactsSurfaceRequest("final", "小慢是AI聊天助手", "小慢是AI聊天助手", 0);
const first = { factId: "assistant.displayName", utf16Start: 0, utf16End: 2, textHash: hash("小慢") };
const second = { factId: "assistant.kind", utf16Start: 3, utf16End: orderedRequest.utf16End, textHash: hash("AI聊天助手") };
const ordered = { schemaVersion: "p3_hard_facts_surface_decision_v1", authorityVersion: orderedRequest.authorityVersion, planHash: orderedRequest.planHash, scope: orderedRequest.scope, textHash: orderedRequest.textHash, replyHash: orderedRequest.replyHash, utf16Start: orderedRequest.utf16Start, utf16End: orderedRequest.utf16End, decision: "consistent", evidence: [first, second] };
assert.equal(assertP3HardFactsSurfaceDecision(orderedRequest, ordered), "consistent");
assert.throws(() => assertP3HardFactsSurfaceDecision(orderedRequest, { ...ordered, evidence: [second, first] }));

console.log(JSON.stringify({ status: "PASS", canonicalProjection: true, strictBinding: true, noLexicon: true }));
