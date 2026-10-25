import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getGuestSessionManager, guestNoStore, readGuestJson } from "@/lib/guest-session";
import { requireNonEmptyString } from "@/lib/validation";
import {
  activeHandoff,
  buildCommittedResponseMove,
  buildResponsePlanAssistantMoveEnvelope,
  buildSafetyAssistantMoveEnvelope,
  parseCommittedAssistantMoveEnvelope,
} from "@/conversation-os";
import { createChatReply } from "@/services/ai/chatOrchestrationService";
import { AiConversationMessage, AiJudgeResult } from "@/services/ai/types";

const normalizeRecentMessages = (value: unknown): AiConversationMessage[] => {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-24)
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const role = record.role;
      const id = record.id;
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
          id: typeof id === "string" ? id : undefined,
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
    const body = await readGuestJson(request);
    const sessions = getGuestSessionManager();
    const authority = sessions.authorize(request, body.conversationId);
    const content = requireNonEmptyString(body.content, "content", 2000);
    const suppliedTurnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    const turnId = suppliedTurnId;
    const recentMessages = normalizeRecentMessages(body.recentMessages);
    if (body.retry === true) throw new AppError("CONFLICT", "重试需要明确的尝试编号", 409, { reason: "GUEST_REQUEST_CONFLICT" });
    const includeDebugTrace = shouldIncludeDebugTrace(request, body);
    const payload = await sessions.execute({
      request,
      authority,
      endpoint: "reply",
      turnId,
      retryOfAttempt: body.retryOfAttempt,
      inputs: { content, recentMessages, includeDebugTrace },
    }, async (attempt) => {
      const createdAt = new Date().toISOString();
      const reply = await createChatReply({
        conversationId: authority.conversationId,
        currentTurnId: turnId,
        retrying: attempt > 1,
        userMessage: content,
        recentMessages,
        includeDebugTrace,
      });
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
      const committedMove = buildCommittedResponseMove({
        plan: reply.controlTrace?.responsePlan,
        replyText: reply.generation.text,
        sourceUserTurnId: turnId,
        planId: reply.execution.planId,
        requestId: reply.execution.requestId,
      });
      const adjacentAssistantId = recentMessages.at(-1)?.id;
      const interactionMoveEnvelope = reply.finalSource === "safety"
        ? adjacentAssistantId && activeHandoff(
            adjacentAssistantId,
            turnId,
            [...recentMessages, { id: turnId, role: "user", content }]
          )
          ? buildSafetyAssistantMoveEnvelope({
              assistantMoveId,
              safetyTraceId: reply.execution.requestId,
              sourceUserTurnId: turnId,
              committedMove,
              sourceAssistantMoveId: adjacentAssistantId,
            })
          : null
        : buildResponsePlanAssistantMoveEnvelope({
            assistantMoveId,
            planId: reply.execution.planId,
            sourceUserTurnId: turnId,
            committedMove,
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
    });
    return guestNoStore(ok(payload));
  } catch (error) {
    return guestNoStore(failFromError(error));
  }
}
