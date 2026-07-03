import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireNonEmptyString } from "@/lib/validation";
import { createFallbackGeneration, generateChatReply } from "@/services/ai/aiService";
import { buildAiDebugTrace } from "@/services/ai/debugTrace";
import { AiConversationMessage, AiDebugTrace, AiGenerationResult, AiJudgeResult } from "@/services/ai/types";

type GuestRateLimitRecord = {
  date: string;
  count: number;
};

type GuestRateLimitGlobal = typeof globalThis & {
  __manliaoGuestAiRateLimit?: Map<string, GuestRateLimitRecord>;
};

const getGuestIpDailyLimit = () => {
  const value = Number(process.env.GUEST_AI_IP_DAILY_LIMIT ?? "20");
  return Number.isFinite(value) && value > 0 ? value : 20;
};

const getDateKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const getRateLimitStore = () => {
  const storeGlobal = globalThis as GuestRateLimitGlobal;
  if (!storeGlobal.__manliaoGuestAiRateLimit) {
    storeGlobal.__manliaoGuestAiRateLimit = new Map();
  }
  return storeGlobal.__manliaoGuestAiRateLimit;
};

const getClientIp = (request: NextRequest) => {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
};

const assertGuestIpLimit = (request: NextRequest) => {
  const ip = getClientIp(request);
  const date = getDateKey();
  const store = getRateLimitStore();
  const current = store.get(ip);
  const record = current?.date === date ? current : { date, count: 0 };

  if (record.count >= getGuestIpDailyLimit()) {
    throw new AppError("RATE_LIMITED", "游客体验暂时繁忙，请登录后继续慢慢说", 429);
  }

  store.set(ip, record);
  return { ip, record };
};

const incrementGuestIpUsage = (ip: string) => {
  const date = getDateKey();
  const store = getRateLimitStore();
  const current = store.get(ip);
  const record = current?.date === date ? current : { date, count: 0 };
  record.count += 1;
  store.set(ip, record);
};

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const normalizeRecentMessages = (value: unknown): AiConversationMessage[] => {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-8)
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      const promptVersion = record.promptVersion;
      const aiGenerationId = record.aiGenerationId;
      if (role !== "user" && role !== "assistant" && role !== "system") return [];
      if (typeof content !== "string" || !content.trim()) return [];
      return [
        {
          role,
          content: content.trim().slice(0, 2000),
          promptVersion: typeof promptVersion === "string" ? promptVersion : null,
          aiGenerationId: typeof aiGenerationId === "string" ? aiGenerationId : null,
        },
      ];
    });
};

const serializeJudge = (judge: AiJudgeResult & { judgeModel: string }) => ({
  passed: judge.passed,
  riskLevel: judge.riskLevel,
  issues: judge.issues,
  rewriteRequired: judge.rewriteRequired,
  reason: judge.reason,
});

const getFallbackRiskLevel = (content: string): AiJudgeResult["riskLevel"] =>
  /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(content) ? "crisis" : "low";

const createFallbackJudge = (
  riskLevel: AiJudgeResult["riskLevel"],
  reason: string
): AiJudgeResult & { judgeModel: string } => ({
  passed: true,
  riskLevel,
  issues: [],
  rewriteRequired: false,
  reason,
  judgeModel: "fallback-local",
});

const createDisabledJudge = (): AiJudgeResult & { judgeModel: string } =>
  createFallbackJudge("low", "judge/rewrite disabled; base model output returned directly");

const canReturnDebugTrace = () =>
  process.env.NODE_ENV !== "production" || process.env.AI_DEBUG_TRACE === "true";

const shouldIncludeDebugTrace = (request: NextRequest, body: Record<string, unknown>) =>
  canReturnDebugTrace() &&
  (body.debugTrace === true ||
    request.headers.get("x-ai-debug-trace") === "1" ||
    request.nextUrl.searchParams.get("debugAi") === "1");

export async function POST(request: NextRequest) {
  try {
    const { ip } = assertGuestIpLimit(request);
    const body = await readJson(request);
    const content = requireNonEmptyString(body.content, "content", 2000);
    const recentMessages = normalizeRecentMessages(body.recentMessages);
    const includeDebugTrace = shouldIncludeDebugTrace(request, body);
    const createdAt = new Date().toISOString();
    const maybeDebugTrace = ({
      generation,
      judge,
      finalSource,
      fallbackUsed,
      rewriteAttempted,
    }: {
      generation: AiGenerationResult;
      judge: AiJudgeResult & { judgeModel: string };
      finalSource: AiDebugTrace["route"]["finalSource"];
      fallbackUsed: boolean;
      rewriteAttempted: boolean;
    }) =>
      includeDebugTrace
        ? buildAiDebugTrace({
            userMessage: content,
            recentMessages,
            generation,
            judge,
            finalSource,
            fallbackUsed,
            rewriteAttempted,
          })
        : undefined;

    let mainGeneration;
    try {
      mainGeneration = await generateChatReply({
        userMessage: content,
        recentMessages,
      });
    } catch {
      const riskLevel = getFallbackRiskLevel(content);
      const fallback = createFallbackGeneration({
        inputText: content,
        riskLevel,
      });
      const fallbackJudge = createFallbackJudge(riskLevel, "AI 主回复为空或不可用，已使用 fallback");
      incrementGuestIpUsage(ip);

      return ok({
        assistantMessage: {
          id: `guest-ai-${Date.now()}`,
          role: "assistant",
          content: fallback.text,
          createdAt,
          promptVersion: fallback.promptVersion,
        },
        judge: serializeJudge(fallbackJudge),
        fallbackUsed: true,
        rewriteAttempted: false,
        debugTrace: maybeDebugTrace({
          generation: fallback,
          judge: fallbackJudge,
          finalSource: "fallback",
          fallbackUsed: true,
          rewriteAttempted: false,
        }),
      });
    }
    const judge = createDisabledJudge();
    incrementGuestIpUsage(ip);

    return ok({
      assistantMessage: {
        id: `guest-ai-${Date.now()}`,
        role: "assistant",
        content: mainGeneration.text,
        createdAt,
        promptVersion: mainGeneration.promptVersion,
      },
      judge: serializeJudge(judge),
      fallbackUsed: false,
      rewriteAttempted: false,
      debugTrace: maybeDebugTrace({
        generation: mainGeneration,
        judge,
        finalSource: "base_model",
        fallbackUsed: false,
        rewriteAttempted: false,
      }),
    });
  } catch (error) {
    return failFromError(error);
  }
}
