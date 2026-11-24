import { createHash } from "node:crypto";
import { MessageRole, MessageStatus, Prisma, type AiMessageFeedbackSignal } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const visibleStatuses = [MessageStatus.SAVED, MessageStatus.REWRITTEN, MessageStatus.FALLBACK];

type FeedbackTarget = {
  userId: string;
  assistantMessageId: string;
};

const publishedReply = ({ userId, assistantMessageId }: FeedbackTarget): Prisma.ChatMessageWhereInput => ({
  id: assistantMessageId,
  userId,
  role: MessageRole.ASSISTANT,
  contentDeletedAt: null,
  status: { in: visibleStatuses },
  user: { status: "ACTIVE" },
  session: { userId },
});

export const recordChatReplyFeedback = async (input: FeedbackTarget & {
  signal: AiMessageFeedbackSignal;
  tags: string[] | null;
  comment: string | null;
  sourceMessageId?: string | null;
}) => prisma.$transaction(async (tx) => {
  const { userId, signal, tags, comment, sourceMessageId } = input;
  const message = await tx.chatMessage.findFirst({
    where: publishedReply(input),
    select: { id: true, aiGenerationId: true, sessionId: true, createdAt: true },
  });
  if (!message) throw new AppError("NOT_FOUND", "AI 消息不存在", 404);

  if (sourceMessageId) {
    const source = await tx.chatMessage.findFirst({
      where: {
        id: sourceMessageId,
        userId,
        sessionId: message.sessionId,
        role: MessageRole.USER,
        contentDeletedAt: null,
        status: { in: visibleStatuses },
        createdAt: { gt: message.createdAt },
      },
      select: { id: true },
    });
    if (!source) throw new AppError("VALIDATION_ERROR", "反馈原话必须是该会话中晚于目标回复的用户消息", 400, {
      field: "sourceMessageId",
    });
  }

  return tx.aiMessageFeedback.upsert({
    where: { userId_messageId_signal: { userId, messageId: message.id, signal } },
    update: { tags: tags ?? Prisma.JsonNull, comment, ...(sourceMessageId !== undefined ? { sourceMessageId } : {}) },
    create: {
      userId,
      messageId: message.id,
      aiGenerationId: message.aiGenerationId,
      signal,
      tags: tags ?? Prisma.JsonNull,
      comment,
      sourceMessageId,
    },
    select: { id: true, signal: true, createdAt: true, updatedAt: true },
  });
});

// Keep the evidence and approval lookups in the same snapshot when reading reviewed advice.
export const readReplyFeedbackSnapshotInTransaction = async (tx: Prisma.TransactionClient, input: FeedbackTarget) => {
  const target = await tx.chatMessage.findFirst({
    where: publishedReply(input),
    select: {
      id: true,
      content: true,
      sessionId: true,
      createdAt: true,
      replyToMessageId: true,
      feedbacks: {
        where: { userId: input.userId },
        orderBy: { signal: "asc" },
        select: { id: true, signal: true, tags: true, comment: true, sourceMessageId: true },
      },
    },
  });
  if (!target) return null;

  const sourceIds = [target.replyToMessageId, ...target.feedbacks.map(({ sourceMessageId }) => sourceMessageId)]
    .filter((id): id is string => id !== null);
  const sources = sourceIds.length ? await tx.chatMessage.findMany({
    where: {
      id: { in: sourceIds },
      userId: input.userId,
      sessionId: target.sessionId,
      role: MessageRole.USER,
      contentDeletedAt: null,
      status: { in: visibleStatuses },
    },
    select: { id: true, content: true, createdAt: true },
  }) : [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const projectUserMessage = (id: string | null, kind: "trigger" | "feedback") => {
    const source = id ? byId.get(id) : undefined;
    if (!source || (kind === "trigger" ? source.createdAt > target.createdAt : source.createdAt <= target.createdAt)) return null;
    return { id: source.id, content: source.content };
  };

  const snapshot = {
    assistantMessage: { id: target.id, content: target.content },
    userMessage: projectUserMessage(target.replyToMessageId, "trigger"),
    feedback: target.feedbacks.flatMap(({ id, signal, tags, comment, sourceMessageId }) => {
      const source = projectUserMessage(sourceMessageId, "feedback");
      if (sourceMessageId && !source) return [];
      return [{ id, signal, tags, comment, sourceMessage: source }];
    }),
  };
  const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { ...snapshot, version };
};

export const readReplyFeedbackSnapshot = (input: FeedbackTarget) =>
  prisma.$transaction((tx) => readReplyFeedbackSnapshotInTransaction(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
