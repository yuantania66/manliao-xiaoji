import type { AiConversationMessage } from "@/services/ai/types";
import { evaluateSemanticEvidence, inspectActiveAnswerFrame } from "@/services/clinical/semanticEvidence";
import type { ConversationStateResult } from "../state";

import { ASSISTANT_GROUNDING } from "./assistantGrounding";
import { isAssistantRepairSignal } from "./repairSignal";
import type { ConversationControlContext } from "./types";

export const assembleConversationControlContext = ({
  conversationId,
  userMessage,
  recentMessages,
  conversationState,
}: {
  conversationId: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  conversationState: ConversationStateResult;
}): ConversationControlContext => {
  const adjacentTurns = recentMessages
    .filter((message): message is AiConversationMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content, createdAt: message.createdAt }));
  const semanticEvidence = evaluateSemanticEvidence({ userTurn: userMessage, recentMessages });
  const activeFrame = inspectActiveAnswerFrame({ userTurn: userMessage, recentMessages });

  return {
    conversationId,
    currentUserMessage: userMessage,
    adjacentTurns,
    semanticEvidence,
    activeAnswerFrame: {
      type: activeFrame.frame?.type ?? null,
      question: activeFrame.frame?.question ?? null,
      compatible: activeFrame.compatible,
    },
    interaction: conversationState.interaction,
    repairSignal: isAssistantRepairSignal(userMessage),
    grounding: ASSISTANT_GROUNDING,
    confirmedFacts: [`Current user message: ${userMessage}`],
    unconfirmedHypotheses: [],
    safety: { level: "low", triggered: false },
  };
};
