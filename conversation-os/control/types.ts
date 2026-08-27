import type { AffectEvidenceSpan, ConversationInteractionSignals } from "../state";
import type { CommittedAssistantMove, ConversationMessage } from "../types";
import type {
  CommittedAssistantMoveEnvelopeV1,
  ProactiveGreetingHandoffFunction,
  ProactiveGreetingRequiredFunction,
} from "../interactionMoveEnvelope";

export type DialogueAct =
  | "share" | "answer" | "ask_information" | "ask_identity" | "ask_capability"
  | "ask_definition" | "challenge_contradiction" | "correct_assistant" | "yield_initiative"
  | "request_pause" | "end_conversation" | "seek_emotional_support" | "request_action_support" | "acknowledge";

export type GroundingReference =
  | "assistant_name" | "identity" | "ai_identity" | "clinician_identity" | "body" | "body_metaphor"
  | "physical_presence" | "physical_presence_metaphor"
  | "voice_input" | "voice_output" | "vision" | "hearing"
  | "time" | "memory" | "proactive_messaging" | "previous_wording" | "none";

export type DirectQuestionKind =
  | "assistant_name" | "identity" | "ai_identity" | "clinician_identity"
  | "body_capability" | "voice_input" | "voice_output" | "perception_capability"
  | "time_capability" | "memory_capability" | "proactive_messaging_capability"
  | "definition" | "reason_or_contradiction" | "other";

export type DirectQuestion = {
  text: string;
  kind: DirectQuestionKind;
  subject?: string;
  subjectOwnership?: "current_user_self" | "external_or_other" | "uncertain" | "committed_assistant_claim";
  targetTurnId?: string;
  targetProposition?: string;
  evidence: string[];
};

export type TargetPropositionOperation =
  | "explain"
  | "answer"
  | "affirm"
  | "repair_or_withdraw";

export type ChallengedProposition = {
  id: string;
  text: string;
  sourceTurnId: string;
  groundingReference?: GroundingReference;
  status: "rejected";
};

export type StillOpenUserIntent = {
  kind: "no_topic";
  sourceTurnId: string;
  text: string;
};

export type CorrectionSignal = {
  targetTurnId: string;
  correctionType: "irrelevant_answer" | "wrong_assumption" | "misunderstanding";
  challengedPropositions: ChallengedProposition[];
  stillOpenUserIntent: StillOpenUserIntent | null;
  evidence: string[];
};

export type ResponseRelationKind =
  | "requests_answer"
  | "answers_previous_move"
  | "repairs_previous_move"
  | "challenges_move_fit"
  | "rejects_or_declines_move"
  | "continues_active_thread"
  | "opens_new_thread"
  | "yields_initiative"
  | "shares_initiative"
  | "requests_pause"
  | "requests_action_support"
  | "shares_distress"
  | "acknowledges_previous_move";

export type RelationalInterpretationCandidate = {
  relation: ResponseRelationKind;
  confidence: number;
  targetTurnId?: string;
  targetProposition?: string;
  targetOperation?: TargetPropositionOperation;
  evidence: string[];
};

export type UserMoveRelationKind =
  | "reciprocates_move"
  | "answers_move"
  | "continues_from_move"
  | "opens_or_redirects_thread"
  | "challenges_move_fit"
  | "rejects_or_declines_move"
  | "sets_boundary_or_pause"
  | "unclear";

export type UserRelationEvidenceSpan = {
  source: "current_user_turn";
  sourceUserTurnId: string;
  start: number;
  end: number;
  text: string;
};

export type UserMoveRelationCandidate = {
  kind: UserMoveRelationKind;
  confidence: number;
  evidence: UserRelationEvidenceSpan[];
};

export type UserMoveRelationProjection = {
  sourceUserTurnId: string;
  targetAssistantMoveId: string;
  targetFunction: ProactiveGreetingRequiredFunction;
  candidates: UserMoveRelationCandidate[];
  ambiguous: boolean;
};

export type ProactiveGreetingOpenEnvelope = Extract<
  CommittedAssistantMoveEnvelopeV1,
  {
    origin: { kind: "proactive_greeting" };
    handoff: { edge: "opens" };
  }
>;

export type ActiveInteractionMoveHandoffTarget = {
  sourceAssistantMoveId: string;
  sourceGreetingFunction: ProactiveGreetingRequiredFunction;
  envelope: ProactiveGreetingOpenEnvelope;
};

export type InteractionMoveHandoffPlan = {
  sourceAssistantMoveId: string;
  sourceGreetingFunction: ProactiveGreetingRequiredFunction;
  sourceUserTurnId: string;
  selectedRelation: UserMoveRelationKind;
  requiredFunction: ProactiveGreetingHandoffFunction | "defer_handoff_completion";
  completionIntent: "fulfill" | "defer";
  questionPolicy: "none" | "optional_after_completion";
  evidence: UserRelationEvidenceSpan[];
};

