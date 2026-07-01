import { AiConversationMessage } from "./types";
import { buildSlowChatOSGuidance } from "./slowChatOS";

export const buildInteractionPlanGuidance = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => buildSlowChatOSGuidance({ userMessage, recentMessages });
