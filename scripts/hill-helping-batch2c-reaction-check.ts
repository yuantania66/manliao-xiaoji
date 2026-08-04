import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  loadFormalCommittedHelpingMoveFixtures,
  lookupAssociatedCommittedHelpingMove,
} from "@/services/helping/committedHelpingMoveAssociation";
import {
  BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION,
  createFailedReactionAssessmentFixture,
  evaluateReactionAssessmentFixture,
  parseReactionCandidateV1,
  parseReactionEvidenceV1,
  type EvaluateReactionAssessmentFixtureInput,
  type ReactionAssessmentFixtureAssociation,
  type ReactionRelation,
} from "@/services/helping/reactionAssessmentFixture";

import { buildBatch2BFormalRecord } from "./hill-helping-batch2b-fixtures";
import {
  BATCH2C_FIXTURE_SESSION_ID,
  BATCH2C_FIXTURE_TARGET_TURN_ID,
  BATCH2C_FIXTURE_USER_TURN_ID,
  BATCH2C_REACTION_SEMANTIC_FIXTURES,
  nonImpactAssociationFor,
  reactionCandidate,
  reactionEvidence,
} from "./hill-helping-batch2c-reaction-fixtures";

const root = process.cwd();
const targetPlanId = `plan-${BATCH2C_FIXTURE_TARGET_TURN_ID}`;
const formalRecord = buildBatch2BFormalRecord({
  sessionId: BATCH2C_FIXTURE_SESSION_ID,
  messageId: BATCH2C_FIXTURE_TARGET_TURN_ID,
  committedOrder: 1,
});
const formalLoad = loadFormalCommittedHelpingMoveFixtures({
  records: [formalRecord],
  sessionId: BATCH2C_FIXTURE_SESSION_ID,
  explicitTargetAssistantTurnId: BATCH2C_FIXTURE_TARGET_TURN_ID,
});

assert.equal(formalLoad.moves.length, 1, "the evaluator fixture target must load as formal_v1");
assert.equal(formalLoad.trace[0]?.reason, "formal_v1_loaded");

