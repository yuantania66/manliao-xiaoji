import { AiConversationMessage, AiMemoryContext, AiModelMessage, AiPromptMeta, AiVoiceConstraints } from "./types";
import { formatMemoryContextForPrompt } from "./dataLayers";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";
import { ConversationContext } from "@/conversation-os";
import type { ClinicalPlan } from "@/services/clinical/clinicalTypes";
import type { ResponsePlan } from "@/conversation-os/control";
import { ASSISTANT_GROUNDING, formatAssistantGroundingForPrompt } from "@/conversation-os/control";
import {
  explicitlyResumesPreGreetingHistory,
  isProactiveGreetingPromptVersion,
} from "@/lib/proactive-greeting";

export const CHAT_PROMPT_VERSION = "chat-response-plan-v26";
export const JUDGE_PROMPT_VERSION = "judge-disabled-v1";
export const REWRITE_PROMPT_VERSION = "rewrite-disabled-v1";
export const FALLBACK_PROMPT_VERSION = "fallback-v1";

export type ChatPromptEvaluationAdapter = {
  id: "exp-bl-012a-a1" | "exp-bl-012a-a2";
  developerInstructions: string[];
};

const toModelRole = (role: AiConversationMessage["role"]): AiModelMessage["role"] | null => {
  if (role === "user" || role === "assistant") return role;
  return null;
};

