import {
  AiGenerationStatus,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isProactiveGreetingPromptVersion } from "@/lib/proactive-greeting";
import {
  attachCommittedAssistantMoveEnvelope,
  buildProactiveGreetingAssistantMoveEnvelope,
  extractCommittedAssistantMoveEnvelope,
} from "@/conversation-os";
import {
  generateProactiveGreeting,
  type ProactiveGreetingGenerationResult,
} from "@/services/ai/proactiveGreeting";
import { AiConversationMessage } from "@/services/ai/types";
import { createRawMemoryFromChatMessage } from "@/services/memory/rawMemoryService";

const RETURN_GREETING_IDLE_MS = 30 * 60 * 1000;
const OPEN_GREETING_DEDUPE_MS = 2 * 1000;

export type ProactiveGreetingExecutionStatus = {
  type: "system_status";
  code: "PROACTIVE_GREETING_FAILED";
  message: string;
  retryable: true;
  turnId: string;
};

export type ProactiveGreetingEnsureResult =
  | { status: "committed"; message: Awaited<ReturnType<typeof createGreetingMessage>> }
  | { status: "not_due" }
  | { status: "retryable_failure"; systemStatus: ProactiveGreetingExecutionStatus };

const retryableGreetingFailure = (sessionId: string): ProactiveGreetingEnsureResult => ({
  status: "retryable_failure",
  systemStatus: {
    type: "system_status",
    code: "PROACTIVE_GREETING_FAILED",
    message: "欢迎语暂时没生成，可以直接发消息或重新生成。",
    retryable: true,
    turnId: `proactive-greeting:${sessionId}`,
  },
});

const createGreetingMessage = async ({
  sessionId,
  userId,
  generation,
  createdAt,
}: {
  sessionId: string;
  userId: string;
  generation: ProactiveGreetingGenerationResult;
  createdAt: Date;
}) => {
  const savedMessage = await prisma.$transaction(async (tx) => {
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
    const interactionMoveEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
      assistantMoveId: message.id,
      generationId: savedGeneration.id,
      intent: generation.proactiveIntent,
    });

    await tx.aiGeneration.update({
      where: { id: savedGeneration.id },
      data: {
        executionTrace: attachCommittedAssistantMoveEnvelope(
          null,
          interactionMoveEnvelope
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    await tx.chatSession.update({
      where: { id: sessionId },
      data: {
        lastMessage: generation.text,
        lastMessageAt: createdAt,
      },
    });

    return { ...message, interactionMoveEnvelope };
  });

  await createRawMemoryFromChatMessage({
    chatMessageId: savedMessage.id,
    metadata: { source: "proactive_greeting_service" },
  }).catch((error) => {
    console.error("raw memory proactive greeting write failed", error);
  });

  return savedMessage;
};

export const ensureProactiveChatGreeting = async ({
  sessionId,
  userId,
  force = false,
  dedupeWindowMs = OPEN_GREETING_DEDUPE_MS,
}: {
  sessionId: string;
  userId: string;
  force?: boolean;
  dedupeWindowMs?: number;
}): Promise<ProactiveGreetingEnsureResult> => {
  const latestMessage = await prisma.chatMessage.findFirst({
    where: {
      sessionId,
      userId,
      status: { not: MessageStatus.BLOCKED },
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
  if (
    force &&
    latestMessage &&
    isProactiveGreetingPromptVersion(latestMessage.aiGeneration?.promptVersion) &&
    now.getTime() - latestMessage.createdAt.getTime() < dedupeWindowMs
  ) {
    return { status: "not_due" };
  }

  const hasAnyCommittedMessage = Boolean(await prisma.chatMessage.findFirst({
    where: {
      userId,
      status: { not: MessageStatus.BLOCKED },
    },
    select: { id: true },
  }));

  const recentMessages = await prisma.chatMessage.findMany({
    where: {
      sessionId,
      userId,
      status: { not: MessageStatus.BLOCKED },
    },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: {
      role: true,
      content: true,
      aiGenerationId: true,
      aiGeneration: {
        select: {
          promptVersion: true,
          executionTrace: true,
        },
      },
    },
  });
  const greetingProjection = recentMessages.map((message) => {
    const interactionMoveEnvelope = extractCommittedAssistantMoveEnvelope(
      message.aiGeneration?.executionTrace
    );
    const isGreeting =
      (interactionMoveEnvelope?.origin.kind === "proactive_greeting") ||
      isProactiveGreetingPromptVersion(message.aiGeneration?.promptVersion);
    return { message, interactionMoveEnvelope, isGreeting };
  });
  const recentGreetings = greetingProjection
    .filter((item) => item.isGreeting)
    .slice(0, 3)
    .reverse()
    .map((item) => ({
      text: item.message.content,
      interactionMoveEnvelope: item.interactionMoveEnvelope,
    }));
  const modelMessages: AiConversationMessage[] = recentMessages
    .filter((message) => !greetingProjection.find((item) => item.message === message)?.isGreeting)
    .slice(0, 6)
    .reverse()
    .map((message) => ({
      role: message.role.toLowerCase() as "user" | "assistant" | "system",
      content: message.content,
      promptVersion: message.aiGeneration?.promptVersion ?? null,
      aiGenerationId: message.aiGenerationId,
    }));

  const generateWithOneRecovery = async (
    kind: "initial" | "return",
    messages: AiConversationMessage[]
  ) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await generateProactiveGreeting({
          kind,
          recentMessages: messages,
          recentGreetings,
        });
      } catch (error) {
        lastError = error;
        console.error(
          `proactive greeting generation attempt ${attempt + 1} failed`,
          error
        );
      }
    }
    throw lastError;
  };

  if (!latestMessage) {
    try {
      const generation = await generateWithOneRecovery(
        hasAnyCommittedMessage ? "return" : "initial",
        []
      );
      const message = await createGreetingMessage({ sessionId, userId, generation, createdAt: now });
      return { status: "committed", message };
    } catch (error) {
      console.error("proactive greeting generation failed", error);
      return retryableGreetingFailure(sessionId);
    }
  }

  if (!force && isProactiveGreetingPromptVersion(latestMessage.aiGeneration?.promptVersion)) {
    return { status: "not_due" };
  }

  const idleMs = now.getTime() - latestMessage.createdAt.getTime();
  if (!force && idleMs < RETURN_GREETING_IDLE_MS) return { status: "not_due" };

  try {
    const generation = await generateWithOneRecovery("return", modelMessages);
    const message = await createGreetingMessage({ sessionId, userId, generation, createdAt: now });
    return { status: "committed", message };
  } catch (error) {
    console.error("proactive greeting generation failed", error);
    return retryableGreetingFailure(sessionId);
  }
};
