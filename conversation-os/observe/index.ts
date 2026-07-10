import { Notice, ObserveInput } from "../types";

const isNumericToken = (content: string) => /^[0-9０-９]+$/.test(content.trim());

const isVeryShortToken = (content: string) => {
  const trimmed = content.trim();
  return Boolean(trimmed) && [...trimmed].length <= 2;
};

const getMessageFormText = (content: string) => {
  const trimmed = content.trim();
  if (!trimmed) return "用户发送了一条空白消息。";
  if (isNumericToken(trimmed)) return "用户发送了数字。";
  if (/^[a-zA-Z]$/.test(trimmed)) return "用户发送了单个字母。";
  if ([...trimmed].length <= 2) return "用户发送了一条很短的消息。";
  return "用户发送了一条文本消息。";
};

const getSequenceObservation = (content: string, recentMessages: ObserveInput["recentMessages"]) => {
  const recentUserMessages = recentMessages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content);

  if (isNumericToken(content) && recentUserMessages.length >= 2 && recentUserMessages.every(isNumericToken)) {
    return "用户连续发送数字。";
  }

  if (
    isVeryShortToken(content) &&
    recentUserMessages.length >= 2 &&
    recentUserMessages.every(isVeryShortToken)
  ) {
    return "用户连续发送很短的消息。";
  }

  return null;
};

export const observe = ({ userMessage, recentMessages }: ObserveInput): Notice => {
  const sequenceObservation = getSequenceObservation(userMessage.content, recentMessages);

  return {
    observations: [
    {
      kind: "user_message",
      text: `用户当前消息：${userMessage.content}`,
      source: "current_user_message",
    },
    {
      kind: "message_form",
      text: getMessageFormText(userMessage.content),
      source: "current_user_message",
    },
    {
      kind: "conversation_context",
      text: `本轮之前可见最近消息数量：${recentMessages.length}`,
      source: "recent_messages",
    },
    ...(sequenceObservation
      ? [
          {
            kind: "conversation_context" as const,
            text: sequenceObservation,
            source: "recent_messages" as const,
          },
        ]
      : []),
  ],
  };
};
