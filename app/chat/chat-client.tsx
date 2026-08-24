"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CalendarDays, Search } from "lucide-react";

import type { CommittedAssistantMoveEnvelopeV1 } from "@/conversation-os";
import { apiRequest, ClientApiError } from "@/lib/client-api";
import { clearAuth, getStoredAuth, saveAuth } from "@/lib/client-auth";
import { createClientTurnId } from "@/lib/client-turn-id";
import {
  advanceChatSessionAuthority,
  canApplyChatSessionResult,
  canApplyChatTurnResult,
  createChatTurnAuthorityState,
  resolveChatTurnResult,
  submitChatTurnAuthority,
  type ChatTurnAuthorityState,
  type ChatTurnResultAuthority,
} from "@/lib/chat-turn-result-authority";
import {
  appendGuestRecentGreeting,
  collapseConsecutiveGuestGreetings,
  guestProactiveGreetingKind,
  parseGuestRecentGreetings,
} from "@/lib/guest-proactive-greeting";
import { isProactiveGreetingPromptVersion } from "@/lib/proactive-greeting";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  promptVersion?: string | null;
  interactionMoveEnvelope?: CommittedAssistantMoveEnvelopeV1 | null;
  debugTrace?: AiDebugTrace;
};

type ExecutionSystemStatus = {
  type: "system_status";
  code: string;
  message: string;
  retryable: boolean;
  turnId: string;
};

type TurnScopedExecutionStatus = ExecutionSystemStatus & {
  inputText: string;
  isGuest: boolean;
  authority: ChatTurnResultAuthority;
};

type AsyncTurnCompletionPath =
  | "guest-submit-failure"
  | "guest-submit-success"
  | "guest-submit-transport"
  | "auth-submit-failure"
  | "auth-submit-success"
  | "auth-submit-transport"
  | "guest-retry-failure"
  | "guest-retry-success"
  | "guest-retry-transport"
  | "auth-retry-failure"
  | "auth-retry-success"
  | "auth-retry-transport";

type AiDebugTrace = {
  visibleSteps: string[];
  thinkingLayers?: {
    title: string;
    body: string;
    evidence: string[];
  }[];
  clinicalLogic?: {
    skippedBySafety: boolean;
    conversationState: string;
    safetyDecision?: {
      level: string;
      routedToSafety: boolean;
      notes: string[];
    };
    inputSignals: {
      userCorrectedAi: boolean;
      userWantsPause: boolean;
      userRequestsHelp: boolean;
      userRequestsSummary: boolean;
      userExpressesUncertainty: boolean;
      userExpressesEmotion: boolean;
      ambiguityLevel: string;
    };
    signals?: {
      messageLength: string;
      expressionDifficulty: boolean;
      explicitAdviceRequest: boolean;
      emotionalIntensity: string;
      hasPreviousAssistantReply: boolean;
      conversationStage: string;
      memoryAvailability: {
        hasUnderstanding: boolean;
        hasRelationship: boolean;
        hasTimeline: boolean;
        hasSemanticMemory: boolean;
      };
    };
    memoryUsed: {
      understandings: string[];
      relationships: string[];
      timelineEvents: string[];
    };
    memoryExcluded: {
      rawMemory: "not_allowed";
      deterministicMemoryCaveat: string[];
    };
    selectedPlan?: {
      responseIntent: string;
      primaryStrategy: string;
      secondaryStrategies: string[];
      questionFunction: string;
      toneConstraint: string[];
      interventionBoundary: string[];
      safetyNotes: string[];
      rationale: string[];
    };
  };
  prompt?: {
    mode: string;
    promptVersion: string;
    receivedHistoryCount: number;
    includedHistoryCount: number;
    filteredHistoryCount: number;
    memoryIncluded: boolean;
    memorySource?: string;
    memoryLayer?: string;
    memoryTrust?: string;
    conversationContext?: {
      conversationId: string;
      latestNotice: {
        observations: { text: string }[];
      };
      understanding: {
        unknowns: { text: string }[];
      };
      responseGoal: {
        experienceGoal?: string[];
        engageMode?: string;
        policyReason?: string;
        questionStyle?: {
          purpose: string;
          avoid: string[];
          northStar: string;
        };
        userExperience: string[];
        languageConstraint: string[];
      };
    };
    conversationOrientation?: {
      currentUnderstanding: string[];
      unknowns: string[];
      possibleDirections: string[];
    };
    conversationUpdate?: {
      notes: string[];
    };
    voiceConstraints?: {
      source: string;
      styleDirectives: string[];
      rhythm: string[];
      prohibitedExpressions: string[];
      questionDirectives: string[];
    };
    responsePlan?: {
      planId: string;
      decisionOwner: string;
      answerObligations: { kind: string }[];
      responseActions: string[];
      clinicalStrategy: unknown | null;
      questionPolicy: { mode: string };
      closurePolicy: { mode: string };
    };
    filteredHistory: {
      role: string;
      reason: string;
      promptVersion?: string | null;
      preview: string;
    }[];
    modelMessageRoles: string[];
  };
  generation: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    rawLLMOutput?: string;
    postProcessSteps?: {
      layer: string;
      before: string;
      after: string;
      reason?: string;
    }[];
    finalReplySource?:
      | "llm"
      | "llm_regenerate"
      | "constraint_failure"
      | "guard_rewrite"
      | "fallback"
      | "mock"
      | "safety";
    tokenInput?: number;
    tokenOutput?: number;
    providerReasoning?: {
      available: boolean;
      source: string;
      characters?: number;
    };
  };
  judge: {
    passed: boolean;
    riskLevel: string;
    issues: string[];
    rewriteRequired: boolean;
    reason: string;
    judgeModel?: string;
  };
  route: {
    finalSource: string;
    fallbackUsed: boolean;
    rewriteAttempted: boolean;
    regenerateAttempted?: boolean;
    safetyUsed?: boolean;
    safetyOverrideReason?: string;
  };
  conversationControl?: {
    interpretation: {
      primaryDialogueAct: string;
      responseRelation: {
        candidates: { relation: string; confidence: number }[];
      };
    };
    dialogueState: {
      currentActivity: { primary: string; concurrent: string[] };
      initiativeOwner: string;
    };
    responsePlan: {
      planId: string;
      decisionOwner: string;
      answerObligations: { kind: string }[];
      responseActions: string[];
      questionPolicy: { mode: string };
      closurePolicy: { mode: string };
    };
    clinicalInvoked: boolean;
    validation: { passed: boolean; failureReasons: string[]; planChanged: false }[];
    stateUpdate: { remainingOpenLoops: string[] };
  };
};

type ChatSession = {
  id: string;
  title: string;
};

