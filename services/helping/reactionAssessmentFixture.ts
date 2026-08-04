import type {
  HelpingAssociationLookupResult,
  LoadedFormalHelpingMove,
} from "./committedHelpingMoveAssociation";
import type { HelpingReaction } from "./hillHelpingTypes";

export const BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION = 1 as const;

export type ReactionEvidenceRole =
  | "supports_reaction"
  | "supports_impact"
  | "counterevidence";

export type ReactionEvidenceV1 = {
  sourceUserTurnId: string;
  targetAssistantTurnId: string;
  role: ReactionEvidenceRole;
  text: string;
};

export type ReactionRelation =
  | "direct_response"
  | "continues_move"
  | "rejects_move"
  | "topic_shift"
  | "unclear";

export type AssociatingReactionRelation = Exclude<
  ReactionRelation,
  "topic_shift" | "unclear"
>;

export type NonImpactReactionRelation = Extract<
  ReactionRelation,
  "topic_shift" | "unclear"
>;

export type ReactionCandidateV1 = {
  reaction: HelpingReaction;
  confidence: number;
  sourceUserTurnId: string;
  targetAssistantTurnId: string;
  relationToPreviousMove: ReactionRelation;
  evidence: ReactionEvidenceV1[];
};

export type TargetBoundNonImpactFixtureAssociation = {
  status: "target_bound_non_impact";
  sourceUserTurnId: string;
  targetAssistantTurnId: string;
  relation: NonImpactReactionRelation;
  evidence: string[];
};

export type ReactionAssessmentFixtureAssociation =
  | HelpingAssociationLookupResult
  | TargetBoundNonImpactFixtureAssociation;

type ReactionAssessmentBase = {
  schemaVersion: typeof BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION;
  mode: "shadow";
  source: "fixture";
  sourceUserTurnId: string;
  reasons: string[];
};

export type Batch2CReactionAssessmentV1 =
  | ReactionAssessmentBase & {
      status: "assessed";
      targetAssistantTurnId: string;
      targetPlanId: string;
      relation: AssociatingReactionRelation;
      reactionCandidates: ReactionCandidateV1[];
      reactionEvidenceKnown: true;
      impactKnown: boolean;
    }
  | ReactionAssessmentBase & {
      status: "observed_non_impact";
      targetAssistantTurnId: string;
      targetPlanId: string;
      relation: NonImpactReactionRelation;
      reactionCandidates: ReactionCandidateV1[];
      reactionEvidenceKnown: boolean;
      impactKnown: false;
    }
  | ReactionAssessmentBase & {
      status: "not_evaluable" | "invalid" | "failed";
      reactionCandidates: [];
      reactionEvidenceKnown: false;
      impactKnown: false;
    };

export type ReactionEvidenceParseResult =
  | { valid: true; evidence: ReactionEvidenceV1 }
  | { valid: false; reasons: string[] };

export type ReactionCandidateParseResult =
  | { valid: true; candidate: ReactionCandidateV1 }
  | { valid: false; reasons: string[] };

export type EvaluateReactionAssessmentFixtureInput = {
  sessionId: string;
  currentUserTurnId: string;
  loadedMoves: LoadedFormalHelpingMove[];
  association: unknown;
  candidateInput: unknown;
  provenanceEvidence: unknown;
};

const REACTIONS = [
  "continued_exploration",
  "expressed_new_awareness",
  "moved_toward_action",
  "reported_action_result",
  "accepted_or_used_move",
  "corrected_or_rejected_move",
  "relationship_strain",
  "paused_or_withdrew",
  "requested_different_help",
  "topic_shift",
  "unclear",
] as const satisfies readonly HelpingReaction[];

const ASSOCIATING_RELATIONS = [
  "direct_response",
  "continues_move",
  "rejects_move",
] as const satisfies readonly AssociatingReactionRelation[];

const NON_IMPACT_RELATIONS = [
  "topic_shift",
  "unclear",
] as const satisfies readonly NonImpactReactionRelation[];

const RELATIONS = [
  ...ASSOCIATING_RELATIONS,
  ...NON_IMPACT_RELATIONS,
] as const satisfies readonly ReactionRelation[];

const EVIDENCE_ROLES = [
  "supports_reaction",
  "supports_impact",
  "counterevidence",
] as const satisfies readonly ReactionEvidenceRole[];

