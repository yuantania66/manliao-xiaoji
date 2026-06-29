import { buildRewriteMessages, REWRITE_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel, isAiProviderConfigured } from "./modelProvider";
import { getFallbackReply } from "./aiService";
import { AiConversationMessage, AiGenerationResult, AiJudgeResult } from "./types";

export const getRewriteModel = () => process.env.AI_REWRITE_MODEL?.trim() || getDefaultAiModel();

export const rewriteChatReply = async ({
  userMessage,
  originalReply,
  judgeResult,
  recentMessages,
}: {
  userMessage: string;
  originalReply: string;
  judgeResult: AiJudgeResult;
  recentMessages: AiConversationMessage[];
}): Promise<AiGenerationResult> => {
  if (!isAiProviderConfigured()) {
    return {
      text: getFallbackReply(judgeResult.riskLevel),
      model: "mock:rewrite",
      promptVersion: REWRITE_PROMPT_VERSION,
      latencyMs: 0,
    };
  }

  const response = await callModel({
    model: getRewriteModel(),
    messages: buildRewriteMessages({ userMessage, originalReply, judgeResult, recentMessages }),
    temperature: 0.55,
  });

  return {
    ...response,
    promptVersion: REWRITE_PROMPT_VERSION,
  };
};
