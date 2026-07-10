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
};
