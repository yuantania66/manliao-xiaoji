import {
  MessageRole,
  MessageStatus,
  RawMemoryKind,
  RawMemorySourceType,
  RefinementStep,
  SemanticMemoryKind,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { createRawMemoryFromChatMessage } from "../services/memory/rawMemoryService";
import { createRefinementJobForRawMemory } from "../services/memory/refinementJobService";
import { maybeMergeMemoryV2ResponseContext } from "../services/memory/responseContextService";
import { retrieveMemoryV2ContextForUser } from "../services/memory/retrievalService";
import {
  processRawCapturedJob,
  processRawToSegmentationJob,
} from "../services/memory/refinementWorkerService";
import { StructuredMemoryItem, StructuredRagContext } from "../services/understanding/understandingTypes";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const emptyContext = (retrievalReason = "v1_response_context"): StructuredRagContext => ({
  recentMemories: [],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason,
});

const createRelationshipCandidateRawMemory = async ({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) => {
  const rawMemory = await prisma.rawMemory.create({
    data: {
      userId,
      kind: RawMemoryKind.METADATA,
      sourceType: RawMemorySourceType.SYSTEM,
      sourceId: `response-relationship-candidate-${Date.now()}`,
      sourceRevision: 1,
      content: `structured relationship candidate: ${displayName}`,
      payload: {
        personCandidates: [{ displayName }],
        content: "structured deterministic relationship response context check",
      },
      occurredAt: new Date(),
    },
  });

  await createRefinementJobForRawMemory({ rawMemoryId: rawMemory.id });

  return rawMemory;
};

const processRawMemoryPipeline = async (rawMemoryId: string) => {
  const rawCapturedJob = await prisma.refinementJob.findFirstOrThrow({
    where: {
      rawMemoryId,
      step: RefinementStep.RAW_CAPTURED,
    },
  });
  const rawCapturedResult = await processRawCapturedJob({ jobId: rawCapturedJob.id });
  assert(rawCapturedResult.outcome === "succeeded", "RAW_CAPTURED should succeed");

  const segmentationJob = await prisma.refinementJob.findFirstOrThrow({
    where: {
      rawMemoryId,
      step: RefinementStep.RAW_TO_SEGMENTATION,
    },
  });
  const segmentationResult = await processRawToSegmentationJob({ jobId: segmentationJob.id });
  assert(segmentationResult.outcome === "succeeded", "RAW_TO_SEGMENTATION should succeed");
};

const main = async () => {
  const user = await prisma.user.create({
    data: {
      phone: `memory-v2-response-context-${Date.now()}`,
      nickname: "memory-v2-response-context-check",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.chatSession.create({
      data: { userId: user.id, title: "memory-v2-response-context-check" },
      select: { id: true },
    });
    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        role: MessageRole.USER,
        status: MessageStatus.SAVED,
        content: "今天验证 Memory V2 response context feature flag。",
      },
      select: { id: true },
    });

    const rawMemory = await createRawMemoryFromChatMessage({ chatMessageId: message.id });
    await processRawMemoryPipeline(rawMemory.id);

    const relationshipRawMemory = await createRelationshipCandidateRawMemory({
      userId: user.id,
      displayName: "Alex",
    });
    await processRawMemoryPipeline(relationshipRawMemory.id);

    const semanticMemory = await prisma.semanticMemory.findFirstOrThrow({
      where: {
        userId: user.id,
        kind: SemanticMemoryKind.RAW_SEGMENT,
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(semanticMemory.currentVersionRecord, "SemanticMemory should have current version");
    const understanding = await prisma.understanding.findFirstOrThrow({
      where: {
        userId: user.id,
        category: "RAW_SEGMENT",
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(understanding.currentVersionRecord, "Understanding should have current version");
    const relationship = await prisma.relationship.findFirstOrThrow({
      where: {
        userId: user.id,
        displayName: "Alex",
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(relationship.currentVersionRecord, "Relationship should have current version");

    let disabledCallCount = 0;
    const baseContext = emptyContext();
    const disabledContext = await maybeMergeMemoryV2ResponseContext({
      userId: user.id,
      v1Context: baseContext,
      enabled: false,
      retrieve: async () => {
        disabledCallCount += 1;
        throw new Error("V2 retrieval should not be called when flag is disabled.");
      },
    });
    assert(disabledCallCount === 0, "Flag=false should not call V2 retrieval");
    assert(disabledContext === baseContext, "Flag=false should return the original V1 context");
    assert(disabledContext.recentMemories.length === 0, "Flag=false should not inject V2 memories");

    const enabledContext = await maybeMergeMemoryV2ResponseContext({
      userId: user.id,
      v1Context: emptyContext(),
      enabled: true,
      retrieve: retrieveMemoryV2ContextForUser,
    });
    assert(
      enabledContext.recentMemories.some((item) => item.id === `memory-v2:${semanticMemory.id}`),
      "Flag=true should inject V2 recentMemories"
    );
    assert(
      enabledContext.recentMemories.some((item) => item.id === `memory-v2-understanding:${understanding.id}`),
      "Flag=true should inject V2 Understanding context"
    );
    assert(
      enabledContext.recentMemories.some((item) => item.id === `memory-v2-relationship:${relationship.id}`),
      "Flag=true should inject V2 Relationship context"
    );
    assert(
      enabledContext.recentMemories.findIndex((item) => item.id === `memory-v2-understanding:${understanding.id}`) <
        enabledContext.recentMemories.findIndex((item) => item.id === `memory-v2:${semanticMemory.id}`),
      "Flag=true should rank Understanding above SemanticMemory"
    );

    const v1Duplicate = {
      id: "v1-response-same-source",
      kind: "fact",
      text: "这个 V1 item 应该被 V2 去重替换",
      reason: "v1_summary",
      sourceType: rawMemory.sourceType,
      sourceId: rawMemory.sourceId,
      origin: "v1",
      priority: 1,
    } as StructuredMemoryItem & {
      sourceType: string;
      sourceId: string;
      origin: "v1";
      priority: number;
    };
    const v1Other = {
      id: "v1-response-other-source",
      kind: "fact",
      text: "这个 V1 item 应该保留",
      reason: "v1_summary",
      sourceType: rawMemory.sourceType,
      sourceId: "other-source",
      origin: "v1",
      priority: 1,
    } as StructuredMemoryItem & {
      sourceType: string;
      sourceId: string;
      origin: "v1";
      priority: number;
    };
    const dedupeBaseContext = emptyContext();
    dedupeBaseContext.recentMemories = [v1Duplicate, v1Other];

    const dedupedContext = await maybeMergeMemoryV2ResponseContext({
      userId: user.id,
      v1Context: dedupeBaseContext,
      enabled: true,
    });
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2:${semanticMemory.id}`),
      "Deduped response context should keep V2 item"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2-understanding:${understanding.id}`),
      "Deduped response context should keep V2 Understanding item"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2-relationship:${relationship.id}`),
      "Deduped response context should keep V2 Relationship item"
    );
    assert(
      !dedupedContext.recentMemories.some((item) => item.id === v1Duplicate.id),
      "Deduped response context should remove same-source V1 item"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === v1Other.id),
      "Deduped response context should keep different-source V1 item"
    );

    console.log("Memory V2 response context checks passed");
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
