import { PROACTIVE_GREETING_PROMPT_VERSION } from "@/lib/proactive-greeting";
import { AppError } from "@/lib/errors";

import { callModel, getDefaultAiModel, isAiProviderConfigured } from "./modelProvider";
import { AiConversationMessage, AiGenerationResult, AiModelMessage } from "./types";

type ProactiveGreetingKind = "initial" | "return";

const getShanghaiTimeLabel = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "long",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

const previewHistory = (messages: AiConversationMessage[]) =>
  messages
    .slice(-6)
    .map((message) => `${message.role === "assistant" ? "AI" : "用户"}：${message.content}`)
    .join("\n");

const buildProactiveGreetingMessages = ({
  kind,
  recentMessages,
  now,
  repairInstruction,
}: {
  kind: ProactiveGreetingKind;
  recentMessages: AiConversationMessage[];
  now: Date;
  repairInstruction?: string;
}): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "你是慢聊小记的聊天助手。",
      "你要主动和用户打一个自然的招呼，而不是等待用户先开口。",
      "只输出一句中文，不要解释你的思考，不要列选项，不要用括号。",
      "语气要像关系里自然的一句轻声招呼，克制、具体、有人味。",
      "不要说教、不要鸡汤、不要像客服、不要像心理咨询师开场白。",
      "不要使用呀、呢、啦、哦、～这类卖萌或客服式语气词。",
      "不要问很大的问题；可以给用户一个低压力入口。",
      "不要编造环境、天气、窗外声音、用户状态、用户情绪或刚发生的事。",
      "不要猜用户在家、出门、上班、学习或正在做什么。",
      "不要暗示用户很少来、难得来、好久没来、终于来了，除非最近对话里有明确证据。",
      "不要用“是……还是……”这类强迫二选一的问题。",
      "不要建议用户去做某个动作，比如躺会儿、休息、出门、喝水、睡觉。",
      "不要评价用户如何消磨时间，不要使用“打发时间”。",
      "这句话必须给用户一个低压力表达入口，不能只是报时间或寒暄。",
      "只能依据：用户此刻打开了慢聊小记、当前时间、最近对话里明确出现过的信息。",
      kind === "initial"
        ? "这是进入聊天时的第一句。"
        : "这是用户隔了一段时间回来时的第一句。",
      `当前上海时间：${getShanghaiTimeLabel(now)}`,
      repairInstruction,
    ].join("\n"),
  },
  ...(recentMessages.length > 0
    ? [
        {
          role: "developer" as const,
          content: `最近对话，只用于判断语气和连续感：\n${previewHistory(recentMessages)}`,
        },
      ]
    : []),
  {
    role: "user",
    content: "请生成慢聊小记此刻主动对用户说的第一句话。",
  },
];

const cleanGreeting = (value: string) =>
  value
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const UNSUPPORTED_RELATION_JUDGMENT_PATTERN =
  /难得|好久不见|很久不见|好久没来|很久没来|终于来了|终于来|终于上来|又来了|又来啦|又上来/;

const validateGreeting = (value: string) => {
  if (!value) return "输出为空。";
  if (UNSUPPORTED_RELATION_JUDGMENT_PATTERN.test(value)) {
    return "包含无证据的来访频率或关系判断。";
  }
  if (/在家|出门|上班|学习|窗外|天气|蝉|雨|太阳|风/.test(value)) {
    return "包含无证据的场景、活动或环境判断。";
  }
  if (/躺|休息|喝水|睡觉|出去走|出门|打发时间|消磨时间/.test(value)) {
    return "包含行动建议或轻浮的时间评价。";
  }
  if (/呀|呢|啦|哦|～/.test(value)) {
    return "包含卖萌或客服式语气词。";
  }
  if (/是.*还是/.test(value)) {
    return "包含强迫二选一的问题。";
  }
  if (!/说|聊|讲|放|留|开口|在这|这里|感觉|一句/.test(value)) {
    return "缺少低压力表达入口。";
  }
  return null;
};

export const generateProactiveGreeting = async ({
  kind,
  recentMessages,
  now = new Date(),
}: {
  kind: ProactiveGreetingKind;
  recentMessages: AiConversationMessage[];
  now?: Date;
}): Promise<AiGenerationResult> => {
  if (!isAiProviderConfigured()) {
    throw new AppError("AI_GENERATION_FAILED", "AI 主动问候模型未配置", 502);
  }

  const model =
    process.env.AI_PROACTIVE_GREETING_MODEL?.trim() ||
    process.env.AI_MAIN_MODEL?.trim() ||
    getDefaultAiModel();

  const generateOnce = async (repairInstruction?: string) =>
    callModel({
      model,
      messages: buildProactiveGreetingMessages({
        kind,
        recentMessages,
        now,
        repairInstruction,
      }),
      temperature: 0.85,
    });

  let response = await generateOnce();
  let text = cleanGreeting(response.text);
  const rejectionReason = validateGreeting(text);
  if (rejectionReason) {
    response = await generateOnce(
      `上一句不合格，原因：${rejectionReason} 请重写一句。不要说“难得上来”、不要推断用户多久没来、不要编场景。`
    );
    text = cleanGreeting(response.text);
  }

  const finalRejectionReason = validateGreeting(text);
  if (finalRejectionReason) {
    throw new AppError("AI_GENERATION_FAILED", "AI 主动问候未通过输出约束", 502, {
      reason: finalRejectionReason,
    });
  }

  return {
    ...response,
    text,
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  };
};