const associationFor = (relation: ReactionRelation): ReactionAssessmentFixtureAssociation => {
  if (relation === "topic_shift" || relation === "unclear") {
    return nonImpactAssociationFor(relation);
  }
  const association = lookupAssociatedCommittedHelpingMove({
    loadedMoves: formalLoad.moves,
    currentUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
    explicitReplyToAssistantTurnId: BATCH2C_FIXTURE_TARGET_TURN_ID,
    correctionTargetAssistantTurnId:
      relation === "rejects_move" ? BATCH2C_FIXTURE_TARGET_TURN_ID : undefined,
    semanticEvidence: [{
      sourceUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
      targetAssistantTurnId: BATCH2C_FIXTURE_TARGET_TURN_ID,
      relation,
      evidence: [`Batch 2C ${relation} association evidence.`],
    }],
  });
  assert.equal(association.status, "associated", `${relation} must pass the Batch 2B gate`);
  return association;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const formalTargetSnapshot = clone(formalLoad.moves);

let semanticPasses = 0;
for (const fixture of BATCH2C_REACTION_SEMANTIC_FIXTURES) {
  const result = evaluateReactionAssessmentFixture({
    sessionId: BATCH2C_FIXTURE_SESSION_ID,
    currentUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
    loadedMoves: formalLoad.moves,
    association: associationFor(fixture.relation),
    candidateInput: clone(fixture.candidates),
    provenanceEvidence: clone(fixture.provenanceEvidence),
  });
  assert.equal(result.schemaVersion, BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION, fixture.id);
  assert.equal(result.mode, "shadow", fixture.id);
  assert.equal(result.source, "fixture", fixture.id);
  assert.equal(result.status, fixture.expectedStatus, fixture.id);
  assert.equal(result.reactionEvidenceKnown, fixture.expectedReactionEvidenceKnown, fixture.id);
  assert.equal(result.impactKnown, fixture.expectedImpactKnown, fixture.id);
  if (result.status === "assessed" || result.status === "observed_non_impact") {
    assert.equal(result.targetAssistantTurnId, BATCH2C_FIXTURE_TARGET_TURN_ID, fixture.id);
    assert.equal(result.targetPlanId, targetPlanId, fixture.id);
    assert.equal(result.relation, fixture.relation, fixture.id);
    assert.equal(result.reactionCandidates.length, fixture.candidates.length, fixture.id);
  }
  semanticPasses += 1;
}
assert.deepEqual(
  formalLoad.moves,
  formalTargetSnapshot,
  "correction assessment must not rewrite the committed formal target"
);

const validEvidence = reactionEvidence({ text: "对，这正是在回应上一条。" });
const validCandidate = reactionCandidate({
  reaction: "accepted_or_used_move",
  relation: "direct_response",
  evidence: [validEvidence],
});

assert.deepEqual(parseReactionEvidenceV1(validEvidence), {
  valid: true,
  evidence: validEvidence,
});
assert.equal(parseReactionEvidenceV1({ ...validEvidence, extra: true }).valid, false);
assert.equal(parseReactionCandidateV1(validCandidate).valid, true);
assert.equal(parseReactionCandidateV1({ ...validCandidate, extra: true }).valid, false);

const directAssociation = associationFor("direct_response");
const validInput = (): EvaluateReactionAssessmentFixtureInput => ({
  sessionId: BATCH2C_FIXTURE_SESSION_ID,
  currentUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
  loadedMoves: formalLoad.moves,
  association: clone(directAssociation),
  candidateInput: [clone(validCandidate)],
  provenanceEvidence: [clone(validEvidence)],
});

let failClosedPasses = 0;
const expectFailClosed = ({
  id,
  input,
  status = "invalid",
  reason,
}: {
  id: string;
  input: EvaluateReactionAssessmentFixtureInput;
  status?: "not_evaluable" | "invalid" | "failed";
  reason?: string;
}) => {
  const result = evaluateReactionAssessmentFixture(input);
  assert.equal(result.status, status, id);
  assert.deepEqual(result.reactionCandidates, [], id);
  assert.equal(result.reactionEvidenceKnown, false, id);
  assert.equal(result.impactKnown, false, id);
  assert.ok(result.reasons.length > 0, id);
  if (reason) assert.ok(result.reasons.includes(reason), `${id}: ${result.reasons.join(", ")}`);
  failClosedPasses += 1;
};

expectFailClosed({
  id: "no Batch 2B association",
  input: {
    ...validInput(),
    association: { status: "not_associated", reason: "target_not_formal" },
  },
  status: "not_evaluable",
  reason: "association:target_not_formal",
});
expectFailClosed({
  id: "invalid source identity",
  input: { ...validInput(), currentUserTurnId: " " },
  reason: "invalid_source_user_turn_id",
});
expectFailClosed({
  id: "missing formal target",
  input: { ...validInput(), loadedMoves: [] },
  reason: "formal_target_binding_failed",
});
expectFailClosed({
  id: "cross-session formal target",
  input: { ...validInput(), sessionId: "another-session" },
  reason: "formal_target_binding_failed",
});
expectFailClosed({
  id: "duplicate formal target identity",
  input: { ...validInput(), loadedMoves: [...formalLoad.moves, clone(formalLoad.moves[0])] },
  reason: "formal_target_binding_failed",
});
expectFailClosed({
  id: "malformed formal target cannot throw",
  input: {
    ...validInput(),
    loadedMoves: [{ sessionId: BATCH2C_FIXTURE_SESSION_ID } as never],
  },
  reason: "formal_target_binding_failed",
});

const tamperedAssociation = clone(directAssociation) as Record<string, unknown>;
if (tamperedAssociation.status === "associated") {
  tamperedAssociation.move = {
    ...(tamperedAssociation.move as Record<string, unknown>),
    planId: "tampered-plan",
  };
}
expectFailClosed({
  id: "association plan does not match formal target",
  input: { ...validInput(), association: tamperedAssociation },
  reason: "formal_target_plan_mismatch",
});
expectFailClosed({
  id: "candidate rejects unknown fields",
  input: { ...validInput(), candidateInput: [{ ...validCandidate, extra: true }] },
  reason: "candidate_0:invalid_candidate_keys",
});
expectFailClosed({
  id: "nested evidence rejects unknown fields",
  input: {
    ...validInput(),
    candidateInput: [{
      ...validCandidate,
      evidence: [{ ...validEvidence, inferredBy: "model" }],
    }],
  },
  reason: "candidate_0:evidence_0:invalid_evidence_keys",
});
expectFailClosed({
  id: "confidence rejects NaN",
  input: { ...validInput(), candidateInput: [{ ...validCandidate, confidence: Number.NaN }] },
  reason: "candidate_0:invalid_confidence",
});
expectFailClosed({
  id: "confidence rejects out of range",
  input: { ...validInput(), candidateInput: [{ ...validCandidate, confidence: 1.01 }] },
  reason: "candidate_0:invalid_confidence",
});
expectFailClosed({
  id: "candidate source user turn binding",
  input: {
    ...validInput(),
    candidateInput: [{ ...validCandidate, sourceUserTurnId: "stale-user-turn" }],
  },
  reason: "candidate_0:evidence_0:candidate_source_mismatch",
});
expectFailClosed({
  id: "candidate target binding",
  input: {
    ...validInput(),
    candidateInput: [{ ...validCandidate, targetAssistantTurnId: "other-target" }],
  },
  reason: "candidate_0:evidence_0:candidate_target_mismatch",
});
expectFailClosed({
  id: "provenance source user turn binding",
  input: {
    ...validInput(),
    provenanceEvidence: [{ ...validEvidence, sourceUserTurnId: "stale-user-turn" }],
  },
  reason: "provenance_0:source_user_turn_mismatch",
});
expectFailClosed({
  id: "provenance target binding",
  input: {
    ...validInput(),
    provenanceEvidence: [{ ...validEvidence, targetAssistantTurnId: "other-target" }],
  },
  reason: "provenance_0:target_turn_mismatch",
});
expectFailClosed({
  id: "candidate evidence must exist in frozen provenance",
  input: {
    ...validInput(),
    provenanceEvidence: [reactionEvidence({ text: "不同的冻结证据。" })],
  },
  reason: "candidate_0:evidence_0:unverified_provenance",
});
expectFailClosed({
  id: "candidate relation must match association",
  input: {
    ...validInput(),
    candidateInput: [{ ...validCandidate, relationToPreviousMove: "continues_move" }],
  },
  reason: "candidate_0:association_relation_mismatch",
});
expectFailClosed({
  id: "relation and reaction must be compatible",
  input: {
    ...validInput(),
    association: associationFor("continues_move"),
    candidateInput: [{
      ...validCandidate,
      reaction: "relationship_strain",
      relationToPreviousMove: "continues_move",
    }],
  },
  reason: "candidate_0:incompatible_relation_reaction",
});
expectFailClosed({
  id: "correction reaction cannot use direct response relation",
  input: {
    ...validInput(),
    candidateInput: [{ ...validCandidate, reaction: "corrected_or_rejected_move" }],
  },
  reason: "candidate_0:incompatible_relation_reaction",
});
expectFailClosed({
  id: "candidate list cannot be empty",
  input: { ...validInput(), candidateInput: [] },
  reason: "reaction_candidates_required",
});
expectFailClosed({
  id: "provenance list cannot be empty",
  input: { ...validInput(), provenanceEvidence: [] },
  reason: "provenance_evidence_required",
});
expectFailClosed({
  id: "counterevidence alone cannot classify a reaction",
  input: {
    ...validInput(),
    candidateInput: [{
      ...validCandidate,
      evidence: [{ ...validEvidence, role: "counterevidence" }],
    }],
    provenanceEvidence: [{ ...validEvidence, role: "counterevidence" }],
  },
  reason: "candidate_0:missing_supporting_reaction_evidence",
});
expectFailClosed({
  id: "association rejects unknown fields",
  input: {
    ...validInput(),
    association: { ...(directAssociation as object), evaluatorHint: "accept" },
  },
  reason: "invalid_associated_keys",
});
expectFailClosed({
  id: "non-impact source binding",
  input: {
    ...validInput(),
    association: {
      ...nonImpactAssociationFor("topic_shift"),
      sourceUserTurnId: "stale-user-turn",
    },
    candidateInput: BATCH2C_REACTION_SEMANTIC_FIXTURES[7].candidates,
    provenanceEvidence: BATCH2C_REACTION_SEMANTIC_FIXTURES[7].provenanceEvidence,
  },
  reason: "non_impact_source_user_turn_mismatch",
});

const mutableCandidate = clone(validCandidate);
const mutableEvidence = clone(validEvidence);
const immutableResult = evaluateReactionAssessmentFixture({
  ...validInput(),
  candidateInput: [mutableCandidate],
  provenanceEvidence: [mutableEvidence],
});
mutableCandidate.evidence[0].text = "mutated after assessment";
mutableEvidence.text = "mutated after assessment";
assert.equal(immutableResult.status, "assessed");
if (immutableResult.status === "assessed") {
  assert.equal(immutableResult.reactionCandidates[0].evidence[0].text, validEvidence.text);
}

const failedEnvelope = createFailedReactionAssessmentFixture({
  sourceUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
  reason: "fixture_evaluator_failure",
});
assert.equal(failedEnvelope.status, "failed");
assert.deepEqual(failedEnvelope.reactionCandidates, []);
assert.equal(failedEnvelope.reactionEvidenceKnown, false);
assert.equal(failedEnvelope.impactKnown, false);

const walkTypeScript = (directory: string): string[] => {
  if (!statSync(directory).isDirectory()) return [];
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    return statSync(absolute).isDirectory()
      ? walkTypeScript(absolute)
      : /\.(ts|tsx)$/.test(entry) ? [absolute] : [];
  });
};

