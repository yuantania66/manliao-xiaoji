import { MessageRole, MessageStatus } from "@prisma/client";
import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { parsePagination, requireNonEmptyString } from "@/lib/validation";
import { createReviewedChatReply } from "@/services/ai/chatReplyService";
import { ensureProactiveChatGreeting } from "@/services/chat/proactiveGreetingService";
import { extractExperienceFromChatMessage } from "@/services/experience/experienceExtractorService";
import { createRawMemoryFromChatMessage } from "@/services/memory/rawMemoryService";
import { maybeMergeMemoryV2ResponseContext } from "@/services/memory/responseContextService";
import {
  extractUnderstandingFromMessage,
  writeUnderstandingExtraction,
} from "@/services/understanding/extractService";
import { updateUnderstandingHypotheses } from "@/services/understanding/hypothesisService";
import { buildStructuredRagContext } from "@/services/understanding/retrievalService";
import type { InteractionState } from "@/conversation-os/control";

const COMMITTED_MESSAGE_STATUSES = [
  MessageStatus.SAVED,
  MessageStatus.REWRITTEN,
  MessageStatus.FALLBACK,
];

const readJson = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON", 400);
  }
};

const assertSessionOwner = async (sessionId: string, userId: string) => {
  const session = await prisma.chatSession.findFirst({
    where: {
      id: sessionId,
      userId,
    },
    select: { id: true },
  });

  if (!session) throw new AppError("NOT_FOUND", "聊天会话不存在", 404);
};

const canReturnDebugTrace = () =>
  process.env.NODE_ENV !== "production" || process.env.AI_DEBUG_TRACE === "true";

