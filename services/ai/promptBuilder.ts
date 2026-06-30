import { AiConversationMessage, AiJudgeResult, AiModelMessage } from "./types";
import { retrieveAiGuidance } from "./ragKnowledge";

export const CHAT_PROMPT_VERSION = "chat-v1";
export const JUDGE_PROMPT_VERSION = "judge-v1";
export const REWRITE_PROMPT_VERSION = "rewrite-v1";
export const FALLBACK_PROMPT_VERSION = "fallback-v1";

const formatHistory = (recentMessages: AiConversationMessage[]) =>
  recentMessages
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

export const buildChatMessages = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}): AiModelMessage[] => {
  const guidance = retrieveAiGuidance({ userMessage, recentMessages });

  return [
    {
      role: "developer",
      content:
        "你是慢聊小记的陪伴式聊天助手。用温暖、克制、像朋友一样的中文回应用户。不要诊断疾病，不要承诺疗效，不要给强硬建议。回复 1 到 2 句，每句尽量短。",
    },
    {
      role: "user",
      content: `本轮相关回复指南：\n${guidance || "无特别指南，保持短、稳、少脑补。"}\n\n最近对话：\n${formatHistory(recentMessages) || "暂无"}\n\n用户刚刚说：${userMessage}`,
    },
  ];
};

export const buildJudgeMessages = ({
  userMessage,
  assistantReply,
  recentMessages,
}: {
  userMessage: string;
  assistantReply: string;
  recentMessages: AiConversationMessage[];
}): AiModelMessage[] => [
  {
    role: "developer",
    content:
      '你是慢聊小记 AI 回复审查器。只输出 JSON，不要 Markdown。检查回复是否安全、是否过度诊断、是否承诺疗效、是否太像 AI、是否缺少共情、是否给出不合适强建议、是否存在自伤/危机风险。输出格式必须是 {"passed":true,"riskLevel":"low","issues":[],"rewriteRequired":false,"reason":""}，riskLevel 只能是 low/medium/high/crisis。',
  },
  {
    role: "user",
    content: `最近对话：\n${formatHistory(recentMessages) || "暂无"}\n\n用户输入：${userMessage}\n\n待审查回复：${assistantReply}`,
  },
];

export const buildRewriteMessages = ({
  userMessage,
  originalReply,
  judgeResult,
  recentMessages,
}: {
  userMessage: string;
  originalReply: string;
  judgeResult: AiJudgeResult;
  recentMessages: AiConversationMessage[];
}): AiModelMessage[] => {
  const guidance = retrieveAiGuidance({ userMessage, recentMessages });

  return [
    {
      role: "developer",
      content:
        "你是慢聊小记的回复改写器。根据审查问题重写回复，保持温柔、具体、有共情。不要诊断，不承诺疗效，不给强硬建议，不提自己是 AI。回复 1 到 2 句，每句尽量短。",
    },
    {
      role: "user",
      content: `本轮相关回复指南：\n${guidance || "无特别指南，保持短、稳、少脑补。"}\n\n最近对话：\n${formatHistory(recentMessages) || "暂无"}\n\n用户输入：${userMessage}\n\n原回复：${originalReply}\n\n审查问题：${judgeResult.issues.join(", ") || "无"}\n审查原因：${judgeResult.reason}`,
    },
  ];
};