type AuthUser = {
  id: string;
  phone: string | null;
  wechatOpenid: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
};

type ChatMessageResponse = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  promptVersion?: string | null;
  interactionMoveEnvelope?: CommittedAssistantMoveEnvelopeV1 | null;
};

type ChatMessagesListResponse = {
  items: ChatMessageResponse[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  greetingStatus?: ExecutionSystemStatus | null;
};

type CachedChat = {
  sessionId: string;
  messages: Message[];
  hasMore?: boolean;
  nextCursor?: string | null;
  greetingStatus?: ExecutionSystemStatus | null;
};

type GuestAiUsage = {
  date: string;
  count: number;
};

export type InitialChatData = CachedChat | null;

const CHAT_CACHE_PREFIX = "xinqingChatCache";
const GUEST_MODE_KEY = "xinqingGuestMode";
const GUEST_CHAT_CACHE_KEY = "xinqingGuestChatCache:v2";
const GUEST_AI_USAGE_KEY = "xinqingGuestAiUsage";
const GUEST_RECENT_GREETINGS_KEY = "xinqingGuestRecentGreetings:v2";
const GUEST_LEGACY_RECENT_GREETINGS_KEY = "xinqingGuestRecentGreetings:v1";
const GUEST_AI_DAILY_LIMIT = 3;
const GUEST_SESSION_ID = "guest-session";
const LOCAL_DEMO_TOKEN_PREFIX = "local_demo_";
const GUEST_AI_LIMIT_MESSAGE =
  "今天的游客体验次数用完啦。登录后可以继续慢慢说，也能保存聊天回看。";

const TYPEWRITER_STEP_MIN = 2;
const TYPEWRITER_STEP_MAX = 5;
const TYPEWRITER_DELAY_MIN_MS = 110;
const TYPEWRITER_DELAY_MAX_MS = 220;
const GUEST_OPEN_GREETING_DEDUPE_KEY = "xinqingGuestOpenGreetingAt";
const OPEN_GREETING_DEDUPE_MS = 2 * 1000;

const sleep = (delay: number) =>
  new Promise((resolve) => window.setTimeout(resolve, delay));

const getNextTypingIndex = (text: string, currentIndex: number) => {
  const punctuationIndex = text.slice(currentIndex).search(/[，。！？、；：,.!?;:\n]/);
  if (punctuationIndex >= 0 && punctuationIndex <= 5) {
    return currentIndex + punctuationIndex + 1;
  }

  const step =
    TYPEWRITER_STEP_MIN +
    Math.floor(Math.random() * (TYPEWRITER_STEP_MAX - TYPEWRITER_STEP_MIN + 1));
  return Math.min(text.length, currentIndex + step);
};

const getTypingDelay = (latestText: string) => {
  const lastChar = latestText.at(-1);
  if (lastChar && /[。！？.!?\n]/.test(lastChar)) return 360;
  if (lastChar && /[，、；：,;:]/.test(lastChar)) return 220;
  return (
    TYPEWRITER_DELAY_MIN_MS +
    Math.floor(Math.random() * (TYPEWRITER_DELAY_MAX_MS - TYPEWRITER_DELAY_MIN_MS + 1))
  );
};

const formatChatDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
};

const formatMessageTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const formatMessageDate = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const shouldShowMessageTime = (message: Message, previous?: Message) => {
  if (!previous) return true;
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() >
    5 * 60 * 1000
  );
};

const getDebugLayers = (trace: AiDebugTrace) =>
  !trace.prompt
    ? [
        {
          title: "旧 debug 已废弃",
          body: "这条消息带的是旧调试结构，不代表当前 AI 链路。请发送新消息查看 base-model debug。",
          evidence: [],
        },
      ]
    : trace.thinkingLayers?.length
    ? trace.thinkingLayers
    : trace.visibleSteps.map((step, index) => ({
        title: `${index + 1}. 调试`,
        body: step,
        evidence: [],
      }));

const formatEngineDetails = (trace: AiDebugTrace) => {
  const prompt = trace.prompt;
  const memoryLabel =
    prompt && prompt.memoryIncluded
      ? [prompt.memorySource, prompt.memoryLayer, prompt.memoryTrust].filter(Boolean).join(" / ")
      : "none";
  return [
    prompt
      ? `Prompt: ${prompt.mode} / ${prompt.promptVersion}`
      : "Prompt: legacy debug trace",
    prompt
      ? `历史: received=${prompt.receivedHistoryCount}, included=${prompt.includedHistoryCount}, filtered=${prompt.filteredHistoryCount}`
      : "历史: unknown",
    prompt ? `记忆: ${memoryLabel}` : "记忆: unknown",
    prompt?.conversationContext
      ? `Conversation OS: notice=${prompt.conversationContext.latestNotice.observations.length}, unknowns=${prompt.conversationContext.understanding.unknowns.length}, experienceGoal=${prompt.conversationContext.responseGoal.experienceGoal?.join(",") ?? "unknown"}, engageMode=${prompt.conversationContext.responseGoal.engageMode ?? "unknown"}`
      : "Conversation OS: unknown",
    trace.conversationControl
      ? `Conversation OS Control: owner=${trace.conversationControl.responsePlan.decisionOwner}, plan=${trace.conversationControl.responsePlan.planId}, relations=${trace.conversationControl.interpretation.responseRelation.candidates.map((item) => `${item.relation}:${item.confidence}`).join(",") || "none"}, activity=${trace.conversationControl.dialogueState.currentActivity.primary}, concurrent=${trace.conversationControl.dialogueState.currentActivity.concurrent.join(",") || "none"}, initiative=${trace.conversationControl.dialogueState.initiativeOwner}, obligations=${trace.conversationControl.responsePlan.answerObligations.map((item) => item.kind).join(",") || "none"}, actions=${trace.conversationControl.responsePlan.responseActions.join(",")}, clinical=${trace.conversationControl.clinicalInvoked}, validation=${trace.conversationControl.validation.map((item) => item.passed).join(" -> ")}, open=${trace.conversationControl.stateUpdate.remainingOpenLoops.length}`
      : "Conversation OS Control: safety or unavailable",
    prompt?.conversationOrientation
      ? `Orientation: current=${prompt.conversationOrientation.currentUnderstanding.length}, unknowns=${prompt.conversationOrientation.unknowns.length}, directions=${prompt.conversationOrientation.possibleDirections.length}`
      : "Orientation: unknown",
    prompt?.conversationUpdate
      ? `Update: ${prompt.conversationUpdate.notes.join(" | ") || "none"}`
      : "Update: unknown",
    prompt?.voiceConstraints
      ? `Voice: ${prompt.voiceConstraints.styleDirectives.join(" | ")}`
      : "Voice: unknown",
    prompt ? `模型消息: ${prompt.modelMessageRoles.join(" -> ") || "无"}` : "模型消息: unknown",
    prompt
      ? `过滤: ${
          prompt.filteredHistory.length > 0
            ? prompt.filteredHistory
                .map((item) => `${item.role}:${item.reason}:${item.preview}`)
                .join(" | ")
            : "无"
        }`
      : "过滤: unknown",
    `生成: ${trace.generation.model} / ${trace.generation.promptVersion} / ${trace.generation.latencyMs}ms`,
    `生成来源: ${trace.generation.finalReplySource ?? "unknown"}`,
    `Raw LLM: ${trace.generation.rawLLMOutput ?? "none"}`,
    `PostProcess: ${
      trace.generation.postProcessSteps?.length
        ? trace.generation.postProcessSteps
            .map((step) => `${step.layer}: ${step.before} -> ${step.after}${step.reason ? ` / ${step.reason}` : ""}`)
            .join(" | ")
        : "none"
    }`,
    trace.clinicalLogic
      ? `Clinical: state=${trace.clinicalLogic.conversationState}, skippedBySafety=${trace.clinicalLogic.skippedBySafety}, intent=${trace.clinicalLogic.selectedPlan?.responseIntent ?? "none"}, strategy=${trace.clinicalLogic.selectedPlan?.primaryStrategy ?? "none"}, memory=understanding:${trace.clinicalLogic.memoryUsed.understandings.length}/relationship:${trace.clinicalLogic.memoryUsed.relationships.length}/timeline:${trace.clinicalLogic.memoryUsed.timelineEvents.length}`
      : "Clinical: unknown",
    `审查: disabled / ${trace.judge.reason}`,
    `路线: ${trace.route.finalSource}, rewrite=${trace.route.rewriteAttempted}, regenerate=${trace.route.regenerateAttempted ?? false}, fallback=${trace.route.fallbackUsed}`,
    ...(trace.route.safetyOverrideReason
      ? [`Safety override: ${trace.route.safetyOverrideReason}`]
      : []),
  ].join("\n");
};