export type ContentMeaning = {
  literalText: string;
  semanticEvidence: ConversationControlContext["semanticEvidence"];
  explicitPropositions: Array<{
    id: string;
    text: string;
    sourceTurnId: string;
    confidence: number;
    evidence: string[];
  }>;
  directQuestions: DirectQuestion[];
  contentAvailabilityEvidence: string[];
  affectEvidence: AffectEvidenceSpan[];
};

export type TurnStateUpdate = {
  commonGround: Array<{
    propositionId: string;
    proposition: string;
    operation: "confirm" | "hypothesize" | "reject";
    subject: "user" | "assistant" | "system" | "conversation";
    speaker: "user" | "assistant" | "system";
    epistemicStatus:
      | "asserted_by_user"
      | "assistant_hypothesis"
      | "system_truth"
      | "selected_memory"
      | "rejected_by_user";
    sourceTurnId: string;
    confidence: number;
    evidence: string[];
  }>;
  obligationChanges: Array<{
    operation: "open";
    sourceTurnId: string;
    targetProposition: string;
    evidence: string[];
  }>;
  initiativeProposal: "user" | "assistant" | "shared" | "paused";
  activeThreadProposal: {
    sourceTurnId: string;
    relation: "continue" | "open" | "pause" | "close";
    evidence: string[];
  } | null;
  repairProposal: {
    targetTurnId: string;
    rejectedPropositionIds: string[];
    evidence: string[];
  } | null;
};

export type RelationalTurnInterpretation = {
  id: string;
  contentMeaning: ContentMeaning;
  responseRelation: RelationalInterpretationCandidate;
  stateUpdate: TurnStateUpdate;
  confidence: number;
  evidence: string[];
};

export type OrdinaryPostureSourceSpan = {
  source: "current_user_turn" | "adjacent_committed_user_turn";
  sourceTurnId: string;
  start: number;
  end: number;
  text: string;
};

export type OrdinaryPostureProposal = {
  mode: "accompany" | "explore";
  sourceSpans: OrdinaryPostureSourceSpan[];
  proposedContribution: { targetSpanIndexes: number[]; instruction: string };
  evidence: string[];
};

export type OrdinaryPosturePlan = {
  mode: "accompany" | "explore";
  sourceSpans: OrdinaryPostureSourceSpan[];
  requiredContribution: { targetSpanIndexes: number[]; instruction: string };
  evidence: string[];
};

export type PurposeSubjectOwnershipAuthorityTrace = {
  attempted: boolean;
  used: boolean;
  reason: string;
  ownership?: "current_user_self" | "external_or_other" | "uncertain";
  model?: string;
  latencyMs?: number;
  contractSha256?: string;
  error?: string;
};

export type TurnInterpretation = {
  contentMeaning: ContentMeaning;
  responseRelation: {
    candidates: RelationalInterpretationCandidate[];
    ambiguous: boolean;
  };
  userMoveRelation: UserMoveRelationProjection | null;
  stateUpdate: TurnStateUpdate;
  interpretations: RelationalTurnInterpretation[];
  ordinaryPostureProposal: OrdinaryPostureProposal | null;
  purposeSubjectOwnershipAuthority?: PurposeSubjectOwnershipAuthorityTrace;
  /**
   * Compatibility evidence only. Dialogue State and Response Planner must not
   * use this field to select a response strategy.
   */
  literalMeaning: string;
  primaryDialogueAct: DialogueAct;
  secondarySignals: DialogueAct[];
  directQuestions: DirectQuestion[];
  interaction: ConversationInteractionSignals;
  repairSignal: boolean;
  correction: CorrectionSignal | null;
  groundingReference: GroundingReference;
  confidence: number;
  evidenceSources: Array<"current_user_message" | "adjacent_turn" | "deterministic_boundary" | "model_interpretation">;
  notes: string[];
};

export type AssistantGrounding = {
  source: "assistant_grounding_v3";
  availableFacts: {
    product: { name: "慢聊小记" };
    assistant: { displayName: "小慢"; kind: "AI聊天助手"; isAi: true; isClinician: false; roleBoundary: string };
    modalities: { textInput: true; textOutput: true; voiceInput: false; voiceOutput: false; vision: false; hearing: false };
    embodiment: { hasBody: false; canSit: false; canSleep: false; canHug: false; canTouch: false; boundary: string };
    capabilities: {
      currentTimeWithoutContext: false;
      memory: string;
      proactiveMessaging: { openOrReturnGreeting: true; backgroundPush: false; boundary: string };
    };
  };
  prohibitedClaims: string[];
};

