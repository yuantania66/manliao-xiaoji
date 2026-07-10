import {
  MessageRole,
  MessageStatus,
  RawMemoryEventType,
  RawMemoryKind,
  RawMemorySourceType,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import {
  appendRawMemoryEvent,
  createRawMemoryFromChatMessage,
  createRawMemoryFromNote,
} from "../services/memory/rawMemoryService";

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const phone = `memory-v2-raw-${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      phone,
      nickname: "memory-v2-raw-check",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.chatSession.create({
      data: {
        userId: user.id,
        title: "memory-v2-raw-check",
      },
      select: { id: true },
    });

    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        role: MessageRole.USER,
        status: MessageStatus.SAVED,
        content: "今天开会之后我有点累。",
      },
      select: { id: true },
    });

    const chatRaw = await createRawMemoryFromChatMessage({
      chatMessageId: message.id,
      metadata: { check: "chat" },
    });
    assert(chatRaw.userId === user.id, "Chat RawMemory userId mismatch");
    assert(chatRaw.sourceType === RawMemorySourceType.CHAT_MESSAGE, "Chat RawMemory sourceType mismatch");
    assert(chatRaw.sourceId === message.id, "Chat RawMemory sourceId mismatch");
    assert(chatRaw.kind === RawMemoryKind.CONVERSATION_MESSAGE, "Chat RawMemory kind mismatch");

    const chatCreatedEvents = await prisma.rawMemoryEvent.count({
      where: {
        rawMemoryId: chatRaw.id,
        eventType: RawMemoryEventType.CREATED,
      },
    });
    assert(chatCreatedEvents === 1, "Chat RawMemory should have one CREATED event");

    const duplicateChatRaw = await createRawMemoryFromChatMessage({ chatMessageId: message.id });
    assert(duplicateChatRaw.id === chatRaw.id, "Duplicate chat create should return existing RawMemory");
    const chatRawCount = await prisma.rawMemory.count({
      where: {
        userId: user.id,
        sourceType: RawMemorySourceType.CHAT_MESSAGE,
        sourceId: message.id,
      },
    });
    assert(chatRawCount === 1, `Expected 1 chat RawMemory, got ${chatRawCount}`);

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        content: "晚上散步后舒服了一些。",
        recordDate: new Date("2026-07-08T00:00:00.000Z"),
        moodName: "relieved",
        moodIcon: "leaf",
        isDraft: false,
      },
      select: { id: true },
    });

    const noteRaw = await createRawMemoryFromNote({
      noteId: note.id,
      metadata: { check: "note" },
    });
    assert(noteRaw.userId === user.id, "Note RawMemory userId mismatch");
    assert(noteRaw.sourceType === RawMemorySourceType.NOTE, "Note RawMemory sourceType mismatch");
    assert(noteRaw.sourceId === note.id, "Note RawMemory sourceId mismatch");
    assert(noteRaw.kind === RawMemoryKind.NOTE, "Note RawMemory kind mismatch");

    const duplicateNoteRaw = await createRawMemoryFromNote({ noteId: note.id });
    assert(duplicateNoteRaw.id === noteRaw.id, "Duplicate note create should return existing RawMemory");
    const noteRawCount = await prisma.rawMemory.count({
      where: {
        userId: user.id,
        sourceType: RawMemorySourceType.NOTE,
        sourceId: note.id,
      },
    });
    assert(noteRawCount === 1, `Expected 1 note RawMemory, got ${noteRawCount}`);

    const tombstone = await appendRawMemoryEvent({
      rawMemoryId: chatRaw.id,
      userId: user.id,
      eventType: RawMemoryEventType.TOMBSTONE,
      reason: "memory-v2 raw check tombstone",
      metadata: { check: "tombstone" },
    });
    assert(tombstone.eventType === RawMemoryEventType.TOMBSTONE, "TOMBSTONE event mismatch");

    const redaction = await appendRawMemoryEvent({
      rawMemoryId: chatRaw.id,
      userId: user.id,
      eventType: RawMemoryEventType.REDACTION,
      reason: "memory-v2 raw check redaction",
      metadata: { check: "redaction" },
    });
    assert(redaction.eventType === RawMemoryEventType.REDACTION, "REDACTION event mismatch");

    const eventCount = await prisma.rawMemoryEvent.count({
      where: { rawMemoryId: chatRaw.id },
    });
    assert(eventCount === 3, `Expected 3 chat raw events, got ${eventCount}`);

    console.log("Memory V2 raw checks passed");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
