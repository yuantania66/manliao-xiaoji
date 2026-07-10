import {
  Evidence,
  EvidenceRole,
  EvidenceTargetType,
  RawMemory,
  RelationshipStatus,
  RelationshipVersion,
  SemanticMemoryStatus,
  SemanticMemoryVersion,
  TimelineEventStatus,
  TimelineEventVersion,
  UnderstandingStatus,
  UnderstandingVersion,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  StructuredMemoryItem,
  StructuredRagContext,
} from "@/services/understanding/understandingTypes";

type SemanticMemoryForContext = {
  id: string;
  userId: string;
  projectionEvidenceId: string | null;
  title: string;
  content: string;
  confidence: number;
  currentVersion: number;
  currentVersionId: string | null;
  lastUpdatedAt: Date;
  currentVersionRecord: SemanticMemoryVersion | null;
};

type TimelineEventForContext = {
  id: string;
  title: string;
  description: string | null;
  startDate: Date | null;
  confidence: number;
  currentVersionId: string | null;
  currentVersionRecord: TimelineEventVersion | null;
};

type RelationshipForContext = {
  id: string;
  displayName: string;
  relationshipType: string;
  identityLabel: string | null;
  influenceSummary: string | null;
  confidence: number;
  currentVersionId: string | null;
  updatedAt: Date;
  currentVersionRecord: RelationshipVersion | null;
};

type UnderstandingForContext = {
  id: string;
  title: string;
  understanding: string;
  category: string | null;
  confidence: number;
  currentVersionId: string | null;
  lastTouchedAt: Date;
  currentVersionRecord: UnderstandingVersion | null;
};

type EvidenceWithRawMemory = Evidence & { rawMemory: RawMemory | null };

type EvidenceByTargetKey = Map<string, EvidenceWithRawMemory>;

type MemoryV2StructuredMemoryItem = StructuredMemoryItem & {
  origin: "v2";
  sourceType?: string;
  sourceId?: string;
  evidenceIds: string[];
  currentVersionId?: string | null;
  priority: number;
};

type SourceBackedStructuredMemoryItem = StructuredMemoryItem & {
  origin?: "v1" | "v2";
  sourceType?: string;
  sourceId?: string;
  evidenceIds?: string[];
  currentVersionId?: string | null;
  priority?: number;
};

const emptyStructuredRagContext = (retrievalReason: string): StructuredRagContext => ({
  recentMemories: [],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason,
});

const sourceKeyForItem = (item: SourceBackedStructuredMemoryItem) =>
  item.sourceType && item.sourceId ? `${item.sourceType}:${item.sourceId}` : null;

const targetKey = (targetType: EvidenceTargetType, targetId: string) => `${targetType}:${targetId}`;

const scoreItem = (item: SourceBackedStructuredMemoryItem) => {
  const originScore = item.origin === "v2" ? 100 : 0;
  const evidenceScore = item.evidenceIds?.length ? 20 : 0;
  const currentVersionScore = item.currentVersionId ? 10 : 0;
  return item.priority ?? originScore + evidenceScore + currentVersionScore;
};

const mergeAndDedupeMemoryItems = ({
  v2Items,
  v1Items = [],
}: {
  v2Items: MemoryV2StructuredMemoryItem[];
  v1Items?: StructuredMemoryItem[];
}) => {
  const v2SourceKeys = new Set(v2Items.map(sourceKeyForItem).filter(Boolean));
  const chosenV1BySource = new Map<string, SourceBackedStructuredMemoryItem>();
  const passthrough: SourceBackedStructuredMemoryItem[] = [];

  for (const item of v1Items as SourceBackedStructuredMemoryItem[]) {
    const key = sourceKeyForItem(item);
    if (!key) {
      passthrough.push(item);
      continue;
    }
    if (v2SourceKeys.has(key)) continue;

    const existing = chosenV1BySource.get(key);
    if (!existing || scoreItem(item) >= scoreItem(existing)) {
      chosenV1BySource.set(key, item);
    }
  }

  return [...v2Items, ...chosenV1BySource.values(), ...passthrough].sort((left, right) => {
    const priorityDelta = scoreItem(right) - scoreItem(left);
    if (priorityDelta !== 0) return priorityDelta;
    return left.id.localeCompare(right.id);
  }) as StructuredMemoryItem[];
};