const toMessages = (items: ChatMessageResponse[]): Message[] =>
  items
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      id: item.id,
      role: item.role as "user" | "assistant",
      text: item.content,
      createdAt: item.createdAt ?? new Date().toISOString(),
      promptVersion: item.promptVersion,
      interactionMoveEnvelope: item.interactionMoveEnvelope,
    }));

const getChatCacheKey = () => {
  const auth = getStoredAuth();
  return auth?.token && auth.user?.id ? `${CHAT_CACHE_PREFIX}:${auth.user.id}` : null;
};

const readChatCache = (): CachedChat | null => {
  if (typeof window === "undefined") return null;
  const key = getChatCacheKey();
  if (!key) return null;

  try {
    const cached = JSON.parse(window.sessionStorage.getItem(key) || "null") as CachedChat | null;
    return cached?.sessionId && Array.isArray(cached.messages) ? cached : null;
  } catch {
    return null;
  }
};

const writeChatCache = (value: CachedChat) => {
  if (typeof window === "undefined") return;
  const key = getChatCacheKey();
  if (!key) return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
};

const getInitialGuestMode = () => {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(GUEST_MODE_KEY) === "true";
};

const readGuestMessages = (): Message[] => {
  if (typeof window === "undefined") return [];

  try {
    const cached = JSON.parse(window.sessionStorage.getItem(GUEST_CHAT_CACHE_KEY) || "[]");
    return Array.isArray(cached)
      ? collapseConsecutiveGuestGreetings(cached as Message[])
      : [];
  } catch {
    return [];
  }
};

const writeGuestMessages = (messages: Message[]) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(GUEST_CHAT_CACHE_KEY, JSON.stringify(messages));
};

const readGuestRecentGreetings = () => {
  if (typeof window === "undefined") return [];
  return parseGuestRecentGreetings(
    window.localStorage.getItem(GUEST_RECENT_GREETINGS_KEY) ??
      window.localStorage.getItem(GUEST_LEGACY_RECENT_GREETINGS_KEY)
  );
};

const rememberGuestGreeting = (greeting: Message) => {
  if (typeof window === "undefined") return;
  const next = appendGuestRecentGreeting(readGuestRecentGreetings(), {
    text: greeting.text,
    interactionMoveEnvelope: greeting.interactionMoveEnvelope,
  });
  window.localStorage.setItem(
    GUEST_RECENT_GREETINGS_KEY,
    JSON.stringify(next)
  );
};

const reserveGuestOpenGreeting = () => {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  const lastGreetingAt = Number(window.sessionStorage.getItem(GUEST_OPEN_GREETING_DEDUPE_KEY));
  if (Number.isFinite(lastGreetingAt) && now - lastGreetingAt < OPEN_GREETING_DEDUPE_MS) {
    return false;
  }
  window.sessionStorage.setItem(GUEST_OPEN_GREETING_DEDUPE_KEY, String(now));
  return true;
};

const releaseGuestOpenGreeting = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GUEST_OPEN_GREETING_DEDUPE_KEY);
};

const createGuestGreetingMessage = async ({
  kind,
  recentMessages,
}: {
  kind: "initial" | "return";
  recentMessages: Message[];
}): Promise<Message | null> => {
  try {
    const recentGreetings = readGuestRecentGreetings();
    const data = await apiRequest<{ assistantMessage: ChatMessageResponse }>(
      "/api/chat/guest/greeting",
      {
        method: "POST",
        auth: false,
        body: {
          kind,
          recentMessages: recentMessages.slice(-6).map((message) => ({
            id: message.id,
            role: message.role,
            content: message.text,
            promptVersion: message.promptVersion,
            interactionMoveEnvelope: message.interactionMoveEnvelope,
          })),
          recentGreetings,
        },
      }
    );
    const greeting = {
      id: data.assistantMessage.id,
      role: "assistant" as const,
      text: data.assistantMessage.content,
      createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
      promptVersion: data.assistantMessage.promptVersion,
      interactionMoveEnvelope: data.assistantMessage.interactionMoveEnvelope,
    };
    rememberGuestGreeting(greeting);
    return greeting;
  } catch {
    return null;
  }
};

type GuestGreetingLoadResult = {
  messages: Message[];
  greetingFailed: boolean;
};