const evaluatorPath = path.join(root, "services/helping/reactionAssessmentFixture.ts");
const productionFiles = ["app", "conversation-os", "services"]
  .flatMap((directory) => walkTypeScript(path.join(root, directory)))
  .filter((file) => file !== evaluatorPath);
const downstreamConsumers = productionFiles.filter((file) =>
  readFileSync(file, "utf8").includes("reactionAssessmentFixture") ||
  readFileSync(file, "utf8").includes("evaluateReactionAssessmentFixture")
);
assert.deepEqual(downstreamConsumers, [], "the fixture evaluator must have zero production consumers");

const evaluatorSource = readFileSync(evaluatorPath, "utf8");
for (const forbidden of [
  "@/services/memory",
  "PrismaClient",
  "@prisma/client",
  "responsePlanner",
  "initiativeOwner",
  "interactionMetadata",
  "ChatMessage",
]) {
  assert.equal(evaluatorSource.includes(forbidden), false, `forbidden integration: ${forbidden}`);
}
assert.equal(
  readFileSync(path.join(root, "services/helping/index.ts"), "utf8")
    .includes("reactionAssessmentFixture"),
  false,
  "the production helping barrel must not export the fixture evaluator"
);

console.log(JSON.stringify({
  gate: "B2-Reaction-Shadow",
  schemaVersion: BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION,
  semanticFixtures: semanticPasses,
  failClosedCases: failClosedPasses,
  formalTargetBinding: "passed",
  sourceUserTurnBinding: "passed",
  evidenceProvenance: "passed",
  impactKnownDerivation: "passed",
  downstreamConsumers: downstreamConsumers.length,
  userVisibleBehaviorChanges: 0,
}, null, 2));