export const mapSemanticMemoryToStructuredRagContext = ({
  semanticMemories,
  understandings = [],
  relationships = [],
  timelineEvents = [],
  evidenceById,
  evidenceByTargetKey,
  v1Context,
}: {
  semanticMemories: SemanticMemoryForContext[];
  understandings?: UnderstandingForContext[];
  relationships?: RelationshipForContext[];
  timelineEvents?: TimelineEventForContext[];
  evidenceById?: Map<string, EvidenceWithRawMemory>;
  evidenceByTargetKey?: EvidenceByTargetKey;
  v1Context?: StructuredRagContext;
}): StructuredRagContext => {
  const understandingItems: MemoryV2StructuredMemoryItem[] = understandings.map((understanding) => {
    const currentVersion = understanding.currentVersionRecord;
    const evidence = evidenceByTargetKey?.get(targetKey(EvidenceTargetType.UNDERSTANDING, understanding.id));
    const sourceType = evidence?.rawMemory?.sourceType;
    const sourceId = evidence?.rawMemory?.sourceId;
    const evidenceIds = evidence ? [evidence.id] : [];

    return {
      id: `memory-v2-understanding:${understanding.id}`,
      kind: "hypothesis",
      text: currentVersion?.understanding ?? understanding.understanding,
      occurredAt:
        evidence?.occurredAt?.toISOString() ??
        currentVersion?.createdAt.toISOString() ??
        understanding.lastTouchedAt.toISOString(),
      topics: [currentVersion?.category ?? understanding.category ?? "RAW_SEGMENT"],
      confidence: currentVersion?.confidence ?? understanding.confidence,
      reason: "memory_v2_understanding_current_version",
      origin: "v2",
      sourceType,
      sourceId,
      evidenceIds,
      currentVersionId: understanding.currentVersionId,
      priority: 300 + (evidenceIds.length ? 20 : 0) + (understanding.currentVersionId ? 10 : 0),
    };
  });

  const relationshipItems: MemoryV2StructuredMemoryItem[] = relationships.map((relationship) => {
    const currentVersion = relationship.currentVersionRecord;
    const evidence = evidenceByTargetKey?.get(targetKey(EvidenceTargetType.RELATIONSHIP, relationship.id));
    const sourceType = evidence?.rawMemory?.sourceType;
    const sourceId = evidence?.rawMemory?.sourceId;
    const evidenceIds = evidence ? [evidence.id] : [];
    const displayName = currentVersion?.displayName ?? relationship.displayName;
    const relationshipType = currentVersion?.relationshipType ?? relationship.relationshipType;

    return {
      id: `memory-v2-relationship:${relationship.id}`,
      kind: "hypothesis",
      text:
        currentVersion?.influenceSummary ??
        relationship.influenceSummary ??
        `Relationship candidate: ${displayName} (${relationshipType})`,
      occurredAt:
        evidence?.occurredAt?.toISOString() ??
        currentVersion?.createdAt.toISOString() ??
        relationship.updatedAt.toISOString(),
      people: [displayName],
      topics: ["RELATIONSHIP_SUPPORTING", relationshipType],
      confidence: currentVersion?.confidence ?? relationship.confidence,
      reason: "memory_v2_relationship_supporting_current_version",
      origin: "v2",
      sourceType,
      sourceId,
      evidenceIds,
      currentVersionId: relationship.currentVersionId,
      priority: 240 + (evidenceIds.length ? 20 : 0) + (relationship.currentVersionId ? 10 : 0),
    };
  });

  const timelineItems: MemoryV2StructuredMemoryItem[] = timelineEvents.map((event) => {
    const currentVersion = event.currentVersionRecord;
    const evidence = evidenceByTargetKey?.get(targetKey(EvidenceTargetType.TIMELINE_EVENT, event.id));
    const sourceType = evidence?.rawMemory?.sourceType;
    const sourceId = evidence?.rawMemory?.sourceId;
    const evidenceIds = evidence ? [evidence.id] : [];

    return {
      id: `memory-v2-timeline:${event.id}`,
      kind: "event",
      text: currentVersion?.description ?? event.description ?? currentVersion?.title ?? event.title,
      occurredAt:
        currentVersion?.startDate?.toISOString() ??
        event.startDate?.toISOString() ??
        evidence?.occurredAt?.toISOString() ??
        currentVersion?.createdAt.toISOString(),
      topics: ["TIMELINE_SUPPORTING"],
      confidence: currentVersion?.confidence ?? event.confidence,
      reason: "memory_v2_timeline_supporting_current_version",
      origin: "v2",
      sourceType,
      sourceId,
      evidenceIds,
      currentVersionId: event.currentVersionId,
      priority: 200 + (evidenceIds.length ? 20 : 0) + (event.currentVersionId ? 10 : 0),
    };
  });

  const semanticItems: MemoryV2StructuredMemoryItem[] = semanticMemories.map((memory) => {
    const currentVersion = memory.currentVersionRecord;
    const evidence = memory.projectionEvidenceId ? evidenceById?.get(memory.projectionEvidenceId) : undefined;
    const sourceType = evidence?.rawMemory?.sourceType;
    const sourceId = evidence?.rawMemory?.sourceId;
    const evidenceIds = evidence ? [evidence.id] : [];

    return {
      id: `memory-v2:${memory.id}`,
      kind: "interpretation",
      text: currentVersion?.content ?? memory.content,
      occurredAt: evidence?.occurredAt?.toISOString() ?? currentVersion?.createdAt.toISOString() ?? memory.lastUpdatedAt.toISOString(),
      topics: ["RAW_SEGMENT"],
      confidence: currentVersion?.confidence ?? memory.confidence,
      reason: "memory_v2_raw_segment_current_version",
      origin: "v2",
      sourceType,
      sourceId,
      evidenceIds,
      currentVersionId: memory.currentVersionId,
      priority: 100 + (evidenceIds.length ? 20 : 0) + (memory.currentVersionId ? 10 : 0),
    };
  });
  const v2Items = [...understandingItems, ...relationshipItems, ...timelineItems, ...semanticItems];

  const v2Fragment = emptyStructuredRagContext(
    `memory_v2=understanding:${understandingItems.length},relationship:${relationshipItems.length},timeline:${timelineItems.length},raw_segment:${semanticItems.length}; dedupe=sourceType_sourceId_v2_priority`
  );
  v2Fragment.recentMemories = mergeAndDedupeMemoryItems({
    v2Items,
    v1Items: v1Context?.recentMemories,
  });

  if (!v1Context) return v2Fragment;

  return {
    ...v1Context,
    recentMemories: v2Fragment.recentMemories,
    retrievalReason: [v1Context.retrievalReason, v2Fragment.retrievalReason].filter(Boolean).join("; "),
  };
};