const readOrSeedGuestMessages = async (): Promise<GuestGreetingLoadResult> => {
  const messages = readGuestMessages();
  if (!reserveGuestOpenGreeting()) {
    return { messages, greetingFailed: false };
  }

  const nonGreetingMessages = messages.filter(
    (message) => !isProactiveGreetingPromptVersion(message.promptVersion)
  );
  const greetingKind = guestProactiveGreetingKind({
    localMessageCount: messages.length,
    recentGreetings: readGuestRecentGreetings(),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && !reserveGuestOpenGreeting()) break;
    const greeting = await createGuestGreetingMessage({
      kind: greetingKind,
      recentMessages: nonGreetingMessages,
    });
    if (greeting) {
      const nextMessages = [...messages, greeting];
      writeGuestMessages(nextMessages);
      return { messages: nextMessages, greetingFailed: false };
    }
    releaseGuestOpenGreeting();
  }
  return { messages, greetingFailed: true };
};

const getTodayKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const readGuestAiUsage = (): GuestAiUsage => {
  const today = getTodayKey();
  if (typeof window === "undefined") return { date: today, count: 0 };

  try {
    const usage = JSON.parse(window.localStorage.getItem(GUEST_AI_USAGE_KEY) || "null") as
      | GuestAiUsage
      | null;
    return usage?.date === today ? usage : { date: today, count: 0 };
  } catch {
    return { date: today, count: 0 };
  }
};

const writeGuestAiUsage = (usage: GuestAiUsage) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_AI_USAGE_KEY, JSON.stringify(usage));
};

const getGuestAiRemaining = () =>
  Math.max(GUEST_AI_DAILY_LIMIT - readGuestAiUsage().count, 0);

const incrementGuestAiUsage = () => {
  const usage = readGuestAiUsage();
  const next = {
    date: usage.date,
    count: Math.min(usage.count + 1, GUEST_AI_DAILY_LIMIT),
  };
  writeGuestAiUsage(next);
  return Math.max(GUEST_AI_DAILY_LIMIT - next.count, 0);
};

