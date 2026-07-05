import { MessageRole, MessageStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createProactiveGreeting,
  createReturnGreeting,
  isProactiveGreetingText,
} from "@/lib/proactive-greeting";

const RETURN_GREETING_IDLE_MS = 30 * 60 * 1000;

const createGreetingMessage = async ({
  sessionId,
  userId,
  content,
  createdAt,
}: {
  sessionId: string;
  userId: string;
  content: string;
  createdAt: Date;
}) =>
  prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: {
        sessionId,
        userId,
        role: MessageRole.ASSISTANT,
        content,
        status: MessageStatus.SAVED,
        createdAt,
      },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        aiGeneration: {
          select: {
            promptVersion: true,
          },
        },
      },
    });

    await tx.chatSession.update({
      where: { id: sessionId },
      data: {
        lastMessage: content,
        lastMessageAt: createdAt,
      },
    });

    return message;
  });

export const ensureProactiveChatGreeting = async ({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}) => {
  const latestMessage = await prisma.chatMessage.findFirst({
    where: {
      sessionId,
      userId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      content: true,
      createdAt: true,
    },
  });

  const now = new Date();
  if (!latestMessage) {
    return createGreetingMessage({
      sessionId,
      userId,
      content: createProactiveGreeting(now),
      createdAt: now,
    });
  }

  if (isProactiveGreetingText(latestMessage.content)) return null;

  const idleMs = now.getTime() - latestMessage.createdAt.getTime();
  if (idleMs < RETURN_GREETING_IDLE_MS) return null;

  return createGreetingMessage({
    sessionId,
    userId,
    content: createReturnGreeting(now),
    createdAt: now,
  });
};
