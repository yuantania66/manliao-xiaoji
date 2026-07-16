import type { ClinicalMemoryContext } from "@/services/ai/clinicalMemoryAdapter";
import type { AiConversationMessage, AiRiskLevel } from "@/services/ai/types";
import type { ConversationState } from "@/conversation-os/state";

export type ClinicalCurrentUnderstanding = {
  event: string[];
  emotion: string[];
  meaning: string[];
  need: string[];
  relationship: string[];
  goal: string[];
  conflict: string[];
  unknown: string[];
};

export type ClinicalAmbiguityLevel = "low" | "medium" | "high";

export type ClinicalConversationSignals = {
  userCorrectedAi: boolean;
  userWantsPause: boolean;
  userRequestsHelp: boolean;
  userRequestsSummary: boolean;
  userExpressesUncertainty: boolean;
  userExpressesEmotion: boolean;
  ambiguityLevel: ClinicalAmbiguityLevel;
};

export type ClinicalMessageLength = "SHORT" | "MEDIUM" | "LONG";

export type ClinicalEmotionalIntensity = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type ClinicalConversationStage = "OPENING" | "EXPLORING" | "CONTINUING";

export type ClinicalSignals = {
  messageLength: ClinicalMessageLength;
  expressionDifficulty: boolean;
  explicitAdviceRequest: boolean;
  emotionalIntensity: ClinicalEmotionalIntensity;
  hasPreviousAssistantReply: boolean;
  conversationStage: ClinicalConversationStage;
  memoryAvailability: {
    hasUnderstanding: boolean;
    hasRelationship: boolean;
    hasTimeline: boolean;
    hasSemanticMemory: boolean;
  };
};

export type ResponseGoal =
  | "help_continue_expression"
  | "clarify"
  | "reflect"
  | "summarize"
  | "support_action"
  | "hold_space";

export type PersonCenteredInteractionStage =
  | "expression"
  | "exploration"
  | "understanding"
  | "intervention_requested"
  | "action"
  | "repair_or_pause"
  | "unclear";

export type InterventionFamily =
  | "bounded_decision_support"
  | "direct_judgment"
  | "low_risk_action_support"
  | "high_impact_action_support"
  | "general_advice"
  | "diagnostic_assessment"
  | "cbt"
  | "act"
  | "mi"
  | "case_formulation"
  | "dream_interpretation";

export type UnderstandingEvidence = {
  status: "unverified" | "provisional" | "aligned" | "contradicted";
  scope: "none" | "boundary" | "current_experience" | "request_scope" | "relevant_facts";
  basis: Array<
    | "current_explicit_content"
    | "adjacent_user_confirmation"
    | "clear_current_request"
    | "visible_history"
    | "user_correction"
  >;
};

export type PersonCenteredGateEvidence = {
  interactionStage: PersonCenteredInteractionStage;
  understandingEvidence: UnderstandingEvidence;
  unresolvedCorrectionOrBoundary: {
    present: boolean;
    kind: "correction" | "refusal" | "pause" | "hesitation" | null;
  };
  interventionConsent: {
    status: "none" | "ambiguous" | "explicit_scoped" | "revoked";
    scope: InterventionFamily[];
    requestRisk: "simple_low_risk" | "interpretive_or_high_impact" | "unknown";
    basis: Array<
      | "current_explicit_request"
      | "adjacent_acceptance_of_offered_scope"
      | "visible_history"
      | "current_revocation"
    >;
  };
};

export type InterventionReadiness = "blocked" | "limited" | "ready";

export type InterventionIntensity = "none" | "low" | "moderate" | "high";

export type EligibilityReasonCode =
  | "correction_requires_repair"
  | "boundary_or_pause_revoked"
  | "no_scoped_consent"
  | "ambiguous_consent"
  | "understanding_unverified"
  | "facts_insufficient_for_judgment"
  | "explicit_low_risk_scoped_request"
  | "aligned_and_scoped_consent"
  | "topic_or_cue_is_not_consent";

export type PersonCenteredGateDecision = {
  version: "person-centered-gate-v1";
  effectiveStage: PersonCenteredInteractionStage;
  interventionReadiness: InterventionReadiness;
  maxInterventionIntensity: InterventionIntensity;
  allowedInterventionFamilies: InterventionFamily[];
  blockedInterventionFamilies: InterventionFamily[];
  responseGoalPolicy: {
    allowed: ResponseGoal[];
    preferred: ResponseGoal | null;
    fallback: ResponseGoal;
  };
  eligibilityReason: EligibilityReasonCode[];
};

export type ProfessionalGuidanceGateTrace = {
  retrievedIds: string[];
  injectedIds: string[];
  withheldIds: string[];
  unknownMetadataIds: string[];
};

