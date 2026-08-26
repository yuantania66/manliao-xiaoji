import type {
  AnswerObligation,
  DialogueState,
  InteractionState,
  TurnInterpretation,
} from "@/conversation-os/control";

export type HelpingApplicability = "applicable" | "uncertain" | "not_applicable";

export type HillGoalFamily = "exploration" | "insight" | "action";

export type ExplorationIntention =
  | "offer_support"
  | "facilitate_narrative_exploration"
  | "facilitate_thought_exploration"
  | "facilitate_feeling_exploration"
  | "clarify_shared_understanding"
  | "allow_pause_without_abandonment";

export type InsightIntention =
  | "assess_insight_readiness"
  | "foster_awareness"
  | "facilitate_collaborative_insight"
  | "explore_supported_discrepancy"
  | "process_current_helping_relationship";

export type ActionIntention =
  | "clarify_action_goal"
  | "explore_options"
  | "provide_relevant_information"
  | "support_decision_making"
  | "rehearse_behavior_or_wording"
  | "plan_small_adjustable_step"
  | "review_action_result"
  | "support_low_risk_regulation_practice";

export type HillIntention =
  | ExplorationIntention
  | InsightIntention
  | ActionIntention
  | "repair_current_helping_relationship";

export type ExplorationSkill =
  | "attending_and_support"
  | "minimal_encourager"
  | "supportive_pause"
  | "restatement"
  | "summary"
  | "thought_question_or_probe"
  | "feeling_question_or_probe"
  | "feeling_reflection";

export type InsightSkill =
  | "awareness_challenge"
  | "insight_question_or_probe"
  | "tentative_interpretation"
  | "current_relationship_processing";

export type ActionSkill =
  | "action_question_or_probe"
  | "information_giving"
  | "option_generation"
  | "direct_guidance"
  | "strategy_disclosure"
  | "behavioral_rehearsal"
  | "decision_support"
  | "small_step_planning"
  | "action_review"
  | "low_risk_relaxation_or_mindfulness";

export type HillSkill =
  | ExplorationSkill
  | InsightSkill
  | ActionSkill
  | "relationship_repair";

export type HelpingReaction =
  | "continued_exploration"
  | "expressed_new_awareness"
  | "moved_toward_action"
  | "reported_action_result"
  | "accepted_or_used_move"
  | "corrected_or_rejected_move"
  | "relationship_strain"
  | "paused_or_withdrew"
  | "requested_different_help"
  | "topic_shift"
  | "unclear";

export type HelpingReactionCandidate = {
  reaction: HelpingReaction;
  confidence: number;
  evidence: string[];
  targetAssistantTurnId: string;
  relationToPreviousMove:
    | "direct_response"
    | "continues_move"
    | "rejects_move"
    | "topic_shift"
    | "unclear";
};

export type HelperSelfCheck = {
  unsupportedAssumptions: string[];
  possibleCulturalAssumptions: string[];
  repeatedFailedMoves: string[];
  capabilityLimits: string[];
  userRejectedClaims: string[];
  pressureRisk: "low" | "medium" | "high";
};

export type HillHelpingPlan = {
  applicability: HelpingApplicability;
  primaryGoal?: HillGoalFamily;
  supportingGoal?: HillGoalFamily;
  readiness?: {
    status: "supported" | "uncertain" | "not_supported";
    evidence: string[];
    counterEvidence: string[];
  };
  intention?: HillIntention;
  primarySkill?: HillSkill;
  supportingSkill?: HillSkill;
  relationshipPriority: "none" | "repair" | "process_current_relationship";
  previousMoveAssessment?: {
    assistantTurnId: string;
    reactionCandidates: HelpingReactionCandidate[];
    impactKnown: boolean;
  };
  expectedUserResponse?: string[];
  stopOrReassessWhen?: string[];
  prohibitedMoves: string[];
  helperSelfCheck: HelperSelfCheck;
  evidence: string[];
  hypotheses: string[];
};

export type HillHelpingDecision =
  | { status: "decided"; plan: HillHelpingPlan }
  | {
      status: "failed";
      failureCode: "invalid_input" | "invalid_plan" | "provider_failure" | "timeout";
      retryable: boolean;
      evidence: string[];
    };

export type HillUserBoundary = {
  kind:
    | "pause"
    | "stop"
    | "no_advice"
    | "no_analysis"
    | "no_questions"
    | "correction"
    | "other_explicit_boundary";
  sourceTurnId: string;
  text: string;
  evidence: string[];
};

export type CurrentRelationshipEvidence = {
  kind: "strain" | "misunderstanding" | "pressure" | "repair_attempt" | "repair_response";
  sourceTurnId: string;
  text: string;
  evidence: string[];
};

export type CommittedHelpingMove = {
  assistantTurnId: string;
  planId: string;
  primaryGoal?: HillGoalFamily;
  supportingGoal?: HillGoalFamily;
  relationshipPriority: "none" | "repair" | "process_current_relationship";
  intention: HillIntention;
  primarySkill: HillSkill;
  supportingSkill?: HillSkill;
  assumptions: string[];
  evidence: string[];
  expectedUserResponse: string[];
  stopOrReassessWhen: string[];
};

export type HillHelpingInput = {
  userTurnId: string;
  currentUserMaterial: {
    sourceTurnId: string;
    literalText: string;
    semanticEvidence: TurnInterpretation["contentMeaning"]["semanticEvidence"];
    explicitPropositions: TurnInterpretation["contentMeaning"]["explicitPropositions"];
    directQuestions: TurnInterpretation["contentMeaning"]["directQuestions"];
  };
  turnInterpretation: TurnInterpretation;
  dialogueState: DialogueState;
  interactionState: InteractionState;
  directObligations: AnswerObligation[];
  userBoundaries: HillUserBoundary[];
  currentRelationshipEvidence: CurrentRelationshipEvidence[];
  establishedConversationContext: Array<{
    kind: "prior_semantic_topic" | "active_answer_frame";
    sourceTurnId: string;
    evidence: string[];
  }>;
  recentCommittedHelpingMoves: CommittedHelpingMove[];
};

export type HillHelpingProviderTrace = {
  attempted: boolean;
  used: boolean;
  reason: string;
  model?: string;
  latencyMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  rawOutput?: string;
  error?: string;
};

export type HillHelpingShadowTrace = {
  mode: "shadow";
  enabled: boolean;
  skippedReason?: "feature_disabled" | "safety_pre_gate" | "ordinary_handoff_no_fast_boundary";
  decision: HillHelpingDecision | null;
  provider: HillHelpingProviderTrace;
  inputEvidence: string[];
};
