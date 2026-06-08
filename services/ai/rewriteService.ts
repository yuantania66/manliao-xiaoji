import { buildRewriteMessages, REWRITE_PROMPT_VERSION } from "./promptBuilder";
import { callModel } from "./modelProvider";
import { getFallbackReply } from "./aiService";
import { AiConversationMessage, AiGenerationResult, AiJudgeResult } from "./types";

export const getRewriteModel = () => process.env.AI_REWRITE_MODEL?.trim() || "gpt-4.1-mini";

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
  if (!process.env.OPENAI_API_KEY?.trim()) {
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
