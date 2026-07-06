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
import {
  extractUnderstandingFromMessage,
  writeUnderstandingExtraction,
} from "@/services/understanding/extractService";
import { updateUnderstandingHypotheses } from "@/services/understanding/hypothesisService";
import { buildStructuredRagContext } from "@/services/understanding/retrievalService";

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

    const [items, total] = await prisma.$transaction([
      prisma.chatMessage.findMany({
        where: {
          sessionId,
          userId: user.id,
        },
        orderBy: { createdAt: "asc" },
        skip: pagination.skip,
        take: pagination.take,
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
        },
      }),
    ]);

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
    const content = requireNonEmptyString(body.content, "content", 2000);
    const includeDebugTrace = shouldIncludeDebugTrace(request, body);
    const now = new Date();

    const recentMessages = await prisma.chatMessage.findMany({
      where: {
        sessionId,
        userId: user.id,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        role: true,
        content: true,
        aiGenerationId: true,
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
        role: item.role.toLowerCase() as "user" | "assistant" | "system",
        content: item.content,
        promptVersion: item.aiGeneration?.promptVersion ?? null,
        aiGenerationId: item.aiGenerationId,
      }));

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          sessionId,
          userId: user.id,
          role: MessageRole.USER,
          content,
          status: MessageStatus.SAVED,
        },
        select: {
          id: true,
          role: true,
          content: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          lastMessage: content,
          lastMessageAt: now,
        },
      });

      return created;
    });

    const understandingExtraction = await extractUnderstandingFromMessage({
      userId: user.id,
      sourceType: "chat",
      sourceId: message.id,
      content,
      createdAt: message.createdAt,
      recentMessages: serializedRecentMessages,
    });
    const understandingContext = await buildStructuredRagContext({
      userId: user.id,
      extraction: understandingExtraction,
      currentMessage: content,
      now: message.createdAt,
    });

    const reviewedReply = await createReviewedChatReply({
      userId: user.id,
      sessionId,
      userMessage: content,
      recentMessages: serializedRecentMessages,
      understandingContext,
      includeDebugTrace,
    });

    const writtenUnderstanding = await writeUnderstandingExtraction({
      userId: user.id,
      sourceType: "chat",
      sourceId: message.id,
      createdAt: message.createdAt,
      extraction: understandingExtraction,
    }).catch((error) => {
      console.error("understanding write failed", error);
      return null;
    });

    if (writtenUnderstanding) {
      await updateUnderstandingHypotheses({
        userId: user.id,
        extraction: understandingExtraction,
        writtenFacts: writtenUnderstanding.facts,
      }).catch((error) => {
        console.error("understanding hypothesis update failed", error);
      });
    }

    await extractExperienceFromChatMessage({
      userId: user.id,
      sessionId,
      messageId: message.id,
      content,
      createdAt: message.createdAt,
    }).catch((error) => {
      console.error("experience extraction failed", error);
    });

    return ok(
      {
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
