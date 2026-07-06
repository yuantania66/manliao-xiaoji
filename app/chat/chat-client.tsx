"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, Search } from "lucide-react";

import { apiRequest, ClientApiError } from "@/lib/client-api";
import { clearAuth, getStoredAuth, saveAuth } from "@/lib/client-auth";
import { isProactiveGreetingPromptVersion } from "@/lib/proactive-greeting";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  promptVersion?: string | null;
  debugTrace?: AiDebugTrace;
};

type AiDebugTrace = {
  visibleSteps: string[];
  thinkingLayers?: {
    title: string;
    body: string;
    evidence: string[];
  }[];
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
    safetyUsed?: boolean;
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
};

type ChatMessagesListResponse = {
  items: ChatMessageResponse[];
};

type CachedChat = {
  sessionId: string;
  messages: Message[];
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
const GUEST_AI_DAILY_LIMIT = 3;
const GUEST_SESSION_ID = "guest-session";
const LOCAL_DEMO_TOKEN_PREFIX = "local_demo_";
const GUEST_AI_LIMIT_MESSAGE =
  "今天的游客体验次数用完啦。登录后可以继续慢慢说，也能保存聊天回看。";

const TYPEWRITER_STEP_MIN = 2;
const TYPEWRITER_STEP_MAX = 5;
const TYPEWRITER_DELAY_MIN_MS = 110;
const TYPEWRITER_DELAY_MAX_MS = 220;
const RETURN_GREETING_IDLE_MS = 30 * 60 * 1000;

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
    `审查: disabled / ${trace.judge.reason}`,
    `路线: ${trace.route.finalSource}, rewrite=${trace.route.rewriteAttempted}, fallback=${trace.route.fallbackUsed}`,
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
    return Array.isArray(cached) ? (cached as Message[]) : [];
  } catch {
    return [];
  }
};

const writeGuestMessages = (messages: Message[]) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(GUEST_CHAT_CACHE_KEY, JSON.stringify(messages));
};

const createGuestGreetingMessage = async ({
  kind,
  recentMessages,
}: {
  kind: "initial" | "return";
  recentMessages: Message[];
}): Promise<Message | null> => {
  try {
    const data = await apiRequest<{ assistantMessage: ChatMessageResponse }>(
      "/api/chat/guest/greeting",
      {
        method: "POST",
        auth: false,
        body: {
          kind,
          recentMessages: recentMessages.slice(-6).map((message) => ({
            role: message.role,
            content: message.text,
            promptVersion: message.promptVersion,
          })),
        },
      }
    );

    return {
      id: data.assistantMessage.id,
      role: "assistant",
      text: data.assistantMessage.content,
      createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
      promptVersion: data.assistantMessage.promptVersion,
    };
  } catch {
    return null;
  }
};

