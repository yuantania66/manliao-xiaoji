import {
  AiGenerationStatus,
  AiRiskLevel as PrismaAiRiskLevel,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { createChatReply } from "./chatOrchestrationService";
import { createChatMemoryContext, createNoteMemoryContext } from "./dataLayers";
import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
  AiMemoryContext,
  AiRiskLevel,
} from "./types";
import { createRawMemoryFromChatMessage } from "@/services/memory/rawMemoryService";
import { StructuredRagContext } from "@/services/understanding/understandingTypes";

const mapRiskLevel = (riskLevel: AiRiskLevel) => {
  const value = riskLevel.toUpperCase();
  if (value === "MEDIUM" || value === "HIGH" || value === "CRISIS") {
    return value as PrismaAiRiskLevel;
  }
  return PrismaAiRiskLevel.LOW;
};

const isStableMemoryText = (value: string) =>
  value.trim().length >= 6 && !/^([0-9０-９]+|[a-zA-Z]|[嗯啊哦好行对是])$/.test(value.trim());

const previewMemory = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 48);

const loadMemoryContext = async ({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}): Promise<AiMemoryContext | null> => {
  const note = await prisma.note.findFirst({
    where: { userId },
    orderBy: [{ recordDate: "desc" }, { createdAt: "desc" }],
    select: {
      content: true,
      recordDate: true,
    },
  });

  if (note && isStableMemoryText(note.content)) {
    return createNoteMemoryContext({
      text: previewMemory(note.content),
      date: note.recordDate.toISOString().slice(0, 10),
    });
  }

  const chatMessage = await prisma.chatMessage.findFirst({
    where: {
      userId,
      sessionId: { not: sessionId },
      role: MessageRole.USER,
    },
    orderBy: { createdAt: "desc" },
    select: {
      content: true,
      createdAt: true,
    },
  });

  if (chatMessage && isStableMemoryText(chatMessage.content)) {
    return createChatMemoryContext({
      text: previewMemory(chatMessage.content),
      date: chatMessage.createdAt.toISOString().slice(0, 10),
    });
  }

  return null;
};

const serializeMessage = (message: {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  aiGenerationId: string | null;
  aiGeneration?: { promptVersion: string } | null;
  createdAt: Date;
}) => ({
  id: message.id,
  role: message.role.toLowerCase(),
  content: message.content,
  status: message.status.toLowerCase(),
  aiGenerationId: message.aiGenerationId,
  promptVersion: message.aiGeneration?.promptVersion ?? null,
  createdAt: message.createdAt.toISOString(),
});

const saveGeneration = async ({
  userId,
  sessionId,
  inputText,
  generation,
  status,
  rewriteOfId,
}: {
  userId: string;
  sessionId: string;
  inputText: string;
  generation: AiGenerationResult;
  status: AiGenerationStatus;
  rewriteOfId?: string;
}) =>
  prisma.aiGeneration.create({
    data: {
      userId,
      sessionId,
      sourceType: AiSourceType.CHAT,
      sourceId: sessionId,
      model: generation.model,
      promptVersion: generation.promptVersion,
      inputText,
      outputText: generation.text,
      rewriteOfId,
      latencyMs: generation.latencyMs,
      tokenInput: generation.tokenInput,
      tokenOutput: generation.tokenOutput,
      status,
    },
    select: { id: true },
  });

const saveJudgeResult = async ({
  userId,
  generationId,
  judgeResult,
}: {
  userId: string;
  generationId: string;
  judgeResult: AiJudgeResult & { judgeModel: string; promptVersion: string };
}) =>
  prisma.aiJudgeResult.create({
    data: {
      userId,
      generationId,
      passed: judgeResult.passed,
      riskLevel: mapRiskLevel(judgeResult.riskLevel),
      issues: judgeResult.issues as Prisma.InputJsonValue,
      rewriteRequired: judgeResult.rewriteRequired,
      reason: judgeResult.reason,
      rawResult: (judgeResult.raw ?? null) as Prisma.InputJsonValue,
      judgeModel: judgeResult.judgeModel,
      promptVersion: judgeResult.promptVersion,
    },
    select: { id: true },
  });

const saveAssistantMessage = async ({
  userId,
  sessionId,
  content,
  status,
  aiGenerationId,
}: {
  userId: string;
  sessionId: string;
  content: string;
  status: MessageStatus;
  aiGenerationId: string;
}) => {
  const savedMessage = await prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: {
        sessionId,
        userId,
        role: MessageRole.ASSISTANT,
        content,
        status,
        aiGenerationId,
      },
      select: {
        id: true,
        role: true,
        content: true,
        status: true,
        aiGenerationId: true,
        aiGeneration: {
          select: {
            promptVersion: true,
          },
        },
        createdAt: true,
      },
    });

    await tx.chatSession.update({
      where: { id: sessionId },
      data: {
        lastMessage: content,
        lastMessageAt: message.createdAt,
      },
    });

    return message;
  });

  await createRawMemoryFromChatMessage({
    chatMessageId: savedMessage.id,
    metadata: { source: "chat_reply_service_assistant_message" },
  }).catch((error) => {
    console.error("raw memory assistant message write failed", error);
  });

  return savedMessage;
};

export const createReviewedChatReply = async ({
  userId,
  sessionId,
  userMessage,
  recentMessages,
  understandingContext,
  includeDebugTrace = false,
}: {
  userId: string;
  sessionId: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  understandingContext?: StructuredRagContext | null;
  includeDebugTrace?: boolean;
}): Promise<{
  assistantMessage: ReturnType<typeof serializeMessage>;
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  rewriteAttempted: boolean;
  fallbackUsed: boolean;
  debugTrace?: AiDebugTrace;
}> => {
  const reply = await createChatReply({
    conversationId: sessionId,
    userId,
    userMessage,
    recentMessages,
    loadMemoryContext: () => loadMemoryContext({ userId, sessionId }),
    understandingContext,
    includeDebugTrace,
  });
  const generationStatus =
    reply.finalSource === "fallback" ? AiGenerationStatus.FALLBACK : AiGenerationStatus.GENERATED;
  const messageStatus = reply.finalSource === "fallback" ? MessageStatus.FALLBACK : MessageStatus.SAVED;

  const savedGeneration = await saveGeneration({
    userId,
    sessionId,
    inputText: userMessage,
    generation: reply.generation,
    status: generationStatus,
  });
  await saveJudgeResult({
    userId,
    generationId: savedGeneration.id,
    judgeResult: reply.judge,
  });
  const assistantMessage = await saveAssistantMessage({
    userId,
    sessionId,
    content: reply.generation.text,
    status: messageStatus,
    aiGenerationId: savedGeneration.id,
  });

  return {
    assistantMessage: serializeMessage(assistantMessage),
    judge: reply.judge,
    rewriteAttempted: reply.rewriteAttempted,
    fallbackUsed: reply.fallbackUsed,
    debugTrace: reply.debugTrace,
  };
};
