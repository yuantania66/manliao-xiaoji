import { AppError } from "@/lib/errors";

import { buildChatPrompt, CHAT_PROMPT_VERSION, FALLBACK_PROMPT_VERSION } from "./promptBuilder";
import { callModel, getDefaultAiModel } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiMemoryContext, AiRiskLevel } from "./types";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";

export const getMainModel = () => process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel();

const GENERIC_OPENING_PATTERN = /^(嗯|收到|听到了|好)[，,。？?！!、]?\s*/;
const INVENTED_SCENE_PATTERN =
  /我这边|我这里|我刚刚.*(想|看到|听到)|我正(在)?(看|想|听)|我喜欢|我想起|让我想到|窗台|窗边|窗外|叶子|树影|影子|光线|屋檐|房间|云|天空|风不大|风很|太阳|阳光|雨声|树叶|喝杯茶|喝水|休息一下|出去走|站着发.*呆|躲一躲|太热|有意思的(剧|歌|电影|游戏)|看.*剧|听.*歌/;
const LOW_INFORMATION_INPUT_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[^\s\p{L}\p{N}])$/u;
const LOW_CONTENT_INPUT_PATTERN = /随手打|随便打|不知道聊什么|没做什么|没什么|没发生什么|没有特别/;
const MEANING_SEEKING_PATTERN =
  /是什么意思|什么意思|什么含义|特别含义|特别的含义|代表什么|是想说|还是只是|随手打|随便打|打错了|猜/;
const FORMULAIC_LOW_INFORMATION_PATTERN =
  /^(收到了?|听到了?|看到了?|听着呢|嗯|好|在的|在这[儿里]|接着|接住了|你说|收到了?这个.+|放在这里也可以|先这样也行|这样待着也可以|我在|我在听)[。.]?$/;
const FORMULAIC_LOW_CONTENT_PATTERN =
  /^(那就先|就这样|先这样|那也|也挺好|挺好|先放着|放着|有时候就是会这样|.*待一会儿|.*待着|.*待在这|.*停一会儿|.*停在)[^。！？]*[。.]?$/;
const POETIC_EMPTY_PATTERN =
  /落在这[里儿]|停在这[里儿]|留在这[里儿]|待在这[里儿]|时间.*流过|这句话.*已经在|不用承担|空一点|算今天的一部分|慢慢散开|安静地|轻轻地/;
const OVER_INTERPRETED_LOW_CONTENT_PATTERN = /手比脑子快|随手.*也挺|只是随手/;

const removeGenericOpening = (text: string) => {
  const cleaned = text.replace(GENERIC_OPENING_PATTERN, "").trim();
  return cleaned.length >= 2 ? cleaned : text;
};

const removeInventedScene = (text: string) => {
  if (!INVENTED_SCENE_PATTERN.test(text)) return text;
  return "可以先不找话题。你愿意的话，就从刚刚那一点感觉说起。";
};

const needsLowInformationRepair = (userMessage: string, text: string) =>
  LOW_INFORMATION_INPUT_PATTERN.test(userMessage.trim()) &&
  (MEANING_SEEKING_PATTERN.test(text) ||
    FORMULAIC_LOW_INFORMATION_PATTERN.test(text) ||
    text.replace(/[。.\s]/g, "") === userMessage.trim());

const needsLowContentRepair = (userMessage: string, text: string) =>
  LOW_CONTENT_INPUT_PATTERN.test(userMessage.trim()) &&
  (FORMULAIC_LOW_CONTENT_PATTERN.test(text) ||
    POETIC_EMPTY_PATTERN.test(text) ||
    OVER_INTERPRETED_LOW_CONTENT_PATTERN.test(text));

const getLowInformationFallback = (userMessage: string) => {
  const value = userMessage.trim();
  if (/^[0-9０-９]+$/.test(value)) return `就先是 ${value}。`;
  if (/^[a-zA-Z]$/.test(value)) return `就先是 ${value}。`;
  if (/^[^\s\p{L}\p{N}]$/u.test(value)) return `就这个符号。`;
  return "不急着解释。";
};

const getLowContentFallback = (userMessage: string) => {
  if (/随手打|随便打/.test(userMessage)) return "随手按一下也没事。";
  if (/不知道聊什么/.test(userMessage)) return "不用硬找话题。";
  if (/没做什么/.test(userMessage)) return "没做什么也正常。";
  return "不用硬说。";
};

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
  const cleanedText = removeInventedScene(removeGenericOpening(response.text));

  if (needsLowInformationRepair(userMessage, cleanedText) || needsLowContentRepair(userMessage, cleanedText)) {
    try {
      const repaired = await callModel({
        model: getMainModel(),
        messages: [
          ...prompt.messages,
          {
            role: "developer",
            content:
              "上一句不合格：它把低信息输入当成了谜题，或者用了固定安抚短句/文艺空句。请重写一句中文：像普通人说话，不要问含义，不要猜，不要说“收到/收到了/看到了/在的/接着/你说/也可以/也行/我在/我在听/放在这里/落在这里/那就先/就这样/待着/停一会儿/时间流过”，不要给建议，只贴着用户刚刚这句话自然回应。",
          },
        ],
        temperature: 0.9,
      });
      const repairedText = removeInventedScene(removeGenericOpening(repaired.text));
      const fallbackText = LOW_INFORMATION_INPUT_PATTERN.test(userMessage.trim())
        ? getLowInformationFallback(userMessage)
        : getLowContentFallback(userMessage);
      return {
        ...repaired,
        text:
          needsLowInformationRepair(userMessage, repairedText) ||
          needsLowContentRepair(userMessage, repairedText)
            ? fallbackText
            : repairedText,
        model: `${repaired.model}:repaired`,
        promptVersion: CHAT_PROMPT_VERSION,
        promptMeta: prompt.meta,
      };
    } catch {
      return {
        ...response,
        text: LOW_INFORMATION_INPUT_PATTERN.test(userMessage.trim())
          ? getLowInformationFallback(userMessage)
          : getLowContentFallback(userMessage),
        promptVersion: CHAT_PROMPT_VERSION,
        promptMeta: prompt.meta,
      };
    }
  }

  return {
    ...response,
    text: cleanedText,
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

  return "先不用解释完整。这个部分可以先放在这里，慢慢来。";
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