export type ClinicalContext = {
  conversation: {
    currentUserMessage: string;
    previousAssistantMessage?: string | null;
    turnCount: number;
    state: ConversationState;
  };
  memory: {
    understandings: ClinicalMemoryContext["understandings"];
    relationships: ClinicalMemoryContext["relationships"];
    timelineEvents: ClinicalMemoryContext["timelineEvents"];
    semanticMemories: ClinicalMemoryContext["semanticMemories"];
  };
  session: {
    currentResponseGoal?: ResponseGoal | null;
    previousResponseGoal?: ResponseGoal | null;
  };
  safety: {
    safetyTriggered: boolean;
    safetyLevel: AiRiskLevel | "none";
  };
  meta: {
    locale: string;
    timezone: string;
    channel: string;
  };
  signals: ClinicalSignals;
  personCenteredEvidence?: PersonCenteredGateEvidence;
  /**
   * @deprecated LEGACY / frozen compatibility field. New Clinical Logic code
   * must read structured fields from `conversation` instead.
   */
  conversationId: string;
  /**
   * @deprecated LEGACY / frozen compatibility field. New Clinical Logic code
   * must not depend on user identity here.
   */
  userId: string;
  /**
   * @deprecated LEGACY / frozen compatibility field. Use
   * `conversation.currentUserMessage`.
   */
  userTurn: string;
  /**
   * @deprecated LEGACY / frozen compatibility field. Use
   * `conversation.previousAssistantMessage` and `conversation.turnCount`.
   */
  recentTurns: AiConversationMessage[];
  /**
   * @deprecated LEGACY / frozen compatibility field. Current Clinical Logic v1
   * does not consume this object.
   */
  currentUnderstanding: ClinicalCurrentUnderstanding;
  /**
   * @deprecated LEGACY / frozen compatibility field. Use structured
   * `memory.understandings`, `memory.relationships`, `memory.timelineEvents`,
   * and `memory.semanticMemories`.
   */
  memoryContext: ClinicalMemoryContext;
  /**
   * @deprecated LEGACY / frozen compatibility field. New Clinical Logic code
   * should derive needed signals locally from structured conversation fields,
   * or add explicit structured fields in a future reviewed sprint.
   */
  conversationSignals: ClinicalConversationSignals;
  /**
   * @deprecated LEGACY / frozen compatibility field. Use `safety`.
   */
  safetyNotes: string[];
};

export type ClinicalStrategy =
  | "noop"
  | "rogers"
  | "rogers_reflection"
  | "rogers_validation"
  | "rogers_repair"
  | "cbt_fact_interpretation_separation"
  | "act_acceptance_space"
  | "mi_open_question"
  | "mi_affirmation"
  | "mi_summary";

export type ClinicalResponseIntent =
  | "invite_expression"
  | "empathic_reflection"
  | "receive"
  | "repair"
  | "explore"
  | "clarify"
  | "summarize"
  | "affirm"
  | "support_pause"
  | "support_action";

export type ClinicalQuestionFunction =
  | "open_gentle_invitation"
  | "clarify_or_reflect"
  | "none"
  | "clarify_meaning"
  | "explore_experience"
  | "repair_understanding"
  | "support_user_agency"
  | "separate_fact_from_interpretation";

export type ClinicalPlan = {
  responseGoal: ResponseGoal;
  responseIntent: ClinicalResponseIntent;
  primaryStrategy: ClinicalStrategy;
  secondaryStrategies: ClinicalStrategy[];
  questionFunction: ClinicalQuestionFunction;
  toneConstraint: string[];
  interventionBoundary: string[];
  safetyNotes: string[];
  rationale: string[];
  personCenteredGate?: Readonly<{
    version: PersonCenteredGateDecision["version"];
    readiness: InterventionReadiness;
    maxIntensity: InterventionIntensity;
    allowedFamilies: ReadonlyArray<InterventionFamily>;
    allowedResponseGoals: ReadonlyArray<ResponseGoal>;
  }>;
};

export type ClinicalStrategyDefinition = {
  name: ClinicalStrategy;
  goal: string;
  whenToUse: string[];
  whenNotToUse: string[];
  userNeed: string;
  expectedExperience: string;
  example?: string;
  reference: "Rogers" | "CBT" | "ACT" | "MI" | "Engineering Placeholder";
};

export type ClinicalTrace = {
  skippedBySafety: boolean;
  conversationState: ClinicalContext["conversation"]["state"];
  safetyDecision?: {
    level: AiRiskLevel | "none";
    routedToSafety: boolean;
    notes: string[];
  };
  inputSignals: ClinicalContext["conversationSignals"];
  signals: ClinicalContext["signals"];
  memoryUsed: {
    understandings: string[];
    relationships: string[];
    timelineEvents: string[];
  };
  memoryExcluded: {
    rawMemory: "not_allowed";
    deterministicMemoryCaveat: string[];
  };
  selectedPlan?: ClinicalPlan;
  personCenteredGate?: {
    evidence: PersonCenteredGateEvidence;
    decision: PersonCenteredGateDecision;
    professionalGuidance?: ProfessionalGuidanceGateTrace;
  };
};
