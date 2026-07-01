import { AppError } from "@/lib/errors";

import { buildChatMessages, CHAT_PROMPT_VERSION, FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel } from "./modelProvider";
import { buildSlowChatState } from "./slowChatOS";
import { AiConversationMessage, AiGenerationResult, AiRiskLevel } from "./types";

const LOW_INFORMATION_PROMPT_VERSION = "low-info-v1";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

export const isLowInformationInput = (inputText: string) =>
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z])$/.test(inputText.trim());

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

const getRecentNumericUserValues = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .filter((message) => message.role === "user")
    .map((message) => normalizeDigit(message.content))
    .filter((value): value is number => value !== null);

const isConsecutiveTrend = (values: number[], direction: "up" | "down") => {
  if (values.length < 3) return false;
  const recent = values.slice(-3);
  return recent.every((value, index) => {
    if (index === 0) return true;
    return direction === "up" ? value > recent[index - 1] : value < recent[index - 1];
  });
};

const getIntensityText = ({
  value,
  previousValue,
  numericValues,
  primarySignal,
}: {
  value: number;
  previousValue: number | null;
  numericValues: number[];
  primarySignal: string;
}) => {
  const subject = primarySignal || "这件事";
  const valuesWithCurrent = [...numericValues, value];
  const risingSequence = isConsecutiveTrend(valuesWithCurrent, "up");
  const fallingSequence = isConsecutiveTrend(valuesWithCurrent, "down");

  if (previousValue !== null) {
    if (value < previousValue) {
      if (fallingSequence) {
        return value <= 1
          ? `我看到它一路往下了。${subject}已经很低。`
          : `它还在往下。先跟着这个变化就好。`;
      }
      return value <= 1 ? `嗯，轻下来了。已经很低。` : `嗯，比刚才轻了一点。`;
    }
    if (value > previousValue) {
      if (risingSequence) {
        return value >= 4
          ? `我看到数字还在往上。先不用解释原因。`
          : `它还在往上走。先知道这个变化就好。`;
      }
      if (value >= 7) {
        return `嗯，这个数字已经高了。先不急着拆原因。`;
      }
      return `嗯，往上了一点。先不用解释为什么。`;
    }
    return `还停在这个位置。先不用解释为什么没变。`;
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
  const state = buildSlowChatState({ userMessage: inputText, recentMessages });
  const number = normalizeDigit(token);
  const previousNumber = getRecentNumericUserValue(recentMessages);
  const numericValues = getRecentNumericUserValues(recentMessages);
  let text = "我收到这个很短的回应了。先不用把话说完整。";

  if (number !== null) {
    text = getIntensityText({
      value: number,
      previousValue: previousNumber,
      numericValues,
      primarySignal: state.continuity.primarySignal,
    });
  } else if (state.continuity.recentBoundary || state.presenceMode === "quiet") {
    text = "嗯，我收住。你不用再补充。";
  } else if (state.continuity.primarySignal === "累") {
    text = state.continuity.repeatedLowInformation ? "还在。" : "嗯，累先在这里。";
  } else if (state.continuity.primarySignal !== "这件事") {
    text = state.continuity.repeatedLowInformation
      ? "嗯，还在。"
      : `嗯，${state.continuity.primarySignal}先在这里。`;
  } else if (state.continuity.repeatedLowInformation) {
    text = "还在这里。";
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
