import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MessageRole, MessageStatus, SemanticMemoryKind } from "@prisma/client";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  createResponsePlanPreflightAuthoritySnapshot,
  interpretTurnDeterministically,
  type EpisodeMemoryCandidate,
} from "../conversation-os/control";
import type { ResponsePlanRecoveryDirective } from "../conversation-os/control/responsePlanner";
import { determineConversationState } from "../conversation-os/state";
import { prisma } from "../lib/prisma";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import {
  createPlanPreflightRecoveryDirective,
  preflightResponsePlan,
} from "../services/ai/chatExecutionLifecycle";
import {
  parseEpisodeSummaryProviderOutput,
  refreshEpisodeSummaryForSession,
  retrieveRelevantEpisodeMemories,
  type EpisodeSummaryProvider,
} from "../services/memory/episodeSummaryService";
import { createRawMemoryFromChatMessage } from "../services/memory/rawMemoryService";
import type { UnderstandingExtraction } from "../services/understanding/understandingTypes";

const workExtraction: UnderstandingExtraction = {
  facts: [],
  experiences: [{ emotion: "疲惫" }],
  interpretations: [],
  people: [],
  topics: ["工作"],
  occurredAt: null,
};

const provider: EpisodeSummaryProvider = async ({ previousSummary, committedMessages }) => ({
  naturalSummary: "用户提到领导临时改需求让工作变得消耗，后来对话停在这份压力是否还在。",
  people: ["领导"],
  topics: ["工作"],
  emotions: ["疲惫"],
  openThreads: ["工作压力是否仍在持续"],
  confirmedFacts: ["领导曾临时改需求"],
  hypotheses: ["这段经历可能与后续不想上班有关"],
  sourceMessageIds: [
    ...(previousSummary?.sourceMessageIds ?? []),
    ...committedMessages.map((message) => message.id),
  ],
});

const createMessage = async ({
  userId,
  sessionId,
  role,
  content,
}: {
  userId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
}) => {
  const message = await prisma.chatMessage.create({
    data: { userId, sessionId, role, content, status: MessageStatus.SAVED },
    select: { id: true },
  });
  await createRawMemoryFromChatMessage({ chatMessageId: message.id });
  return message;
};

