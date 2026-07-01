import { AiConversationMessage, AiJudgeResult, AiModelMessage } from "./types";
import { buildInteractionPlanGuidance } from "./interactionPlan";
import { retrieveAiGuidance } from "./ragKnowledge";
import { buildResponsePolicyGuidance } from "./responsePolicy";

export const CHAT_PROMPT_VERSION = "chat-v3-plan";
export const JUDGE_PROMPT_VERSION = "judge-v2";
export const REWRITE_PROMPT_VERSION = "rewrite-v3-plan";
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
  const interactionPlan = buildInteractionPlanGuidance({ userMessage, recentMessages });
  const responsePolicy = buildResponsePolicyGuidance({ userMessage, recentMessages });

  return [
    {
      role: "developer",
      content:
        "你是慢聊小记的陪伴式聊天助手。用温暖、克制、像朋友一样的中文回应用户。回复 1 到 2 句，每句尽量短。先执行本轮互动计划，让用户自然接得下去；再参考知识指南和护栏。不要诊断疾病，不要承诺疗效，不要给强硬建议。",
    },
    {
      role: "user",
      content: `${interactionPlan}\n\n本轮相关回复指南：\n${guidance || "无特别指南，保持短、稳、少脑补。"}\n\n必要护栏：\n${responsePolicy}\n\n最近对话：\n${formatHistory(recentMessages) || "暂无"}\n\n用户刚刚说：${userMessage}`,
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
      '你是慢聊小记 AI 回复审查器。只输出 JSON，不要 Markdown。检查回复是否安全、是否过度诊断、是否承诺疗效、是否太像 AI、是否缺少共情、是否给出不合适强建议、是否存在自伤/危机风险、是否重复安抚但没有推进、是否用抽象大问题把负担丢回用户、是否有赌气/摆烂/讽刺语气、是否忽略用户纠正。输出格式必须是 {"passed":true,"riskLevel":"low","issues":[],"rewriteRequired":false,"reason":""}，riskLevel 只能是 low/medium/high/crisis。',
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
  const interactionPlan = buildInteractionPlanGuidance({ userMessage, recentMessages });
  const responsePolicy = buildResponsePolicyGuidance({ userMessage, recentMessages });

  return [
    {
      role: "developer",
      content:
        "你是慢聊小记的回复改写器。先按本轮互动计划重写，再处理审查问题。保持温柔、具体、有共情。不要诊断，不承诺疗效，不给强硬建议，不提自己是 AI。回复 1 到 2 句，每句尽量短。",
    },
    {
      role: "user",
      content: `${interactionPlan}\n\n本轮相关回复指南：\n${guidance || "无特别指南，保持短、稳、少脑补。"}\n\n必要护栏：\n${responsePolicy}\n\n最近对话：\n${formatHistory(recentMessages) || "暂无"}\n\n用户输入：${userMessage}\n\n原回复：${originalReply}\n\n审查问题：${judgeResult.issues.join(", ") || "无"}\n审查原因：${judgeResult.reason}`,
    },
  ];
};
