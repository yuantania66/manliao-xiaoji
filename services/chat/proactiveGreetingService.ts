import { AiGenerationStatus, AiSourceType, MessageRole, MessageStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isProactiveGreetingPromptVersion } from "@/lib/proactive-greeting";
import { generateProactiveGreeting } from "@/services/ai/proactiveGreeting";
import { AiConversationMessage, AiGenerationResult } from "@/services/ai/types";

const RETURN_GREETING_IDLE_MS = 30 * 60 * 1000;

const createGreetingMessage = async ({
  sessionId,
  userId,
  generation,
  createdAt,
}: {
  sessionId: string;
  userId: string;
  generation: AiGenerationResult;
  createdAt: Date;
}) =>
  prisma.$transaction(async (tx) => {
    const savedGeneration = await tx.aiGeneration.create({
      data: {
        userId,
        sessionId,
        sourceType: AiSourceType.CHAT,
        sourceId: sessionId,
        model: generation.model,
        promptVersion: generation.promptVersion,
        inputText: "proactive_greeting",
        outputText: generation.text,
        latencyMs: generation.latencyMs,
        tokenInput: generation.tokenInput,
        tokenOutput: generation.tokenOutput,
        status: AiGenerationStatus.GENERATED,
      },
      select: { id: true },
    });

    const message = await tx.chatMessage.create({
      data: {
        sessionId,
        userId,
        role: MessageRole.ASSISTANT,
        content: generation.text,
        status: MessageStatus.SAVED,
        aiGenerationId: savedGeneration.id,
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
        lastMessage: generation.text,
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
      createdAt: true,
      aiGeneration: {
        select: {
          promptVersion: true,
        },
      },
    },
  });

  const now = new Date();
  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      sessionId,
      userId,
    },
    orderBy: { createdAt: "desc" },
    take: 6,
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
  const modelMessages: AiConversationMessage[] = recentMessages.reverse().map((message) => ({
    role: message.role.toLowerCase() as "user" | "assistant" | "system",
    content: message.content,
    promptVersion: message.aiGeneration?.promptVersion ?? null,
    aiGenerationId: message.aiGenerationId,
  }));

  if (!latestMessage) {
    try {
      const generation = await generateProactiveGreeting({
        kind: "initial",
        recentMessages: [],
        now,
      });
      return createGreetingMessage({ sessionId, userId, generation, createdAt: now });
    } catch (error) {
      console.error("proactive greeting generation failed", error);
      return null;
    }
  }

  if (isProactiveGreetingPromptVersion(latestMessage.aiGeneration?.promptVersion)) return null;

  const idleMs = now.getTime() - latestMessage.createdAt.getTime();
  if (idleMs < RETURN_GREETING_IDLE_MS) return null;

  try {
    const generation = await generateProactiveGreeting({
      kind: "return",
      recentMessages: modelMessages,
      now,
    });
    return createGreetingMessage({ sessionId, userId, generation, createdAt: now });
  } catch (error) {
    console.error("proactive greeting generation failed", error);
    return null;
  }
};
