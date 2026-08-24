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
  attachCommittedAssistantMoveEnvelope,
  activeHandoff,
  buildCommittedResponseMove,
  buildResponsePlanAssistantMoveEnvelope,
  buildSafetyAssistantMoveEnvelope,
  extractCommittedAssistantMoveEnvelope,
  type CommittedAssistantMoveEnvelopeV1,
} from "@/conversation-os";

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
import {
  toUserSafeExecutionStatus,
  type ChatExecutionTrace,
  type UserSafeExecutionStatus,
} from "./chatExecutionLifecycle";
import type { InteractionState, ResponsePlan } from "@/conversation-os/control";
import type { EpisodeMemoryCandidate } from "@/conversation-os/control";

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
  interactionMoveEnvelope?: CommittedAssistantMoveEnvelopeV1 | null;
}) => ({
  id: message.id,
  role: message.role.toLowerCase(),
  content: message.content,
  status: message.status.toLowerCase(),
  aiGenerationId: message.aiGenerationId,
  promptVersion: message.aiGeneration?.promptVersion ?? null,
  createdAt: message.createdAt.toISOString(),
  interactionMoveEnvelope: message.interactionMoveEnvelope ?? null,
});

const saveGeneration = async ({
  userId,
  sessionId,
  inputText,
  generation,
  status,
  rewriteOfId,
  execution,
  attemptId,
  turnId,
}: {
  userId: string;
  sessionId: string;
  inputText: string;
  generation: AiGenerationResult;
  status: AiGenerationStatus;
  rewriteOfId?: string;
  execution: ChatExecutionTrace;
  attemptId?: string;
  turnId: string;
}) =>
  prisma.aiGeneration.create({
    data: {
      userId,
      sessionId,
      sourceType: AiSourceType.CHAT,
      sourceId: turnId,
      model: generation.model,
      promptVersion: generation.promptVersion,
      inputText,
      outputText: generation.text,
      rewriteOfId,
      requestId: execution.requestId,
      turnId,
      attemptId,
      executionTrace: execution as unknown as Prisma.InputJsonValue,
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

export const commitValidatedAssistantMessage = async ({
  userId,
  sessionId,
  content,
  status,
  aiGenerationId,
  replyToMessageId,
  interactionMetadata,
  execution,
  responsePlan,
  envelopeOrigin = "response_plan",
}: {
  userId: string;
  sessionId: string;
  content: string;
  status: MessageStatus;
  aiGenerationId: string;
  replyToMessageId: string;
  interactionMetadata: NonNullable<InteractionState["lastCommittedAssistantMove"]>;
  execution: ChatExecutionTrace;
  responsePlan?: ResponsePlan | null;
  envelopeOrigin?: "response_plan" | "safety_override" | null;
}) => {
  if (execution.phase !== "VALIDATED") {
    throw new Error("Only a validated execution may enter the Assistant commit boundary.");
  }
  if (execution.turnId !== replyToMessageId) {
    throw new Error("Validated execution turn does not match the Assistant reply target.");
  }
  const select = {
    id: true,
    role: true,
    content: true,
    status: true,
    aiGenerationId: true,
    aiGeneration: {
      select: {
        promptVersion: true,
        executionTrace: true,
      },
    },
    interactionMetadata: true,
    createdAt: true,
  } satisfies Prisma.ChatMessageSelect;
  let created = false;
  const savedMessage = await prisma.$transaction(async (tx) => {
    const inserted = await tx.chatMessage.createMany({
      data: [{
        sessionId,
        userId,
        role: MessageRole.ASSISTANT,
        content,
        status,
        aiGenerationId,
        replyToMessageId,
        interactionMetadata: interactionMetadata as unknown as Prisma.InputJsonValue,
      }],
      skipDuplicates: true,
    });
    created = inserted.count === 1;
    const message = await tx.chatMessage.findUniqueOrThrow({
      where: { replyToMessageId },
      select,
    });

    if (created) {
      await tx.chatSession.update({
        where: { id: sessionId },
        data: {
          lastMessage: content,
          lastMessageAt: message.createdAt,
        },
      });
    }
    let interactionMoveEnvelope: CommittedAssistantMoveEnvelopeV1 | null = null;
    if (created) {
      if (envelopeOrigin === "response_plan") {
        interactionMoveEnvelope = buildResponsePlanAssistantMoveEnvelope({
          assistantMoveId: message.id,
          planId: execution.planId,
          sourceUserTurnId: replyToMessageId,
          committedMove: interactionMetadata,
          handoffCommitEvidence: responsePlan
            ? {
                executionPhase: "VALIDATED",
                finalAttemptPhase: execution.attempts.at(-1)?.phase ?? null,
                executionPlanId: execution.planId,
                executionTurnId: execution.turnId,
                responsePlan,
                finalValidation: execution.attempts.at(-1)?.validation ?? null,
              }
            : null,
        });
      } else if (envelopeOrigin === "safety_override") {
        const history = await tx.chatMessage.findMany({
          where: { sessionId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            status: true,
            aiGeneration: { select: { executionTrace: true } },
          },
        });
        const committedEvents = history.map((event) => ({
          id: event.id,
          role: event.role.toLowerCase(),
          status: event.status.toLowerCase(),
          interactionMoveEnvelope: extractCommittedAssistantMoveEnvelope(
            event.aiGeneration?.executionTrace
          ),
        }));
        const currentIndex = committedEvents.findIndex((event) => event.id === replyToMessageId);
        const sourceAssistantMoveId = currentIndex > 0
          ? committedEvents[currentIndex - 1]?.id
          : null;
        if (
          sourceAssistantMoveId &&
          activeHandoff(sourceAssistantMoveId, replyToMessageId, committedEvents)
        ) {
          interactionMoveEnvelope = buildSafetyAssistantMoveEnvelope({
            assistantMoveId: message.id,
            safetyTraceId: execution.requestId,
            sourceUserTurnId: replyToMessageId,
            committedMove: interactionMetadata,
            sourceAssistantMoveId,
          });
        }
      }
      const committedExecution = {
        ...execution,
        phase: "COMMITTED" as const,
        transitions: [
          ...execution.transitions,
          {
            phase: "COMMITTED" as const,
            reason: interactionMoveEnvelope
              ? "Assistant Message, interaction metadata, and move envelope committed atomically."
              : "Assistant Message and interaction metadata committed atomically; handoff envelope intentionally deferred for this origin.",
          },
        ],
        committedMessageId: message.id,
        ...(interactionMoveEnvelope ? { interactionMoveEnvelope } : {}),
      };
      await tx.aiGeneration.update({
        where: { id: aiGenerationId },
        data: {
          executionTrace: (interactionMoveEnvelope
            ? attachCommittedAssistantMoveEnvelope(
                committedExecution,
                interactionMoveEnvelope
              )
            : committedExecution) as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      interactionMoveEnvelope = extractCommittedAssistantMoveEnvelope(
        message.aiGeneration?.executionTrace
      );
    }

    return { ...message, interactionMoveEnvelope };
  });

  if (created) {
    await createRawMemoryFromChatMessage({
      chatMessageId: savedMessage.id,
      metadata: { source: "chat_reply_service_assistant_message" },
    }).catch((error) => {
      console.error("raw memory assistant message write failed", error);
    });
  }

  return savedMessage;
};

export const buildCommittedAssistantMove = (
  reply: Awaited<ReturnType<typeof createChatReply>>
): NonNullable<InteractionState["lastCommittedAssistantMove"]> =>
  buildCommittedResponseMove({
    plan: reply.controlTrace?.responsePlan,
    replyText: reply.generation.text,
    sourceUserTurnId: reply.execution.turnId,
    planId: reply.execution.planId,
    requestId: reply.execution.requestId,
  });

const markCommitted = (
  execution: ChatExecutionTrace,
  messageId: string,
  interactionMoveEnvelope: CommittedAssistantMoveEnvelopeV1 | null
): ChatExecutionTrace => ({
  ...execution,
  phase: "COMMITTED",
  transitions: [
    ...execution.transitions,
    {
      phase: "COMMITTED",
      reason: "Assistant Message and interaction metadata committed atomically.",
    },
  ],
  committedMessageId: messageId,
  ...(interactionMoveEnvelope ? { interactionMoveEnvelope } : {}),
});

export const createReviewedChatReply = async ({
  userId,
  sessionId,
  currentTurnId,
  retrying = false,
  userMessage,
  recentMessages,
  understandingContext,
  episodeMemoryCandidates = [],
  includeDebugTrace = false,
}: {
  userId: string;
  sessionId: string;
  currentTurnId?: string;
  retrying?: boolean;
  userMessage: string;
  recentMessages: AiConversationMessage[];
  understandingContext?: StructuredRagContext | null;
  episodeMemoryCandidates?: EpisodeMemoryCandidate[];
  includeDebugTrace?: boolean;
}): Promise<
  | {
      outcome: "committed";
      assistantMessage: ReturnType<typeof serializeMessage>;
      judge: AiJudgeResult & { judgeModel: string; promptVersion: string };
      rewriteAttempted: boolean;
      fallbackUsed: boolean;
      debugTrace?: AiDebugTrace;
      execution: ChatExecutionTrace;
    }
  | {
      outcome: "failed";
      systemStatus: UserSafeExecutionStatus;
      debugTrace?: AiDebugTrace;
      execution: ChatExecutionTrace;
    }
> => {
  const reply = await createChatReply({
    conversationId: sessionId,
    currentTurnId,
    retrying,
    userId,
    userMessage,
    recentMessages,
    loadMemoryContext: () => loadMemoryContext({ userId, sessionId }),
    understandingContext,
    episodeMemoryCandidates,
    includeDebugTrace,
  });
  try {
    const attemptedGenerations = reply.generationAttempts.length
      ? reply.generationAttempts
      : [reply.generation];
    let previousGenerationId: string | undefined;
    const savedGenerations: Array<{ id: string }> = [];
    for (const [index, generation] of attemptedGenerations.entries()) {
      const accepted = reply.execution.phase === "VALIDATED" &&
        index === attemptedGenerations.length - 1;
      const saved = await saveGeneration({
        userId,
        sessionId,
        inputText: userMessage,
        generation,
        status: accepted
          ? reply.finalSource === "fallback"
            ? AiGenerationStatus.FALLBACK
            : AiGenerationStatus.GENERATED
          : AiGenerationStatus.FAILED,
        rewriteOfId: previousGenerationId,
        execution: reply.execution,
        attemptId: reply.execution.attempts[index]?.attemptId,
        turnId: reply.execution.turnId,
      });
      previousGenerationId = saved.id;
      savedGenerations.push(saved);
    }

    if (reply.execution.phase !== "VALIDATED") {
      return {
        outcome: "failed",
        systemStatus: toUserSafeExecutionStatus(reply.execution),
        debugTrace: reply.debugTrace,
        execution: reply.execution,
      };
    }

    const messageStatus = reply.finalSource === "fallback" ? MessageStatus.FALLBACK : MessageStatus.SAVED;
    const savedGeneration = savedGenerations.at(-1);
    if (!savedGeneration) throw new Error("Validated reply has no saved generation.");
    await saveJudgeResult({
      userId,
      generationId: savedGeneration.id,
      judgeResult: reply.judge,
    });
    const assistantMessage = await commitValidatedAssistantMessage({
      userId,
      sessionId,
      content: reply.generation.text,
      status: messageStatus,
      aiGenerationId: savedGeneration.id,
      replyToMessageId: reply.execution.turnId,
      interactionMetadata: buildCommittedAssistantMove(reply),
      execution: reply.execution,
      responsePlan: reply.controlTrace?.responsePlan ?? null,
      envelopeOrigin: reply.finalSource === "safety" ? "safety_override" : "response_plan",
    });
    if (reply.finalSource !== "safety" && !assistantMessage.interactionMoveEnvelope) {
      throw new Error("Committed Assistant Message is missing its move envelope.");
    }
    const execution = markCommitted(
      reply.execution,
      assistantMessage.id,
      assistantMessage.interactionMoveEnvelope ?? null
    );
    if (reply.controlTrace) {
      const answeredObligations = reply.controlTrace.responsePlan.answerObligations.map((item) => item.id);
      reply.controlTrace.stateUpdate = {
        answeredObligations,
        remainingOpenLoops: [],
        obligationTransitions: reply.controlTrace.responsePlan.answerObligations.map((item) => ({
          id: item.id,
          from: "open",
          to: "answered",
          closeReason: "response_committed",
          sourceConversationId: item.sourceConversationId,
          sourceTurnId: item.sourceTurnId,
        })),
        notes: ["Validated Assistant Message committed; obligation transitions are now official."],
      };
      if (reply.debugTrace) reply.debugTrace.conversationControl = reply.controlTrace;
    }
    if (reply.debugTrace) reply.debugTrace.execution = execution;

    return {
      outcome: "committed",
      assistantMessage: serializeMessage(assistantMessage),
      judge: reply.judge,
      rewriteAttempted: reply.rewriteAttempted,
      fallbackUsed: reply.fallbackUsed,
      debugTrace: reply.debugTrace,
      execution,
    };
  } catch (error) {
    const execution: ChatExecutionTrace = {
      ...reply.execution,
      phase: "FAILED",
      transitions: [
        ...reply.execution.transitions,
        {
          phase: "FAILED",
          reason: "Persistence failed before the commit boundary completed.",
        },
      ],
      failure: {
        code: "PERSISTENCE_ERROR",
        reason: error instanceof Error ? error.message : "Unknown persistence failure",
        retryable: true,
      },
      committedMessageId: undefined,
    };
    if (reply.debugTrace) reply.debugTrace.execution = execution;
    return {
      outcome: "failed",
      systemStatus: toUserSafeExecutionStatus(execution),
      debugTrace: reply.debugTrace,
      execution,
    };
  }
};
