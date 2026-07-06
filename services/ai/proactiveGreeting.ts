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
}: {
  kind: ProactiveGreetingKind;
  recentMessages: AiConversationMessage[];
  now: Date;
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
      "不要用“是……还是……”这类强迫二选一的问题。",
      "只能依据：用户此刻打开了慢聊小记、当前时间、最近对话里明确出现过的信息。",
      kind === "initial"
        ? "这是进入聊天时的第一句。"
        : "这是用户隔了一段时间回来时的第一句。",
      `当前上海时间：${getShanghaiTimeLabel(now)}`,
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

  const response = await callModel({
    model:
      process.env.AI_PROACTIVE_GREETING_MODEL?.trim() ||
      process.env.AI_MAIN_MODEL?.trim() ||
      getDefaultAiModel(),
    messages: buildProactiveGreetingMessages({ kind, recentMessages, now }),
    temperature: 0.85,
  });

  return {
    ...response,
    text: cleanGreeting(response.text),
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  };
};