export type EpisodeMemoryCandidate = {
  semanticMemoryId: string;
  sessionId: string;
  summary: string;
  people: string[];
  topics: string[];
  emotions: string[];
  openThreads: string[];
  confirmedFacts: string[];
  hypotheses: string[];
  sourceMessageIds: string[];
  occurredAt: string;
  relevanceScore: number;
  matchedDimensions: Array<"people" | "topics" | "emotions" | "text">;
};

export type ConversationControlContext = {
  conversationId: string;
  currentTurnId: string;
  currentUserMessage: string;
  adjacentTurns: ConversationMessage[];
  interactionMoveHandoffEnvelopePresent: boolean;
  interactionMoveHandoffTarget: ActiveInteractionMoveHandoffTarget | null;
  semanticEvidence: {
    status: "sufficient" | "insufficient";
    source: "current_user_message" | "established_conversation_frame" | "none";
    reason: string;
  };
  activeAnswerFrame: { type: string | null; question: string | null; compatible: boolean };
  interaction: ConversationInteractionSignals;
  evidenceSignals: {
    explicitAdviceRequest: boolean;
  };
  repairSignal: boolean;
  correction: CorrectionSignal | null;
  grounding: AssistantGrounding;
  episodeMemoryCandidates: EpisodeMemoryCandidate[];
  confirmedFacts: string[];
  unconfirmedHypotheses: string[];
  safety: { level: "low" | "crisis"; triggered: boolean; reason?: string };
};

export type AnswerObligation = {
  id: string;
  sourceConversationId: string;
  sourceTurnId: string;
  triggeringUserAct: DialogueAct;
  targetProposition: string;
  status: "open" | "answered" | "withdrawn" | "expired";
  closeReason?: "response_committed" | "user_withdrew" | "thread_closed" | "superseded";
  question: string;
  kind: DirectQuestionKind;
  priority: "must_answer_first";
  requiredDisclosure: string[];
  evidence: string[];
};

export type CommonGroundProposition = {
  id: string;
  text: string;
  status: "confirmed" | "hypothesized" | "rejected";
  subject: "user" | "assistant" | "system" | "conversation";
  speaker: "user" | "assistant" | "system";
  epistemicStatus:
    | "asserted_by_user"
    | "assistant_hypothesis"
    | "system_truth"
    | "selected_memory"
    | "rejected_by_user";
  sourceTurnId: string;
  confidence: number;
  evidence: string[];
};

export type InteractionState = {
  currentActivity: {
    primary:
      | "answering_obligation"
      | "repairing_common_ground"
      | "developing_thread"
      | "opening_thread"
      | "supporting_emotion"
      | "supporting_action"
      | "pausing"
      | "idle"
      | "ordinary_exchange";
    concurrent: Array<
      | "answering_obligation"
      | "repairing_common_ground"
      | "developing_thread"
      | "opening_thread"
      | "supporting_emotion"
      | "supporting_action"
      | "pausing"
      | "idle"
      | "ordinary_exchange"
    >;
    evidence: string[];
  };
  activeThread: {
    id: string;
    sourceTurnIds: string[];
    status: "active" | "paused" | "closed";
    evidence: string[];
  } | null;
  commonGround: {
    confirmed: CommonGroundProposition[];
    hypothesized: CommonGroundProposition[];
    rejected: CommonGroundProposition[];
  };
  openObligations: AnswerObligation[];
  initiativeOwner: "user" | "assistant" | "shared" | "paused";
  lastCommittedAssistantMove: CommittedAssistantMove | null;
  repairState: {
    status: "none" | "active" | "resolved";
    targetTurnId?: string;
    rejectedPropositionIds: string[];
    evidence: string[];
  };
};

export type DialogueState = InteractionState & {
  /** Compatibility trace fields. They are projections, not Planner inputs. */
  openLoops: string[];
  answerObligations: AnswerObligation[];
  currentInitiative: ConversationInteractionSignals["initiativeDirection"];
  correction: CorrectionSignal | null;
  conversationContinuity: {
    relation: "responds_to_invitation" | "follows_previous_wording" | "continues_topic" | "new_topic";
    evidence: string[];
  };
  confirmedFacts: string[];
  unconfirmedHypotheses: string[];
  activeInteractionNeeds: Array<"direct_answer" | "explanation" | "ordinary_interaction" | "emotional_support" | "action_support" | "pause" | "repair">;
};

export type ClinicalStrategyAdvice = {
  strategy: string;
  intent: string;
  questionFunction: string;
  toneConstraints: string[];
  interventionBoundaries: string[];
  evidence: string[];
};

export type ResponseAction =
  | "answer_directly" | "explain_plainly" | "repair_previous_wording"
  | "establish_assistant_identity"
  | "acknowledge_without_psychologizing" | "respond_to_proactive_greeting"
  | "take_light_topic_initiative"
  | "invite_low_pressure_calibration" | "continue_established_frame"
  | "continue_established_thread" | "offer_neutral_conversation_entry"
  | "offer_emotional_support" | "offer_action_support" | "respect_pause";

