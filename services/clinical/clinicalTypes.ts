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

export type ClinicalSemanticEvidence = {
  status: "sufficient" | "insufficient";
  source: "current_user_message" | "established_conversation_frame" | "none";
  reason: string;
};

export type ClinicalSignals = {
  messageLength: ClinicalMessageLength;
  expressionDifficulty: boolean;
  explicitAdviceRequest: boolean;
  emotionalIntensity: ClinicalEmotionalIntensity;
  hasPreviousAssistantReply: boolean;
  conversationStage: ClinicalConversationStage;
  semanticEvidence: ClinicalSemanticEvidence;
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
};