const shouldIncludeDebugTrace = (request: NextRequest, body: Record<string, unknown>) =>
  canReturnDebugTrace() &&
  (body.debugTrace === true ||
    request.headers.get("x-ai-debug-trace") === "1" ||
    request.nextUrl.searchParams.get("debugAi") === "1");

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { sessionId } = await context.params;
    await assertSessionOwner(sessionId, user.id);
    await ensureProactiveChatGreeting({ sessionId, userId: user.id });

    const { searchParams } = new URL(request.url);
    const pagination = parsePagination(searchParams);
    const before = searchParams.get("before")?.trim() || null;
    const beforeMessage = before
      ? await prisma.chatMessage.findFirst({
          where: {
            id: before,
            sessionId,
            userId: user.id,
          },
          select: { id: true, createdAt: true },
        })
      : null;
    if (before && !beforeMessage) {
      throw new AppError("VALIDATION_ERROR", "before 游标无效", 400, { field: "before" });
    }

    const [newestItems, total] = await prisma.$transaction([
      prisma.chatMessage.findMany({
        where: {
          sessionId,
          userId: user.id,
          status: { in: COMMITTED_MESSAGE_STATUSES },
          ...(beforeMessage
            ? {
                OR: [
                  { createdAt: { lt: beforeMessage.createdAt } },
                  {
                    createdAt: beforeMessage.createdAt,
                    id: { lt: beforeMessage.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: beforeMessage ? 0 : pagination.skip,
        take: pagination.take + 1,
        select: {
          id: true,
          role: true,
          content: true,
          status: true,
          createdAt: true,
          aiGeneration: {
            select: {
              promptVersion: true,
            },
          },
        },
      }),
      prisma.chatMessage.count({
        where: {
          sessionId,
          userId: user.id,
          status: { in: COMMITTED_MESSAGE_STATUSES },
        },
      }),
    ]);
    const hasMore = newestItems.length > pagination.pageSize;
    const items = newestItems.slice(0, pagination.pageSize).reverse();

    return ok({
      items: items.map((item) => ({
        id: item.id,
        role: item.role.toLowerCase(),
        content: item.content,
        status: item.status.toLowerCase(),
        createdAt: item.createdAt.toISOString(),
        promptVersion: item.aiGeneration?.promptVersion ?? null,
      })),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      hasMore,
      nextCursor: hasMore ? items[0]?.id ?? null : null,
    });
  } catch (error) {
    return failFromError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { sessionId } = await context.params;
    await assertSessionOwner(sessionId, user.id);

    const body = await readJson(request);
    const retryTurnId = typeof body.retryTurnId === "string" ? body.retryTurnId.trim() : "";
    const suppliedTurnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
    if (suppliedTurnId && !/^[a-zA-Z0-9:_-]{8,160}$/.test(suppliedTurnId)) {
      throw new AppError("VALIDATION_ERROR", "turnId 格式无效", 400, { field: "turnId" });
    }
    const resolvedNewTurnId = suppliedTurnId || `turn-${crypto.randomUUID()}`;
    const requestedContent = retryTurnId
      ? null
      : requireNonEmptyString(body.content, "content", 2000);
    const includeDebugTrace = shouldIncludeDebugTrace(request, body);
    const now = new Date();
    const retryMessage = retryTurnId
      ? await prisma.chatMessage.findFirst({
          where: {
            id: retryTurnId,
            sessionId,
            userId: user.id,
            role: MessageRole.USER,
            status: { in: COMMITTED_MESSAGE_STATUSES },
          },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
          },
        })
      : null;
    if (retryTurnId && !retryMessage) {
      throw new AppError("NOT_FOUND", "可重试的用户消息不存在", 404);
    }
    const existingCurrentMessage = !retryMessage && suppliedTurnId
      ? await prisma.chatMessage.findFirst({
          where: {
            id: suppliedTurnId,
            sessionId,
            userId: user.id,
            role: MessageRole.USER,
            status: { in: COMMITTED_MESSAGE_STATUSES },
          },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
          },
        })
      : null;
    if (existingCurrentMessage && existingCurrentMessage.content !== requestedContent) {
      throw new AppError("VALIDATION_ERROR", "turnId 已用于另一条消息", 409, { field: "turnId" });
    }
    const content = retryMessage?.content ?? existingCurrentMessage?.content ?? requestedContent!;
    const sourceMessageForHistory = retryMessage ?? existingCurrentMessage;
    const existingCommittedReply = sourceMessageForHistory
      ? await prisma.chatMessage.findUnique({
          where: { replyToMessageId: sourceMessageForHistory.id },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            createdAt: true,
            aiGeneration: { select: { promptVersion: true } },
          },
        })
      : null;
    if (existingCommittedReply) {
      return ok({
        status: "committed",
        userMessage: {
          id: sourceMessageForHistory!.id,
          role: "user",
          content: sourceMessageForHistory!.content,
          status: sourceMessageForHistory!.status.toLowerCase(),
          createdAt: sourceMessageForHistory!.createdAt.toISOString(),
        },
        assistantMessage: {
          id: existingCommittedReply.id,
          role: "assistant",
          content: existingCommittedReply.content,
          status: existingCommittedReply.status.toLowerCase(),
          createdAt: existingCommittedReply.createdAt.toISOString(),
          promptVersion: existingCommittedReply.aiGeneration?.promptVersion ?? null,
        },
      });
    }

    const recentMessages = await prisma.chatMessage.findMany({
      where: {
        sessionId,
        userId: user.id,
        status: { in: COMMITTED_MESSAGE_STATUSES },
        ...(sourceMessageForHistory
          ? {
              OR: [
                { createdAt: { lt: sourceMessageForHistory.createdAt } },
                {
                  createdAt: sourceMessageForHistory.createdAt,
                  id: { lt: sourceMessageForHistory.id },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        aiGenerationId: true,
        status: true,
        replyToMessageId: true,
        interactionMetadata: true,
        aiGeneration: {
          select: {
            promptVersion: true,
          },
        },
      },
    });
    const serializedRecentMessages = recentMessages
      .slice()
      .reverse()
      .map((item) => ({
        id: item.id,
        role: item.role.toLowerCase() as "user" | "assistant" | "system",
        content: item.content,
        createdAt: item.createdAt.toISOString(),
        promptVersion: item.aiGeneration?.promptVersion ?? null,
        aiGenerationId: item.aiGenerationId,
        status: item.status.toLowerCase() as "saved" | "rewritten" | "fallback",
        replyToMessageId: item.replyToMessageId,
        committedAssistantMove: item.interactionMetadata as
          | InteractionState["lastCommittedAssistantMove"]
          | undefined,
      }));

    let userMessageCreated = false;
    const message = sourceMessageForHistory ?? await prisma.$transaction(async (tx) => {
      const inserted = await tx.chatMessage.createMany({
        data: [{
          id: resolvedNewTurnId,
          sessionId,
          userId: user.id,
          role: MessageRole.USER,
          content,
          status: MessageStatus.SAVED,
        }],
        skipDuplicates: true,
      });
      userMessageCreated = inserted.count === 1;
      const created = await tx.chatMessage.findUniqueOrThrow({
        where: { id: resolvedNewTurnId },
        select: {
          id: true,
          sessionId: true,
          userId: true,
          role: true,
          content: true,
          status: true,
          createdAt: true,
        },
      });
      if (
        created.sessionId !== sessionId ||
        created.userId !== user.id ||
        created.role !== MessageRole.USER ||
        created.content !== content
      ) {
        throw new AppError("VALIDATION_ERROR", "turnId 已用于另一条消息", 409, { field: "turnId" });
      }

      if (userMessageCreated) await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          lastMessage: content,
          lastMessageAt: now,
        },
      });

      return created;
    });

    if (userMessageCreated) await createRawMemoryFromChatMessage({
      chatMessageId: message.id,
      metadata: { source: "chat_api_user_message" },
    }).catch((error) => {
      console.error("raw memory chat message write failed", error);
    });

    const understandingExtraction = await extractUnderstandingFromMessage({
      userId: user.id,
      sourceType: "chat",
      sourceId: message.id,
      content,
      createdAt: message.createdAt,
      recentMessages: serializedRecentMessages,
    });
    const baseUnderstandingContext = await buildStructuredRagContext({
      userId: user.id,
      extraction: understandingExtraction,
      currentMessage: content,
      now: message.createdAt,
    });
    const understandingContext = await maybeMergeMemoryV2ResponseContext({
      userId: user.id,
      v1Context: baseUnderstandingContext,
    });

    const reviewedReply = await createReviewedChatReply({
      userId: user.id,
      sessionId,
      currentTurnId: message.id,
      retrying: Boolean(retryTurnId || existingCurrentMessage),
      userMessage: content,
      recentMessages: serializedRecentMessages,
      understandingContext,
      includeDebugTrace,
    });

    const writtenUnderstanding = userMessageCreated ? await writeUnderstandingExtraction({
      userId: user.id,
      sourceType: "chat",
      sourceId: message.id,
      createdAt: message.createdAt,
      extraction: understandingExtraction,
    }).catch((error) => {
      console.error("understanding write failed", error);
      return null;
    }) : null;

    if (writtenUnderstanding) {
      await updateUnderstandingHypotheses({
        userId: user.id,
        extraction: understandingExtraction,
        writtenFacts: writtenUnderstanding.facts,
      }).catch((error) => {
        console.error("understanding hypothesis update failed", error);
      });
    }

    if (userMessageCreated) await extractExperienceFromChatMessage({
      userId: user.id,
      sessionId,
      messageId: message.id,
      content,
      createdAt: message.createdAt,
    }).catch((error) => {
      console.error("experience extraction failed", error);
    });

    if (reviewedReply.outcome === "failed") {
      return ok(
        {
          status: "failed",
          userMessage: {
            id: message.id,
            role: message.role.toLowerCase(),
            content: message.content,
            status: message.status.toLowerCase(),
            createdAt: message.createdAt.toISOString(),
          },
          systemStatus: reviewedReply.systemStatus,
          debugTrace: reviewedReply.debugTrace,
        },
        200
      );
    }

    return ok(
      {
        status: "committed",
        userMessage: {
          id: message.id,
          role: message.role.toLowerCase(),
          content: message.content,
          status: message.status.toLowerCase(),
          createdAt: message.createdAt.toISOString(),
        },
        assistantMessage: reviewedReply.assistantMessage,
        judge: {
          passed: reviewedReply.judge.passed,
          riskLevel: reviewedReply.judge.riskLevel,
          issues: reviewedReply.judge.issues,
          rewriteRequired: reviewedReply.judge.rewriteRequired,
          reason: reviewedReply.judge.reason,
        },
        rewriteAttempted: reviewedReply.rewriteAttempted,
        fallbackUsed: reviewedReply.fallbackUsed,
        debugTrace: reviewedReply.debugTrace,
      },
      201
    );
  } catch (error) {
    return failFromError(error);
  }
}
