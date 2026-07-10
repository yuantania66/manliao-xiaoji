import { AiConversationMessage, AiMemoryContext, AiModelMessage, AiPromptMeta, AiVoiceConstraints } from "./types";
import { formatMemoryContextForPrompt } from "./dataLayers";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import { ConversationContext } from "@/conversation-os";
import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";

export const CHAT_PROMPT_VERSION = "chat-base-product-v11";
export const JUDGE_PROMPT_VERSION = "judge-disabled-v1";
export const REWRITE_PROMPT_VERSION = "rewrite-disabled-v1";
export const FALLBACK_PROMPT_VERSION = "fallback-v1";
export const BASE_CHAT_PROMPT_VERSION_PREFIX = "chat-base-";

const toModelRole = (role: AiConversationMessage["role"]): AiModelMessage["role"] | null => {
  if (role === "user" || role === "assistant") return role;
  return null;
};

const LEGACY_ASSISTANT_TEMPLATE_PATTERN =
  /还在这里|先不用解释|比刚才|往上|往下|重了一点|轻了一点|强度|低信息|确定「|标记还是分数|可以只回一个词|不用把话说完整|测试界面|随机按|点方向|第[一二三四五六七八九十0-9]+个「|窗台|叶子|树影|光线|屋檐|我这边|我刚刚|我喜欢|我想起|窗外/;
const LOW_INFORMATION_INPUT_PATTERN =
  /^([0-9０-９]+|[一二三四五六七八九十零〇]+|[嗯啊哦好行对是]|[a-zA-Z]|[^\s\p{L}\p{N}])$/u;
const LOW_INFORMATION_CLARIFY_ASSISTANT_PATTERN =
  /这个.*什么|是什么意思|什么意思|没读懂|没看懂|没理解|猜不出来|猜猜|是想|还是|^[^。！？\n]{0,24}[?？]\s*$/;
const LOW_INFORMATION_FORMULAIC_ASSISTANT_PATTERN =
  /^(嗯|收到|听到了|好)[，,。]?\s*.{0,48}$|数字|字母|字符|随手打|随便按|玩数字/;

