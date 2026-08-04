import type {
  NonImpactReactionRelation,
  ReactionCandidateV1,
  ReactionEvidenceRole,
  ReactionEvidenceV1,
  ReactionRelation,
} from "@/services/helping/reactionAssessmentFixture";

export const BATCH2C_FIXTURE_SESSION_ID = "batch2c-reaction-session";
export const BATCH2C_FIXTURE_USER_TURN_ID = "batch2c-user-current";
export const BATCH2C_FIXTURE_TARGET_TURN_ID = "batch2c-assistant-formal-target";

export const reactionEvidence = ({
  text,
  role = "supports_reaction",
  sourceUserTurnId = BATCH2C_FIXTURE_USER_TURN_ID,
  targetAssistantTurnId = BATCH2C_FIXTURE_TARGET_TURN_ID,
}: {
  text: string;
  role?: ReactionEvidenceRole;
  sourceUserTurnId?: string;
  targetAssistantTurnId?: string;
}): ReactionEvidenceV1 => ({
  sourceUserTurnId,
  targetAssistantTurnId,
  role,
  text,
});

export const reactionCandidate = ({
  reaction,
  relation,
  evidence,
  confidence = 0.8,
  sourceUserTurnId = BATCH2C_FIXTURE_USER_TURN_ID,
  targetAssistantTurnId = BATCH2C_FIXTURE_TARGET_TURN_ID,
}: {
  reaction: ReactionCandidateV1["reaction"];
  relation: ReactionRelation;
  evidence: ReactionEvidenceV1[];
  confidence?: number;
  sourceUserTurnId?: string;
  targetAssistantTurnId?: string;
}): ReactionCandidateV1 => ({
  reaction,
  confidence,
  sourceUserTurnId,
  targetAssistantTurnId,
  relationToPreviousMove: relation,
  evidence,
});

export type Batch2CReactionSemanticFixture = {
  id: string;
  relation: ReactionRelation;
  candidates: ReactionCandidateV1[];
  provenanceEvidence: ReactionEvidenceV1[];
  expectedStatus: "assessed" | "observed_non_impact";
  expectedReactionEvidenceKnown: boolean;
  expectedImpactKnown: boolean;
};

const oneCandidateFixture = ({
  id,
  reaction,
  relation,
  evidence,
  expectedImpactKnown,
  expectedReactionEvidenceKnown = true,
}: {
  id: string;
  reaction: ReactionCandidateV1["reaction"];
  relation: ReactionRelation;
  evidence: ReactionEvidenceV1[];
  expectedImpactKnown: boolean;
  expectedReactionEvidenceKnown?: boolean;
}): Batch2CReactionSemanticFixture => ({
  id,
  relation,
  candidates: [reactionCandidate({ reaction, relation, evidence })],
  provenanceEvidence: evidence,
  expectedStatus: relation === "topic_shift" || relation === "unclear"
    ? "observed_non_impact"
    : "assessed",
  expectedReactionEvidenceKnown,
  expectedImpactKnown,
});

const acceptedEvidence = reactionEvidence({ text: "对，就是这个意思。" });
const actionResultEvidence = reactionEvidence({
  text: "我试了，但没什么变化。",
  role: "supports_impact",
});
const strainEvidence = reactionEvidence({
  text: "你刚才连续问让我压力更大。",
  role: "supports_impact",
});
const correctionEvidence = reactionEvidence({ text: "不是这样，我说的不是这个意思。" });
const noAttributionEvidence = reactionEvidence({
  text: "不是你的问题让我好些，是事情自己解决了。",
  role: "supports_impact",
});
const awarenessEvidence = reactionEvidence({ text: "我现在能看见这两件事的区别了。" });
const causalCounterevidence = reactionEvidence({
  text: "但也可能只是时间过去了。",
  role: "counterevidence",
});
const topicShiftEvidence = reactionEvidence({ text: "这件事先放下，我想说工作。" });
const unclearEvidence = reactionEvidence({ text: "嗯。", role: "counterevidence" });
const continuedEvidence = reactionEvidence({ text: "刚才说到那里，我还想到一件事。" });

export const BATCH2C_REACTION_SEMANTIC_FIXTURES: Batch2CReactionSemanticFixture[] = [
  oneCandidateFixture({
    id: "explicit-acceptance-not-impact",
    reaction: "accepted_or_used_move",
    relation: "direct_response",
    evidence: [acceptedEvidence],
    expectedImpactKnown: false,
  }),
  oneCandidateFixture({
    id: "explicit-action-result-impact-known",
    reaction: "reported_action_result",
    relation: "continues_move",
    evidence: [actionResultEvidence],
    expectedImpactKnown: true,
  }),
  oneCandidateFixture({
    id: "explicit-pressure-negative-impact-known",
    reaction: "relationship_strain",
    relation: "rejects_move",
    evidence: [strainEvidence],
    expectedImpactKnown: true,
  }),
  oneCandidateFixture({
    id: "explicit-correction-reaction-only",
    reaction: "corrected_or_rejected_move",
    relation: "rejects_move",
    evidence: [correctionEvidence],
    expectedImpactKnown: false,
  }),
  oneCandidateFixture({
    id: "explicit-no-attribution-is-reported-impact",
    reaction: "corrected_or_rejected_move",
    relation: "rejects_move",
    evidence: [noAttributionEvidence],
    expectedImpactKnown: true,
  }),
  oneCandidateFixture({
    id: "new-awareness-without-impact-attribution",
    reaction: "expressed_new_awareness",
    relation: "direct_response",
    evidence: [awarenessEvidence],
    expectedImpactKnown: false,
  }),
  oneCandidateFixture({
    id: "causal-ambiguity-counterevidence",
    reaction: "expressed_new_awareness",
    relation: "direct_response",
    evidence: [
      { ...awarenessEvidence, role: "supports_impact" },
      causalCounterevidence,
    ],
    expectedImpactKnown: false,
  }),
  oneCandidateFixture({
    id: "target-bound-topic-shift",
    reaction: "topic_shift",
    relation: "topic_shift",
    evidence: [topicShiftEvidence],
    expectedImpactKnown: false,
  }),
  oneCandidateFixture({
    id: "unclear-form-evidence",
    reaction: "unclear",
    relation: "unclear",
    evidence: [unclearEvidence],
    expectedReactionEvidenceKnown: false,
    expectedImpactKnown: false,
  }),
  {
    id: "multiple-complementary-reactions",
    relation: "direct_response",
    candidates: [
      reactionCandidate({
        reaction: "continued_exploration",
        relation: "direct_response",
        evidence: [continuedEvidence],
      }),
      reactionCandidate({
        reaction: "expressed_new_awareness",
        relation: "direct_response",
        evidence: [awarenessEvidence],
      }),
    ],
    provenanceEvidence: [continuedEvidence, awarenessEvidence],
    expectedStatus: "assessed",
    expectedReactionEvidenceKnown: true,
    expectedImpactKnown: false,
  },
];

export const nonImpactAssociationFor = (
  relation: NonImpactReactionRelation
) => ({
  status: "target_bound_non_impact" as const,
  sourceUserTurnId: BATCH2C_FIXTURE_USER_TURN_ID,
  targetAssistantTurnId: BATCH2C_FIXTURE_TARGET_TURN_ID,
  relation,
  evidence: [`Target-bound ${relation} fixture evidence.`],
});
