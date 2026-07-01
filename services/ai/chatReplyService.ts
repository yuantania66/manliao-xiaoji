import {
  AiGenerationStatus,
  AiRiskLevel as PrismaAiRiskLevel,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  createFallbackGeneration,
  createLowInformationGeneration,
  generateChatReply,
  isLowInformationInput,
} from "./aiService";
import { judgeReply } from "./aiJudgeService";
import { JUDGE_PROMPT_VERSION } from "./promptBuilder";
import { rewriteChatReply } from "./rewriteService";
import { AiConversationMessage, AiGenerationResult, AiJudgeResult, AiRiskLevel } from "./types";

const mapRiskLevel = (riskLevel: AiRiskLevel) => {
  const value = riskLevel.toUpperCase();
  if (value === "MEDIUM" || value === "HIGH" || value === "CRISIS") {
    return value as PrismaAiRiskLevel;
  }
  return PrismaAiRiskLevel.LOW;
};

const getFallbackRiskLevel = (content: string): AiRiskLevel =>
  /自杀|轻生|不想活|伤害自己|结束生命|割腕|寻死/.test(content) ? "crisis" : "low";

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

const serializeMessage = (message: {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  aiGenerationId: string | null;
  createdAt: Date;
}) => ({
  id: message.id,
  role: message.role.toLowerCase(),
  content: message.content,
  status: message.status.toLowerCase(),
  aiGenerationId: message.aiGenerationId,
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
}: {
  userId: string;
  sessionId: string;
  userMessage: string;
  recentMessages: AiConversationMessage[];
}) => {
  if (isLowInformationInput(userMessage)) {
    const generation = createLowInformationGeneration({
      inputText: userMessage,
      recentMessages,
    });
    const savedGeneration = await saveGeneration({
      userId,
      sessionId,
      inputText: userMessage,
      generation,
      status: AiGenerationStatus.GENERATED,
    });
    const judge = createFallbackJudge("low", "低信息输入已使用确定性承接");
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
    };
  }

  let mainGeneration: AiGenerationResult;
  try {
    mainGeneration = await generateChatReply({ userMessage, recentMessages });
  } catch {
    const riskLevel = getFallbackRiskLevel(userMessage);
    const fallback = createFallbackGeneration({
      inputText: userMessage,
      riskLevel,
    });
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
      judge: createFallbackJudge(riskLevel, "AI 主回复为空或不可用，已使用 fallback"),
      rewriteAttempted: false,
      fallbackUsed: true,
    };
  }
  const savedMainGeneration = await saveGeneration({
    userId,
    sessionId,
    inputText: userMessage,
    generation: mainGeneration,
    status: AiGenerationStatus.GENERATED,
  });

  const firstJudge = await judgeReply({
    userMessage,
    assistantReply: mainGeneration.text,
    recentMessages,
  });
  await saveJudgeResult({
    userId,
    generationId: savedMainGeneration.id,
    judgeResult: firstJudge,
  });

  if (firstJudge.passed) {
    const assistantMessage = await saveAssistantMessage({
      userId,
      sessionId,
      content: mainGeneration.text,
      status: MessageStatus.SAVED,
      aiGenerationId: savedMainGeneration.id,
    });

    return {
      assistantMessage: serializeMessage(assistantMessage),
      judge: firstJudge,
      rewriteAttempted: false,
      fallbackUsed: false,
    };
  }

  if (firstJudge.rewriteRequired) {
    const rewritten = await rewriteChatReply({
      userMessage,
      originalReply: mainGeneration.text,
      judgeResult: firstJudge,
      recentMessages,
    });
    const savedRewrite = await saveGeneration({
      userId,
      sessionId,
      inputText: userMessage,
      generation: rewritten,
      status: AiGenerationStatus.REWRITTEN,
      rewriteOfId: savedMainGeneration.id,
    });
    const secondJudge = await judgeReply({
      userMessage,
      assistantReply: rewritten.text,
      recentMessages,
    });
    await saveJudgeResult({
      userId,
      generationId: savedRewrite.id,
      judgeResult: secondJudge,
    });

    if (secondJudge.passed) {
      const assistantMessage = await saveAssistantMessage({
        userId,
        sessionId,
        content: rewritten.text,
        status: MessageStatus.REWRITTEN,
        aiGenerationId: savedRewrite.id,
      });

      return {
        assistantMessage: serializeMessage(assistantMessage),
        judge: secondJudge,
        rewriteAttempted: true,
        fallbackUsed: false,
      };
    }
  }

  const fallback = createFallbackGeneration({
    inputText: userMessage,
    riskLevel: firstJudge.riskLevel,
  });
  const savedFallback = await saveGeneration({
    userId,
    sessionId,
    inputText: userMessage,
    generation: fallback,
    status: AiGenerationStatus.FALLBACK,
    rewriteOfId: savedMainGeneration.id,
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
    judge: firstJudge,
    rewriteAttempted: firstJudge.rewriteRequired,
    fallbackUsed: true,
  };
};