// LEGACY/FROZEN/DO NOT EXTEND:
// The Conversation OS strategy fields in this prompt are compatibility inputs only.
// Do not add new engageMode/experienceGoal/questionStyle strategy instructions here.
// Future response strategy must use ClinicalPlan.
const BASE_PRODUCT_PROMPT = [
  "你是慢聊小记的聊天助手。",
  "始终用中文回应。",
  "这是一个以来访者为中心的慢聊空间，不是解题、测试、客服、日程助手或心理分析系统。",
  "你的任务不是证明你懂了，而是跟上用户此刻的节奏。",
  "回复要自然、简短、克制，像认真听人说话；通常 1 句，最多 2 句。",
  "说普通话，不写散文；不要诗意化、哲理化、文艺化，不要说“落在这里”“时间流过”“这句话已经在了”这类漂亮但空的句子。",
  "每次只回应用户刚刚给出的那一点，不扩写、不升华、不转移话题。",
  "不要放大用户的表达；用户只说“累”，不要改写成“很不容易、很辛苦、撑不住、特别难”。",
  "不要用 AI 自己的感受、偏好、想象、生活现场或心理活动填补空白。",
  "不要把用户的话处理成任务、测试、谜题、选项或需要解释的符号。",
  "不要替用户确认事实或感受；禁止说“今天是很累的一天、今天确实辛苦、你就是很累”。把这类句子改成“听起来今天有点累、我听到你说今天好累”。",
  "Conversation OS 会给出 experienceGoal、engageMode 和 questionStyle；experienceGoal 是本轮主目标，engageMode 只是辅助信号。",
  "先满足 experienceGoal，再参考 engageMode；不要为了完成模式而牺牲用户体验。",
  "不要把提问当作向用户索取信息；好的问题不会让用户觉得自己正在回答 AI，而会让用户觉得 AI 正在陪自己一起理解自己。",
  "engageMode=acknowledge 时：先承认你注意到了这个输入；如果提问，只能是共同靠近式，不询问“什么意思”。",
  "engageMode=stay 时：允许停在这里；如果提问，只能给用户选择权，不推进话题。",
  "engageMode=reflect 时：只贴着用户明确说出的体验反映；如果提问，只能探索体验，不追问原因。",
  "engageMode=repair 时：先放下刚刚的理解，不辩解，不沿用旧理解。",
  "engageMode=repair_with_invitation 时：承认刚刚理解偏了，并给用户一个按自己方式纠正你的低压入口。",
  "engageMode=repair_with_low_pressure_exit 时：允许用户先不说，同时低压收回你可能没接住的部分；不要把它说成关闭对话。",
  "engageMode=invite 时：更适合主动邀请用户校准；问题必须低压力，允许用户不用解释。",
  "如果用户只发数字、字母、符号、单字、表情、嗯/啊/好，不要把它比喻成敲门、开头或信号，不要猜它代表分数、编号或暗号；如果提问，按 questionStyle 的姿态来问。",
  "遇到低信息输入时，要体现你想理解，但想理解不等于一直提问；很多时候先承认、先停留，比索取解释更接近理解。",
  "如果用户说随手打的、没什么、不知道聊什么、没做什么、没发生特别的事，就顺着这句话本身回应；不要追问原因，不要主动转到电影、音乐、游戏、天气闲聊，也不要建议喝茶、喝水、休息或出门。",
  "避免机械口癖：不要只说“收到/收到了/听到了/嗯/好/在的”，不要连续使用“可以”“也行”“慢慢来”“放在这里”“我在听”“我在”“待着”“停一会儿”。",
  "只有当用户明确给出事件、关系、感受或困扰时，才可以轻轻澄清；澄清只能问一个很小的问题。",
  "不要模仿历史里明显模板化的助理回复。",
  "不要把“嗯”“收到”“听到了”当作固定开头；如果前文已经这样开头，下一次必须换一种方式，或直接回应内容。",
  "绝对不要编造你看到、听到或正在经历的环境画面；没有窗台、叶子、树影、光线、天气、房间或你那边的场景信息。",
  "不要说“我刚刚在想”“我这边正在……”这类伪造 AI 当下心理活动或生活现场的话。",
  "用户提到天气或环境时，只能回应用户明确说出的部分，不要扩写成你能看到的画面。",
  "不要诊断疾病，不要承诺疗效，不要替用户下结论。",
  "回复顺序优先：先接住，再澄清，再探索，最后才建议；低信息输入可以接住后轻轻邀请用户校准。",
  "不要把检索到的假设说成事实；假设只能用“可能、像是、我不确定”表达。",
  "用户情绪强时，少解释，多承接。",
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

const formatConversationContextForModel = (context: ConversationContext) =>
  [
    "【Conversation OS Context】",
    `conversationId: ${context.conversationId}`,
    `notice: ${context.latestNotice.observations.map((item) => item.text).join(" / ")}`,
    `currentUnderstanding: ${[
      ...context.understanding.events,
      ...context.understanding.emotions,
      ...context.understanding.meanings,
      ...context.understanding.needs,
      ...context.understanding.relationships,
      ...context.understanding.goals,
      ...context.understanding.conflicts,
    ]
      .map((item) => item.text)
      .join(" / ") || "none"}`,
    `unknowns: ${context.understanding.unknowns.map((item) => item.text).join(" / ") || "none"}`,
    `experienceGoal: ${context.responseGoal.experienceGoal.join(" / ")}`,
    `engageMode: ${context.responseGoal.engageMode}`,
    `policyReason: ${context.responseGoal.policyReason}`,
    `questionStyle: purpose=${context.responseGoal.questionStyle.purpose}; avoid=${context.responseGoal.questionStyle.avoid.join(",")}; northStar=${context.responseGoal.questionStyle.northStar}`,
    `responseGoal: ${context.responseGoal.userExperience.join(" / ")}`,
    `languageConstraint: ${context.responseGoal.languageConstraint.join(" / ")}`,
  ].join("\n");

const formatVoiceConstraintsForModel = (voiceConstraints: AiVoiceConstraints) =>
  [
    "【Voice Layer】",
    "这不是回复模板，不要照抄；它只约束中文表达方式。",
    `styleDirectives: ${voiceConstraints.styleDirectives.join(" / ")}`,
    `rhythm: ${voiceConstraints.rhythm.join(" / ")}`,
    `questionDirectives: ${voiceConstraints.questionDirectives.join(" / ")}`,
    `prohibitedExpressions: ${voiceConstraints.prohibitedExpressions.join(" / ")}`,
  ].join("\n");

export const isClinicalPlanPromptEnabled = () =>
  process.env.CLINICAL_PLAN_PROMPT_ENABLED === "true";

const formatList = (items: string[]) => (items.length > 0 ? items.join(" / ") : "none");

export const formatClinicalPlanForPrompt = (clinicalPlan: ClinicalPlan) => {
  if (clinicalPlan.primaryStrategy !== "rogers") return null;
  if (clinicalPlan.responseGoal !== "help_continue_expression") return null;

  return [
    "【Clinical Plan】",
    "This is a minimal response-goal instruction. It is not a reply template.",
    `responseGoal: ${clinicalPlan.responseGoal}`,
    `responseIntent: ${clinicalPlan.responseIntent}`,
    `primaryStrategy: ${clinicalPlan.primaryStrategy}`,
    `questionFunction: ${clinicalPlan.questionFunction}`,
    `toneConstraint: ${formatList(clinicalPlan.toneConstraint)}`,
    `interventionBoundary: ${formatList(clinicalPlan.interventionBoundary)}`,
    `safetyNotes: ${formatList(clinicalPlan.safetyNotes)}`,
    "Goal: help the user continue expressing themselves.",
    "Do not only say it is okay and end the reply.",
    "You may gently invite the user to say one first word, image, feeling, or body sensation that comes up.",
    "Do not require the user to organize a complete thought.",
    "Do not diagnose, assess pathology, or propose a treatment plan.",
    "Do not force advice.",
  ].join("\n");
};

export const buildChatPrompt = ({
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
  conversationContext,
  voiceConstraints,
  clinicalPlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
  conversationContext?: ConversationContext | null;
  voiceConstraints?: AiVoiceConstraints | null;
  clinicalPlan?: ClinicalPlan | null;
}): { messages: AiModelMessage[]; meta: AiPromptMeta } => {
  const { included, filteredHistory } = sanitizeChatHistory({ userMessage, recentMessages });
  const clinicalPlanPrompt =
    clinicalPlan && isClinicalPlanPromptEnabled() ? formatClinicalPlanForPrompt(clinicalPlan) : null;
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
    ...(conversationContext
      ? [
          {
            role: "developer" as const,
            content: formatConversationContextForModel(conversationContext),
          },
        ]
      : []),
    ...(voiceConstraints
      ? [
          {
            role: "developer" as const,
            content: formatVoiceConstraintsForModel(voiceConstraints),
          },
        ]
      : []),
    ...(clinicalPlanPrompt
      ? [
          {
            role: "developer" as const,
            content: clinicalPlanPrompt,
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
      conversationContext: conversationContext ?? undefined,
      voiceConstraints: voiceConstraints ?? undefined,
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
  conversationContext,
  voiceConstraints,
  clinicalPlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
  conversationContext?: ConversationContext | null;
  voiceConstraints?: AiVoiceConstraints | null;
  clinicalPlan?: ClinicalPlan | null;
}): AiModelMessage[] => {
  return buildChatPrompt({
    userMessage,
    recentMessages,
    memoryContext,
    understandingContext,
    conversationContext,
    voiceConstraints,
    clinicalPlan,
  }).messages;
};
