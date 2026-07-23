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