const ASSOCIATION_FAILURE_REASONS = [
  "no_formal_moves",
  "conflicting_explicit_targets",
  "target_not_formal",
  "missing_target_bound_semantic_evidence",
  "invalid_semantic_evidence",
  "non_associating_relation",
  "ambiguous_semantic_target",
  "ambiguous_relation",
  "correction_relation_mismatch",
] as const;

const EVIDENCE_KEYS = new Set([
  "sourceUserTurnId",
  "targetAssistantTurnId",
  "role",
  "text",
]);
const CANDIDATE_KEYS = new Set([
  "reaction",
  "confidence",
  "sourceUserTurnId",
  "targetAssistantTurnId",
  "relationToPreviousMove",
  "evidence",
]);
const ASSOCIATED_KEYS = new Set([
  "status",
  "targetAssistantTurnId",
  "relation",
  "move",
  "evidence",
]);
const NOT_ASSOCIATED_KEYS = new Set(["status", "reason"]);
const NON_IMPACT_ASSOCIATION_KEYS = new Set([
  "status",
  "sourceUserTurnId",
  "targetAssistantTurnId",
  "relation",
  "evidence",
]);

const REACTIONS_BY_RELATION: Record<ReactionRelation, readonly HelpingReaction[]> = {
  direct_response: [
    "continued_exploration",
    "expressed_new_awareness",
    "moved_toward_action",
    "reported_action_result",
    "accepted_or_used_move",
  ],
  continues_move: [
    "continued_exploration",
    "expressed_new_awareness",
    "moved_toward_action",
    "reported_action_result",
    "accepted_or_used_move",
  ],
  rejects_move: [
    "corrected_or_rejected_move",
    "relationship_strain",
    "paused_or_withdrew",
    "requested_different_help",
  ],
  topic_shift: ["topic_shift"],
  unclear: ["unclear"],
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (value: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(value).length === allowed.size &&
  Object.keys(value).every((key) => allowed.has(key));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const isMember = <T extends readonly string[]>(value: unknown, members: T): value is T[number] =>
  typeof value === "string" && members.includes(value as T[number]);

const traceUserTurnId = (value: unknown) =>
  isNonEmptyString(value) ? value : "<invalid-fixture-user-turn>";

const failClosed = ({
  sourceUserTurnId,
  status,
  reasons,
}: {
  sourceUserTurnId: unknown;
  status: "not_evaluable" | "invalid" | "failed";
  reasons: string[];
}): Batch2CReactionAssessmentV1 => ({
  schemaVersion: BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION,
  mode: "shadow",
  source: "fixture",
  status,
  sourceUserTurnId: traceUserTurnId(sourceUserTurnId),
  reactionCandidates: [],
  reactionEvidenceKnown: false,
  impactKnown: false,
  reasons: reasons.length > 0 ? Array.from(new Set(reasons)) : ["unspecified_fixture_failure"],
});

export const parseReactionEvidenceV1 = (value: unknown): ReactionEvidenceParseResult => {
  if (!isRecord(value)) return { valid: false, reasons: ["evidence_not_plain_object"] };
  const reasons: string[] = [];
  if (!hasExactKeys(value, EVIDENCE_KEYS)) reasons.push("invalid_evidence_keys");
  if (!isNonEmptyString(value.sourceUserTurnId)) reasons.push("invalid_evidence_source_user_turn");
  if (!isNonEmptyString(value.targetAssistantTurnId)) reasons.push("invalid_evidence_target_turn");
  if (!isMember(value.role, EVIDENCE_ROLES)) reasons.push("invalid_evidence_role");
  if (!isNonEmptyString(value.text)) reasons.push("invalid_evidence_text");
  if (reasons.length > 0) return { valid: false, reasons };
  return {
    valid: true,
    evidence: {
      sourceUserTurnId: value.sourceUserTurnId as string,
      targetAssistantTurnId: value.targetAssistantTurnId as string,
      role: value.role as ReactionEvidenceRole,
      text: value.text as string,
    },
  };
};

export const parseReactionCandidateV1 = (value: unknown): ReactionCandidateParseResult => {
  if (!isRecord(value)) return { valid: false, reasons: ["candidate_not_plain_object"] };
  const reasons: string[] = [];
  if (!hasExactKeys(value, CANDIDATE_KEYS)) reasons.push("invalid_candidate_keys");
  if (!isMember(value.reaction, REACTIONS)) reasons.push("invalid_reaction");
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) reasons.push("invalid_confidence");
  if (!isNonEmptyString(value.sourceUserTurnId)) reasons.push("invalid_candidate_source_user_turn");
  if (!isNonEmptyString(value.targetAssistantTurnId)) reasons.push("invalid_candidate_target_turn");
  if (!isMember(value.relationToPreviousMove, RELATIONS)) reasons.push("invalid_candidate_relation");
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    reasons.push("candidate_evidence_required");
  }

  const parsedEvidence: ReactionEvidenceV1[] = [];
  if (Array.isArray(value.evidence)) {
    for (const [index, item] of value.evidence.entries()) {
      const parsed = parseReactionEvidenceV1(item);
      if (!parsed.valid) {
        reasons.push(...parsed.reasons.map((reason) => `evidence_${index}:${reason}`));
        continue;
      }
      parsedEvidence.push(parsed.evidence);
      if (parsed.evidence.sourceUserTurnId !== value.sourceUserTurnId) {
        reasons.push(`evidence_${index}:candidate_source_mismatch`);
      }
      if (parsed.evidence.targetAssistantTurnId !== value.targetAssistantTurnId) {
        reasons.push(`evidence_${index}:candidate_target_mismatch`);
      }
    }
  }

  if (
    isMember(value.reaction, REACTIONS) &&
    isMember(value.relationToPreviousMove, RELATIONS) &&
    !REACTIONS_BY_RELATION[value.relationToPreviousMove].includes(value.reaction)
  ) reasons.push("incompatible_relation_reaction");

  if (
    value.reaction !== "unclear" &&
    parsedEvidence.length > 0 &&
    !parsedEvidence.some((item) =>
      item.role === "supports_reaction" || item.role === "supports_impact"
    )
  ) reasons.push("missing_supporting_reaction_evidence");

  if (reasons.length > 0) return { valid: false, reasons: Array.from(new Set(reasons)) };
  return {
    valid: true,
    candidate: {
      reaction: value.reaction as HelpingReaction,
      confidence: value.confidence as number,
      sourceUserTurnId: value.sourceUserTurnId as string,
      targetAssistantTurnId: value.targetAssistantTurnId as string,
      relationToPreviousMove: value.relationToPreviousMove as ReactionRelation,
      evidence: parsedEvidence,
    },
  };
};

