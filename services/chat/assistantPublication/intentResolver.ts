/**
 * P2 preview turn intent — discourse-structure understanding, not reply micro-rules.
 * Reuses Conversation OS deterministic interpret when useful; adds relation-to-prior for soft ack.
 */

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  type ResponsePlan,
  type TurnInterpretation,
} from "@/conversation-os/control";
import { determineConversationState } from "@/conversation-os/state";
import type { AiConversationMessage } from "@/services/ai/types";

import type { ChatTurnSnippet } from "./assistantIdentity";

export type P2IntentKind =
  | "acknowledge_prior_offer"
  | "ask_assistant_name"
  | "rename_assistant"
  | "ask_identity"
  | "share"
  | "yield_or_no_topic"
  | "request_answer"
  | "other";

export type P2TurnIntent = {
  kind: P2IntentKind;
  posture: string;
  evidence: string[];
  primaryDialogueAct: string | null;
  responseActions: string[];
};

const SHORT_ACK =
  /^(?:好的哇|好的呀|好的|好呀|好啊|嗯嗯|嗯|行|可以|哦|喔|知道了|明白了)[。.!！？?\s]*$/u;

const PRIOR_CLOSING_OR_AVAILABILITY =
  /安静|待着|随时|需要我|叫我|不说也|没什么.*也|先这样|我在这/u;

function toAiMessages(recent: ChatTurnSnippet[]): AiConversationMessage[] {
  return recent
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content);
}

function priorAssistant(recent: ChatTurnSnippet[]): string {
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]?.role === "assistant") return recent[i].content;
  }
  return "";
}

function looksLikeNameQuestion(text: string): boolean {
  return /^(?:那你)?(?:到底)?(?:你|您)?叫什么(?:名字)?[呀啊呢吗]?[？?]?$/u.test(
    text.trim(),
  );
}

function looksLikeIdentityQuestion(text: string): boolean {
  return /^(?:你|您)(?:到底)?(?:是谁|是什么)(?:吗)?[？?。！!]*$/u.test(text.trim());
}

/**
 * Resolve intent for one P2 preview turn.
 */
export function resolveP2TurnIntent(args: {
  userText: string;
  recentMessages?: ChatTurnSnippet[];
  renamedThisTurn?: boolean;
}): P2TurnIntent {
  const userText = args.userText.trim();
  const recent = args.recentMessages ?? [];
  const evidence: string[] = [];

  if (args.renamedThisTurn) {
    return {
      kind: "rename_assistant",
      posture:
        "用户正在给你起称呼：接受并沿用新称呼，简短自然，不要事后否认。",
      evidence: ["rename_extractor"],
      primaryDialogueAct: null,
      responseActions: [],
    };
  }

  if (looksLikeNameQuestion(userText)) {
    return {
      kind: "ask_assistant_name",
      posture: "用户在问你的称呼：直接用当前稳定称呼回答，不要跑题。",
      evidence: ["name_question_form"],
      primaryDialogueAct: "ask_identity",
      responseActions: ["answer_directly"],
    };
  }

  if (looksLikeIdentityQuestion(userText)) {
    return {
      kind: "ask_identity",
      posture: "用户在问你是谁：说明你是 AI 聊天助手与当前称呼，不冒充医生。",
      evidence: ["identity_question_form"],
      primaryDialogueAct: "ask_identity",
      responseActions: ["answer_directly"],
    };
  }

  const prior = priorAssistant(recent);
  if (prior && SHORT_ACK.test(userText) && PRIOR_CLOSING_OR_AVAILABILITY.test(prior)) {
    evidence.push("short_ack_after_closing_or_availability_offer");
    return {
      kind: "acknowledge_prior_offer",
      posture:
        "用户在应和上一轮的收束/陪伴邀请，表示接住了你刚才的话，而不是在重新找你、也不是在开新话题。顺着上一轮已经给出的姿态轻轻承接即可；不要把这轮理解成需要再次证明你还在、需要重新发出邀请的请求。",
      evidence,
      primaryDialogueAct: "acknowledge",
      responseActions: ["acknowledge_without_psychologizing"],
    };
  }

  // Conversation OS deterministic layer (when it adds signal).
  let interpretation: TurnInterpretation | null = null;
  let plan: ResponsePlan | null = null;
  try {
    const recentAi = toAiMessages(recent);
    const conversationState = determineConversationState({
      currentUserMessage: userText,
      recentMessages: recentAi,
    });
    const context = assembleConversationControlContext({
      conversationId: "p2-preview",
      userMessage: userText,
      recentMessages: recentAi,
      conversationState,
    });
    interpretation = interpretTurnDeterministically(context);
    const dialogueState = buildDialogueState(context, interpretation);
    plan = createResponsePlan({
      context,
      interpretation,
      dialogueState,
      clinicalAdviceProvider: () => ({
        strategy: "none",
        intent: "none",
        questionFunction: "none",
        toneConstraints: [],
        interventionBoundaries: ["no diagnosis"],
        evidence: ["p2-preview-disabled-clinical"],
      }),
    });
    evidence.push(`os_act=${interpretation.primaryDialogueAct}`);
  } catch (error) {
    evidence.push(
      `os_unavailable:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const act = interpretation?.primaryDialogueAct ?? null;
  const actions = plan?.responseActions ?? [];

  if (act === "yield_initiative" || actions.includes("take_light_topic_initiative")) {
    return {
      kind: "yield_or_no_topic",
      posture:
        "用户暂无明确话题或在让出主动：轻量陪伴即可，不要审讯式追问。",
      evidence,
      primaryDialogueAct: act,
      responseActions: actions,
    };
  }

  if (
    interpretation?.responseRelation?.candidates?.some(
      (c) => c.relation === "requests_answer",
    )
  ) {
    return {
      kind: "request_answer",
      posture: "用户在请求回答：先直接回应所问，再决定是否轻轻延展。",
      evidence,
      primaryDialogueAct: act,
      responseActions: actions,
    };
  }

  if (act === "share" || actions.includes("acknowledge_without_psychologizing")) {
    return {
      kind: "share",
      posture:
        "用户在分享或表达：先理解这句话在对话中的用意，再自然简短回应。",
      evidence,
      primaryDialogueAct: act,
      responseActions: actions,
    };
  }

  return {
    kind: "other",
    posture: "先理解用户这句话在对话里的意图，再自然简短回应。",
    evidence,
    primaryDialogueAct: act,
    responseActions: actions,
  };
}

export function buildIntentAwareSystemPrompt(args: {
  basePrompt: string;
  intent: P2TurnIntent;
}): string {
  return [
    args.basePrompt,
    `本轮意图：${args.intent.kind}。`,
    `回应姿态：${args.intent.posture}`,
  ].join("");
}
