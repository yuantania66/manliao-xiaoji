import {
  AiGenerationStatus,
  AiRiskLevel as PrismaAiRiskLevel,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { createFallbackGeneration, generateChatReply } from "./aiService";
import { createSafetyGeneration, isCrisisInput } from "./chatSafety";
import { createChatMemoryContext, createNoteMemoryContext } from "./dataLayers";
import { buildAiDebugTrace } from "./debugTrace";
import { JUDGE_PROMPT_VERSION } from "./promptBuilder";
import {
  AiConversationMessage,
  AiDebugTrace,
  AiGenerationResult,
  AiJudgeResult,
  AiMemoryContext,
  AiRiskLevel,
} from "./types";

const mapRiskLevel = (riskLevel: AiRiskLevel) => {
  const value = riskLevel.toUpperCase();
  if (value === "MEDIUM" || value === "HIGH" || value === "CRISIS") {
    return value as PrismaAiRiskLevel;
  }
  return PrismaAiRiskLevel.LOW;
};

const getFallbackRiskLevel = (content: string): AiRiskLevel =>
  /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(content) ? "crisis" : "low";

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

const createFallbackJudge = (
  riskLevel: AiRiskLevel,
  reason: string
): AiJudgeResult & { judgeModel: string; promptVersion: string } => ({
  passed: true,
  riskLevel,
  issues: [],
  rewriteRequired: false,
  reason,
  judgeModel: "fallback-local",
  promptVersion: JUDGE_PROMPT_VERSION,
});

const createDisabledJudge = (reason: string): AiJudgeResult & { judgeModel: string; promptVersion: string } =>
  createFallbackJudge("low", reason);

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
}) =>
  prisma.$transaction(async (tx) => {
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

export const createReviewedChatReply = async ({
  userId,
  sessionId,
  userMessage,
  recentMessages,
  includeDebugTrace = false,
}: {
  userId: string;
  sessionId: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  includeDebugTrace?: boolean;
}): Promise<{
  assistantMessage: ReturnType<typeof serializeMessage>;
  judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
  rewriteAttempted: boolean;
  fallbackUsed: boolean;
  debugTrace?: AiDebugTrace;
}> => {
  const maybeDebugTrace = ({
    generation,
    judge,
    finalSource,
    fallbackUsed,
    rewriteAttempted,
  }: {
    generation: AiGenerationResult;
    judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
    finalSource: AiDebugTrace["route"]["finalSource"];
    fallbackUsed: boolean;
    rewriteAttempted: boolean;
  }) =>
    includeDebugTrace
      ? buildAiDebugTrace({
          userMessage,
          recentMessages,
          generation,
          judge,
          finalSource,
          fallbackUsed,
          rewriteAttempted,
        })
      : undefined;

  let generation: AiGenerationResult;
  if (isCrisisInput(userMessage)) {
    generation = createSafetyGeneration(userMessage);
    const savedSafety = await saveGeneration({
      userId,
      sessionId,
      inputText: userMessage,
      generation,
      status: AiGenerationStatus.GENERATED,
    });
    const safetyJudge = createFallbackJudge("crisis", "safety gate matched; base model skipped");
    await saveJudgeResult({
      userId,
      generationId: savedSafety.id,
      judgeResult: safetyJudge,
    });
    const assistantMessage = await saveAssistantMessage({
      userId,
      sessionId,
      content: generation.text,
      status: MessageStatus.SAVED,
      aiGenerationId: savedSafety.id,
    });

    return {
      assistantMessage: serializeMessage(assistantMessage),
      judge: safetyJudge,
      rewriteAttempted: false,
      fallbackUsed: false,
      debugTrace: maybeDebugTrace({
        generation,
        judge: safetyJudge,
        finalSource: "safety",
        fallbackUsed: false,
        rewriteAttempted: false,
      }),
    };
  }

  const memoryContext = await loadMemoryContext({ userId, sessionId });

  try {
    generation = await generateChatReply({ userMessage, recentMessages, memoryContext });
  } catch {
    const riskLevel = getFallbackRiskLevel(userMessage);
    const fallback = createFallbackGeneration({
      inputText: userMessage,
      riskLevel,
    });
    const fallbackJudge = createFallbackJudge(riskLevel, "AI 主回复为空或不可用，已使用 fallback");
    const savedFallback = await saveGeneration({
      userId,
      sessionId,
      inputText: userMessage,
      generation: fallback,
      status: AiGenerationStatus.FALLBACK,
    });
    const assistantMessage = await saveAssistantMessage({
      userId,
      sessionId,
      content: fallback.text,
      status: MessageStatus.FALLBACK,
      aiGenerationId: savedFallback.id,
    });

    return {
      assistantMessage: serializeMessage(assistantMessage),
      judge: fallbackJudge,
      rewriteAttempted: false,
      fallbackUsed: true,
      debugTrace: maybeDebugTrace({
        generation: fallback,
        judge: fallbackJudge,
        finalSource: "fallback",
        fallbackUsed: true,
        rewriteAttempted: false,
      }),
    };
  }

  const savedGeneration = await saveGeneration({
    userId,
    sessionId,
    inputText: userMessage,
    generation,
    status: AiGenerationStatus.GENERATED,
  });
  const judge = createDisabledJudge("judge/rewrite disabled; base model output returned directly");
  await saveJudgeResult({
    userId,
    generationId: savedGeneration.id,
    judgeResult: judge,
  });
  const assistantMessage = await saveAssistantMessage({
    userId,
    sessionId,
    content: generation.text,
    status: MessageStatus.SAVED,
    aiGenerationId: savedGeneration.id,
  });

  return {
    assistantMessage: serializeMessage(assistantMessage),
    judge,
    rewriteAttempted: false,
    fallbackUsed: false,
    debugTrace: maybeDebugTrace({
      generation,
      judge,
      finalSource: "base_model",
      fallbackUsed: false,
      rewriteAttempted: false,
    }),
  };
};