const parseCandidateArray = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false as const, reasons: ["reaction_candidates_required"] };
  }
  const candidates: ReactionCandidateV1[] = [];
  const reasons: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseReactionCandidateV1(item);
    if (!parsed.valid) {
      reasons.push(...parsed.reasons.map((reason) => `candidate_${index}:${reason}`));
    } else {
      candidates.push(parsed.candidate);
    }
  }
  return reasons.length > 0
    ? { valid: false as const, reasons }
    : { valid: true as const, candidates };
};

const parseEvidenceArray = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false as const, reasons: ["provenance_evidence_required"] };
  }
  const evidence: ReactionEvidenceV1[] = [];
  const reasons: string[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = parseReactionEvidenceV1(item);
    if (!parsed.valid) {
      reasons.push(...parsed.reasons.map((reason) => `provenance_${index}:${reason}`));
    } else {
      evidence.push(parsed.evidence);
    }
  }
  return reasons.length > 0
    ? { valid: false as const, reasons }
    : { valid: true as const, evidence };
};

type ParsedAssociation =
  | { kind: "associated"; targetAssistantTurnId: string; relation: AssociatingReactionRelation; planId: string }
  | { kind: "non_impact"; sourceUserTurnId: string; targetAssistantTurnId: string; relation: NonImpactReactionRelation }
  | { kind: "not_associated"; reason: string };