export const retrieveMemoryV2ContextForUser = async ({
  userId,
  v1Context,
  take = 20,
}: {
  userId: string;
  v1Context?: StructuredRagContext;
  take?: number;
}): Promise<StructuredRagContext> => {
  const semanticMemories = await prisma.semanticMemory.findMany({
    where: {
      userId,
      kind: "RAW_SEGMENT",
      status: { in: [SemanticMemoryStatus.ACTIVE, SemanticMemoryStatus.USER_CORRECTED] },
      currentVersionId: { not: null },
    },
    include: {
      currentVersionRecord: true,
    },
    orderBy: [{ currentVersion: "desc" }, { lastUpdatedAt: "desc" }],
    take,
  });
  const understandings = await prisma.understanding.findMany({
    where: {
      userId,
      status: {
        in: [
          UnderstandingStatus.OPEN,
          UnderstandingStatus.DEEPENING,
          UnderstandingStatus.USER_CORRECTED,
        ],
      },
      currentVersionId: { not: null },
    },
    include: {
      currentVersionRecord: true,
    },
    orderBy: [{ currentVersion: "desc" }, { lastTouchedAt: "desc" }],
    take,
  });
  const timelineEvents = await prisma.timelineEvent.findMany({
    where: {
      userId,
      status: {
        in: [TimelineEventStatus.ACTIVE, TimelineEventStatus.USER_CORRECTED],
      },
      currentVersionId: { not: null },
    },
    include: {
      currentVersionRecord: true,
    },
    orderBy: [{ currentVersion: "desc" }, { startDate: "desc" }, { createdAt: "desc" }],
    take,
  });
  const relationships = await prisma.relationship.findMany({
    where: {
      userId,
      status: {
        in: [
          RelationshipStatus.ACTIVE,
          RelationshipStatus.WEAKENED,
          RelationshipStatus.USER_CORRECTED,
        ],
      },
      currentVersionId: { not: null },
    },
    include: {
      currentVersionRecord: true,
    },
    orderBy: [{ currentVersion: "desc" }, { updatedAt: "desc" }],
    take,
  });

  const evidenceIds = semanticMemories.flatMap((memory) =>
    memory.projectionEvidenceId ? [memory.projectionEvidenceId] : []
  );
  const targetLinks = await prisma.memoryEvidenceLink.findMany({
    where: {
      userId,
      role: EvidenceRole.SOURCE,
      OR: [
        {
          targetType: EvidenceTargetType.UNDERSTANDING,
          targetId: { in: understandings.map((understanding) => understanding.id) },
        },
        {
          targetType: EvidenceTargetType.TIMELINE_EVENT,
          targetId: { in: timelineEvents.map((event) => event.id) },
        },
        {
          targetType: EvidenceTargetType.RELATIONSHIP,
          targetId: { in: relationships.map((relationship) => relationship.id) },
        },
      ],
    },
    include: {
      evidence: {
        include: {
          rawMemory: true,
        },
      },
    },
  });
  const linkedEvidenceIds = targetLinks.map((link) => link.evidenceId);
  const allEvidenceIds = [...new Set([...evidenceIds, ...linkedEvidenceIds])];
  const evidenceRecords = allEvidenceIds.length
    ? await prisma.evidence.findMany({
        where: {
          userId,
          id: { in: allEvidenceIds },
        },
        include: {
          rawMemory: true,
        },
      })
    : [];
  const evidenceById = new Map(evidenceRecords.map((evidence) => [evidence.id, evidence]));
  const evidenceByTargetKey = new Map(
    targetLinks.map((link) => [targetKey(link.targetType, link.targetId), link.evidence])
  );

  return mapSemanticMemoryToStructuredRagContext({
    semanticMemories,
    understandings,
    relationships,
    timelineEvents,
    evidenceById,
    evidenceByTargetKey,
    v1Context,
  });
};