const planningInputFor = (userMessage: string, candidates: EpisodeMemoryCandidate[]) => {
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages: [],
  });
  const context = assembleConversationControlContext({
    conversationId: "current-session",
    currentTurnId: "current-turn",
    userMessage,
    recentMessages: [],
    conversationState,
    episodeMemoryCandidates: candidates,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  return { context, interpretation, dialogueState };
};

const planFor = (
  userMessage: string,
  candidates: EpisodeMemoryCandidate[],
  recoveryDirective: ResponsePlanRecoveryDirective | null = null,
  modelEnrichedSupportingEmotion = false
) => {
  const { context, interpretation, dialogueState } = planningInputFor(
    userMessage,
    candidates
  );
  const effectiveDialogueState = modelEnrichedSupportingEmotion
    ? {
        ...dialogueState,
        currentActivity: {
          ...dialogueState.currentActivity,
          primary: "supporting_emotion" as const,
        },
      }
    : dialogueState;
  return createResponsePlan({
    context,
    interpretation,
    dialogueState: effectiveDialogueState,
    recoveryDirective,
    clinicalAdviceProvider: () => null,
  });
};

const preflightFor = (
  userMessage: string,
  candidates: EpisodeMemoryCandidate[],
  plan: ReturnType<typeof createResponsePlan>,
  modelEnrichedSupportingEmotion = false
) => {
  const { context, interpretation, dialogueState } = planningInputFor(userMessage, candidates);
  const effectiveDialogueState = modelEnrichedSupportingEmotion
    ? {
        ...dialogueState,
        currentActivity: { ...dialogueState.currentActivity, primary: "supporting_emotion" as const },
      }
    : dialogueState;
  return preflightResponsePlan(plan, createResponsePlanPreflightAuthoritySnapshot({
    context,
    interpretation,
    dialogueState: effectiveDialogueState,
  }));
};

const main = async () => {
  assert.equal(parseEpisodeSummaryProviderOutput("```json\n{}\n```"), null);
  assert.equal(parseEpisodeSummaryProviderOutput({
    naturalSummary: "x",
    people: [],
    topics: [],
    emotions: [],
    openThreads: [],
    confirmedFacts: [],
    hypotheses: [],
    sourceMessageIds: ["m1"],
    extra: true,
  }), null, "Summary parser must reject extra keys.");

  const user = await prisma.user.create({
    data: { phone: `episode-loop-${Date.now()}`, nickname: "episode-loop-check" },
    select: { id: true },
  });
  try {
    const oldSession = await prisma.chatSession.create({
      data: { userId: user.id, title: "old work episode" },
      select: { id: true },
    });
    const currentSession = await prisma.chatSession.create({
      data: { userId: user.id, title: "current episode" },
      select: { id: true },
    });
    const concurrentSession = await prisma.chatSession.create({
      data: { userId: user.id, title: "concurrent episode" },
      select: { id: true },
    });
    await createMessage({
      userId: user.id,
      sessionId: concurrentSession.id,
      role: MessageRole.USER,
      content: "今天工作临时有变化。",
    });
    await createMessage({
      userId: user.id,
      sessionId: concurrentSession.id,
      role: MessageRole.ASSISTANT,
      content: "这次变化已经记在当前对话里。",
    });
    let concurrentProviderArrivals = 0;
    let releaseConcurrentProviders!: () => void;
    const concurrentProviderBarrier = new Promise<void>((resolve) => {
      releaseConcurrentProviders = resolve;
    });
    const concurrentProvider: EpisodeSummaryProvider = async (input) => {
      concurrentProviderArrivals += 1;
      if (concurrentProviderArrivals === 2) releaseConcurrentProviders();
      await concurrentProviderBarrier;
      return {
        naturalSummary: "本会话用于验证同一末条消息的并发幂等发布。",
        people: [],
        topics: ["并发验证"],
        emotions: [],
        openThreads: [],
        confirmedFacts: ["两条消息已经提交"],
        hypotheses: [],
        sourceMessageIds: [
          ...(input.previousSummary?.sourceMessageIds ?? []),
          ...input.committedMessages.map((message) => message.id),
        ],
      };
    };
    const concurrentResults = await Promise.all([
      refreshEpisodeSummaryForSession({
        userId: user.id,
        sessionId: concurrentSession.id,
        provider: concurrentProvider,
      }),
      refreshEpisodeSummaryForSession({
        userId: user.id,
        sessionId: concurrentSession.id,
        provider: concurrentProvider,
      }),
    ]);
    assert.deepEqual(
      concurrentResults.map((result) => result.outcome).sort(),
      ["refreshed", "unchanged"],
      "Concurrent refreshes must recover the unique-key loser as unchanged."
    );
    const concurrentMemory = await prisma.semanticMemory.findFirstOrThrow({
      where: {
        userId: user.id,
        kind: SemanticMemoryKind.EPISODE_SUMMARY,
        source: `CHAT_SESSION:${concurrentSession.id}`,
      },
      include: { versions: true },
    });
    assert.equal(concurrentMemory.versions.length, 1, "Concurrent refresh must publish one version.");

    await createMessage({
      userId: user.id,
      sessionId: oldSession.id,
      role: MessageRole.USER,
      content: "前几天领导又临时改需求，我感觉很累。",
    });
    await createMessage({
      userId: user.id,
      sessionId: oldSession.id,
      role: MessageRole.ASSISTANT,
      content: "那次临时变化确实占了不少精力。",
    });

    const first = await refreshEpisodeSummaryForSession({
      userId: user.id,
      sessionId: oldSession.id,
      provider,
    });
    assert.equal(first.outcome, "refreshed");
    const firstMemory = await prisma.semanticMemory.findUniqueOrThrow({
      where: { id: first.semanticMemoryId },
      include: { currentVersionRecord: true },
    });
    assert.equal(firstMemory.kind, SemanticMemoryKind.EPISODE_SUMMARY);
    assert.equal(firstMemory.currentVersion, 1);
    assert(firstMemory.currentVersionId, "Episode summary must point to an append-only version.");
    const evidenceLinks = await prisma.memoryEvidenceLink.count({
      where: {
        targetType: "SEMANTIC_MEMORY_VERSION",
        targetId: firstMemory.currentVersionId!,
        role: "SOURCE",
      },
    });
    assert.equal(evidenceLinks, 2, "Every source message must bind evidence to the summary version.");

    const unchanged = await refreshEpisodeSummaryForSession({
      userId: user.id,
      sessionId: oldSession.id,
      provider,
    });
    assert.equal(unchanged.outcome, "unchanged");
    assert.equal(await prisma.semanticMemoryVersion.count({
      where: { semanticMemoryId: firstMemory.id },
    }), 1, "Same last committed message must be idempotent.");

    await createMessage({
      userId: user.id,
      sessionId: oldSession.id,
      role: MessageRole.USER,
      content: "这周还是有点不想面对工作。",
    });
    await createMessage({
      userId: user.id,
      sessionId: oldSession.id,
      role: MessageRole.ASSISTANT,
      content: "这份消耗还在。",
    });
    const updated = await refreshEpisodeSummaryForSession({
      userId: user.id,
      sessionId: oldSession.id,
      provider,
    });
    assert.equal(updated.outcome, "refreshed");
    const updatedMemory = await prisma.semanticMemory.findUniqueOrThrow({
      where: { id: firstMemory.id },
      include: { versions: true },
    });
    assert.equal(updatedMemory.currentVersion, 2);
    assert.equal(updatedMemory.versions.length, 2, "Summary updates must append a version.");

    const candidates = await retrieveRelevantEpisodeMemories({
      userId: user.id,
      currentSessionId: currentSession.id,
      currentMessage: "最近不想上班",
      extraction: workExtraction,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.semanticMemoryId, firstMemory.id);
    assert(candidates[0]?.matchedDimensions.includes("topics"));

    const unrelated = await retrieveRelevantEpisodeMemories({
      userId: user.id,
      currentSessionId: currentSession.id,
      currentMessage: "今天看到一部科幻电影",
      extraction: { ...workExtraction, topics: ["电影"], experiences: [] },
    });
    assert.equal(unrelated.length, 0, "Unrelated episode history must not be returned.");

    const selectedPlan = planFor("最近不想上班", candidates, null, true);
    assert.equal(selectedPlan.selectedEpisodeMemory?.semanticMemoryId, firstMemory.id);
    assert(selectedPlan.relevanceProvenance.some((item) =>
      item.source === "interaction_state" && item.planElement.includes(firstMemory.id)
    ));
    const surfacePrompt = formatResponsePlanForPrompt(selectedPlan);
    assert(surfacePrompt.includes("selectedEpisodeMemory:"));
    assert(surfacePrompt.includes("领导曾临时改需求"));
    assert(!surfacePrompt.includes(candidates[0]!.sourceMessageIds[0]!), "Surface must not receive source ids.");
    assert(surfacePrompt.includes("Never state an unconfirmed cause"));

    const initialPreflight = preflightFor("最近不想上班", candidates, selectedPlan, true);
    assert.deepEqual(
      initialPreflight.failureReasons,
      ["missing_emotional_support_evidence_spans"],
      "The real regression shape must reproduce the local emotional evidence failure."
    );
    const recoveryDirective = createPlanPreflightRecoveryDirective(
      selectedPlan,
      initialPreflight
    );
    assert(recoveryDirective, "The exact local failure must request one Planner recovery.");
    const recoveredPlan = planFor(
      "最近不想上班",
      candidates,
      recoveryDirective,
      true
    );
    const recoveredPreflight = preflightFor("最近不想上班", candidates, recoveredPlan, true);
    assert.equal(
      recoveredPreflight.passed,
      true,
      `Recovered episode plan must pass preflight: ${recoveredPreflight.failureReasons.join(",")}`
    );
    assert(!recoveredPlan.responseActions.includes("offer_emotional_support"));
    assert.equal(recoveredPlan.positiveFunctionContract, null);
    assert.equal(recoveredPlan.clinicalStrategy, null);
    assert.equal(recoveredPlan.behaviorSource, "ordinary_conversation");
    assert.equal(recoveredPlan.selectedEpisodeMemory?.semanticMemoryId, firstMemory.id);
    assert(recoveredPlan.relevanceProvenance.some((item) =>
      item.planElement === `selectedEpisodeMemory:${firstMemory.id}`
    ));
    const recoveredSurfacePrompt = formatResponsePlanForPrompt(recoveredPlan);
    assert(recoveredSurfacePrompt.includes("selectedEpisodeMemory:"));
    assert(recoveredSurfacePrompt.includes("领导曾临时改需求"));

    const noMemoryInitialPlan = planFor("最近不想上班", [], null, true);
    const noMemoryDirective = createPlanPreflightRecoveryDirective(
      noMemoryInitialPlan,
      preflightFor("最近不想上班", [], noMemoryInitialPlan, true)
    );
    assert(noMemoryDirective);
    assert.equal(
      preflightFor(
        "最近不想上班",
        [],
        planFor("最近不想上班", [], noMemoryDirective, true),
        true
      ).passed,
      true,
      "Ordinary chat without Episode Memory must recover without adding affect keywords."
    );

    const explicitEmotionPlan = planFor("最近上班真的很累", candidates);
    assert.equal(preflightFor("最近上班真的很累", candidates, explicitEmotionPlan).passed, true);
    assert(explicitEmotionPlan.responseActions.includes("offer_emotional_support"));
    assert.equal(
      createPlanPreflightRecoveryDirective(
        explicitEmotionPlan,
        preflightFor("最近上班真的很累", candidates, explicitEmotionPlan)
      ),
      null,
      "Canonical current-turn affect evidence must pass without recovery."
    );

    const directQuestionPlan = planFor("你叫什么名字？", candidates);
    assert.equal(directQuestionPlan.selectedEpisodeMemory, null);
    const pausePlan = planFor("先不聊了", candidates);
    assert.equal(pausePlan.selectedEpisodeMemory, null);

    const replyServiceSource = readFileSync("services/ai/chatReplyService.ts", "utf8");
    const routeSource = readFileSync("app/api/chat/sessions/[sessionId]/messages/route.ts", "utf8");
    assert(!replyServiceSource.includes("refreshEpisodeSummaryForSession"));
    assert(routeSource.includes("after(async () =>"));
    assert(routeSource.includes("await refreshEpisodeSummaryForSession"));
    assert(routeSource.indexOf('reviewedReply.outcome === "failed"') < routeSource.indexOf("after(async () =>"));
    assert(routeSource.includes("episode summary refresh failed after Assistant commit"));
    assert(!surfacePrompt.includes("我记得你之前提过"), "The loop must not add fixed user-facing copy.");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }

  console.log("conversation episode memory loop check: PASS");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