function ChatContent({ initialChat }: { initialChat: InitialChatData }) {
  const searchParams = useSearchParams();
  const date = searchParams.get("date");
  const requestedSessionId = searchParams.get("sessionId");
  const targetMessageId = searchParams.get("messageId");
  const showAiDebugTrace =
    searchParams.get("debugAi") === "1" || process.env.NEXT_PUBLIC_AI_DEBUG_TRACE === "true";
  const [input, setInput] = useState("");
  const canUseInitialChat =
    !requestedSessionId || requestedSessionId === initialChat?.sessionId;
  const [messages, setMessages] = useState<Message[]>(
    canUseInitialChat ? (initialChat?.messages ?? []) : []
  );
  const [sessionId, setSessionId] = useState<string | null>(
    requestedSessionId ?? initialChat?.sessionId ?? null
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(!canUseInitialChat || !initialChat);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(initialChat?.hasMore ?? false);
  const [olderMessagesCursor, setOlderMessagesCursor] = useState<string | null>(
    initialChat?.nextCursor ?? null
  );
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [typingMessageIds, setTypingMessageIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [executionStatus, setExecutionStatus] = useState<TurnScopedExecutionStatus | null>(null);
  const [greetingStatus, setGreetingStatus] = useState<ExecutionSystemStatus | null>(
    canUseInitialChat ? (initialChat?.greetingStatus ?? null) : null
  );
  const [isDebugLoggingIn, setIsDebugLoggingIn] = useState(false);
  const typingCancelledRef = useRef(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const isLoadingOlderMessagesRef = useRef(false);
  const shouldAutoScrollToBottomRef = useRef(true);
  const prependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const hydratedFromCacheRef = useRef(false);
  const positionedTargetRef = useRef<string | null>(null);
  const sessionContextKey = `${requestedSessionId ?? ""}\u0000${sessionId ?? ""}`;
  const sessionContextRef = useRef<{
    key: string;
    authority: ChatTurnAuthorityState;
  }>({
    key: sessionContextKey,
    authority: createChatTurnAuthorityState(sessionId ?? ""),
  });

  const getErrorMessage = useCallback((error: unknown) => {
    if (error instanceof ClientApiError) return error.message;
    if (error instanceof Error) return error.message;
    return "服务暂时不可用，请稍后再试";
  }, []);

  useLayoutEffect(() => {
    if (sessionContextRef.current.key === sessionContextKey) return;
    const authority = advanceChatSessionAuthority(
      sessionContextRef.current.authority,
      sessionId ?? ""
    );
    sessionContextRef.current = { key: sessionContextKey, authority };
    setExecutionStatus((current) =>
      current && canApplyChatSessionResult({ current: authority, result: current.authority })
        ? current
        : null
    );
    setGreetingStatus(null);
    setErrorMessage("");
  }, [sessionContextKey, sessionId]);

  const applyTurnCompletionResult = useCallback(
    (
      _path: AsyncTurnCompletionPath,
      authority: ChatTurnResultAuthority,
      completion: {
        executionStatus?: TurnScopedExecutionStatus | null;
        errorMessage?: string;
      }
    ) => {
      if ("executionStatus" in completion) {
        setExecutionStatus((current) =>
          resolveChatTurnResult({
            current: sessionContextRef.current.authority,
            result: authority,
            previousValue: current,
            nextValue: completion.executionStatus ?? null,
          })
        );
      }
      if (completion.errorMessage !== undefined) {
        setErrorMessage((current) =>
          resolveChatTurnResult({
            current: sessionContextRef.current.authority,
            result: authority,
            previousValue: current,
            nextValue: completion.errorMessage ?? "",
          })
        );
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const loadChat = async () => {
      const storedAuth = getStoredAuth();
      const currentGuestMode = getInitialGuestMode();
      const isLocalDemoAuth = storedAuth?.token?.startsWith(LOCAL_DEMO_TOKEN_PREFIX);

      if (!storedAuth?.token || isLocalDemoAuth) {
        if (!currentGuestMode) {
          window.sessionStorage.setItem(GUEST_MODE_KEY, "true");
        }
        setIsGuestMode(true);
        setSessionId(GUEST_SESSION_ID);
        shouldAutoScrollToBottomRef.current = true;
        const guestLoad = await readOrSeedGuestMessages();
        setMessages(guestLoad.messages);
        setErrorMessage(guestLoad.greetingFailed
          ? "欢迎语暂时没生成，可以直接发消息或刷新重试。"
          : "");
        setHasMoreOlderMessages(false);
        setOlderMessagesCursor(null);
        setIsLoadingMessages(false);
        return;
      }

      setIsGuestMode(false);
      const cached = readChatCache();
      if (!hydratedFromCacheRef.current && cached && !requestedSessionId) {
        hydratedFromCacheRef.current = true;
        setSessionId(cached.sessionId);
        shouldAutoScrollToBottomRef.current = true;
        setMessages(cached.messages);
        setHasMoreOlderMessages(cached.hasMore ?? false);
        setOlderMessagesCursor(cached.nextCursor ?? null);
      }

      if (initialChat && !requestedSessionId) {
        writeChatCache(initialChat);
      }

      if (initialChat && canUseInitialChat) {
        setSessionId(initialChat.sessionId);
        shouldAutoScrollToBottomRef.current = true;
        setMessages(initialChat.messages);
        setHasMoreOlderMessages(initialChat.hasMore ?? false);
        setOlderMessagesCursor(initialChat.nextCursor ?? null);
        setGreetingStatus(initialChat.greetingStatus ?? null);
        setIsLoadingMessages(false);
        return;
      }

      setIsLoadingMessages(true);
      setErrorMessage("");

      try {
        let activeSessionId = requestedSessionId ?? cached?.sessionId ?? initialChat?.sessionId ?? null;
        if (!activeSessionId) {
          const sessions = await apiRequest<{ items: ChatSession[] }>("/api/chat/sessions");
          if (sessions.items[0]?.id) {
            activeSessionId = sessions.items[0].id;
          } else {
            const created = await apiRequest<ChatSession>("/api/chat/sessions", {
              method: "POST",
              body: { title: "慢慢说" },
            });
            activeSessionId = created.id;
          }
        }

        let data: ChatMessagesListResponse;
        try {
          data = await apiRequest<ChatMessagesListResponse>(
            `/api/chat/sessions/${activeSessionId}/messages?pageSize=50`
          );
        } catch (error) {
          if (requestedSessionId || activeSessionId !== cached?.sessionId) throw error;
          const sessions = await apiRequest<{ items: ChatSession[] }>("/api/chat/sessions");
          activeSessionId = sessions.items[0]?.id ?? null;
          if (!activeSessionId) throw error;
          data = await apiRequest<ChatMessagesListResponse>(
            `/api/chat/sessions/${activeSessionId}/messages?pageSize=50`
          );
        }

        if (cancelled) return;
        const nextMessages = toMessages(data.items);
        setSessionId(activeSessionId);
        shouldAutoScrollToBottomRef.current = true;
        setMessages(nextMessages);
        setHasMoreOlderMessages(data.hasMore);
        setOlderMessagesCursor(data.nextCursor);
        setGreetingStatus(data.greetingStatus ?? null);
        writeChatCache({
          sessionId: activeSessionId,
          messages: nextMessages,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
        });
      } catch (error) {
        if (cancelled) return;
        shouldAutoScrollToBottomRef.current = true;
        setMessages([]);
        setHasMoreOlderMessages(false);
        setOlderMessagesCursor(null);
        setErrorMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };

    loadChat();

    return () => {
      cancelled = true;
    };
  }, [canUseInitialChat, getErrorMessage, initialChat, requestedSessionId]);

  useEffect(() => {
    return () => {
      typingCancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    const scrollElement = messagesScrollRef.current;
    if (!scrollElement) return;

    const targetKey = targetMessageId ?? date;
    if (targetKey && positionedTargetRef.current !== targetKey) {
      const targetElement = targetMessageId
        ? scrollElement.querySelector<HTMLElement>(`[data-message-id="${targetMessageId}"]`)
        : messages
            .map((message) => ({
              id: message.id,
              date: formatMessageDate(message.createdAt),
            }))
            .find((message) => message.date === date)
          ? scrollElement.querySelector<HTMLElement>(
              `[data-message-id="${
                messages.find((message) => formatMessageDate(message.createdAt) === date)?.id
              }"]`
            )
          : null;

      if (targetElement) {
        scrollElement.scrollTop = Math.max(targetElement.offsetTop - 16, 0);
        positionedTargetRef.current = targetKey;
        return;
      }
    }

    if (prependScrollRef.current) {
      const previous = prependScrollRef.current;
      prependScrollRef.current = null;
      scrollElement.scrollTop =
        scrollElement.scrollHeight - previous.scrollHeight + previous.scrollTop;
      return;
    }

    if (!shouldAutoScrollToBottomRef.current) return;

    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [date, messages, targetMessageId, typingMessageIds]);

  const loadOlderMessages = useCallback(async () => {
    if (
      isGuestMode ||
      !sessionId ||
      !hasMoreOlderMessages ||
      !olderMessagesCursor ||
      isLoadingOlderMessagesRef.current
    ) {
      return;
    }

    const scrollElement = messagesScrollRef.current;
    if (!scrollElement) return;

    isLoadingOlderMessagesRef.current = true;
    setIsLoadingOlderMessages(true);
    setErrorMessage("");

    try {
      const data = await apiRequest<ChatMessagesListResponse>(
        `/api/chat/sessions/${sessionId}/messages?pageSize=50&before=${encodeURIComponent(
          olderMessagesCursor
        )}`
      );
      const olderMessages = toMessages(data.items);
      prependScrollRef.current = {
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
      };
      shouldAutoScrollToBottomRef.current = false;
      setMessages((current) => {
        const currentIds = new Set(current.map((message) => message.id));
        const uniqueOlderMessages = olderMessages.filter((message) => !currentIds.has(message.id));
        if (uniqueOlderMessages.length === 0) {
          prependScrollRef.current = null;
          return current;
        }
        const nextMessages = [...uniqueOlderMessages, ...current];
        writeChatCache({
          sessionId,
          messages: nextMessages,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
        });
        return nextMessages;
      });
      setHasMoreOlderMessages(data.hasMore);
      setOlderMessagesCursor(data.nextCursor);
    } catch (error) {
      prependScrollRef.current = null;
      setErrorMessage(getErrorMessage(error));
    } finally {
      isLoadingOlderMessagesRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [
    getErrorMessage,
    hasMoreOlderMessages,
    isGuestMode,
    olderMessagesCursor,
    sessionId,
  ]);

  const handleMessagesScroll = () => {
    const scrollElement = messagesScrollRef.current;
    if (scrollElement && scrollElement.scrollTop <= 32) {
      void loadOlderMessages();
    }
  };

  useEffect(() => {
    const targetKey = targetMessageId ?? date;
    if (
      !targetKey ||
      isGuestMode ||
      isLoadingMessages ||
      isLoadingOlderMessages ||
      !hasMoreOlderMessages
    ) {
      return;
    }

    const targetIsLoaded = targetMessageId
      ? messages.some((message) => message.id === targetMessageId)
      : messages.some((message) => formatMessageDate(message.createdAt) === date);
    if (!targetIsLoaded) void loadOlderMessages();
  }, [
    date,
    hasMoreOlderMessages,
    isGuestMode,
    isLoadingMessages,
    isLoadingOlderMessages,
    loadOlderMessages,
    messages,
    targetMessageId,
  ]);

  const revealAssistantReply = (messageId: string, fullText: string) =>
    new Promise<void>(async (resolve) => {
      let index = 0;
      typingCancelledRef.current = false;
      setTypingMessageIds((current) =>
        current.includes(messageId) ? current : [...current, messageId]
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, text: "" } : message
        )
      );

      while (index < fullText.length && !typingCancelledRef.current) {
        const nextIndex = getNextTypingIndex(fullText, index);
        const visibleText = fullText.slice(0, nextIndex);
        index = nextIndex;

        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, text: visibleText }
              : message
          )
        );
        await sleep(getTypingDelay(visibleText));
      }

      setTypingMessageIds((current) => current.filter((id) => id !== messageId));
      resolve();
    });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();

    if (!text) {
      return;
    }

    if (!sessionId || isLoadingMessages) {
      return;
    }

    const optimisticId = createClientTurnId();
    const submittedAuthority = submitChatTurnAuthority(
      sessionContextRef.current.authority,
      optimisticId
    );
    sessionContextRef.current.authority = submittedAuthority.state;
    const resultAuthority = submittedAuthority.result;
    const isCurrentSessionResult = () =>
      canApplyChatSessionResult({
        current: sessionContextRef.current.authority,
        result: resultAuthority,
      });
    const pendingAssistantId = `typing-${Date.now()}`;
    const now = new Date().toISOString();
    const userMessage: Message = { id: optimisticId, role: "user", text, createdAt: now };
    shouldAutoScrollToBottomRef.current = true;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: pendingAssistantId, role: "assistant", text: "...", createdAt: now },
    ]);
    setTypingMessageIds((current) => [...current, pendingAssistantId]);
    setInput("");
    setErrorMessage("");
    setExecutionStatus(null);

    if (isGuestMode) {
      const replacePendingAssistant = async (assistantMessage: Message) => {
        setTypingMessageIds((current) =>
          current.filter((id) => id !== pendingAssistantId).concat(assistantMessage.id)
        );
        setMessages((current) => {
          const next = current.map((message) =>
            message.id === pendingAssistantId ? { ...assistantMessage, text: "" } : message
          );
          writeGuestMessages(next);
          return next;
        });
        await revealAssistantReply(assistantMessage.id, assistantMessage.text);
        setMessages((current) => {
          writeGuestMessages(current);
          return current;
        });
      };

      if (!showAiDebugTrace && getGuestAiRemaining() <= 0) {
        setMessages((current) => current.filter((message) => message.id !== pendingAssistantId));
        setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
        setExecutionStatus({
          type: "system_status",
          code: "RATE_LIMITED",
          message: GUEST_AI_LIMIT_MESSAGE,
          retryable: false,
          turnId: optimisticId,
          inputText: text,
          isGuest: true,
          authority: resultAuthority,
        });
        return;
      }

      try {
        const data = await apiRequest<{
          status: "committed" | "failed";
          assistantMessage?: ChatMessageResponse;
          systemStatus?: ExecutionSystemStatus;
          debugTrace?: AiDebugTrace;
        }>("/api/chat/guest", {
          method: "POST",
          auth: false,
          body: {
            content: text,
            turnId: optimisticId,
            debugTrace: showAiDebugTrace,
            recentMessages: messages.slice(-24).map((message) => ({
              id: message.id,
              role: message.role,
              content: message.text,
              promptVersion: message.promptVersion,
              createdAt: message.createdAt,
              interactionMoveEnvelope: message.interactionMoveEnvelope,
            })),
          },
        });
        if (!showAiDebugTrace) {
          incrementGuestAiUsage();
        }
        if (!isCurrentSessionResult()) return;
        if (data.status === "failed" || !data.assistantMessage) {
          setMessages((current) => {
            const next = current.filter((message) => message.id !== pendingAssistantId);
            writeGuestMessages(next);
            return next;
          });
          setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
          if (data.systemStatus) {
            const nextStatus = {
              ...data.systemStatus,
              inputText: text,
              isGuest: true,
              authority: resultAuthority,
            };
            applyTurnCompletionResult("guest-submit-failure", resultAuthority, {
              executionStatus: nextStatus,
            });
          }
          return;
        }
        applyTurnCompletionResult("guest-submit-success", resultAuthority, {
          executionStatus: null,
        });
        if (!isCurrentSessionResult()) return;
        await replacePendingAssistant({
          id: data.assistantMessage.id,
          role: "assistant",
          text: data.assistantMessage.content,
          createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
          promptVersion: data.assistantMessage.promptVersion,
          interactionMoveEnvelope: data.assistantMessage.interactionMoveEnvelope,
          debugTrace: data.debugTrace,
        });
      } catch (error) {
        if (isCurrentSessionResult()) {
          setMessages((current) =>
            current.filter(
              (message) => message.id !== pendingAssistantId && message.id !== optimisticId
            )
          );
          setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
        }
        applyTurnCompletionResult("guest-submit-transport", resultAuthority, {
          errorMessage: getErrorMessage(error),
        });
      }
      return;
    }

    try {
      const data = await apiRequest<{
        status: "committed" | "failed";
        userMessage: ChatMessageResponse;
        assistantMessage?: ChatMessageResponse;
        systemStatus?: ExecutionSystemStatus;
        debugTrace?: AiDebugTrace;
      }>(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { content: text, turnId: optimisticId, debugTrace: showAiDebugTrace },
      });
      if (!isCurrentSessionResult()) return;
      if (data.status === "failed" || !data.assistantMessage) {
        setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
        setMessages((current) => [
          ...current.filter(
            (message) => message.id !== optimisticId && message.id !== pendingAssistantId
          ),
          {
            id: data.userMessage.id,
            role: "user",
            text: data.userMessage.content,
            createdAt: data.userMessage.createdAt ?? now,
          },
        ]);
        if (data.systemStatus) {
          const nextStatus = {
            ...data.systemStatus,
            inputText: text,
            isGuest: false,
            authority: resultAuthority,
          };
          applyTurnCompletionResult("auth-submit-failure", resultAuthority, {
            executionStatus: nextStatus,
          });
        }
        return;
      }
      applyTurnCompletionResult("auth-submit-success", resultAuthority, {
        executionStatus: null,
      });
      const committedAssistantMessage = data.assistantMessage;
      setTypingMessageIds((current) =>
        current.filter((id) => id !== pendingAssistantId).concat(committedAssistantMessage.id)
      );
      setMessages((current) => [
        ...current.filter(
          (message) => message.id !== optimisticId && message.id !== pendingAssistantId
        ),
        {
          id: data.userMessage.id,
          role: "user",
          text: data.userMessage.content,
          createdAt: data.userMessage.createdAt ?? now,
          promptVersion: data.userMessage.promptVersion,
        },
        {
          id: committedAssistantMessage.id,
          role: "assistant",
          text: "",
          createdAt: committedAssistantMessage.createdAt ?? new Date().toISOString(),
          promptVersion: committedAssistantMessage.promptVersion,
          interactionMoveEnvelope: committedAssistantMessage.interactionMoveEnvelope,
          debugTrace: data.debugTrace,
        },
      ]);
      await revealAssistantReply(committedAssistantMessage.id, committedAssistantMessage.content);
      if (!isCurrentSessionResult()) return;
      const refreshed = await apiRequest<ChatMessagesListResponse>(
        `/api/chat/sessions/${sessionId}/messages?pageSize=50`
      );
      if (!isCurrentSessionResult()) return;
      writeChatCache({
        sessionId,
        messages: toMessages(refreshed.items),
        hasMore: refreshed.hasMore,
        nextCursor: refreshed.nextCursor,
      });
    } catch (error) {
      if (isCurrentSessionResult()) {
        setMessages((current) =>
          current.filter(
            (message) => message.id !== pendingAssistantId && message.id !== optimisticId
          )
        );
        setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
      }
      applyTurnCompletionResult("auth-submit-transport", resultAuthority, {
        errorMessage: getErrorMessage(error),
      });
    }
  };

  const handleExecutionRetry = async () => {
    if (greetingStatus?.retryable && sessionId && !isGuestMode) {
      setGreetingStatus(null);
      setErrorMessage("");
      try {
        const data = await apiRequest<ChatMessagesListResponse>(
          `/api/chat/sessions/${sessionId}/messages?pageSize=50&retryGreeting=1`
        );
        const nextMessages = toMessages(data.items);
        setMessages(nextMessages);
        setHasMoreOlderMessages(data.hasMore);
        setOlderMessagesCursor(data.nextCursor);
        setGreetingStatus(data.greetingStatus ?? null);
        writeChatCache({
          sessionId,
          messages: nextMessages,
          hasMore: data.hasMore,
          nextCursor: data.nextCursor,
          greetingStatus: data.greetingStatus ?? null,
        });
      } catch (error) {
        setGreetingStatus(greetingStatus);
        setErrorMessage(getErrorMessage(error));
      }
      return;
    }
    const pending = executionStatus;
    if (!pending?.retryable || !sessionId) return;
    const resultAuthority = pending.authority;
    const isCurrentSessionResult = () =>
      canApplyChatSessionResult({
        current: sessionContextRef.current.authority,
        result: resultAuthority,
      });
    const ownsLatestTurnResult = () =>
      canApplyChatTurnResult({
        current: sessionContextRef.current.authority,
        result: resultAuthority,
      });
    if (!ownsLatestTurnResult()) return;
    setExecutionStatus(null);
    setErrorMessage("");
    try {
      if (pending.isGuest) {
        const data = await apiRequest<{
          status: "committed" | "failed";
          assistantMessage?: ChatMessageResponse;
          systemStatus?: ExecutionSystemStatus;
          debugTrace?: AiDebugTrace;
        }>("/api/chat/guest", {
          method: "POST",
          auth: false,
          body: {
            content: pending.inputText,
            turnId: pending.turnId,
            retry: true,
            debugTrace: showAiDebugTrace,
            recentMessages: messages
              .filter((message) => message.id !== pending.turnId)
              .slice(-24)
              .map((message) => ({
                id: message.id,
                role: message.role,
                content: message.text,
                promptVersion: message.promptVersion,
                createdAt: message.createdAt,
                interactionMoveEnvelope: message.interactionMoveEnvelope,
              })),
          },
        });
        if (!showAiDebugTrace) incrementGuestAiUsage();
        if (!isCurrentSessionResult()) return;
        if (data.status === "failed" || !data.assistantMessage) {
          const nextStatus = {
            ...(data.systemStatus ?? pending),
            inputText: pending.inputText,
            isGuest: true,
            authority: resultAuthority,
          };
          applyTurnCompletionResult("guest-retry-failure", resultAuthority, {
            executionStatus: nextStatus,
          });
          return;
        }
        applyTurnCompletionResult("guest-retry-success", resultAuthority, {
          executionStatus: null,
        });
        const assistant: Message = {
          id: data.assistantMessage.id,
          role: "assistant",
          text: "",
          createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
          promptVersion: data.assistantMessage.promptVersion,
          interactionMoveEnvelope: data.assistantMessage.interactionMoveEnvelope,
          debugTrace: data.debugTrace,
        };
        setMessages((current) => {
          const next = [...current, assistant];
          writeGuestMessages(next);
          return next;
        });
        await revealAssistantReply(assistant.id, data.assistantMessage.content);
        setMessages((current) => {
          writeGuestMessages(current);
          return current;
        });
        return;
      }

      const data = await apiRequest<{
        status: "committed" | "failed";
        assistantMessage?: ChatMessageResponse;
        systemStatus?: ExecutionSystemStatus;
        debugTrace?: AiDebugTrace;
      }>(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { retryTurnId: pending.turnId, debugTrace: showAiDebugTrace },
      });
      if (!isCurrentSessionResult()) return;
      if (data.status === "failed" || !data.assistantMessage) {
        const nextStatus = {
          ...(data.systemStatus ?? pending),
          inputText: pending.inputText,
          isGuest: false,
          authority: resultAuthority,
        };
        applyTurnCompletionResult("auth-retry-failure", resultAuthority, {
          executionStatus: nextStatus,
        });
        return;
      }
      applyTurnCompletionResult("auth-retry-success", resultAuthority, {
        executionStatus: null,
      });
      const assistant: Message = {
        id: data.assistantMessage.id,
        role: "assistant",
        text: "",
        createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
        promptVersion: data.assistantMessage.promptVersion,
        interactionMoveEnvelope: data.assistantMessage.interactionMoveEnvelope,
        debugTrace: data.debugTrace,
      };
      setMessages((current) => [...current, assistant]);
      await revealAssistantReply(assistant.id, data.assistantMessage.content);
    } catch (error) {
      const completion = {
        executionStatus: pending,
        errorMessage: getErrorMessage(error),
      };
      if (pending.isGuest) {
        applyTurnCompletionResult("guest-retry-transport", resultAuthority, completion);
      } else {
        applyTurnCompletionResult("auth-retry-transport", resultAuthority, completion);
      }
    }
  };

  const loginForDebug = async () => {
    setIsDebugLoggingIn(true);
    setErrorMessage("");

    try {
      const data = await apiRequest<{ user: AuthUser; token: string; expiresAt: string }>(
        "/api/auth/wechat",
        {
          method: "POST",
          auth: false,
          body: { code: `web_mock_debug_${Date.now()}` },
        }
      );
      saveAuth(data);
      window.sessionStorage.removeItem(GUEST_MODE_KEY);
      window.location.assign("/chat?debugAi=1");
    } catch (error) {
      clearAuth();
      setErrorMessage(getErrorMessage(error));
      setIsDebugLoggingIn(false);
    }
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute inset-x-0 top-0 h-[30px] bg-[var(--page-bg)]" />

        <Link
          href="/"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
          aria-label="返回首页"
        >
          ‹ 返回
        </Link>

        <h1 className="absolute left-[22px] top-[82px] h-[38px] w-[345px] text-[28px] font-semibold leading-[38px]">
          慢慢说。
        </h1>

        {date ? (
          <p className="absolute left-[22px] top-[122px] h-[18px] w-[260px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
            {formatChatDate(date)} 的聊天
          </p>
        ) : null}

        {showAiDebugTrace && isGuestMode ? (
          <button
            type="button"
            onClick={loginForDebug}
            disabled={isDebugLoggingIn}
            className="absolute left-[22px] top-[124px] z-20 rounded-md border border-[var(--line)] bg-white/70 px-2 py-1 text-[11px] font-semibold leading-4 text-[var(--sage)] disabled:opacity-60"
          >
            {isDebugLoggingIn ? "登录中" : "debug 登录"}
          </button>
        ) : null}

        <button
          type="button"
          aria-label="打开聊天菜单"
          aria-expanded={isMenuOpen}
          className="absolute left-[328px] top-[78px] z-[2147483601] h-[22px] w-10 text-center text-lg font-semibold leading-[22px] text-[var(--sage)]"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          ···
        </button>

        {isMenuOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭聊天菜单"
              className="absolute inset-0 z-[2147483599] bg-[var(--page-bg)]/60"
              onClick={() => setIsMenuOpen(false)}
            />
            <div className="absolute left-[174px] top-[108px] z-[2147483600] h-[126px] w-[194px] rounded-2xl bg-[var(--card-warm)]">
              <Link
                href="/chat/calendar"
                className="absolute left-[22px] top-6 flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="进入聊天日历"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>聊天日历</span>
              </Link>
              <div className="absolute left-5 top-[63px] h-px w-[154px] bg-[var(--line)]" />
              <Link
                href="/chat/search"
                className="absolute left-[22px] top-[82px] flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="查找聊天内容"
              >
                <Search className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>查找聊天内容</span>
              </Link>
            </div>
          </>
        ) : null}

        {messages.length === 0 ? (
          <>
            <div className="absolute left-[242px] top-[178px] h-28 w-28 rounded-full bg-[#f4e4d3]" />
            <Image
              src="/quiet-leaf.svg"
              alt=""
              width={125}
              height={115}
              priority
              className="absolute left-[244px] top-[168px] h-[115px] w-[125px]"
            />

            <p className="absolute left-[30px] top-80 h-[66px] w-80 whitespace-pre-line text-xl font-medium leading-[33px] text-[var(--soft-copy)] opacity-80">
              {isLoadingMessages
                ? "正在把之前的话\n轻轻拿回来。"
                : errorMessage
                  ? `${errorMessage}\n可以稍后再试。`
                  : "可以只说一句话，\n也可以只留一个词。"}
            </p>
          </>
        ) : (
          <div
            ref={messagesScrollRef}
            onScroll={handleMessagesScroll}
            aria-busy={isLoadingOlderMessages}
            className="chat-scrollbar absolute left-[22px] right-[18px] top-[150px] flex max-h-[534px] flex-col gap-2 overflow-y-auto pb-5 pr-3"
          >
            {messages.map((message, index) => (
              <div key={message.id} data-message-id={message.id} className="flex flex-col">
                {shouldShowMessageTime(message, messages[index - 1]) ? (
                  <div className="mb-2 mt-1 text-center text-[10px] leading-4 text-[var(--muted)]">
                    {formatMessageTime(message.createdAt)}
                  </div>
                ) : null}
                <div
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[274px] rounded-[18px] bg-[var(--sage)] px-3.5 py-3 text-[13px] leading-[22px] text-[var(--card-warm)]"
                      : "mr-auto max-w-[306px] rounded-[18px] bg-[var(--card-warm)] px-3.5 py-3 text-[13px] leading-[22px] text-[var(--body)]"
                  }
                >
                  {message.text}
                </div>
                {showAiDebugTrace && message.role === "assistant" && message.debugTrace ? (
                  <details className="mr-auto mt-1 max-w-[306px] rounded-[10px] border border-[var(--line)] bg-white/55 px-3 py-2 text-[11px] leading-[18px] text-[var(--soft-copy)]">
                    <summary className="cursor-pointer select-none font-semibold text-[var(--sage)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--sage)]">
                      AI debug
                    </summary>
                    <div className="mt-2 space-y-2">
                      {getDebugLayers(message.debugTrace).map((layer) => (
                        <section key={layer.title} className="border-l-2 border-[var(--line)] pl-2">
                          <div className="font-semibold text-[var(--ink)]">{layer.title}</div>
                          <p className="mt-0.5 text-[var(--body)]">{layer.body}</p>
                        </section>
                      ))}
                      <details className="border-t border-[var(--line)] pt-2">
                        <summary className="cursor-pointer select-none font-semibold text-[var(--sage)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--sage)]">
                          工程信息
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[var(--muted)]">
                          {formatEngineDetails(message.debugTrace)}
                        </pre>
                      </details>
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <form
          className="absolute left-[18px] top-[716px] h-[54px] w-[354px] rounded-2xl bg-[var(--card-warm)]"
          onSubmit={handleSubmit}
        >
          <input
            aria-label="聊天输入"
            placeholder="说点什么"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="absolute left-4 top-[17px] h-5 w-[230px] bg-transparent text-[13px] leading-5 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
          <button
            type="submit"
            disabled={isLoadingMessages || !sessionId}
            className="absolute left-[288px] top-2 h-[38px] w-14 rounded-[14px] bg-[var(--sage)] text-xs font-semibold leading-[18px] text-[var(--card-warm)] disabled:bg-[#d8d1c9]"
          >
            发送
          </button>
        </form>

        {executionStatus ?? greetingStatus ? (
          <div
            role="status"
            className="absolute bottom-[82px] left-[18px] right-[18px] flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--page-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--soft-copy)]"
          >
            <span>{(executionStatus ?? greetingStatus)?.message}</span>
            {(executionStatus ?? greetingStatus)?.retryable ? (
              <button
                type="button"
                onClick={handleExecutionRetry}
                className="ml-3 shrink-0 font-semibold text-[var(--sage)]"
              >
                重新生成
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export default function ChatClient({ initialChat }: { initialChat: InitialChatData }) {
  return (
    <Suspense fallback={null}>
      <ChatContent initialChat={initialChat} />
    </Suspense>
  );
}
