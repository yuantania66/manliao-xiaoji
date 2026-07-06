import { AppError } from "@/lib/errors";

import { buildChatPrompt, CHAT_PROMPT_VERSION, FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiMemoryContext, AiRiskLevel } from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

export const generateChatReply = async ({
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
}): Promise<AiGenerationResult> => {
  const prompt = buildChatPrompt({ userMessage, recentMessages, memoryContext, understandingContext });
  const response = await callModel({
    model: getMainModel(),
    messages: prompt.messages,
    temperature: 0.75,
  });

  return {
    ...response,
    promptVersion: CHAT_PROMPT_VERSION,
    promptMeta: prompt.meta,
  };
};

const USER_CORRECTION_PATTERN =
  /不是这个问题|我已经说过了|你还问|别再让我|不是这样|不对|你说话像模板|一直在套模板|别编|别圆/;

export const getFallbackReply = ({
  inputText = "",
  riskLevel = "low",
}: {
  inputText?: string;
  riskLevel?: AiRiskLevel;
} = {}) => {
  if (riskLevel === "crisis") {
    return "这会儿先不用解释。请把自己和可能伤害你的东西隔开，联系身边可信的人；有危险就打当地紧急电话。";
  }

  if (USER_CORRECTION_PATTERN.test(inputText)) {
    if (/累/.test(inputText)) {
      return "是我刚才没接住。你已经说了累，就先停在这里。";
    }
    return "是我刚才没接住。先回到你刚刚说的这句。";
  }

  return "嗯，先不用解释完整。这个部分可以先放在这里，慢慢来。";
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
    text: getFallbackReply({ inputText, riskLevel }),
    model: "fallback",
    promptVersion: FALLBACK_PROMPT_VERSION,
    latencyMs: 0,
  };
};
