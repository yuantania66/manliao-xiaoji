import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import { prisma } from "../lib/prisma";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import type { AiConversationMessage } from "../services/ai/types";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const sessionId = arg("--session");
const outputPath = arg("--output") ?? "docs/evals/conversation-grounding-leak-pre.json";
const markdownPath = arg("--markdown") ?? "docs/evals/conversation-grounding-leak-pre.md";

if (!sessionId) throw new Error("--session is required");

const sha256 = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

const targetInputs = new Set(["不知道聊啥", "我没问会不会坐", "我也没问你是谁"]);

const run = async () => {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          role: true,
          content: true,
          status: true,
          createdAt: true,
          aiGenerationId: true,
          aiGeneration: {
            select: {
              model: true,
              promptVersion: true,
              outputText: true,
              latencyMs: true,
              tokenInput: true,
              tokenOutput: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const targetIndexes = session.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "USER" && targetInputs.has(message.content))
    .slice(-3);
  if (targetIndexes.length !== 3) {
    throw new Error(`Expected 3 target turns, found ${targetIndexes.length}`);
  }

  const turns = targetIndexes.map(({ message, index }) => {
    const historyRows = session.messages.slice(Math.max(0, index - 8), index);
    const recentMessages: AiConversationMessage[] = historyRows.map((item) => ({
      role: item.role.toLowerCase() as AiConversationMessage["role"],
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      promptVersion: item.aiGeneration?.promptVersion ?? null,
      aiGenerationId: item.aiGenerationId,
    }));
    const conversationState = determineConversationState({
      currentUserMessage: message.content,
      recentMessages,
    });
    const context = assembleConversationControlContext({
      conversationId: session.id,
      userMessage: message.content,
      recentMessages,
      conversationState,
    });
    const interpretation = interpretTurnDeterministically(context);
    const dialogueState = buildDialogueState(context, interpretation);
    let clinicalCalls = 0;
    const responsePlan = createResponsePlan({
      context,
      interpretation,
      dialogueState,
      clinicalAdviceProvider: () => {
        clinicalCalls += 1;
        return null;
      },
    });
    const prompt = buildChatPrompt({
      userMessage: message.content,
      recentMessages,
      memoryContext: null,
      understandingContext: null,
      responsePlan,
    });
    const assistant = session.messages[index + 1];

    return {
      userId: session.userId,
      sessionId: session.id,
      conversationId: session.id,
      turnId: message.id,
      requestId: null,
      retryId: null,
      userMessage: message.content,
      actualRouteHistory: historyRows.map((item) => ({
        id: item.id,
        role: item.role.toLowerCase(),
        content: item.content,
        createdAt: item.createdAt.toISOString(),
        promptVersion: item.aiGeneration?.promptVersion ?? null,
      })),
      turnInterpretation: interpretation,
      currentDialogueAct: interpretation.primaryDialogueAct,
      stillOpenUserIntent:
        message.content === "不知道聊啥"
          ? "no_topic + engaged/open + assistant initiative requested"
          : "not represented by the current schema",
      challengedPropositions: [],
      answerObligationsBefore: [],
      answerObligationsAfter: dialogueState.answerObligations,
      requiredDisclosure: {
        source: interpretation.groundingReference,
        result: responsePlan.requiredDisclosure,
      },
      availableFactsProjection: {
        result: "all availableFacts are included in the Surface developer prompt",
        source: context.grounding.source,
      },
      prohibitedClaims: responsePlan.prohibitedClaims,
      responsePlan,
      planHash: sha256(responsePlan),
      prompt: {
        reconstructionNotice:
          "The original production Prompt/control trace was not persisted. This is reconstructed from stored route history and the current production builder with Memory/Understanding omitted.",
        messages: prompt.messages,
        hash: sha256(prompt.messages),
        meta: prompt.meta,
      },
      cache: {
        responseCacheImplemented: false,
        cacheKey: null,
        cacheHit: false,
        note: "POST reads database history. Browser sessionStorage hydrates UI only and is not a response/plan cache.",
      },
      generation: assistant?.aiGeneration
        ? {
            generationId: assistant.aiGenerationId,
            model: assistant.aiGeneration.model,
            promptVersion: assistant.aiGeneration.promptVersion,
            parameters: {
              temperature: 0.75,
              enableThinking: false,
              topP: "unset",
              seed: "unset",
            },
            rawOutput: assistant.aiGeneration.outputText,
            latencyMs: assistant.aiGeneration.latencyMs,
            tokenInput: assistant.aiGeneration.tokenInput,
            tokenOutput: assistant.aiGeneration.tokenOutput,
            status: assistant.aiGeneration.status,
          }
        : null,
      validator: {
        input: assistant?.aiGeneration?.outputText ?? null,
        output: "not persisted for this production request",
      },
      finalResponse: assistant
        ? {
            messageId: assistant.id,
            content: assistant.content,
            status: assistant.status,
            createdAt: assistant.createdAt.toISOString(),
          }
        : null,
      clinicalCallsDuringDeterministicReconstruction: clinicalCalls,
    };
  });

  const artifact = {
    generatedAt: new Date().toISOString(),
    kind: "read-only production-session evidence plus deterministic reconstruction",
    session: {
      userId: session.userId,
      sessionId: session.id,
      conversationId: session.id,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      uiAndApiUseSameSession: true,
    },
    observabilityGap: {
      originalPromptPersisted: false,
      originalControlTracePersisted: false,
      originalValidatorResultPersisted: false,
      rawAndFinalPersisted: true,
      consequence:
        "A new authorized controlled run is required to capture exact external Prompts and stage traces before behavior changes.",
    },
    architectureObservations: {
      routeHistoryLimit: 8,
      serverResponseCache: false,
      dialogueObligationPersistence: false,
      requiredDisclosurePersistence: false,
    },
    turns,
  };

  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  writeFileSync(
    markdownPath,
    [
      "# Conversation Grounding Leak — Pre Evidence",
      "",
      `Generated: ${artifact.generatedAt}`,
      `Session/conversation: ${session.id}`,
      `User: ${session.userId}`,
      "",
      "The UI, POST route and database rows use the same session/conversation. The original",
      "production Prompt, control trace and validator result were not persisted; raw and final",
      "outputs were persisted. Prompt sections below are deterministic reconstructions from the",
      "stored route history and current builder with Memory/Understanding omitted.",
      "",
      ...turns.flatMap((turn) => [
        `## ${turn.userMessage}`,
        "",
        `- turnId: ${turn.turnId}`,
        `- history: ${turn.actualRouteHistory.map((item) => `${item.role}:${item.content}`).join(" | ")}`,
        `- dialogueAct: ${turn.currentDialogueAct}`,
        `- repairSignal: ${turn.turnInterpretation.repairSignal}`,
        `- groundingReference: ${turn.turnInterpretation.groundingReference}`,
        `- answerObligations: ${JSON.stringify(turn.answerObligationsAfter)}`,
        `- requiredDisclosure: ${JSON.stringify(turn.requiredDisclosure.result)}`,
        `- responseActions: ${turn.responsePlan.responseActions.join(", ")}`,
        `- promptHash: ${turn.prompt.hash}`,
        `- planHash: ${turn.planHash}`,
        `- model: ${turn.generation?.model ?? "none"}`,
        `- raw: ${turn.generation?.rawOutput ?? "none"}`,
        `- final: ${turn.finalResponse?.content ?? "none"}`,
        "",
      ]),
    ].join("\n"),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        sessionId: session.id,
        turns: turns.map((turn) => ({
          userMessage: turn.userMessage,
          turnId: turn.turnId,
          historyCount: turn.actualRouteHistory.length,
          dialogueAct: turn.currentDialogueAct,
          repairSignal: turn.turnInterpretation.repairSignal,
          groundingReference: turn.turnInterpretation.groundingReference,
          obligations: turn.answerObligationsAfter.map((item) => item.kind),
          requiredDisclosure: turn.requiredDisclosure.result,
          responseActions: turn.responsePlan.responseActions,
          promptHash: turn.prompt.hash,
          rawEqualsFinal: turn.generation?.rawOutput === turn.finalResponse?.content,
        })),
        observabilityGap: artifact.observabilityGap,
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
