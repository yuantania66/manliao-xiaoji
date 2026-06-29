import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireNonEmptyString } from "@/lib/validation";
import { createFallbackGeneration, generateChatReply } from "@/services/ai/aiService";
import { judgeReply } from "@/services/ai/aiJudgeService";
import { rewriteChatReply } from "@/services/ai/rewriteService";
import { AiConversationMessage, AiJudgeResult } from "@/services/ai/types";

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
      if (role !== "user" && role !== "assistant" && role !== "system") return [];
      if (typeof content !== "string" || !content.trim()) return [];
      return [{ role, content: content.trim().slice(0, 2000) }];
    });
};

const serializeJudge = (judge: AiJudgeResult & { judgeModel: string }) => ({
  passed: judge.passed,
  riskLevel: judge.riskLevel,
  issues: judge.issues,
  rewriteRequired: judge.rewriteRequired,
  reason: judge.reason,
});

export async function POST(request: NextRequest) {
  try {
    const { ip } = assertGuestIpLimit(request);
    const body = await readJson(request);
    const content = requireNonEmptyString(body.content, "content", 2000);
    const recentMessages = normalizeRecentMessages(body.recentMessages);
    const createdAt = new Date().toISOString();

    const mainGeneration = await generateChatReply({
      userMessage: content,
      recentMessages,
    });
    const firstJudge = await judgeReply({
      userMessage: content,
      assistantReply: mainGeneration.text,
      recentMessages,
    });

    if (firstJudge.passed) {
      incrementGuestIpUsage(ip);
      return ok({
        assistantMessage: {
          id: `guest-ai-${Date.now()}`,
          role: "assistant",
          content: mainGeneration.text,
          createdAt,
        },
        judge: serializeJudge(firstJudge),
        fallbackUsed: false,
        rewriteAttempted: false,
      });
    }

    if (firstJudge.rewriteRequired) {
      const rewritten = await rewriteChatReply({
        userMessage: content,
        originalReply: mainGeneration.text,
        judgeResult: firstJudge,
        recentMessages,
      });
      const secondJudge = await judgeReply({
        userMessage: content,
        assistantReply: rewritten.text,
        recentMessages,
      });

      if (secondJudge.passed) {
        incrementGuestIpUsage(ip);
        return ok({
          assistantMessage: {
            id: `guest-ai-${Date.now()}`,
            role: "assistant",
            content: rewritten.text,
            createdAt,
          },
          judge: serializeJudge(secondJudge),
          fallbackUsed: false,
          rewriteAttempted: true,
        });
      }
    }

    const fallback = createFallbackGeneration({
      inputText: content,
      riskLevel: firstJudge.riskLevel,
    });
    incrementGuestIpUsage(ip);

    return ok({
      assistantMessage: {
        id: `guest-ai-${Date.now()}`,
        role: "assistant",
        content: fallback.text,
        createdAt,
      },
      judge: serializeJudge(firstJudge),
      fallbackUsed: true,
      rewriteAttempted: firstJudge.rewriteRequired,
    });
  } catch (error) {
    return failFromError(error);
  }
}
