import type { ConversationInteractionSignals } from "../state";
import type { ConversationMessage } from "../types";

export type DialogueAct =
  | "share" | "answer" | "ask_information" | "ask_identity" | "ask_capability"
  | "ask_definition" | "challenge_contradiction" | "correct_assistant" | "yield_initiative"
  | "request_pause" | "end_conversation" | "seek_emotional_support" | "request_action_support" | "acknowledge";

export type GroundingReference =
  | "identity" | "body" | "voice_input" | "voice_output" | "vision" | "hearing"
  | "time" | "memory" | "previous_wording" | "none";

export type DirectQuestionKind =
  | "identity" | "body_capability" | "voice_input" | "voice_output" | "perception_capability"
  | "time_capability" | "memory_capability" | "definition" | "reason_or_contradiction" | "other";

export type DirectQuestion = {
  text: string;
  kind: DirectQuestionKind;
  subject?: string;
  evidence: string[];
};

export type TurnInterpretation = {
  literalMeaning: string;
  primaryDialogueAct: DialogueAct;
  secondarySignals: DialogueAct[];
  directQuestions: DirectQuestion[];
  interaction: ConversationInteractionSignals;
  repairSignal: boolean;
  groundingReference: GroundingReference;
  confidence: number;
  evidenceSources: Array<"current_user_message" | "adjacent_turn" | "deterministic_boundary" | "model_interpretation">;
  notes: string[];
};

export type AssistantGrounding = {
  source: "assistant_grounding_v1";
  identity: { name: "慢聊小记"; kind: "AI聊天助手"; isAi: true; isClinician: false; roleBoundary: string };
  modalities: { textInput: true; textOutput: true; voiceInput: false; voiceOutput: false; vision: false; hearing: false };
  embodiment: { hasBody: false; canSit: false; canHug: false; canTouch: false; boundary: string };
  capabilities: { currentTimeWithoutContext: false; memory: string };
};

export type ConversationControlContext = {
  conversationId: string;
  currentUserMessage: string;
  adjacentTurns: ConversationMessage[];
  semanticEvidence: {
    status: "sufficient" | "insufficient";
    source: "current_user_message" | "established_conversation_frame" | "none";
    reason: string;
  };
  activeAnswerFrame: { type: string | null; question: string | null; compatible: boolean };
  interaction: ConversationInteractionSignals;
  repairSignal: boolean;
  grounding: AssistantGrounding;
  confirmedFacts: string[];
  unconfirmedHypotheses: string[];
  safety: { level: "low" | "crisis"; triggered: boolean; reason?: string };
};

export type AnswerObligation = {
  id: string;
  question: string;
  kind: DirectQuestionKind;
  priority: "must_answer_first";
  requiredFacts: string[];
  evidence: string[];
};

export type DialogueState = {
  openLoops: string[];
  answerObligations: AnswerObligation[];
  currentInitiative: ConversationInteractionSignals["initiativeDirection"];
  repairState: "none" | "assistant_misunderstanding" | "wording_or_grounding_repair";
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
  | "acknowledge_without_psychologizing" | "take_light_topic_initiative"
  | "offer_emotional_support" | "offer_action_support" | "respect_pause";

export type ResponsePlan = {
  planId: string;
  decisionOwner: "conversation_os.response_planner";
  answerObligations: AnswerObligation[];
  responseActions: ResponseAction[];
  groundingFacts: string[];
  clinicalStrategy: ClinicalStrategyAdvice | null;
  questionPolicy: { mode: "none" | "optional_after_answer" | "one_low_pressure_question"; reason: string };
  closurePolicy: { mode: "forbid_closure" | "allow_pause" | "end_conversation"; reason: string };
  tone: string[];
  stance: string[];
  lengthGuidance: string;
  prohibitedClaims: string[];
  safetyConstraints: string[];
  evidence: string[];
};

export type ResponseValidationResult = { passed: boolean; failureReasons: string[]; checkedPlanId: string; planChanged: false };

export type ConversationControlTrace = {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  dialogueState: DialogueState;
  responsePlan: ResponsePlan;
  clinicalInvoked: boolean;
  validation: ResponseValidationResult[];
  stateUpdate: { answeredObligations: string[]; remainingOpenLoops: string[]; notes: string[] };
};