// LEGACY/FROZEN/DO NOT EXTEND:
// The Conversation OS strategy fields in this prompt are compatibility inputs only.
// Do not add new engageMode/experienceGoal/questionStyle strategy instructions here.
// Future response strategy must use ClinicalPlan.
const BASE_PRODUCT_PROMPT = [
  formatAssistantGroundingForPrompt(),
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
  "如果用户说随手打的、没什么、不知道聊什么、没做什么、没发生特别的事，就顺着这句话本身回应；不要追问原因，不要主动转到电影、音乐、游戏、天气闲聊，也不要建议喝茶、喝水、休息或出门。若后续的 Clinical Plan 明确标注 contentAvailability=no_topic、engagement=engaged/open、initiativeDirection=assistant_invited，则这不是沉默或退出：由助手接过一次轻量话题主动权，不要求用户先想出话题。",
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

const RESPONSE_PLAN_PRODUCT_PROMPT = [
  "始终用自然、简短的中文回应。",
  `你是一个${ASSISTANT_GROUNDING.availableFacts.assistant.kind}，稳定称呼是${ASSISTANT_GROUNDING.availableFacts.assistant.displayName}；${ASSISTANT_GROUNDING.availableFacts.product.name}只属于当前产品名称，不是你的称呼。除非 requiredDisclosure 要求，本轮不要主动介绍身份或能力。`,
  "Conversation OS 的 ResponsePlan 是本轮唯一的非安全回复决策。只实现该计划，不重新解释用户，不另选目标或策略。",
  "完成 responseActions 和 answerObligations；不得增添计划中没有、且无 relevanceProvenance 的命题。",
  "只说 groundingFacts 和 requiredDisclosure 中明确给出的事实。hypothesis 或被用户否定的命题不得作为事实表达。",
  "不要猜测技术失败、模型行为或系统状态的原因；只有 ResponsePlan 明确提供的 user-safe execution fact 才能说明。",
  "不要输出内部分类、计划、证据或推理过程。不要照抄计划措辞。",
  "匹配用户句长和口语语气；普通聊天直接、自然，不使用咨询或客服口吻。",
].join("\n");

const preview = (content: string) => {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
};

export const sanitizeChatHistory = ({
  recentMessages,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  const filteredHistory: AiPromptMeta["filteredHistory"] = [];
  const candidates = recentMessages.slice(-24);
  const filterReasons: Array<string | null> = candidates.map((message) => {
    const role = toModelRole(message.role);
    if (!role) return "unsupported_role";
    if (message.status === "blocked") return "uncommitted_or_blocked_event";
    return null;
  });

  const includedWithSource = candidates.flatMap((message, index) => {
    const reason = filterReasons[index];
    if (reason) {
      filteredHistory.push({
        role: message.role,
        reason,
        promptVersion: message.promptVersion,
        preview: preview(message.content),
      });
      return [];
    }

    const role = toModelRole(message.role);
    return role ? [{
      role,
      content: message.content,
      id: message.id,
      replyToMessageId: message.replyToMessageId,
    }] : [];
  });
  let selected = includedWithSource.slice(-8);
  const first = selected[0];
  if (first?.role === "assistant" && first.replyToMessageId) {
    const linkedUser = includedWithSource.find((item) => item.id === first.replyToMessageId);
    if (linkedUser && !selected.includes(linkedUser)) selected = [linkedUser, ...selected];
  }
  const included = selected.map(({ role, content }) => ({ role, content }));

  return { included, filteredHistory };
};

const scopeHistoryForResponsePlan = ({
  userMessage,
  recentMessages,
  responsePlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  responsePlan?: ResponsePlan | null;
}) => {
  const v1Handoff = responsePlan?.interactionMoveHandoffPlan;
  if (v1Handoff) {
    if (explicitlyResumesPreGreetingHistory(userMessage)) return recentMessages;
    const sourceIndex = recentMessages.findIndex((message) =>
      message.role === "assistant" &&
      message.id === v1Handoff.sourceAssistantMoveId
    );
    return sourceIndex >= 0 ? recentMessages.slice(sourceIndex) : [];
  }
  if (
    !responsePlan?.responseActions.includes("respond_to_proactive_greeting") ||
    explicitlyResumesPreGreetingHistory(userMessage)
  ) {
    return recentMessages;
  }
  const greetingIndex = recentMessages.findLastIndex(
    (message) =>
      message.role === "assistant" &&
      isProactiveGreetingPromptVersion(message.promptVersion)
  );
  return greetingIndex >= 0 ? recentMessages.slice(greetingIndex) : recentMessages;
};

const handoffSurfaceConstraintsFor = (responsePlan: ResponsePlan) => {
  const handoff = responsePlan.interactionMoveHandoffPlan;
  if (!handoff) return [];
  const common = [
    "Treat interactionMoveHandoffPlan as a required semantic function, not a label to repeat.",
    "Do not print or self-report planId, relation names, function names, completion intent, evidence offsets, or validation claims.",
    "The visible reply must address the specified source Assistant move and the current User relation.",
  ];
  const requiredFunctionConstraints: Record<typeof handoff.requiredFunction, string[]> = {
    complete_reciprocal_contact: [
      "这是语义组合算法，不是可见回复文案：源 Assistant 开场与当前 User reciprocal move 已经建立双方接触，当前用户的问候在这个交接中已经完成，Surface 不再对它作表层回应。",
      "可见回复必须把对话推进到寒暄之后：第一个且主要动作应是简短的陈述式过渡，预设交流已经开始，而不是再次建立、确认、提供或索取接触。",
      responsePlan.responseActions.length === 0
        ? "本轮 responseActions 为 none：完成上述 reciprocal 过渡后可以自然结束，也可以只问一个低压力的话题选择问题（例如询问用户今天想聊什么）；不得替用户指定话题、连续提问或要求解释，也不得表示在线、可用或愿意倾听。"
        : "先完成上述 reciprocal 陈述式过渡，再实现计划中仍然存在且有独立支持的 responseActions。",
      "这些句子只约束语义组合；不得复制、翻译、机械改写或向用户暴露本说明，尤其不得把接触已建立、交流已开始或正在过渡作为对用户的解释或自我报告。",
      "Do not replace that function with another greeting, receipt, echo, Assistant-presence confirmation, availability statement, or generic open door.",
    ],
    continue_from_user_answer: [
      "Receive and continue from only the answer content supported by the current User relation evidence.",
      "Do not open a second interview question.",
    ],
    continue_user_introduced_content: [
      "Continue the User-introduced or redirected content rather than returning to the greeting ritual.",
    ],
    answer_current_obligation: [
      "Answer the current scoped obligation before any optional continuation.",
    ],
    withdraw_or_repair_targeted_move: [
      "Withdraw or repair the targeted Assistant interaction move without defending, explaining, or repeating it.",
    ],
    respect_user_boundary: [
      "Respect the current User boundary and add no conversational pressure or continuation request.",
    ],
    defer_handoff_completion: [
      "Preserve uncertainty and provide only ordinary low-burden handling; do not claim or imply handoff completion.",
    ],
  };
  const questionConstraint = handoff.questionPolicy === "none"
    ? ["Do not semantically ask, request, invite, or otherwise seek another User response, whether or not punctuation is used."]
    : [
        "A maximum of one follow-up question is optional only after the required positive function is fully realized.",
        "That question is allowed only when an independently selected ordinary response action supports it; otherwise ask none.",
      ];
  return [...common, ...requiredFunctionConstraints[handoff.requiredFunction], ...questionConstraint];
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

const surfaceConstraintsFor = (responsePlan: ResponsePlan) => {
  const constraints: string[] = [];
  if (responsePlan.selectedEpisodeMemory) {
    constraints.push(
      "Use the selected episode memory only when it helps continue the current user meaning; it is optional material, not a mandatory topic or response action.",
      "Express any useful continuity naturally without exposing memory fields, retrieval, scores, source ids, or internal reasoning.",
      "Treat hypotheses and possible links only as exploration context. Never state an unconfirmed cause, motive, feeling, or relationship as fact."
    );
  }
  if (responsePlan.responseActions.includes("acknowledge_without_psychologizing")) {
    constraints.push(
      "Acknowledge only content explicit in the current user message.",
      "Do not add generic causal mechanisms, inferred benefits, positive reframing, or praise not expressed by the user."
    );
  }
  if (responsePlan.responseActions.includes("establish_assistant_identity")) {
    const contract = responsePlan.positiveFunctionContract?.action === "establish_assistant_identity"
      ? responsePlan.positiveFunctionContract
      : null;
    constraints.push(
      `Complete the assistant-identity function using the canonical displayName ${contract?.displayName ?? "小慢"} from requiredDisclosure.`,
      "Do not use the product name as the assistant's personal name, invent another name, claim to be nameless, or return only a greeting/receipt.",
      contract?.mode === "first_contact"
        ? "Make a brief self-introduction and offer one natural, low-pressure way into conversation; at most one question is allowed only if questionPolicy permits it."
        : contract?.mode === "identity_continuation"
          ? "Continue the exact committed identity claim the user affirmed; respond naturally to that continuity and, only if questionPolicy permits, ask at most one low-pressure question about the name itself."
          : "Repair the product/assistant identity mix-up and provide the canonical assistant display name in the same reply."
    );
  }
  if (responsePlan.responseActions.includes("respond_to_proactive_greeting")) {
    constraints.push(
      "Respond to the concrete content the user supplied after the greeting.",
      "A brief specific continuation is optional, but it must obey questionPolicy; never switch topics merely to keep the user answering.",
      "Treat the proactive greeting as a new surface-history boundary. Do not mention or resume content from before that greeting unless the current user message explicitly brings it back.",
      "Do not return an empty acknowledgement, a bare echo, generic approval, or a phrase that closes the exchange."
    );
  }
  if (responsePlan.responseActions.includes("take_light_topic_initiative")) {
    constraints.push(
      "Offer one neutral, concrete, low-burden topic entry.",
      "Do not add a reassurance or pause preface, and do not steer toward positive, healing, or gratitude framing."
    );
  }
  if (responsePlan.responseActions.includes("invite_low_pressure_calibration")) {
    constraints.push(
      "State only that the current meaning is still uncertain; do not assign a meaning to the message form.",
      "Ask exactly one low-pressure question about what the user wants the assistant to do next, not about what the message means.",
      "Never suggest that the input might be a test, probe, greeting, casual message, random typing, score, code, signal, or hidden meaning.",
      "Do not use reassurance, presence claims, receipt language, or a counselling reflection as a substitute for calibration."
    );
  }
  if (responsePlan.responseActions.includes("continue_established_frame")) {
    constraints.push(
      "Use the current message only inside the explicit immediately preceding answer frame.",
      "Complete that local exchange without adding a new question, inferred meaning, or unrelated topic.",
      "Do not return a bare receipt or presence statement."
    );
  }
  if (responsePlan.responseActions.includes("continue_established_thread")) {
    constraints.push(
      "Continue only the established current-session thread supported by the visible history.",
      "Add one concrete conversational function without a new question; do not infer meaning from the current message form.",
      "Do not return a bare receipt, echo, or presence statement."
    );
  }
  if (responsePlan.responseActions.includes("offer_neutral_conversation_entry")) {
    constraints.push(
      "Offer one concrete, neutral, low-burden conversation entry in statement form.",
      "Do not ask the user to explain, choose a topic, or answer another question.",
      "Do not use receipt, presence, reassurance, positive, healing, gratitude, or counselling framing."
    );
  }
  if (responsePlan.responseActions.includes("offer_emotional_support")) {
    const contract = responsePlan.positiveFunctionContract?.action === "offer_emotional_support"
      ? responsePlan.positiveFunctionContract
      : null;
    constraints.push(
      `Use only the turn-local affect or relational-impact spans in positiveFunctionContract; preserve each span's category, intensity, and object without strengthening it. Evidence spans: ${JSON.stringify(contract?.affectEvidenceSpans ?? [])}.`,
      `Complete exactly the selected ordinary support function: ${contract?.supportFunction ?? "missing_contract"}. This is a required conversational function, not a suggested phrase.`,
      "A receipt, paraphrase, generic invitation, generic presence claim, or statement about the assistant trying to understand is not sufficient support.",
      "Do not use formulaic presence, simulated contact, generic normalization, reassurance, or unsolicited regulation advice as the support function (for example: 'I am here', 'hug you', 'this is normal', or 'take a breath').",
      "Acknowledge the evidenced feeling without judging it as okay, acceptable, normal, natural, right, or wrong. Permission language must modify the user's expression choice, such as how much or how completely to speak, never the feeling itself.",
      "Do not intensify the user's affect, claim complete empathy, or foreground that the assistant cannot fully understand or is working hard to understand.",
      "Realize the selected support function as permission and user control, not as a requirement to continue. The reply is complete once it acknowledges the evidenced feeling and grants that control; no follow-up question is required.",
      "If a follow-up is allowed, keep it genuinely optional and low-burden. Do not ask a question merely to keep the exchange moving, and do not ask for the cause, triggering event, details, or full story by default.",
      "Keep every focus option inside content already evidenced in the current user turn. Do not offer unspecified 'something else', another topic, mood-changing content, distraction, or additional unmentioned causes/events as an alternative.",
      "Releasing an expression burden is not a pause or closure. Do not tell the user to wait, remain with the feeling, continue later, stay quiet, rest, calm down, or set the issue aside unless the user asked for that option.",
      "When the user challenges the assistant but the plan has no supported correction target, acknowledge the current impact without inventing missing prior context, claiming a completed repair, or making the user diagnose the assistant's mistake."
    );
    if (contract?.supportFunction === "reduce_expression_burden") {
      constraints.push(
        "Allowed operation only: lower the pressure to analyze, explain the cause, organize a complete account, or express the experience fully. State that one of those expression burdens is not required, then end the reply.",
        "Forbidden operation: do not add a pause, wait, deferral, silence, or interaction ending. Do not tell the user to stay with the feeling, leave it aside, continue later, or resume when ready.",
        "Keep the semantic boundary explicit: removing an analysis or expression obligation completes this function; postponing the conversation or prescribing what the user should do next is a different action and is outside this plan."
      );
    } else if (contract?.supportFunction === "return_focus_control") {
      constraints.push(
        "Give the user control over which already-mentioned part to express first without requiring the user to choose or answer. Make the controllable focus concrete; 'chat if you want' or 'at your pace' alone does not complete this function.",
        "Use one current-focus control construction. Do not manufacture an A-or-B choice by adding a second topic, event, cause, moment, pause, or unspecified alternative; one invitation bounded to the evidenced current feeling or part is complete."
      );
    } else if (contract?.supportFunction === "return_amount_control") {
      constraints.push(
        "Give the user control over how much to express; explicitly allow a partial or unfinished account without asking for the whole story. Amount control governs expression quantity only. Keep the feeling acknowledgement descriptive, and attach any 'okay/allowed' wording specifically to saying less, stopping before a complete account, or another expression-quantity choice. The quantity permission is complete on its own: do not turn it into a question, require the user to state an amount, add a content or focus choice, or offer another subject as an alternative."
      );
    } else if (contract?.supportFunction === "acknowledge_current_relational_impact") {
      constraints.push(
        "Acknowledge only the current relational impact and the lack of a supported correction target. Do not claim a completed repair or ask the user to diagnose the assistant."
      );
    }
  }
  if (responsePlan.responseActions.includes("repair_previous_wording")) {
    const contract = responsePlan.positiveFunctionContract?.action === "repair_previous_wording"
      ? responsePlan.positiveFunctionContract
      : null;
    constraints.push(
      `Complete the selected repair mode: ${contract?.repairMode ?? "missing_contract"}. Own the assistant's specific prior move before doing anything else.`,
      "Do not defend the previous reply, restate the rejected proposition, or ask the user to identify where the assistant went wrong.",
      "Do not claim the relationship is repaired. Complete only the current repair action and preserve the user's choice about whether to continue."
    );
    if (contract?.repairMode === "factual_replacement") {
      constraints.push(
        `Own the factual mix-up and use only the user-confirmed replacement fact: ${contract.replacementFact ?? "missing replacement"}. An additional fixed word such as 'withdraw' is not required.`
      );
    } else if (contract?.repairMode === "proposition_withdrawal") {
      constraints.push(
        `Explicitly withdraw or stop using the rejected proposition from the targeted assistant move: ${contract.targetText || "targeted prior wording"}. A vague apology or 'I misunderstood' alone is incomplete.`
      );
    } else if (contract?.repairMode === "interaction_move_withdrawal") {
      constraints.push(
        `The rejected interaction-move subtype is ${contract.interactionMoveSubtype ?? "missing_subtype"}. Use concrete action evidence from the targeted prior move—${contract.targetText || "targeted prior move"}—to own and functionally reject that same move. A natural statement that the evidenced move was wrong, ineffective, off-focus, or out of bounds is sufficient; do not mechanically repeat the internal subtype name or require a fixed stop/withdraw token. Do not replace it with another question, suggestion, reassurance, or listening promise.`
      );
    }
    if (responsePlan.requiredDisclosure.some((item) =>
      item.includes("是当前产品名称，不是助手称呼")
    )) {
      constraints.push(
        "This repair must distinguish the product name 慢聊小记 from the Assistant display name 小慢 and provide 小慢 as the canonical replacement; do not claim the Assistant has no name."
      );
    }
  }
  if (responsePlan.questionPolicy.mode === "none") {
    constraints.push("Do not ask a question or append an interview-style follow-up.");
  } else if (responsePlan.questionPolicy.mode === "optional_after_answer") {
    constraints.push("If you ask a follow-up, ask at most one question and keep it specific to the current user message.");
  }
  return constraints;
};

const projectRelevanceProvenanceForSurface = (responsePlan: ResponsePlan) =>
  responsePlan.relevanceProvenance.map((item) => ({
    planElement: item.planElement,
    source: item.source,
    ...(item.sourceTurnId ? { sourceTurnId: item.sourceTurnId } : {}),
    evidence: item.evidence.filter((evidence) => evidence.startsWith("currentUserMessage=")),
  }));

export const formatResponsePlanForPrompt = (responsePlan: ResponsePlan) => {
  const surfaceConstraints = [
    ...surfaceConstraintsFor(responsePlan),
    ...handoffSurfaceConstraintsFor(responsePlan),
  ];
  const common = [
    "【Conversation OS ResponsePlan】",
    "This plan is the single decision authority for this non-safety turn. Surface realization must not re-plan it.",
    `planId: ${responsePlan.planId}`,
    `decisionOwner: ${responsePlan.decisionOwner}`,
    `planningDepth: ${responsePlan.planningDepth}`,
    `responseActions: ${responsePlan.responseActions.join(" / ") || "none"}`,
    `groundingFacts: ${responsePlan.groundingFacts.join(" / ") || "none"}`,
    `requiredDisclosure: ${responsePlan.requiredDisclosure.join(" / ") || "none"}`,
    `positiveFunctionContract: ${responsePlan.positiveFunctionContract ? JSON.stringify(responsePlan.positiveFunctionContract) : "none"}`,
    `interactionMoveHandoffPlan: ${responsePlan.interactionMoveHandoffPlan ? JSON.stringify(responsePlan.interactionMoveHandoffPlan) : "none"}`,
    `questionPolicy: ${responsePlan.questionPolicy.mode}`,
    `closurePolicy: ${responsePlan.closurePolicy.mode}`,
    `tone: ${responsePlan.tone.join(" / ")}`,
    `stance: ${responsePlan.stance.join(" / ")}`,
    `lengthGuidance: ${responsePlan.lengthGuidance}`,
    `selectedEpisodeMemory: ${responsePlan.selectedEpisodeMemory ? JSON.stringify({
      summary: compactMemory(responsePlan.selectedEpisodeMemory.summary),
      people: responsePlan.selectedEpisodeMemory.people.slice(0, 6),
      topics: responsePlan.selectedEpisodeMemory.topics.slice(0, 6),
      emotions: responsePlan.selectedEpisodeMemory.emotions.slice(0, 4),
      openThreads: responsePlan.selectedEpisodeMemory.openThreads.slice(0, 4).map(compactMemory),
      confirmedFacts: responsePlan.selectedEpisodeMemory.confirmedFacts.slice(0, 6).map(compactMemory),
      hypotheses: responsePlan.selectedEpisodeMemory.hypotheses.slice(0, 4).map(compactMemory),
      occurredAt: responsePlan.selectedEpisodeMemory.occurredAt,
    }) : "none"}`,
    `relevanceProvenance: ${JSON.stringify(projectRelevanceProvenanceForSurface(responsePlan))}`,
    `surfaceConstraints: ${surfaceConstraints.join(" / ") || "none"}`,
    `prohibitedClaims: ${responsePlan.prohibitedClaims.join(" / ")}`,
    `safetyConstraints: ${responsePlan.safetyConstraints.join(" / ") || "none"}`,
  ];
  const obligationContract = responsePlan.answerObligations.length
    ? [`answerObligations: ${JSON.stringify(responsePlan.answerObligations.map((item) => ({
        sourceTurnId: item.sourceTurnId,
        question: item.question,
        kind: item.kind,
      })))}`]
    : [];
  const deepContract = responsePlan.planningDepth === "deep" && responsePlan.clinicalStrategy
    ? [
        `clinicalStrategy: ${JSON.stringify({
          intent: responsePlan.clinicalStrategy.intent,
          questionFunction: responsePlan.clinicalStrategy.questionFunction,
          toneConstraints: responsePlan.clinicalStrategy.toneConstraints,
          interventionBoundaries: responsePlan.clinicalStrategy.interventionBoundaries,
        })}`,
      ]
    : [];
  return [
    ...common,
    ...obligationContract,
    ...deepContract,
    "Realize the plan as one natural user-facing reply. Do not mention ResponsePlan.",
  ].join("\n");
};

const formatInteractionDecisionForPrompt = (clinicalPlan: ClinicalPlan) => {
  const interaction = clinicalPlan.interaction;
  return [
    "【Interaction Decision】",
    "This is a structured conversation decision, not a reply template.",
    `contentAvailability: ${interaction.contentAvailability}`,
    `engagement: ${interaction.engagement}`,
    `initiativeDirection: ${interaction.initiativeDirection}`,
    `affect: ${interaction.affect}`,
    `stopIntent: ${interaction.stopIntent}`,
    `evidence: ${formatList(interaction.evidence)}`,
  ];
};

const getActionSupportElements = (clinicalPlan: ClinicalPlan) =>
  [...clinicalPlan.toneConstraint, ...clinicalPlan.interventionBoundary, ...clinicalPlan.rationale].filter((item) =>
    /actionSupportElement:\s*(concrete step|option set|wording frame|sorting scaffold|decision frame)/.test(item)
  );

export const formatClinicalPlanForPrompt = (clinicalPlan: ClinicalPlan) => {
  if (clinicalPlan.primaryStrategy !== "rogers") return null;

  if (clinicalPlan.responseGoal === "support_action") {
    const actionSupportElements = getActionSupportElements(clinicalPlan);
    if (actionSupportElements.length === 0) return null;

    return [
      "【Clinical Plan】",
      "This is a minimal response-goal instruction. It is not a reply template.",
      "Render only the action-support contract already present in ClinicalPlan.",
      "Do not invent new Strategy behavior here.",
      `responseGoal: ${clinicalPlan.responseGoal}`,
      `responseIntent: ${clinicalPlan.responseIntent}`,
      `primaryStrategy: ${clinicalPlan.primaryStrategy}`,
      `questionFunction: ${clinicalPlan.questionFunction}`,
      `toneConstraint: ${formatList(clinicalPlan.toneConstraint)}`,
      `interventionBoundary: ${formatList(clinicalPlan.interventionBoundary)}`,
      `safetyNotes: ${formatList(clinicalPlan.safetyNotes)}`,
      `actionSupportElements: ${actionSupportElements.join(" / ")}`,
      "Goal: provide one small, optional, user-adjustable action-support element.",
      "The action-support element may be a concrete next step, option set, wording frame, sorting scaffold, or decision frame.",
      "Do not decide for the user.",
      "Do not create a large plan.",
      "Do not retreat into pure reflection when the plan already contains a safe action-support element.",
      "Do not diagnose, assess pathology, or propose a treatment plan.",
      ...formatInteractionDecisionForPrompt(clinicalPlan),
    ].join("\n");
  }

  if (clinicalPlan.responseGoal === "hold_space") {
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
      "Goal: respect an explicit request to lower interaction, or lower pressure only where explicit distress or fatigue evidence exists.",
      "Do not turn no_topic alone into a request for silence. Do not ask a follow-up question when stopIntent is true.",
      "Do not diagnose, assess pathology, or propose a treatment plan.",
      ...formatInteractionDecisionForPrompt(clinicalPlan),
    ].join("\n");
  }

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
    ...(clinicalPlan.responseIntent === "initiate_topic"
      ? [
          "Goal: take one light, low-pressure topic initiative because the user has no topic but remains engaged.",
          "Do not treat no_topic as withdrawal, low mood, a wish for silence, or a request for the user to explain themselves.",
          "Do not ask the user to choose or invent a topic before you offer the light entry.",
        ]
      : [
          "Goal: help the user continue expressing themselves.",
          "Do not only say it is okay and end the reply.",
          "You may gently invite the user to say one first word, image, feeling, or body sensation that comes up.",
          "Do not require the user to organize a complete thought.",
        ]),
    "Do not diagnose, assess pathology, or propose a treatment plan.",
    "Do not force advice.",
    ...formatInteractionDecisionForPrompt(clinicalPlan),
  ].join("\n");
};

const shouldRenderClinicalPlanForPrompt = (clinicalPlan: ClinicalPlan) =>
  isClinicalPlanPromptEnabled() ||
  clinicalPlan.interaction.contentAvailability === "no_topic" ||
  clinicalPlan.interaction.stopIntent ||
  (clinicalPlan.responseGoal === "hold_space" && clinicalPlan.interaction.affect === "negative");

export const buildChatPrompt = ({
  userMessage,
  recentMessages,
  memoryContext,
  understandingContext,
  conversationContext,
  voiceConstraints,
  clinicalPlan,
  evaluationAdapter,
  semanticEvidenceRegenerateConstraint,
  responsePlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
  conversationContext?: ConversationContext | null;
  voiceConstraints?: AiVoiceConstraints | null;
  clinicalPlan?: ClinicalPlan | null;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
  semanticEvidenceRegenerateConstraint?: string | null;
  responsePlan?: ResponsePlan | null;
}): { messages: AiModelMessage[]; meta: AiPromptMeta } => {
  const scopedRecentMessages = scopeHistoryForResponsePlan({
    userMessage,
    recentMessages,
    responsePlan,
  });
  const { included, filteredHistory } = sanitizeChatHistory({
    userMessage,
    recentMessages: scopedRecentMessages,
  });
  const clinicalPlanPrompt =
    clinicalPlan && shouldRenderClinicalPlanForPrompt(clinicalPlan) ? formatClinicalPlanForPrompt(clinicalPlan) : null;
  const messages: AiModelMessage[] = [
    {
      role: "developer",
      content: responsePlan ? RESPONSE_PLAN_PRODUCT_PROMPT : BASE_PRODUCT_PROMPT,
    },
    ...(evaluationAdapter
      ? [
          {
            role: "developer" as const,
            content: [
              `Eval-only registered adapter: ${evaluationAdapter.id}.`,
              "These instructions apply only to this controlled trajectory evaluation.",
              ...evaluationAdapter.developerInstructions,
            ].join("\n"),
          },
        ]
      : []),
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
    ...(!responsePlan && conversationContext
      ? [
          {
            role: "developer" as const,
            content: formatConversationContextForModel(conversationContext),
          },
        ]
      : []),
    ...(!responsePlan && voiceConstraints
      ? [
          {
            role: "developer" as const,
            content: formatVoiceConstraintsForModel(voiceConstraints),
          },
        ]
      : []),
    ...(!responsePlan && clinicalPlanPrompt
      ? [
          {
            role: "developer" as const,
            content: clinicalPlanPrompt,
          },
        ]
      : []),
    ...(responsePlan
      ? [{ role: "developer" as const, content: formatResponsePlanForPrompt(responsePlan) }]
      : []),
    ...(semanticEvidenceRegenerateConstraint
      ? [
          {
            role: "developer" as const,
            content: semanticEvidenceRegenerateConstraint,
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
      responsePlan: responsePlan ?? undefined,
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
  evaluationAdapter,
  semanticEvidenceRegenerateConstraint,
  responsePlan,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  memoryContext?: AiMemoryContext | null;
  understandingContext?: StructuredRagContext | null;
  conversationContext?: ConversationContext | null;
  voiceConstraints?: AiVoiceConstraints | null;
  clinicalPlan?: ClinicalPlan | null;
  evaluationAdapter?: ChatPromptEvaluationAdapter | null;
  semanticEvidenceRegenerateConstraint?: string | null;
  responsePlan?: ResponsePlan | null;
}): AiModelMessage[] => {
  return buildChatPrompt({
    userMessage,
    recentMessages,
    memoryContext,
    understandingContext,
    conversationContext,
    voiceConstraints,
    clinicalPlan,
    evaluationAdapter,
    semanticEvidenceRegenerateConstraint,
    responsePlan,
  }).messages;
};