const readOrSeedGuestMessages = async (): Promise<Message[]> => {
  const messages = readGuestMessages();
  if (messages.length > 0) {
    const latestMessage = messages[messages.length - 1];
    const latestTime = new Date(latestMessage.createdAt).getTime();
    const isIdle =
      !Number.isFinite(latestTime) || Date.now() - latestTime >= RETURN_GREETING_IDLE_MS;

    if (isIdle && !isProactiveGreetingPromptVersion(latestMessage.promptVersion)) {
      const greeting = await createGuestGreetingMessage({
        kind: "return",
        recentMessages: messages,
      });
      if (!greeting) return messages;
      const nextMessages = [...messages, greeting];
      writeGuestMessages(nextMessages);
      return nextMessages;
    }

    return messages;
  }

  const greeting = await createGuestGreetingMessage({ kind: "initial", recentMessages: [] });
  if (!greeting) return [];
  const seeded = [greeting];
  writeGuestMessages(seeded);
  return seeded;
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
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [typingMessageIds, setTypingMessageIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isDebugLoggingIn, setIsDebugLoggingIn] = useState(false);
  const typingCancelledRef = useRef(false);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const hydratedFromCacheRef = useRef(false);
  const positionedTargetRef = useRef<string | null>(null);

  const getErrorMessage = (error: unknown) => {
    if (error instanceof ClientApiError) return error.message;
    if (error instanceof Error) return error.message;
    return "服务暂时不可用，请稍后再试";
  };

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
        setMessages(await readOrSeedGuestMessages());
        setIsLoadingMessages(false);
        return;
      }

      setIsGuestMode(false);
      const cached = readChatCache();
      if (!hydratedFromCacheRef.current && cached && !requestedSessionId) {
        hydratedFromCacheRef.current = true;
        setSessionId(cached.sessionId);
        setMessages(cached.messages);
      }

      if (initialChat && !requestedSessionId) {
        writeChatCache(initialChat);
      }

      if (initialChat && canUseInitialChat) {
        setSessionId(initialChat.sessionId);
        setMessages(initialChat.messages);
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
        setMessages(nextMessages);
        writeChatCache({ sessionId: activeSessionId, messages: nextMessages });
      } catch (error) {
        if (cancelled) return;
        setMessages([]);
        setErrorMessage(getErrorMessage(error));
      } finally {
        if (!cancelled) setIsLoadingMessages(false);
      }
    };

    loadChat();

    return () => {
      cancelled = true;
    };
  }, [canUseInitialChat, initialChat, requestedSessionId]);

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

    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [date, messages, targetMessageId, typingMessageIds]);

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

    const optimisticId = `optimistic-${Date.now()}`;
    const pendingAssistantId = `typing-${Date.now()}`;
    const now = new Date().toISOString();
    const userMessage: Message = { id: optimisticId, role: "user", text, createdAt: now };
    setMessages((current) => [
      ...current,
      userMessage,
      { id: pendingAssistantId, role: "assistant", text: "...", createdAt: now },
    ]);
    setTypingMessageIds((current) => [...current, pendingAssistantId]);
    setInput("");
    setErrorMessage("");

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
        const assistantMessage: Message = {
          id: `guest-limit-${Date.now()}`,
          role: "assistant",
          text: GUEST_AI_LIMIT_MESSAGE,
          createdAt: new Date().toISOString(),
        };
        await replacePendingAssistant(assistantMessage);
        return;
      }

      try {
        const data = await apiRequest<{
          assistantMessage: ChatMessageResponse;
          fallbackUsed: boolean;
          debugTrace?: AiDebugTrace;
        }>("/api/chat/guest", {
          method: "POST",
          auth: false,
          body: {
            content: text,
            debugTrace: showAiDebugTrace,
            recentMessages: messages.slice(-8).map((message) => ({
              role: message.role,
              content: message.text,
              promptVersion: message.promptVersion,
            })),
          },
        });
        if (!showAiDebugTrace) {
          incrementGuestAiUsage();
        }
        await replacePendingAssistant({
          id: data.assistantMessage.id,
          role: "assistant",
          text: data.assistantMessage.content,
          createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
          promptVersion: data.assistantMessage.promptVersion,
          debugTrace: data.debugTrace,
        });
      } catch (error) {
        setMessages((current) =>
          current.filter(
            (message) => message.id !== pendingAssistantId && message.id !== optimisticId
          )
        );
        setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
        setErrorMessage(getErrorMessage(error));
      }
      return;
    }

    try {
      const data = await apiRequest<{
        userMessage: ChatMessageResponse;
        assistantMessage: ChatMessageResponse;
        debugTrace?: AiDebugTrace;
      }>(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { content: text, debugTrace: showAiDebugTrace },
      });
      setTypingMessageIds((current) =>
        current.filter((id) => id !== pendingAssistantId).concat(data.assistantMessage.id)
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
          id: data.assistantMessage.id,
          role: "assistant",
          text: "",
          createdAt: data.assistantMessage.createdAt ?? new Date().toISOString(),
          promptVersion: data.assistantMessage.promptVersion,
          debugTrace: data.debugTrace,
        },
      ]);
      await revealAssistantReply(data.assistantMessage.id, data.assistantMessage.content);
      const refreshed = await apiRequest<ChatMessagesListResponse>(
        `/api/chat/sessions/${sessionId}/messages?pageSize=50`
      );
      writeChatCache({ sessionId, messages: toMessages(refreshed.items) });
    } catch (error) {
      setMessages((current) =>
        current.filter(
          (message) => message.id !== pendingAssistantId && message.id !== optimisticId
        )
      );
      setTypingMessageIds((current) => current.filter((id) => id !== pendingAssistantId));
      setErrorMessage(getErrorMessage(error));
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
