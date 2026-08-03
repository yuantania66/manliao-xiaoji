export type ConversationState =
  | "opening"
  | "exploring"
  | "deepening"
  | "action"
  | "closing";

export type ConversationStateInput = {
  currentUserMessage: string;
  recentMessages: ConversationStateMessage[];
};

export type ConversationStateMessage = {
  role: string;
  content: string;
};

export type AffectEvidenceCategory =
  | "unhappiness"
  | "blocked_affect"
  | "sadness"
  | "grievance"
  | "anger"
  | "worry"
  | "relational_impact"
  | "embarrassment"
  | "loneliness"
  | "irritation"
  | "fatigue"
  | "distress"
  | "fear"
  | "anxiety"
  | "panic"
  | "despair"
  | "overwhelm"
  | "pressure"
  | "guilt";

export type AffectEvidenceIntensity = "low" | "moderate" | "high" | "unspecified";

export type AffectEvidenceObject =
  | "self_experience"
  | "assistant_relationship"
  | "interpersonal_experience";

/**
 * The only turn-local evidence representation for user-stated affect or
 * relational impact. `start` and `end` are UTF-16 offsets into the unmodified
 * current user message, so `sourceText.slice(start, end) === text`.
 */
export type AffectEvidenceSpan = {
  source: "current_user_message";
  text: string;
  start: number;
  end: number;
  category: AffectEvidenceCategory;
  intensity: AffectEvidenceIntensity;
  object: AffectEvidenceObject;
};

/**
 * Conversation-owned evidence about how the user is participating in this turn.
 * These fields deliberately separate topic availability from willingness to
 * interact, affect, initiative, and a request to pause.
 */
export type ConversationInteractionSignals = {
  contentAvailability: "has_topic" | "no_topic" | "fragmentary" | "unknown";
  engagement: "engaged" | "open" | "disengaging" | "stop_requested";
  initiativeDirection: "user_leads" | "assistant_invited" | "shared" | "pause";
  affect: "negative" | "neutral_or_light" | "unknown";
  affectEvidence: AffectEvidenceSpan[];
  stopIntent: boolean;
  evidence: string[];
};

export type ConversationStateResult = {
  state: ConversationState;
  reason: string;
  signals: {
    turnCount: number;
    hasPreviousAssistantReply: boolean;
    explicitAdviceRequest: boolean;
    explicitClosingSignal: boolean;
    sustainedUserDisclosure: boolean;
  };
  interaction: ConversationInteractionSignals;
};
