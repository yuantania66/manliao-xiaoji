import type { AiConversationMessage } from "@/services/ai/types";
import { evaluateSemanticEvidence, inspectActiveAnswerFrame } from "@/services/clinical/semanticEvidence";
import type { ConversationStateResult } from "../state";

import { ASSISTANT_GROUNDING } from "./assistantGrounding";
import { detectAssistantCorrection, isAssistantRepairSignal } from "./repairSignal";
import type { ConversationControlContext } from "./types";

export const assembleConversationControlContext = ({
  conversationId,
  currentTurnId,
  userMessage,
  recentMessages,
  conversationState,
}: {
  conversationId: string;
  currentTurnId?: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  conversationState: ConversationStateResult;
}): ConversationControlContext => {
  const adjacentTurns = recentMessages
    .filter((message): message is AiConversationMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message, index) => ({
      id: message.id ?? `${conversationId}:adjacent-${index + 1}`,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      replyToMessageId: message.replyToMessageId,
      promptVersion: message.promptVersion,
      committedAssistantMove: message.committedAssistantMove,
    }));
  const semanticEvidence = evaluateSemanticEvidence({ userTurn: userMessage, recentMessages });
  const activeFrame = inspectActiveAnswerFrame({ userTurn: userMessage, recentMessages });
  const correction = detectAssistantCorrection({ text: userMessage, adjacentTurns });

  return {
    conversationId,
    currentTurnId: currentTurnId ?? `${conversationId}:turn-${recentMessages.length + 1}`,
    currentUserMessage: userMessage,
    adjacentTurns,
    semanticEvidence,
    activeAnswerFrame: {
      type: activeFrame.frame?.type ?? null,
      question: activeFrame.frame?.question ?? null,
      compatible: activeFrame.compatible,
    },
    interaction: conversationState.interaction,
    evidenceSignals: {
      explicitAdviceRequest: conversationState.signals.explicitAdviceRequest,
    },
    repairSignal: Boolean(correction) || isAssistantRepairSignal(userMessage, adjacentTurns),
    correction,
    grounding: ASSISTANT_GROUNDING,
    confirmedFacts: [`Current user message: ${userMessage}`],
    unconfirmedHypotheses: [],
    safety: { level: "low", triggered: false },
  };
};
