import { AiConversationMessage, AiMemoryContext, AiModelMessage, AiPromptMeta } from "./types";

export const CHAT_PROMPT_VERSION = "chat-base-product-v4";
export const JUDGE_PROMPT_VERSION = "judge-disabled-v1";
export const REWRITE_PROMPT_VERSION = "rewrite-disabled-v1";
export const FALLBACK_PROMPT_VERSION = "fallback-v1";
export const BASE_CHAT_PROMPT_VERSION_PREFIX = "chat-base-";

const toModelRole = (role: AiConversationMessage["role"]): AiModelMessage["role"] | null => {
  if (role === "user" || role === "assistant") return role;
  return null;
};

const LEGACY_ASSISTANT_TEMPLATE_PATTERN =
  /还在这里|先不用解释|比刚才|往上|往下|重了一点|轻了一点|强度|低信息|确定「|标记还是分数|可以只回一个词|不用把话说完整|测试界面|随机按|点方向|第[一二三四五六七八九十0-9]+个「/;
const LOW_INFORMATION_INPUT_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[^\s\p{L}\p{N}])$/u;
const LOW_INFORMATION_CLARIFY_ASSISTANT_PATTERN =
  /这个.*什么|是什么意思|什么意思|没读懂|没看懂|没理解|猜不出来|猜猜|是想|还是|^[^。！？\n]{0,24}[?？]\s*$/;
const LOW_INFORMATION_FORMULAIC_ASSISTANT_PATTERN =
  /^(嗯[，,]?\s*([0-9０-９]+|[一二三四五六七八九十零〇]+|[a-zA-Z])?。?|收到。?|好。?)$|数字|字母|字符|随手打|随便按|玩数字/;

const BASE_PRODUCT_PROMPT = [
  "你是慢聊小记的聊天助手。",
  "始终用中文回应。",
  "回复自然、简短、克制，像认真听人说话，不要像客服或咨询师。",
  "把用户的话当作对话的一部分，不要立刻处理成任务、测试或谜题。",
  "如果不确定，可以承认不确定；不必每次都追问、解释或给建议。",
  "不要模仿历史里明显模板化的助理回复。",
  "不要诊断疾病，不要承诺疗效，不要替用户下结论。",
].join("\n");

export const isBaseChatPromptVersion = (promptVersion?: string | null) =>
  Boolean(promptVersion?.startsWith(BASE_CHAT_PROMPT_VERSION_PREFIX));

const preview = (content: string) => {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
};

const getHistoryFilterReason = (message: AiConversationMessage) => {
  if (message.role !== "assistant") return null;

  if (message.promptVersion && !isBaseChatPromptVersion(message.promptVersion)) {
    return `legacy_prompt_version:${message.promptVersion}`;
  }

  if (LEGACY_ASSISTANT_TEMPLATE_PATTERN.test(message.content)) {
    return "legacy_template_text";
  }

  return null;
};

export const sanitizeChatHistory = ({
  userMessage,
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  const filteredHistory: AiPromptMeta["filteredHistory"] = [];
  const currentIsLowInformation = LOW_INFORMATION_INPUT_PATTERN.test(userMessage.trim());
  const included = recentMessages.slice(-12).flatMap((message) => {
    const role = toModelRole(message.role);
    if (!role) {
      filteredHistory.push({
        role: message.role,
        reason: "unsupported_role",
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    if (
      currentIsLowInformation &&
      role === "user" &&
      LOW_INFORMATION_INPUT_PATTERN.test(message.content.trim())
    ) {
      filteredHistory.push({
        role: message.role,
        reason: "low_information_history_for_ambiguous_input",
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    if (
      currentIsLowInformation &&
      role === "assistant" &&
      LOW_INFORMATION_CLARIFY_ASSISTANT_PATTERN.test(message.content)
    ) {
      filteredHistory.push({
        role: message.role,
        reason: "low_information_clarify_history_for_ambiguous_input",
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    if (
      currentIsLowInformation &&
      role === "assistant" &&
      LOW_INFORMATION_FORMULAIC_ASSISTANT_PATTERN.test(message.content)
    ) {
      filteredHistory.push({
        role: message.role,
        reason: "low_information_formulaic_history_for_ambiguous_input",
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    const reason = getHistoryFilterReason(message);
    if (reason) {
      filteredHistory.push({
        role: message.role,
        reason,
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    return [{ role, content: message.content }];
  }).slice(-8);

  return { included, filteredHistory };
};

export const buildChatPrompt = ({
  userMessage,
  recentMessages,
  memoryContext,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
}): { messages: AiModelMessage[]; meta: AiPromptMeta } => {
  const { included, filteredHistory } = sanitizeChatHistory({ userMessage, recentMessages });
  const messages: AiModelMessage[] = [
    {
      role: "developer",
      content: BASE_PRODUCT_PROMPT,
    },
    ...(memoryContext
      ? [
          {
            role: "developer" as const,
            content: `可靠历史：${memoryContext.date ? `${memoryContext.date}，` : ""}${memoryContext.text}\n如果自然，可以轻轻提一句“上次你提到……”。如果不自然，不要硬提；不能添加这里没有的细节。`,
          },
        ]
      : []),
    ...included,
    { role: "user", content: userMessage },
  ];

  return {
    messages,
    meta: {
      mode: "base_product",
      promptVersion: CHAT_PROMPT_VERSION,
      receivedHistoryCount: recentMessages.length,
      includedHistoryCount: included.length,
      filteredHistoryCount: filteredHistory.length,
      memoryIncluded: Boolean(memoryContext),
      memorySource: memoryContext?.source,
      filteredHistory,
      modelMessageRoles: messages.map((message) => message.role),
    },
  };
};

export const buildChatMessages = ({
  userMessage,
  recentMessages,
  memoryContext,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
}): AiModelMessage[] => {
  return buildChatPrompt({ userMessage, recentMessages, memoryContext }).messages;
};
