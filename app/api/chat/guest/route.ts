import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireNonEmptyString } from "@/lib/validation";
import {
  buildCommittedResponseMove,
  buildResponsePlanAssistantMoveEnvelope,
  parseCommittedAssistantMoveEnvelope,
} from "@/conversation-os";
import { createChatReply } from "@/services/ai/chatOrchestrationService";
import { AiConversationMessage, AiJudgeResult } from "@/services/ai/types";

type GuestRateLimitRecord = {
  date: string;
  count: number;
};

type GuestRateLimitGlobal = typeof globalThis & {
  __manliaoGuestAiRateLimit?: Map<string, GuestRateLimitRecord>;
  __manliaoGuestTurnExecutions?: Map<string, Promise<Record<string, unknown>>>;
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

const getGuestTurnExecutionStore = () => {
  const storeGlobal = globalThis as GuestRateLimitGlobal;
  if (!storeGlobal.__manliaoGuestTurnExecutions) {
    storeGlobal.__manliaoGuestTurnExecutions = new Map();
  }
  return storeGlobal.__manliaoGuestTurnExecutions;
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
    .slice(-24)
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      const promptVersion = record.promptVersion;
      const aiGenerationId = record.aiGenerationId;
      const createdAt = record.createdAt;
      const status = record.status;
      const parsedEnvelope = parseCommittedAssistantMoveEnvelope(
        record.interactionMoveEnvelope
      );
      if (role !== "user" && role !== "assistant" && role !== "system") return [];
      if (typeof content !== "string" || !content.trim()) return [];
      if (role === "system" || status === "blocked") return [];
      return [
        {
          role,
          content: content.trim().slice(0, 2000),
          promptVersion: typeof promptVersion === "string" ? promptVersion : null,
          aiGenerationId: typeof aiGenerationId === "string" ? aiGenerationId : null,
          createdAt: typeof createdAt === "string" ? createdAt : undefined,
          status: status === "saved" || status === "rewritten" || status === "fallback"
            ? status
            : undefined,
          interactionMoveEnvelope:
            parsedEnvelope.status === "valid" ? parsedEnvelope.envelope : undefined,
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

const canReturnDebugTrace = () =>
  process.env.NODE_ENV !== "production" || process.env.AI_DEBUG_TRACE === "true";

const shouldIncludeDebugTrace = (request: NextRequest, body: Record<string, unknown>) =>
  canReturnDebugTrace() &&
  (body.debugTrace === true ||
    request.headers.get("x-ai-debug-trace") === "1" ||
    request.nextUrl.searchParams.get("debugAi") === "1");

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const content = requireNonEmptyString(body.content, "content", 2000);
    const suppliedTurnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    const turnId = /^[a-zA-Z0-9:_-]{8,160}$/.test(suppliedTurnId)
      ? suppliedTurnId
      : `guest-turn-${crypto.randomUUID()}`;
    const recentMessages = normalizeRecentMessages(body.recentMessages);
    const retrying = body.retry === true;
    const includeDebugTrace = shouldIncludeDebugTrace(request, body);
    const rateLimit = includeDebugTrace ? null : assertGuestIpLimit(request);
    const store = getGuestTurnExecutionStore();
    if (store.size > 1000) store.delete(store.keys().next().value ?? "");
    const existing = store.get(turnId);
    const execution = existing ?? (async () => {
      const createdAt = new Date().toISOString();
      const reply = await createChatReply({
        conversationId: "guest-session",
        currentTurnId: turnId,
        retrying,
        userMessage: content,
        recentMessages,
        includeDebugTrace,
      });
      if (rateLimit) incrementGuestIpUsage(rateLimit.ip);
      if (reply.execution.phase !== "VALIDATED") {
        if (includeDebugTrace) {
          console.error("guest chat execution failed", {
            phase: reply.execution.phase,
            failure: reply.execution.failure,
            validationFailures: reply.controlTrace?.validation.flatMap(
              (validation) => validation.failureReasons
            ),
          });
        }
        const { toUserSafeExecutionStatus } = await import("@/services/ai/chatExecutionLifecycle");
        return {
          status: "failed",
          systemStatus: toUserSafeExecutionStatus(reply.execution),
          debugTrace: reply.debugTrace,
        };
      }
      const assistantMoveId = `guest-ai-${turnId}`;
      const interactionMoveEnvelope = reply.finalSource === "safety"
        ? null
        : buildResponsePlanAssistantMoveEnvelope({
            assistantMoveId,
            planId: reply.execution.planId,
            sourceUserTurnId: turnId,
            committedMove: buildCommittedResponseMove({
              plan: reply.controlTrace?.responsePlan,
              replyText: reply.generation.text,
              sourceUserTurnId: turnId,
              planId: reply.execution.planId,
              requestId: reply.execution.requestId,
            }),
            handoffCommitEvidence: reply.controlTrace
              ? {
                  executionPhase: "VALIDATED",
                  finalAttemptPhase: reply.execution.attempts.at(-1)?.phase ?? null,
                  executionPlanId: reply.execution.planId,
                  executionTurnId: reply.execution.turnId,
                  responsePlan: reply.controlTrace.responsePlan,
                  finalValidation: reply.execution.attempts.at(-1)?.validation ?? null,
                }
              : null,
          });
      const committedExecution = {
        ...reply.execution,
        phase: "COMMITTED" as const,
        transitions: [
          ...reply.execution.transitions,
          {
            phase: "COMMITTED" as const,
            reason: "Validated guest reply committed to the client-scoped conversation event stream.",
          },
        ],
        committedMessageId: assistantMoveId,
        ...(interactionMoveEnvelope ? { interactionMoveEnvelope } : {}),
      };
      if (reply.debugTrace) reply.debugTrace.execution = committedExecution;
      return {
        status: "committed",
        assistantMessage: {
          id: assistantMoveId,
          role: "assistant",
          content: reply.generation.text,
          createdAt,
          promptVersion: reply.generation.promptVersion,
          interactionMoveEnvelope,
        },
        judge: serializeJudge(reply.judge),
        fallbackUsed: reply.fallbackUsed,
        rewriteAttempted: reply.rewriteAttempted,
        debugTrace: reply.debugTrace,
      };
    })();
    if (!existing) store.set(turnId, execution);
    const payload = await execution;
    if (payload.status === "failed") store.delete(turnId);
    return ok(payload);
  } catch (error) {
    return failFromError(error);
  }
}
