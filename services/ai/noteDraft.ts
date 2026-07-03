import { AiConversationMessage, AiNoteDraft } from "./types";

const MEANINGFUL_TEXT_PATTERN = /[\u4e00-\u9fa5A-Za-z]{2,}/;
const LOW_INFORMATION_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[^\s\p{L}\p{N}])$/u;

const getTodayInShanghai = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const cleanDraftText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^今天的小记草稿[:：]\s*/, "")
    .trim()
    .slice(0, 120);

export const createNoteDraft = ({
  userMessage,
  recentMessages,
  assistantReply,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  assistantReply: string;
}): AiNoteDraft | null => {
  const text = userMessage.trim();
  if (!text || LOW_INFORMATION_PATTERN.test(text) || !MEANINGFUL_TEXT_PATTERN.test(text)) {
    return null;
  }

  const recentUserText = recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((message) => message && !LOW_INFORMATION_PATTERN.test(message))
    .slice(-2);
  const source = cleanDraftText([...recentUserText, text].join("。"));
  if (!source) return null;

  const replyHint = assistantReply.includes("累")
    ? "这会儿先承认自己的累。"
    : assistantReply.includes("不急") || assistantReply.includes("不用")
      ? "今天可以不用急着解释清楚。"
      : "";

  return {
    content: cleanDraftText(replyHint ? `${source}。${replyHint}` : source),
    source: "chat_turn",
    recordDate: getTodayInShanghai(),
  };
};