const parseAssociation = (value: unknown):
  | { valid: true; association: ParsedAssociation }
  | { valid: false; reasons: string[] } => {
  if (!isRecord(value)) return { valid: false, reasons: ["association_not_plain_object"] };
  if (value.status === "not_associated") {
    if (!hasExactKeys(value, NOT_ASSOCIATED_KEYS)) {
      return { valid: false, reasons: ["invalid_not_associated_keys"] };
    }
    if (!isMember(value.reason, ASSOCIATION_FAILURE_REASONS)) {
      return { valid: false, reasons: ["invalid_not_associated_reason"] };
    }
    return { valid: true, association: { kind: "not_associated", reason: value.reason } };
  }

  if (value.status === "associated") {
    const reasons: string[] = [];
    if (!hasExactKeys(value, ASSOCIATED_KEYS)) reasons.push("invalid_associated_keys");
    if (!isNonEmptyString(value.targetAssistantTurnId)) reasons.push("invalid_association_target");
    if (!isMember(value.relation, ASSOCIATING_RELATIONS)) reasons.push("invalid_association_relation");
    if (!isNonEmptyStringArray(value.evidence)) reasons.push("association_evidence_required");
    if (!isRecord(value.move)) {
      reasons.push("invalid_association_move");
    } else {
      if (!isNonEmptyString(value.move.assistantTurnId)) reasons.push("invalid_association_move_target");
      if (!isNonEmptyString(value.move.planId)) reasons.push("invalid_association_move_plan");
      if (value.move.assistantTurnId !== value.targetAssistantTurnId) {
        reasons.push("association_move_target_mismatch");
      }
    }
    if (reasons.length > 0) return { valid: false, reasons };
    return {
      valid: true,
      association: {
        kind: "associated",
        targetAssistantTurnId: value.targetAssistantTurnId as string,
        relation: value.relation as AssociatingReactionRelation,
        planId: (value.move as Record<string, unknown>).planId as string,
      },
    };
  }

  if (value.status === "target_bound_non_impact") {
    const reasons: string[] = [];
    if (!hasExactKeys(value, NON_IMPACT_ASSOCIATION_KEYS)) {
      reasons.push("invalid_non_impact_association_keys");
    }
    if (!isNonEmptyString(value.sourceUserTurnId)) reasons.push("invalid_non_impact_source");
    if (!isNonEmptyString(value.targetAssistantTurnId)) reasons.push("invalid_non_impact_target");
    if (!isMember(value.relation, NON_IMPACT_RELATIONS)) reasons.push("invalid_non_impact_relation");
    if (!isNonEmptyStringArray(value.evidence)) reasons.push("non_impact_evidence_required");
    if (reasons.length > 0) return { valid: false, reasons };
    return {
      valid: true,
      association: {
        kind: "non_impact",
        sourceUserTurnId: value.sourceUserTurnId as string,
        targetAssistantTurnId: value.targetAssistantTurnId as string,
        relation: value.relation as NonImpactReactionRelation,
      },
    };
  }

  return { valid: false, reasons: ["unknown_association_status"] };
};

const evidenceKey = (value: ReactionEvidenceV1) =>
  [value.sourceUserTurnId, value.targetAssistantTurnId, value.role, value.text].join("\u0000");

const isLoadedFormalTarget = (
  value: unknown,
  sessionId: string,
  targetAssistantTurnId: string
): value is LoadedFormalHelpingMove => {
  if (!isRecord(value) || !isRecord(value.move)) return false;
  return value.sessionId === sessionId &&
    value.messageId === targetAssistantTurnId &&
    Number.isSafeInteger(value.committedOrder) &&
    (value.committedOrder as number) >= 0 &&
    value.move.assistantTurnId === targetAssistantTurnId &&
    isNonEmptyString(value.move.planId);
};

const findFormalTarget = ({
  loadedMoves,
  sessionId,
  targetAssistantTurnId,
}: {
  loadedMoves: LoadedFormalHelpingMove[];
  sessionId: string;
  targetAssistantTurnId: string;
}) => {
  const matches = loadedMoves.filter((item): item is LoadedFormalHelpingMove =>
    isLoadedFormalTarget(item, sessionId, targetAssistantTurnId)
  );
  return matches.length === 1 ? matches[0] : null;
};

