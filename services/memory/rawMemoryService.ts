import {
  MemoryActor,
  Prisma,
  RawMemoryEventType,
  RawMemoryKind,
  RawMemorySourceType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { createRefinementJobForRawMemory } from "./refinementJobService";

type PrismaClientLike = Prisma.TransactionClient;
type AppendRawMemoryEventType = typeof RawMemoryEventType.TOMBSTONE | typeof RawMemoryEventType.REDACTION;

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const createRawMemoryCreatedEvent = async ({
  tx,
  userId,
  rawMemoryId,
  metadata,
}: {
  tx: PrismaClientLike;
  userId: string;
  rawMemoryId: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  tx.rawMemoryEvent.create({
    data: {
      userId,
      rawMemoryId,
      eventType: RawMemoryEventType.CREATED,
      metadata,
      createdBy: MemoryActor.SYSTEM,
    },
  });

export const appendRawMemoryEvent = async ({
  rawMemoryId,
  userId,
  eventType,
  reason,
  metadata,
}: {
  rawMemoryId: string;
  userId: string;
  eventType: AppendRawMemoryEventType;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
}) =>
  prisma.rawMemoryEvent.create({
    data: {
      rawMemoryId,
      userId,
      eventType,
      reason,
      metadata,
      createdBy: MemoryActor.SYSTEM,
    },
  });

export const createRawMemoryFromChatMessage = async ({
  chatMessageId,
  metadata,
}: {
  chatMessageId: string;
  metadata?: Prisma.InputJsonValue;
}) => {
  const rawMemory = await prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.findUniqueOrThrow({
      where: { id: chatMessageId },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        role: true,
        content: true,
        status: true,
        createdAt: true,
      },
    });

    const payload = {
      chatMessageId: message.id,
      sessionId: message.sessionId,
      role: message.role,
      status: message.status,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };

    const existing = await tx.rawMemory.findUnique({
      where: {
        userId_sourceType_sourceId_sourceRevision: {
          userId: message.userId,
          sourceType: RawMemorySourceType.CHAT_MESSAGE,
          sourceId: message.id,
          sourceRevision: 1,
        },
      },
    });
    if (existing) return existing;

    const rawMemory = await tx.rawMemory.create({
      data: {
        userId: message.userId,
        kind: RawMemoryKind.CONVERSATION_MESSAGE,
        sourceType: RawMemorySourceType.CHAT_MESSAGE,
        sourceId: message.id,
        sourceRevision: 1,
        sessionId: message.sessionId,
        conversationId: message.sessionId,
        role: message.role,
        content: message.content,
        payload: asJson(payload),
        metadata,
        occurredAt: message.createdAt,
      },
    });

    await createRawMemoryCreatedEvent({
      tx,
      userId: message.userId,
      rawMemoryId: rawMemory.id,
      metadata: metadata ?? asJson({ source: "chat_message" }),
    });

    return rawMemory;
  });

  await createRefinementJobForRawMemory({ rawMemoryId: rawMemory.id }).catch((error) => {
    console.error("refinement job raw memory creation failed", error);
  });

  return rawMemory;
};

export const createRawMemoryFromNote = async ({
  noteId,
  sourceRevision = 1,
  metadata,
}: {
  noteId: string;
  sourceRevision?: number;
  metadata?: Prisma.InputJsonValue;
}) => {
  const rawMemory = await prisma.$transaction(async (tx) => {
    const note = await tx.note.findUniqueOrThrow({
      where: { id: noteId },
      select: {
        id: true,
        userId: true,
        content: true,
        moodName: true,
        moodIcon: true,
        mediaUrls: true,
        recordDate: true,
        coreEventIds: true,
        emotionSliceIds: true,
        generatedFromChatIds: true,
        isDraft: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (note.isDraft) {
      throw new Error("Draft notes are not eligible for RawMemory until published.");
    }

    const payload = {
      noteId: note.id,
      content: note.content,
      moodName: note.moodName,
      moodIcon: note.moodIcon,
      mediaUrls: note.mediaUrls,
      recordDate: note.recordDate.toISOString(),
      coreEventIds: note.coreEventIds,
      emotionSliceIds: note.emotionSliceIds,
      generatedFromChatIds: note.generatedFromChatIds,
      isDraft: note.isDraft,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };

    const existing = await tx.rawMemory.findUnique({
      where: {
        userId_sourceType_sourceId_sourceRevision: {
          userId: note.userId,
          sourceType: RawMemorySourceType.NOTE,
          sourceId: note.id,
          sourceRevision,
        },
      },
    });
    if (existing) return existing;

    const rawMemory = await tx.rawMemory.create({
      data: {
        userId: note.userId,
        kind: RawMemoryKind.NOTE,
        sourceType: RawMemorySourceType.NOTE,
        sourceId: note.id,
        sourceRevision,
        content: note.content,
        payload: asJson(payload),
        metadata,
        occurredAt: note.recordDate,
      },
    });

    await createRawMemoryCreatedEvent({
      tx,
      userId: note.userId,
      rawMemoryId: rawMemory.id,
      metadata: metadata ?? asJson({ source: "note" }),
    });

    return rawMemory;
  });

  await createRefinementJobForRawMemory({ rawMemoryId: rawMemory.id }).catch((error) => {
    console.error("refinement job raw memory creation failed", error);
  });

  return rawMemory;
};