export type OrdinaryHandoffBoundary = {
  source: "hill_helping";
  applicability: "uncertain";
  userBoundaries: Array<"pause" | "stop" | "no_advice" | "no_analysis" | "no_questions" | "correction" | "other_explicit_boundary">;
  evidence: string[];
};

export type EmotionalSupportFunction =
  | "reduce_expression_burden"
  | "return_focus_control"
  | "return_amount_control"
  | "acknowledge_current_relational_impact";

export type RepairCompletionMode =
  | "factual_replacement"
  | "proposition_withdrawal"
  | "interaction_move_withdrawal";

export type InteractionMoveSubtype =
  | "unsolicited_advice"
  | "pressure_question"
  | "generic_listening"
  | "moralizing"
  | "topic_switch";

export type TurnAffectEvidenceSpan = AffectEvidenceSpan & {
  sourceTurnId: string;
};

export type PositiveFunctionContract =
  | {
      action: "establish_assistant_identity";
      mode: "first_contact" | "identity_continuation" | "identity_repair";
      displayName: "小慢";
      sourceTurnId: string;
      targetProposition: string | null;
      evidence: string[];
    }
  | {
      action: "offer_emotional_support";
      supportFunction: EmotionalSupportFunction;
      sourceTurnId: string;
      sourceText: string;
      affectEvidenceSpans: TurnAffectEvidenceSpan[];
      /** Compatibility projection derived from affectEvidenceSpans. */
      explicitAffectOrImpactTerms: string[];
      intensityCeiling: "current_user_expression";
      evidence: string[];
    }
  | {
      action: "repair_previous_wording";
      repairMode: RepairCompletionMode;
      interactionMoveSubtype: InteractionMoveSubtype | null;
      sourceTurnId: string;
      sourceText: string;
      targetTurnId: string;
      targetText: string;
      replacementFact: string | null;
      evidence: string[];
    };

export type ResponsePlan = {
  planId: string;
  decisionOwner: "conversation_os.response_planner";
  behaviorSource: "ordinary_conversation" | "legacy_compat";
  planningDepth: "minimal" | "standard" | "deep";
  answerObligations: AnswerObligation[];
  disclosureScope: { conversationId: string; turnId: string };
  correction: CorrectionSignal | null;
  responseActions: ResponseAction[];
  groundingFacts: string[];
  requiredDisclosure: string[];
  clinicalStrategy: ClinicalStrategyAdvice | null;
  positiveFunctionContract: PositiveFunctionContract | null;
  interactionMoveHandoffPlan: InteractionMoveHandoffPlan | null;
  ordinaryPosture: OrdinaryPosturePlan | null;
  questionPolicy: { mode: "none" | "optional_after_answer" | "one_low_pressure_question"; reason: string };
  closurePolicy: { mode: "forbid_closure" | "allow_pause" | "allow_idle" | "end_conversation"; reason: string };
  tone: string[];
  stance: string[];
  lengthGuidance: string;
  prohibitedClaims: string[];
  safetyConstraints: string[];
  selectedEpisodeMemory?: EpisodeMemoryCandidate | null;
  relevanceProvenance: Array<{
    planElement: string;
    source: "current_turn" | "adjacent_turn" | "interaction_state" | "system_truth" | "safety";
    sourceTurnId?: string;
    evidence: string[];
  }>;
  evidence: string[];
};

export type ResponseValidationResult = {
  /** Hard-gate eligibility. Advisory-only findings do not make this false. */
  passed: boolean;
  /** Backward-compatible union of hard and advisory findings. */
  failureReasons: string[];
  hardFailureReasons?: string[];
  advisoryFailureReasons?: string[];
  /** The candidate is commit-eligible but receives the one internal quality rewrite. */
  rewriteRequired?: boolean;
  checkedPlanId: string;
  planChanged: false;
};

export type ConversationControlTrace = {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  interpretationModel: {
    attempted: boolean;
    used: boolean;
    reason: string;
    model?: string;
    latencyMs?: number;
    tokenInput?: number;
    tokenOutput?: number;
    promptMessages?: Array<{ role: "developer" | "user" | "assistant"; content: string }>;
    rawOutput?: string;
    error?: string;
  };
  dialogueState: DialogueState;
  responsePlan: ResponsePlan;
  clinicalInvoked: boolean;
  validation: ResponseValidationResult[];
  stateUpdate: {
    answeredObligations: string[];
    remainingOpenLoops: string[];
    obligationTransitions: Array<{
      id: string;
      from: "open";
      to: "answered" | "withdrawn" | "expired";
      closeReason: NonNullable<AnswerObligation["closeReason"]>;
      sourceConversationId: string;
      sourceTurnId: string;
    }>;
    notes: string[];
  };
};
