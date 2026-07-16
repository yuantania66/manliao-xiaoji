import type { ClinicalMemoryContext } from "@/services/ai/clinicalMemoryAdapter";
import type { AiConversationMessage } from "@/services/ai/types";
import type { ConversationState } from "@/conversation-os/state";

import type {
  ClinicalAmbiguityLevel,
  ClinicalConversationSignals,
  ClinicalContext,
  ClinicalCurrentUnderstanding,
  ClinicalEmotionalIntensity,
  ClinicalMessageLength,
  ClinicalSignals,
  ResponseGoal,
} from "./clinicalTypes";
import { derivePersonCenteredGateEvidence } from "./personCenteredInterventionGate";

const emptyUnderstanding = (): ClinicalCurrentUnderstanding => ({
  event: [],
  emotion: [],
  meaning: [],
  need: [],
  relationship: [],
  goal: [],
  conflict: [],
  unknown: [],
});

const getAmbiguityLevel = (userTurn: string): ClinicalAmbiguityLevel => {
  const text = userTurn.trim();
  if (!text) return "high";
  if (/^([0-9０-９]+|[a-zA-Z]|[^\s\p{L}\p{N}]|嗯+|啊+|哦+)$/u.test(text)) return "high";
  if (/不知道|说不清|不确定|有点乱|不太想说|要不要说/.test(text)) return "medium";
  return "low";
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const EXPRESSION_DIFFICULTY_PATTERN =
  /不知道(说什么|想说什么|怎么说|怎么讲|从哪说|从哪里说|从哪开始|从哪里开始|该不该说|要不要说)|不知(从哪说|从哪里说|从哪开始|从哪里开始)|说不出来|讲不出来|开不了口|不知道怎么开口|想说但说不出来|想说又不想说|卡住了|(?:我也|我)?说不清.*(?:感受|感觉|心里|难受)|想继续说.*(?:但是|但|又).*(?:不太想|又不想)说|(?:^|[，。！？!?])(?:我)?(?:脑子|脑袋)(?:很|有点)?乱(?:[。！？!?]|$)/;

const EXPLICIT_ADVICE_REQUEST_PATTERN =
  /给我.*建议|给点建议|一些建议|有.*建议|需要.*建议|帮我.*(想|看看|处理|解决|判断|决定|理一下)|怎么办|怎么做|怎么开口|如何开口|开口.*比较好|该怎么|我该|先做什么|该先做什么|能做什么|能不能.*建议|可以.*建议/;

const REPORTED_ADVICE_CONTEXT_PATTERN =
  /(他说|她说|他们说|她们说|朋友说|同事说|领导说|妈妈说|爸爸说|别人|有人|他问|她问|他们问|她们问|问我|曾问|当时.*问).{0,24}(怎么办|怎么做|该怎么|先做什么|能做什么|怎么开口)/;

const isExplicitAdviceRequest = (text: string) =>
  EXPLICIT_ADVICE_REQUEST_PATTERN.test(text) && !REPORTED_ADVICE_CONTEXT_PATTERN.test(text);

const HIGH_EMOTIONAL_INTENSITY_PATTERN =
  /崩|撑不住|喘不过气|受不了|扛不住|难受死|痛苦|害怕|焦虑|慌|绝望|崩溃/;

const MEDIUM_EMOTIONAL_INTENSITY_PATTERN =
  /累|疲惫|难受|委屈|崩|烦|焦虑|害怕|生气|难过|压力|撑不住/;

const getMessageLength = (text: string): ClinicalMessageLength => {
  if (text.length <= 12) return "SHORT";
  if (text.length >= 80) return "LONG";
  return "MEDIUM";
};

const getEmotionalIntensity = (text: string): ClinicalEmotionalIntensity => {
  if (!text) return "UNKNOWN";
  if (HIGH_EMOTIONAL_INTENSITY_PATTERN.test(text)) return "HIGH";
  if (MEDIUM_EMOTIONAL_INTENSITY_PATTERN.test(text)) return "MEDIUM";
  return "LOW";
};

const getConversationStage = (turnCount: number): ClinicalSignals["conversationStage"] => {
  if (turnCount <= 1) return "OPENING";
  if (turnCount <= 3) return "EXPLORING";
  return "CONTINUING";
};

export const createEmptyClinicalSignals = (): ClinicalSignals => ({
  messageLength: "SHORT",
  expressionDifficulty: false,
  explicitAdviceRequest: false,
  emotionalIntensity: "UNKNOWN",
  hasPreviousAssistantReply: false,
  conversationStage: "OPENING",
  memoryAvailability: {
    hasUnderstanding: false,
    hasRelationship: false,
    hasTimeline: false,
    hasSemanticMemory: false,
  },
});

export const deriveClinicalConversationSignals = (userTurn: string): ClinicalConversationSignals => ({
  userCorrectedAi: /不是这个意思|不是这意思|你没懂|你没理解|你理解错|你说错|你是不是.*(没懂|没理解)/.test(
    userTurn
  ),
  userWantsPause: /算了|先不说了|不说了|不聊了|暂停|先这样/.test(userTurn),
  userRequestsHelp: /帮我|怎么办|怎么做|给我.*建议|需要.*建议/.test(userTurn),
  userRequestsSummary: /梳理|总结|复盘|整理一下|理一下/.test(userTurn),
  userExpressesUncertainty: /不知道|不确定|说不清|有点乱|不太懂自己/.test(userTurn),
  userExpressesEmotion: /累|疲惫|难受|委屈|崩|烦|焦虑|害怕|生气|难过|压力|撑不住/.test(userTurn),
  ambiguityLevel: getAmbiguityLevel(userTurn),
});

const buildClinicalSignals = ({
  userTurn,
  previousAssistantMessage,
  turnCount,
  memoryContext,
}: {
  userTurn: string;
  previousAssistantMessage?: string | null;
  turnCount: number;
  memoryContext: ClinicalMemoryContext;
}): ClinicalSignals => {
  const text = normalize(userTurn);

  return {
    messageLength: getMessageLength(text),
    expressionDifficulty: EXPRESSION_DIFFICULTY_PATTERN.test(text),
    explicitAdviceRequest: isExplicitAdviceRequest(text),
    emotionalIntensity: getEmotionalIntensity(text),
    hasPreviousAssistantReply: Boolean(previousAssistantMessage),
    conversationStage: getConversationStage(turnCount),
    memoryAvailability: {
      hasUnderstanding: memoryContext.understandings.length > 0,
      hasRelationship: memoryContext.relationships.length > 0,
      hasTimeline: memoryContext.timelineEvents.length > 0,
      hasSemanticMemory: memoryContext.semanticMemories.length > 0,
    },
  };
};

export const buildClinicalContext = ({
  conversationId,
  userId = "anonymous",
  userTurn,
  recentTurns,
  memoryContext,
  conversationState,
  safetyNotes = [],
  currentResponseGoal = null,
  previousResponseGoal = null,
  safetyTriggered = false,
  safetyLevel = "none",
  locale = "zh-CN",
  timezone = "Asia/Shanghai",
  channel = "chat",
  includePersonCenteredEvidence = false,
}: {
  conversationId: string;
  userId?: string;
  userTurn: string;
  recentTurns: AiConversationMessage[];
  memoryContext: ClinicalMemoryContext;
  conversationState: ConversationState;
  safetyNotes?: string[];
  currentResponseGoal?: ResponseGoal | null;
  previousResponseGoal?: ResponseGoal | null;
  safetyTriggered?: boolean;
  safetyLevel?: ClinicalContext["safety"]["safetyLevel"];
  locale?: string;
  timezone?: string;
  channel?: string;
  includePersonCenteredEvidence?: boolean;
}): ClinicalContext => {
  const previousAssistantMessage =
    [...recentTurns].reverse().find((turn) => turn.role === "assistant")?.content ?? null;
  const turnCount = recentTurns.length + 1;
  const conversationSignals = deriveClinicalConversationSignals(userTurn);
  const signals = buildClinicalSignals({
    userTurn,
    previousAssistantMessage,
    turnCount,
    memoryContext,
  });

  return {
    conversation: {
      currentUserMessage: userTurn,
      previousAssistantMessage,
      turnCount,
      state: conversationState,
    },
    memory: {
      understandings: memoryContext.understandings,
      relationships: memoryContext.relationships,
      timelineEvents: memoryContext.timelineEvents,
      semanticMemories: memoryContext.semanticMemories,
    },
    session: {
      currentResponseGoal,
      previousResponseGoal,
    },
    safety: {
      safetyTriggered,
      safetyLevel,
    },
    meta: {
      locale,
      timezone,
      channel,
    },
    signals,
    ...(includePersonCenteredEvidence
      ? {
          personCenteredEvidence: derivePersonCenteredGateEvidence({
            currentUserMessage: userTurn,
            recentMessages: recentTurns,
            legacyAdviceSignal: signals.explicitAdviceRequest,
          }),
        }
      : {}),
    conversationId,
    userId,
    userTurn,
    recentTurns,
    currentUnderstanding: emptyUnderstanding(),
    memoryContext,
    conversationSignals,
    safetyNotes,
  };
};
