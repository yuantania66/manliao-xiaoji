import { AiConversationMessage, AiMemoryContext, AiModelMessage, AiPromptMeta } from "./types";
import { formatMemoryContextForPrompt } from "./dataLayers";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";

export const CHAT_PROMPT_VERSION = "chat-base-product-v5";
export const JUDGE_PROMPT_VERSION = "judge-disabled-v1";
export const REWRITE_PROMPT_VERSION = "rewrite-disabled-v1";
export const FALLBACK_PROMPT_VERSION = "fallback-v1";
export const BASE_CHAT_PROMPT_VERSION_PREFIX = "chat-base-";

const toModelRole = (role: AiConversationMessage["role"]): AiModelMessage["role"] | null => {
  if (role === "user" || role === "assistant") return role;
  return null;
};

const LEGACY_ASSISTANT_TEMPLATE_PATTERN =
  /还在这里|先不用解释|比刚才|往上|往下|重了一点|轻了一点|强度|低信息|确定「|标记还是分数|可以只回一个词|不用把话说完整|测试界面|随机按|点方向|第[一二三四五六七八九十0-9]+个「|窗台|叶子|树影|光线|屋檐|我这边|窗外/;
const LOW_INFORMATION_INPUT_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[^\s\p{L}\p{N}])$/u;
const LOW_INFORMATION_CLARIFY_ASSISTANT_PATTERN =
  /这个.*什么|是什么意思|什么意思|没读懂|没看懂|没理解|猜不出来|猜猜|是想|还是|^[^。！？\n]{0,24}[?？]\s*$/;
const LOW_INFORMATION_FORMULAIC_ASSISTANT_PATTERN =
  /^(嗯|收到|听到了|好)[，,。]?\s*.{0,48}$|数字|字母|字符|随手打|随便按|玩数字/;

const BASE_PRODUCT_PROMPT = [
  "你是慢聊小记的聊天助手。",
  "始终用中文回应。",
  "回复自然、简短、克制，像认真听人说话。",
  "把用户的话当作对话的一部分，不要立刻处理成任务、测试或谜题。",
  "如果不确定，可以承认不确定；不必每次都追问、解释或给建议。",
  "不要模仿历史里明显模板化的助理回复。",
  "不要把“嗯”“收到”“听到了”当作固定开头；如果前文已经这样开头，下一次必须换一种方式，或直接回应内容。",
  "绝对不要编造你看到、听到或正在经历的环境画面；没有窗台、叶子、树影、光线、天气、房间或你那边的场景信息。",
  "用户提到天气或环境时，只能回应用户明确说出的部分，不要扩写成你能看到的画面。",
  "不要诊断疾病，不要承诺疗效，不要替用户下结论。",
  "回复顺序优先：先接住，再澄清，再探索，最后才建议。",
  "不要把检索到的假设说成事实；假设只能用“可能、像是、我不确定”表达。",
  "用户情绪强时，少解释，多承接。",
  "用户信息不足时，优先问一个低压力问题；但不要连续追问“是什么意思”，也不要反复用同一个语气词承接。",
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

const compactMemory = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

const formatUnderstandingContextForPrompt = (context: StructuredRagContext) =>
  [
    "以下是结构化记忆检索结果。只能作为参考，不要直接复述，不要把假设当事实。",
    JSON.stringify(
      {
        recentMemories: context.recentMemories.map((item) => ({
          kind: item.kind,
          text: compactMemory(item.text),
          people: item.people,
          topics: item.topics,
          emotion: item.emotion,
          reason: item.reason,
        })),
        similarMemories: context.similarMemories.map((item) => ({
          kind: item.kind,
          text: compactMemory(item.text),
          people: item.people,
          topics: item.topics,
          emotion: item.emotion,
          reason: item.reason,
        })),
        coreEvents: context.coreEvents.map((item) => ({
          text: compactMemory(item.text),
          people: item.people,
          topics: item.topics,
        })),
        activeHypotheses: context.activeHypotheses.map((item) => ({
          hypothesisText: compactMemory(item.hypothesisText),
          category: item.category,
          confidence: item.confidence,
        })),
        counterEvidence: context.counterEvidence.map((item) => ({
          kind: item.kind,
          text: compactMemory(item.text),
          emotion: item.emotion,
          reason: item.reason,
        })),
        professionalGuidance: context.professionalGuidance.map((item) => ({
          id: item.id,
          sourceKind: item.sourceKind,
          principle: compactMemory(item.principle),
          applyWhen: compactMemory(item.applyWhen),
          avoid: item.avoid,
          responseMove: compactMemory(item.responseMove),
          reason: item.reason,
        })),
        recentUserFeedback: context.userFeedback.map((item) => ({
          signal: item.signal,
          tags: item.tags,
          comment: item.comment ? compactMemory(item.comment) : null,
          assistantMessage: compactMemory(item.messageText),
        })),
        retrievalReason: context.retrievalReason,
      },
      null,
      2
    ),
    "专业参考只能用于约束回应方式，不要在回复里提到资料名、理论名或来源链接。",
    "用户反馈表示过去哪些回复没有接住；优先避免重复同类错误，不要向用户解释系统如何利用反馈。",
  ].join("\n");

const getUnderstandingMeta = (context?: StructuredRagContext | null): AiPromptMeta["understanding"] | undefined =>
  context
    ? {
        recentMemoryCount: context.recentMemories.length,
        similarMemoryCount: context.similarMemories.length,
        coreEventCount: context.coreEvents.length,
        activeHypothesisCount: context.activeHypotheses.length,
        counterEvidenceCount: context.counterEvidence.length,
        professionalGuidanceCount: context.professionalGuidance.length,
        userFeedbackCount: context.userFeedback.length,
        retrievalReason: context.retrievalReason,
      }
    : undefined;

export const buildChatPrompt = ({
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
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
            content: formatMemoryContextForPrompt(memoryContext),
          },
        ]
      : []),
    ...(understandingContext
      ? [
          {
            role: "developer" as const,
            content: formatUnderstandingContextForPrompt(understandingContext),
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
      memoryLayer: memoryContext?.layer,
      memoryTrust: memoryContext?.trust,
      understandingIncluded: Boolean(understandingContext),
      understanding: getUnderstandingMeta(understandingContext),
      filteredHistory,
      modelMessageRoles: messages.map((message) => message.role),
    },
  };
};

export const buildChatMessages = ({
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
}): AiModelMessage[] => {
  return buildChatPrompt({ userMessage, recentMessages, memoryContext, understandingContext }).messages;
};
