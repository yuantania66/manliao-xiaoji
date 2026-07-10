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
import {
  retrieveMemoryV2ContextForUser,
  mapSemanticMemoryToStructuredRagContext,
} from "../services/memory/retrievalService";
import {
  processRawCapturedJob,
  processRawToSegmentationJob,
} from "../services/memory/refinementWorkerService";
import { StructuredMemoryItem, StructuredRagContext } from "../services/understanding/understandingTypes";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const emptyContext = (retrievalReason = "v1_test_context"): StructuredRagContext => ({
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
      sourceId: `retrieval-relationship-candidate-${Date.now()}`,
      sourceRevision: 1,
      content: `structured relationship candidate: ${displayName}`,
      payload: {
        personCandidates: [{ displayName }],
        content: "structured deterministic relationship retrieval check",
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
      phone: `memory-v2-retrieval-${Date.now()}`,
      nickname: "memory-v2-retrieval-check",
    },
    select: { id: true },
  });

  try {
    const session = await prisma.chatSession.create({
      data: { userId: user.id, title: "memory-v2-retrieval-check" },
      select: { id: true },
    });
    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        sessionId: session.id,
        role: MessageRole.USER,
        status: MessageStatus.SAVED,
        content: "今天我完成了 Memory V2 retrieval 适配验证。",
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
        projectionEvidenceId: { not: null },
        kind: SemanticMemoryKind.RAW_SEGMENT,
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(semanticMemory.currentVersionRecord, "SemanticMemory should include currentVersionRecord");
    const understanding = await prisma.understanding.findFirstOrThrow({
      where: {
        userId: user.id,
        category: "RAW_SEGMENT",
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(understanding.currentVersionRecord, "Understanding should include currentVersionRecord");
    const relationship = await prisma.relationship.findFirstOrThrow({
      where: {
        userId: user.id,
        displayName: "Alex",
      },
      include: {
        currentVersionRecord: true,
      },
    });
    assert(relationship.currentVersionRecord, "Relationship should include currentVersionRecord");

    const v2Context = await retrieveMemoryV2ContextForUser({ userId: user.id });
    const v2Item = v2Context.recentMemories.find((item) => item.id === `memory-v2:${semanticMemory.id}`);
    assert(v2Item, "V2 retrieval should include SemanticMemory item");
    assert(v2Item?.text === semanticMemory.currentVersionRecord?.content, "V2 item should use currentVersion content");
    assert(v2Item?.reason === "memory_v2_raw_segment_current_version", "V2 item reason mismatch");
    const understandingItem = v2Context.recentMemories.find(
      (item) => item.id === `memory-v2-understanding:${understanding.id}`
    );
    assert(understandingItem, "V2 retrieval should include Understanding item");
    assert(
      understandingItem?.text === understanding.currentVersionRecord?.understanding,
      "Understanding item should use currentVersion understanding"
    );
    assert(
      understandingItem?.reason === "memory_v2_understanding_current_version",
      "Understanding item reason mismatch"
    );
    assert(
      v2Context.recentMemories.findIndex((item) => item.id === `memory-v2-understanding:${understanding.id}`) <
        v2Context.recentMemories.findIndex((item) => item.id === `memory-v2:${semanticMemory.id}`),
      "Understanding item should have higher priority than SemanticMemory item"
    );
    assert(
      v2Context.recentMemories.some((item) => item.reason === "memory_v2_timeline_supporting_current_version"),
      "V2 retrieval should include Timeline supporting context"
    );
    const relationshipItem = v2Context.recentMemories.find(
      (item) => item.id === `memory-v2-relationship:${relationship.id}`
    );
    assert(relationshipItem, "V2 retrieval should include Relationship item");
    assert(
      relationshipItem?.text ===
        `Relationship candidate: ${relationship.currentVersionRecord?.displayName} (${relationship.currentVersionRecord?.relationshipType})`,
      "Relationship item should use currentVersion relationship content"
    );
    assert(
      relationshipItem?.reason === "memory_v2_relationship_supporting_current_version",
      "Relationship item reason mismatch"
    );

    const directMapped = mapSemanticMemoryToStructuredRagContext({
      semanticMemories: [semanticMemory],
    });
    const directItem = directMapped.recentMemories.find((item) => item.id === `memory-v2:${semanticMemory.id}`);
    assert(directItem, "Direct mapping should output a StructuredRagContext item");
    assert(directItem?.text === semanticMemory.currentVersionRecord?.content, "Direct mapping should use currentVersion content");

    const v1Duplicate = {
      id: "v1-summary-same-source",
      kind: "fact",
      text: "旧 V1 summary 应该被 V2 替代",
      occurredAt: rawMemory.occurredAt.toISOString(),
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
      id: "v1-summary-other-source",
      kind: "fact",
      text: "不同 source 的 V1 summary 应保留",
      reason: "v1_summary",
      sourceType: rawMemory.sourceType,
      sourceId: "different-source-id",
      origin: "v1",
      priority: 1,
    } as StructuredMemoryItem & {
      sourceType: string;
      sourceId: string;
      origin: "v1";
      priority: number;
    };
    const v1Context = emptyContext();
    v1Context.recentMemories = [v1Duplicate, v1Other];

    const dedupedContext = await retrieveMemoryV2ContextForUser({
      userId: user.id,
      v1Context,
    });
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2:${semanticMemory.id}`),
      "Deduped context should keep V2 item"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2-understanding:${understanding.id}`),
      "Deduped context should keep V2 Understanding item"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === `memory-v2-relationship:${relationship.id}`),
      "Deduped context should keep V2 Relationship item"
    );
    assert(
      !dedupedContext.recentMemories.some((item) => item.id === v1Duplicate.id),
      "V1 item with same sourceType + sourceId should be replaced by V2"
    );
    assert(
      dedupedContext.recentMemories.some((item) => item.id === v1Other.id),
      "V1 item with different source should remain"
    );

    console.log("Memory V2 retrieval checks passed");
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
