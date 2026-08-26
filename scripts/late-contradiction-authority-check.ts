import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  LATE_CONTRADICTION_AUTHORITY_VERSION,
  LATE_CONTRADICTION_CONTRACT_DEFINITION,
  LATE_CONTRADICTION_CONTRACT_HASH,
  validateLateContradiction,
  type LateContradictionProviderInput,
  type LateContradictionVerdict,
} from "./late-contradiction-authority";

const reply = "我是小慢。还没形成完整话题也没关系，从眼前一点开始就好。你好呀！";
const input = { caseId: "dual-positive-only", planId: "late-check", candidateReply: reply };
const verdictFor = (
  providerInput: LateContradictionProviderInput,
  status: LateContradictionVerdict["status"] = "clear"
): LateContradictionVerdict => ({
  schemaVersion: 1,
  authorityVersion: LATE_CONTRADICTION_AUTHORITY_VERSION,
  contractHash: LATE_CONTRADICTION_CONTRACT_HASH,
  caseId: providerInput.caseId,
  planId: providerInput.planId,
  candidateHash: createHash("sha256").update(providerInput.candidateReply).digest("hex"),
  completedFunctions: ["complete_reciprocal_contact", "establish_assistant_identity:first_contact"],
  status,
  completedRitual: "first_contact_greeting_ritual",
  reopenedRitual: status === "late_contradiction" ? "first_contact_greeting_ritual" : null,
  completionEvidence: { start: 999, end: 1000, text: "从眼前一点开始就好。", reason: "entry completed" },
  contradictionEvidence: status === "late_contradiction"
    ? { start: 999, end: 1000, text: "你好呀！", reason: "later ritual reopening" }
    : null,
});

const main = async () => {
  assert.equal(
    LATE_CONTRADICTION_CONTRACT_HASH,
    createHash("sha256").update(LATE_CONTRADICTION_CONTRACT_DEFINITION).digest("hex")
  );
  assert.equal((await validateLateContradiction({
    input,
    provider: async (value) => verdictFor(value, "late_contradiction"),
  })).reason, "late_contradiction:detected");
  const clearInput = { ...input, candidateReply: "我是小慢。我们从眼前一点开始就好。" };
  assert.equal((await validateLateContradiction({
    input: clearInput,
    provider: async (value) => verdictFor(value),
  })).passed, true);
  assert.equal((await validateLateContradiction({
    input,
    provider: async (value) => ({ ...verdictFor(value), extra: true }),
  })).reason, "late_contradiction:malformed_verdict");
  assert.equal((await validateLateContradiction({
    input,
    provider: async (value) => ({ ...verdictFor(value), planId: "wrong" }),
  })).reason, "late_contradiction:binding_mismatch");
  assert.equal((await validateLateContradiction({
    input: { ...input, candidateReply: "重复重复" },
    provider: async (value) => ({
      ...verdictFor(value),
      completionEvidence: { start: 0, end: 2, text: "重复", reason: "ambiguous" },
    }),
  })).reason, "late_contradiction:evidence_mismatch");
  assert.equal((await validateLateContradiction({
    input,
    provider: async (value) => verdictFor(value, "uncertain"),
  })).reason, "late_contradiction:uncertain");
  assert.equal((await validateLateContradiction({
    input,
    provider: async () => { throw new Error("provider unavailable"); },
  })).reason, "late_contradiction:provider_failure");
  console.log(JSON.stringify({
    authorityVersion: LATE_CONTRADICTION_AUTHORITY_VERSION,
    contractHash: LATE_CONTRADICTION_CONTRACT_HASH,
    status: "passed",
  }));
};

void main();