export const evaluateReactionAssessmentFixture = ({
  sessionId,
  currentUserTurnId,
  loadedMoves,
  association,
  candidateInput,
  provenanceEvidence,
}: EvaluateReactionAssessmentFixtureInput): Batch2CReactionAssessmentV1 => {
  if (!isNonEmptyString(sessionId)) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["invalid_session_id"],
    });
  }
  if (!isNonEmptyString(currentUserTurnId)) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["invalid_source_user_turn_id"],
    });
  }
  if (!Array.isArray(loadedMoves)) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["loaded_moves_not_array"],
    });
  }

  const parsedAssociation = parseAssociation(association);
  if (!parsedAssociation.valid) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: parsedAssociation.reasons,
    });
  }
  if (parsedAssociation.association.kind === "not_associated") {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "not_evaluable",
      reasons: [`association:${parsedAssociation.association.reason}`],
    });
  }

  const targetAssistantTurnId = parsedAssociation.association.targetAssistantTurnId;
  const target = findFormalTarget({ loadedMoves, sessionId, targetAssistantTurnId });
  if (!target) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["formal_target_binding_failed"],
    });
  }
  if (
    parsedAssociation.association.kind === "associated" &&
    parsedAssociation.association.planId !== target.move.planId
  ) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["formal_target_plan_mismatch"],
    });
  }
  if (
    parsedAssociation.association.kind === "non_impact" &&
    parsedAssociation.association.sourceUserTurnId !== currentUserTurnId
  ) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["non_impact_source_user_turn_mismatch"],
    });
  }

  const parsedCandidates = parseCandidateArray(candidateInput);
  const parsedProvenance = parseEvidenceArray(provenanceEvidence);
  if (!parsedCandidates.valid || !parsedProvenance.valid) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: [
        ...(parsedCandidates.valid ? [] : parsedCandidates.reasons),
        ...(parsedProvenance.valid ? [] : parsedProvenance.reasons),
      ],
    });
  }

  const relation = parsedAssociation.association.relation;
  const bindingReasons: string[] = [];
  const provenanceKeys = new Set(parsedProvenance.evidence.map(evidenceKey));
  for (const [index, provenance] of parsedProvenance.evidence.entries()) {
    if (provenance.sourceUserTurnId !== currentUserTurnId) {
      bindingReasons.push(`provenance_${index}:source_user_turn_mismatch`);
    }
    if (provenance.targetAssistantTurnId !== targetAssistantTurnId) {
      bindingReasons.push(`provenance_${index}:target_turn_mismatch`);
    }
  }
  for (const [candidateIndex, candidate] of parsedCandidates.candidates.entries()) {
    if (candidate.sourceUserTurnId !== currentUserTurnId) {
      bindingReasons.push(`candidate_${candidateIndex}:source_user_turn_mismatch`);
    }
    if (candidate.targetAssistantTurnId !== targetAssistantTurnId) {
      bindingReasons.push(`candidate_${candidateIndex}:target_turn_mismatch`);
    }
    if (candidate.relationToPreviousMove !== relation) {
      bindingReasons.push(`candidate_${candidateIndex}:association_relation_mismatch`);
    }
    for (const [evidenceIndex, evidence] of candidate.evidence.entries()) {
      if (!provenanceKeys.has(evidenceKey(evidence))) {
        bindingReasons.push(
          `candidate_${candidateIndex}:evidence_${evidenceIndex}:unverified_provenance`
        );
      }
    }
  }
  if (bindingReasons.length > 0) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: bindingReasons,
    });
  }

  const allEvidence = parsedCandidates.candidates.flatMap((candidate) => candidate.evidence);
  const hasReactionSupport = allEvidence.some((evidence) =>
    evidence.role === "supports_reaction" || evidence.role === "supports_impact"
  );
  const hasImpactSupport = allEvidence.some((evidence) => evidence.role === "supports_impact");
  const hasCounterevidence = allEvidence.some((evidence) => evidence.role === "counterevidence");

  if (parsedAssociation.association.kind === "non_impact") {
    const nonImpactRelation = parsedAssociation.association.relation;
    return {
      schemaVersion: BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION,
      mode: "shadow",
      source: "fixture",
      status: "observed_non_impact",
      sourceUserTurnId: currentUserTurnId,
      targetAssistantTurnId,
      targetPlanId: target.move.planId,
      relation: nonImpactRelation,
      reactionCandidates: parsedCandidates.candidates,
      reactionEvidenceKnown: nonImpactRelation === "topic_shift" && hasReactionSupport,
      impactKnown: false,
      reasons: [`non_impact_relation:${nonImpactRelation}`],
    };
  }

  if (!hasReactionSupport) {
    return failClosed({
      sourceUserTurnId: currentUserTurnId,
      status: "invalid",
      reasons: ["reaction_support_required_for_assessed_status"],
    });
  }

  return {
    schemaVersion: BATCH2C_REACTION_ASSESSMENT_SCHEMA_VERSION,
    mode: "shadow",
    source: "fixture",
    status: "assessed",
    sourceUserTurnId: currentUserTurnId,
    targetAssistantTurnId,
    targetPlanId: target.move.planId,
    relation: parsedAssociation.association.relation,
    reactionCandidates: parsedCandidates.candidates,
    reactionEvidenceKnown: true,
    impactKnown: hasImpactSupport && !hasCounterevidence,
    reasons: [],
  };
};

export const createFailedReactionAssessmentFixture = ({
  sourceUserTurnId,
  reason,
}: {
  sourceUserTurnId: string;
  reason: string;
}): Batch2CReactionAssessmentV1 => failClosed({
  sourceUserTurnId,
  status: "failed",
  reasons: [isNonEmptyString(reason) ? reason : "unspecified_fixture_failure"],
});
