import { AppError } from "@/lib/errors";

import { buildChatMessages, CHAT_PROMPT_VERSION, FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import { callModel } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiRiskLevel } from "./types";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || "gpt-4.1-mini";

export const generateChatReply = async ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): Promise<AiGenerationResult> => {
  const response = await callModel({
    model: getMainModel(),
    messages: buildChatMessages({ userMessage, recentMessages }),
    temperature: 0.75,
  });

  return {
    ...response,
    promptVersion: CHAT_PROMPT_VERSION,
  };
};

export const getFallbackReply = (riskLevel: AiRiskLevel = "low") => {
  if (riskLevel === "crisis") {
    return "我很在意你刚刚说的这些。请先把自己放到安全的地方，立刻联系身边可信的人，或拨打当地紧急求助电话。";
  }

  return "我听见了。这个部分我们可以先轻轻放在这里，不急着解释完整。";
};

export const createFallbackGeneration = ({
  inputText,
  riskLevel,
}: {
  inputText: string;
  riskLevel?: AiRiskLevel;
}): AiGenerationResult => {
  if (!inputText.trim()) {
    throw new AppError("VALIDATION_ERROR", "inputText 不能为空", 400);
  }

  return {
    text: getFallbackReply(riskLevel),
    model: "fallback",
    promptVersion: FALLBACK_PROMPT_VERSION,
    latencyMs: 0,
  };
};
