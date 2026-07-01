import { AppError } from "@/lib/errors";

import { buildChatMessages, CHAT_PROMPT_VERSION, FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiRiskLevel } from "./types";

const LOW_INFORMATION_PROMPT_VERSION = "low-info-v1";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

export const isLowInformationInput = (inputText: string) =>
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z])$/.test(inputText.trim());

const getRecentText = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-6)
    .map((message) => message.content)
    .join("\n");

const normalizeDigit = (inputText: string) => {
  const normalized = inputText.trim().replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30)
  );
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const getRecentNumericUserValue = (recentMessages: AiConversationMessage[]) => {
  const recentNumericUserMessage = recentMessages
    .slice()
    .reverse()
    .find((message) => message.role === "user" && normalizeDigit(message.content) !== null);

  return recentNumericUserMessage ? normalizeDigit(recentNumericUserMessage.content) : null;
};

const getIntensityText = ({
  value,
  previousValue,
  recentText,
}: {
  value: number;
  previousValue: number | null;
  recentText: string;
}) => {
  const subject = /累|疲惫|没力气|撑不住|耗尽/.test(recentText)
    ? "累"
    : /烦/.test(recentText)
      ? "烦"
      : /难受|堵|空|麻木|委屈|焦虑|慌|压力/.test(recentText)
        ? "这个感觉"
        : "这件事";

  if (previousValue !== null) {
    if (value < previousValue) {
      return value <= 1
        ? `嗯，又轻了一点。${subject}还在，但已经很低了。`
        : `嗯，比刚才轻了一点。${subject}还在，但没那么顶了。`;
    }
    if (value > previousValue) {
      return `嗯，比刚才重了一点。先按现在这个强度接住。`;
    }
    return `嗯，差不多还在原处。先不用解释为什么没变。`;
  }

  if (value <= 1) {
    return `嗯，很低的一点点。先这样放着就可以。`;
  }
  if (value <= 3) {
    return `嗯，是有一点，但还没满出来。先不用把它解释清楚。`;
  }
  if (value <= 6) {
    return `嗯，已经有点占着了。先不用急着说原因。`;
  }
  return `嗯，挺高了。先不急着拆原因，先把这一下接住。`;
};

export const createLowInformationGeneration = ({
  inputText,
  recentMessages,
}: {
  inputText: string;
  recentMessages: AiConversationMessage[];
}): AiGenerationResult => {
  const token = inputText.trim();
  const recentText = getRecentText(recentMessages);
  const number = normalizeDigit(token);
  const previousNumber = getRecentNumericUserValue(recentMessages);
  let text = "我收到这个很短的回应了。先不用把话说完整。";

  if (number !== null) {
    text = getIntensityText({ value: number, previousValue: previousNumber, recentText });
  } else if (/累|疲惫|没力气|撑不住|耗尽/.test(recentText)) {
    text = "嗯，累这件事先在这里。你不用把它说完整。";
  } else if (/烦|难受|堵|空|麻木|委屈|焦虑|慌|压力/.test(recentText)) {
    text = "嗯，这个感觉我接住了。先不用解释它从哪来。";
  } else if (/别问|别追问|不想说|先别|不想被教育/.test(recentText)) {
    text = "嗯，我收住。你不用再补充。";
  }

  return {
    text,
    model: "deterministic-low-information",
    promptVersion: LOW_INFORMATION_PROMPT_VERSION,
    latencyMs: 0,
  };
};

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

const USER_CORRECTION_PATTERN = /不是这个问题|我已经说过了|你还问|别再让我|不是这样|不对|你说话像模板|一直在套模板/;

export const getFallbackReply = ({
  inputText = "",
  riskLevel = "low",
}: {
  inputText?: string;
  riskLevel?: AiRiskLevel;
} = {}) => {
  if (riskLevel === "crisis") {
    return "我很在意你刚刚说的这些。请先把自己放到安全的地方，立刻联系身边可信的人，或拨打当地紧急求助电话。";
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
