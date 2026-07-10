import { createHash } from "node:crypto";

import {
  EvidenceTargetType,
  EvidenceType,
  MemoryActor,
  Prisma,
  RawMemorySourceType,
  RelationshipStatus,
  RelationshipType,
  RelationshipVersion,
  SemanticMemoryKind,
  SemanticMemoryStatus,
  SemanticMemoryVersion,
  TimelineEventEndStatus,
  TimelineEventStatus,
  TimelineEventVersion,
  UnderstandingStatus,
  UnderstandingVersion,
  VersionChangeType,
} from "@prisma/client";

import {
  ProjectionContext,
  RelationshipProjectionRecord,
  SemanticProjectionRecord,
  TimelineProjectionRecord,
  UnderstandingProjectionRecord,
} from "./projectionContext";
import {
  relationshipProjectionIdFromEvidenceIdAndDisplayName,
  timelineProjectionIdFromEvidenceId,
  understandingProjectionIdFromEvidenceId,
} from "./projectionIds";
import {
  MemoryProjection,
  ProjectionCurrentVersionOutput,
  ProjectionProjectOutput,
  ProjectionVersionOutput,
} from "./projectionTypes";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const asNullableJson = (value: unknown) =>
  value === null || value === undefined ? Prisma.JsonNull : asJson(value);

const semanticProjectionVersionOperationId = ({
  semanticMemoryId,
  version,
}: {
  semanticMemoryId: string;
  version: number;
}) => `memory_v2_projection_semantic:${semanticMemoryId}:v${version}`;

const timelineProjectionVersionOperationId = ({
  timelineEventId,
  version,
}: {
  timelineEventId: string;
  version: number;
}) => `memory_v2_projection_timeline:${timelineEventId}:v${version}`;

const understandingProjectionVersionOperationId = ({
  understandingId,
  version,
}: {
  understandingId: string;
  version: number;
}) => `memory_v2_projection_understanding:${understandingId}:v${version}`;

const relationshipProjectionVersionOperationId = ({
  relationshipId,
  version,
}: {
  relationshipId: string;
  version: number;
}) => `memory_v2_projection_relationship:${relationshipId}:v${version}`;

const parseSegmentationMetadata = (evidenceText: string | null) => {
  if (!evidenceText) return {};
  try {
    const parsed = JSON.parse(evidenceText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const numericMetadataValue = (metadata: Record<string, unknown>, key: string, fallback: number) =>
  typeof metadata[key] === "number" ? metadata[key] : fallback;

const stringMetadataValue = (metadata: Record<string, unknown>, key: string, fallback: string) =>
  typeof metadata[key] === "string" ? metadata[key] : fallback;

const normalizeDisplayName = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const candidateDisplayName = (candidate: unknown) => {
  if (typeof candidate === "string") return normalizeDisplayName(candidate);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return "";
  const record = candidate as Record<string, unknown>;
  return normalizeDisplayName(record.displayName ?? record.name ?? record.label);
};

const extractPersonCandidates = (metadata: Record<string, unknown>) => {
  const rawCandidates =
    metadata.personCandidates ??
    metadata.peopleCandidates ??
    metadata.people ??
    metadata.persons;
  if (!Array.isArray(rawCandidates)) return [];

  return [...new Set(rawCandidates.map(candidateDisplayName).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
};

const firstPersonCandidate = (evidenceText: string | null) =>
  extractPersonCandidates(parseSegmentationMetadata(evidenceText))[0] ?? null;

const displayNameKey = (displayName: string) =>
  createHash("sha256").update(displayName.toLocaleLowerCase()).digest("hex").slice(0, 16);

const createTimelineShape = (
  context: ProjectionContext<TimelineProjectionRecord, TimelineEventVersion>
) => {
  const metadata = parseSegmentationMetadata(context.evidence.evidenceText);
  const algorithm = stringMetadataValue(metadata, "algorithm", "raw_segmentation");
  const segmentCount = numericMetadataValue(metadata, "segmentCount", 1);
  const eventType =
    context.rawMemory?.sourceType === RawMemorySourceType.NOTE
      ? "DAILY_NOTE_EVENT"
      : "RAW_SEGMENT_EVENT";
  const sourceLabel = context.rawMemory
    ? `${context.rawMemory.sourceType}:${context.rawMemory.sourceId}`
    : `${context.evidence.sourceKind}:${context.evidence.sourceId}`;
  const startDate =
    context.rawMemory?.occurredAt ?? context.evidence.occurredAt ?? context.evidence.createdAt;
  const title =
    eventType === "DAILY_NOTE_EVENT"
      ? `Daily note segment: ${algorithm}`
      : `Raw segment event: ${algorithm}`;
  const description = `Deterministic ${eventType} from ${segmentCount} segment(s), source ${sourceLabel}.`;

  return {
    eventType,
    title,
    description,
    startDate,
    confidence: context.evidence.confidence,
    topics: asJson({
      eventType,
      evidenceType: context.evidence.evidenceType,
      algorithm,
      segmentCount,
    }),
    conversationIds: context.rawMemory?.conversationId
      ? asJson([context.rawMemory.conversationId])
      : undefined,
    snapshot: asJson({
      eventType,
      title,
      description,
      startDate: startDate.toISOString(),
      confidence: context.evidence.confidence,
      source: sourceLabel,
      segmentation: metadata,
    }),
  };
};

const createUnderstandingShape = (
  context: ProjectionContext<UnderstandingProjectionRecord, UnderstandingVersion>
) => {
  const semanticMemory = context.sourceSemanticMemory;
  const semanticVersion = semanticMemory?.currentVersionRecord;
  const summary = semanticVersion?.content ?? semanticMemory?.content ?? "";
  const semanticMemoryIds = semanticMemory ? [semanticMemory.id] : [];

  return {
    hypothesisType: "RAW_SEGMENT",
    title: "Raw segment understanding",
    understanding: summary,
    category: "RAW_SEGMENT",
    confidence: context.evidence.confidence,
    relatedSemanticMemoryIds: asJson(semanticMemoryIds),
    snapshot: asJson({
      hypothesisType: "RAW_SEGMENT",
      title: "Raw segment understanding",
      understanding: summary,
      category: "RAW_SEGMENT",
      confidence: context.evidence.confidence,
      evidenceId: context.evidence.id,
      semanticMemoryId: semanticMemory?.id ?? null,
      semanticMemoryVersionId: semanticVersion?.id ?? null,
    }),
  };
};

const createRelationshipShape = (
  context: ProjectionContext<RelationshipProjectionRecord, RelationshipVersion>
) => {
  const displayName = firstPersonCandidate(context.evidence.evidenceText) ?? "";

  return {
    displayName,
    relationshipType: RelationshipType.OTHER,
    confidence: context.evidence.confidence,
    status: RelationshipStatus.ACTIVE,
    snapshot: asJson({
      displayName,
      relationshipType: RelationshipType.OTHER,
      relationshipTypeMeaning: "UNKNOWN",
      confidence: context.evidence.confidence,
      status: RelationshipStatus.ACTIVE,
      evidenceId: context.evidence.id,
      sourceEvidenceType: context.evidence.evidenceType,
    }),
  };
};

export const semanticProjection: MemoryProjection<SemanticProjectionRecord, SemanticMemoryVersion> = {
  projectionName: "SemanticProjection",
  supportedEvidenceTypes: () => [EvidenceType.RAW_SEGMENTATION],
  shouldProject: ({ evidence }) =>
    evidence.status === "ACTIVE" && evidence.evidenceType === EvidenceType.RAW_SEGMENTATION,
  project: async (
    context
  ): Promise<ProjectionProjectOutput<SemanticProjectionRecord>> => {
    if (context.currentProjection) {
      return {
        projectionId: context.currentProjection.id,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY,
        projection: context.currentProjection,
        created: false,
      };
    }

    let createdProjection = true;
    const created = await context.transaction.semanticMemory
      .create({
        data: {
          userId: context.evidence.userId,
          projectionEvidenceId: context.evidence.id,
          kind: SemanticMemoryKind.RAW_SEGMENT,
          title: "Raw segment",
          content: context.evidence.evidenceText ?? "",
          confidence: context.evidence.confidence,
          source: "RAW_SEGMENTATION_EVIDENCE",
          status: SemanticMemoryStatus.ACTIVE,
        },
        include: { currentVersionRecord: true },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.semanticMemory.findUnique({
            where: { projectionEvidenceId: context.evidence.id },
            include: { currentVersionRecord: true },
          });
          if (existing) {
            createdProjection = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      projectionId: created.id,
      targetType: EvidenceTargetType.SEMANTIC_MEMORY,
      projection: created,
      created: createdProjection,
    };
  },
  createVersion: async (
    context,
    projection
  ): Promise<ProjectionVersionOutput<SemanticMemoryVersion>> => {
    if (context.previousVersion) {
      return {
        versionId: context.previousVersion.id,
        version: context.previousVersion.version,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
        versionRecord: context.previousVersion,
        created: false,
      };
    }

    const version = 1;
    const operationId = semanticProjectionVersionOperationId({
      semanticMemoryId: projection.projectionId,
      version,
    });
    let createdVersion = true;
    const created = await context.transaction.semanticMemoryVersion
      .create({
        data: {
          userId: context.evidence.userId,
          semanticMemoryId: projection.projectionId,
          version,
          kind: projection.projection.kind,
          title: projection.projection.title,
          content: projection.projection.content,
          confidence: projection.projection.confidence,
          source: projection.projection.source,
          status: projection.projection.status,
          snapshot: asJson({
            semanticMemoryId: projection.projectionId,
            projectionEvidenceId: context.evidence.id,
            kind: projection.projection.kind,
            title: projection.projection.title,
            content: projection.projection.content,
            confidence: projection.projection.confidence,
            source: projection.projection.source,
            status: projection.projection.status,
          }),
          changeType: VersionChangeType.CREATED,
          reason: "Created by Projection Framework from RAW_SEGMENTATION evidence.",
          operationId,
          createdBy: MemoryActor.SYSTEM,
        },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.semanticMemoryVersion.findUnique({
            where: { operationId },
          });
          if (existing) {
            createdVersion = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      versionId: created.id,
      version: created.version,
      targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
      versionRecord: created,
      created: createdVersion,
    };
  },
  updateCurrentVersion: async (
    context,
    projection,
    version
  ): Promise<ProjectionCurrentVersionOutput<SemanticProjectionRecord>> => {
    if (projection.projection.currentVersionId === version.versionId) {
      return {
        projection: projection.projection,
        updated: false,
      };
    }

    const updated = await context.transaction.semanticMemory.update({
      where: { id: projection.projectionId },
      data: {
        currentVersion: version.version,
        currentVersionId: version.versionId,
        kind: version.versionRecord.kind,
        title: version.versionRecord.title,
        content: version.versionRecord.content,
        confidence: version.versionRecord.confidence,
        source: version.versionRecord.source,
        status: version.versionRecord.status,
        lastUpdatedAt: new Date(),
      },
      include: { currentVersionRecord: true },
    });

    return {
      projection: updated,
      updated: true,
    };
  },
};

export const timelineProjection: MemoryProjection<TimelineProjectionRecord, TimelineEventVersion> = {
  projectionName: "TimelineProjection",
  supportedEvidenceTypes: () => [EvidenceType.RAW_SEGMENTATION],
  shouldProject: ({ evidence, rawMemory }) =>
    evidence.status === "ACTIVE" &&
    evidence.evidenceType === EvidenceType.RAW_SEGMENTATION &&
    Boolean(rawMemory),
  project: async (
    context
  ): Promise<ProjectionProjectOutput<TimelineProjectionRecord>> => {
    if (context.currentProjection) {
      return {
        projectionId: context.currentProjection.id,
        targetType: EvidenceTargetType.TIMELINE_EVENT,
        projection: context.currentProjection,
        created: false,
      };
    }

    const timelineShape = createTimelineShape(context);
    const timelineEventId = timelineProjectionIdFromEvidenceId(context.evidence.id);
    let createdProjection = true;
    const created = await context.transaction.timelineEvent
      .create({
        data: {
          id: timelineEventId,
          userId: context.evidence.userId,
          title: timelineShape.title,
          description: timelineShape.description,
          startDate: timelineShape.startDate,
          endStatus: TimelineEventEndStatus.UNKNOWN,
          topics: timelineShape.topics,
          conversationIds: timelineShape.conversationIds,
          confidence: timelineShape.confidence,
          importanceScore: 0,
          status: TimelineEventStatus.ACTIVE,
        },
        include: { currentVersionRecord: true },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.timelineEvent.findUnique({
            where: { id: timelineEventId },
            include: { currentVersionRecord: true },
          });
          if (existing) {
            createdProjection = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      projectionId: created.id,
      targetType: EvidenceTargetType.TIMELINE_EVENT,
      projection: created,
      created: createdProjection,
    };
  },
  createVersion: async (
    context,
    projection
  ): Promise<ProjectionVersionOutput<TimelineEventVersion>> => {
    const existingVersion = context.previousVersion ?? projection.projection.currentVersionRecord;
    if (existingVersion) {
      return {
        versionId: existingVersion.id,
        version: existingVersion.version,
        targetType: EvidenceTargetType.TIMELINE_EVENT_VERSION,
        versionRecord: existingVersion,
        created: false,
      };
    }

    const version = 1;
    const operationId = timelineProjectionVersionOperationId({
      timelineEventId: projection.projectionId,
      version,
    });
    const timelineShape = createTimelineShape(context);
    let createdVersion = true;
    const created = await context.transaction.timelineEventVersion
      .create({
        data: {
          userId: context.evidence.userId,
          timelineEventId: projection.projectionId,
          version,
          title: projection.projection.title,
          description: projection.projection.description,
          startDate: projection.projection.startDate,
          endDate: projection.projection.endDate,
          durationText: projection.projection.durationText,
          endStatus: projection.projection.endStatus,
          people: asNullableJson(projection.projection.people),
          emotions: asNullableJson(projection.projection.emotions),
          topics: asNullableJson(projection.projection.topics),
          conversationIds: asNullableJson(projection.projection.conversationIds),
          parentEventId: projection.projection.parentEventId,
          mergedIntoEventId: projection.projection.mergedIntoEventId,
          splitFromEventId: projection.projection.splitFromEventId,
          confidence: projection.projection.confidence,
          importanceScore: projection.projection.importanceScore,
          status: projection.projection.status,
          snapshot: timelineShape.snapshot,
          changeType: VersionChangeType.CREATED,
          reason: "Created by Projection Framework from RAW_SEGMENTATION evidence.",
          operationId,
          createdBy: MemoryActor.SYSTEM,
        },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.timelineEventVersion.findUnique({
            where: { operationId },
          });
          if (existing) {
            createdVersion = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      versionId: created.id,
      version: created.version,
      targetType: EvidenceTargetType.TIMELINE_EVENT_VERSION,
      versionRecord: created,
      created: createdVersion,
    };
  },
  updateCurrentVersion: async (
    context,
    projection,
    version
  ): Promise<ProjectionCurrentVersionOutput<TimelineProjectionRecord>> => {
    if (projection.projection.currentVersionId === version.versionId) {
      return {
        projection: projection.projection,
        updated: false,
      };
    }

    const updated = await context.transaction.timelineEvent.update({
      where: { id: projection.projectionId },
      data: {
        currentVersion: version.version,
        currentVersionId: version.versionId,
        title: version.versionRecord.title,
        description: version.versionRecord.description,
        startDate: version.versionRecord.startDate,
        endDate: version.versionRecord.endDate,
        durationText: version.versionRecord.durationText,
        endStatus: version.versionRecord.endStatus,
        people: asNullableJson(version.versionRecord.people),
        emotions: asNullableJson(version.versionRecord.emotions),
        topics: asNullableJson(version.versionRecord.topics),
        conversationIds: asNullableJson(version.versionRecord.conversationIds),
        parentEventId: version.versionRecord.parentEventId,
        mergedIntoEventId: version.versionRecord.mergedIntoEventId,
        splitFromEventId: version.versionRecord.splitFromEventId,
        confidence: version.versionRecord.confidence,
        importanceScore: version.versionRecord.importanceScore,
        status: version.versionRecord.status,
      },
      include: { currentVersionRecord: true },
    });

    return {
      projection: updated,
      updated: true,
    };
  },
};

export const understandingProjection: MemoryProjection<
  UnderstandingProjectionRecord,
  UnderstandingVersion
> = {
  projectionName: "UnderstandingProjection",
  supportedEvidenceTypes: () => [EvidenceType.RAW_SEGMENTATION],
  shouldProject: ({ evidence, sourceSemanticMemory }) =>
    evidence.status === "ACTIVE" &&
    evidence.evidenceType === EvidenceType.RAW_SEGMENTATION &&
    Boolean(sourceSemanticMemory?.currentVersionRecord),
  project: async (
    context
  ): Promise<ProjectionProjectOutput<UnderstandingProjectionRecord>> => {
    if (context.currentProjection) {
      return {
        projectionId: context.currentProjection.id,
        targetType: EvidenceTargetType.UNDERSTANDING,
        projection: context.currentProjection,
        created: false,
      };
    }

    const understandingShape = createUnderstandingShape(context);
    const understandingId = understandingProjectionIdFromEvidenceId(context.evidence.id);
    let createdProjection = true;
    const created = await context.transaction.understanding
      .create({
        data: {
          id: understandingId,
          userId: context.evidence.userId,
          title: understandingShape.title,
          understanding: understandingShape.understanding,
          category: understandingShape.category,
          confidence: understandingShape.confidence,
          relatedSemanticMemoryIds: understandingShape.relatedSemanticMemoryIds,
          status: UnderstandingStatus.OPEN,
        },
        include: { currentVersionRecord: true },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.understanding.findUnique({
            where: { id: understandingId },
            include: { currentVersionRecord: true },
          });
          if (existing) {
            createdProjection = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      projectionId: created.id,
      targetType: EvidenceTargetType.UNDERSTANDING,
      projection: created,
      created: createdProjection,
    };
  },
  createVersion: async (
    context,
    projection
  ): Promise<ProjectionVersionOutput<UnderstandingVersion>> => {
    const existingVersion = context.previousVersion ?? projection.projection.currentVersionRecord;
    if (existingVersion) {
      return {
        versionId: existingVersion.id,
        version: existingVersion.version,
        targetType: EvidenceTargetType.UNDERSTANDING_VERSION,
        versionRecord: existingVersion,
        created: false,
      };
    }

    const version = 1;
    const operationId = understandingProjectionVersionOperationId({
      understandingId: projection.projectionId,
      version,
    });
    const understandingShape = createUnderstandingShape(context);
    let createdVersion = true;
    const created = await context.transaction.understandingVersion
      .create({
        data: {
          userId: context.evidence.userId,
          understandingId: projection.projectionId,
          version,
          title: projection.projection.title,
          understanding: projection.projection.understanding,
          category: projection.projection.category,
          confidence: projection.projection.confidence,
          alternativeHypotheses: asNullableJson(projection.projection.alternativeHypotheses),
          unknowns: asNullableJson(projection.projection.unknowns),
          relatedTimelineEventIds: asNullableJson(projection.projection.relatedTimelineEventIds),
          relatedRelationshipIds: asNullableJson(projection.projection.relatedRelationshipIds),
          relatedSemanticMemoryIds: asNullableJson(projection.projection.relatedSemanticMemoryIds),
          status: projection.projection.status,
          snapshot: understandingShape.snapshot,
          changeType: VersionChangeType.CREATED,
          reason: "Created by Projection Framework from RAW_SEGMENTATION evidence and SemanticMemory current version.",
          operationId,
          createdBy: MemoryActor.SYSTEM,
        },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.understandingVersion.findUnique({
            where: { operationId },
          });
          if (existing) {
            createdVersion = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      versionId: created.id,
      version: created.version,
      targetType: EvidenceTargetType.UNDERSTANDING_VERSION,
      versionRecord: created,
      created: createdVersion,
    };
  },
  updateCurrentVersion: async (
    context,
    projection,
    version
  ): Promise<ProjectionCurrentVersionOutput<UnderstandingProjectionRecord>> => {
    if (projection.projection.currentVersionId === version.versionId) {
      return {
        projection: projection.projection,
        updated: false,
      };
    }

    const updated = await context.transaction.understanding.update({
      where: { id: projection.projectionId },
      data: {
        currentVersion: version.version,
        currentVersionId: version.versionId,
        title: version.versionRecord.title,
        understanding: version.versionRecord.understanding,
        category: version.versionRecord.category,
        confidence: version.versionRecord.confidence,
        alternativeHypotheses: asNullableJson(version.versionRecord.alternativeHypotheses),
        unknowns: asNullableJson(version.versionRecord.unknowns),
        relatedTimelineEventIds: asNullableJson(version.versionRecord.relatedTimelineEventIds),
        relatedRelationshipIds: asNullableJson(version.versionRecord.relatedRelationshipIds),
        relatedSemanticMemoryIds: asNullableJson(version.versionRecord.relatedSemanticMemoryIds),
        status: version.versionRecord.status,
        lastTouchedAt: new Date(),
      },
      include: { currentVersionRecord: true },
    });

    return {
      projection: updated,
      updated: true,
    };
  },
};

export const relationshipProjection: MemoryProjection<
  RelationshipProjectionRecord,
  RelationshipVersion
> = {
  projectionName: "RelationshipProjection",
  supportedEvidenceTypes: () => [EvidenceType.RAW_SEGMENTATION],
  shouldProject: ({ evidence }) =>
    evidence.status === "ACTIVE" &&
    evidence.evidenceType === EvidenceType.RAW_SEGMENTATION &&
    Boolean(firstPersonCandidate(evidence.evidenceText)),
  project: async (
    context
  ): Promise<ProjectionProjectOutput<RelationshipProjectionRecord>> => {
    const relationshipShape = createRelationshipShape(context);
    const relationshipId = relationshipProjectionIdFromEvidenceIdAndDisplayName({
      evidenceId: context.evidence.id,
      displayNameKey: displayNameKey(relationshipShape.displayName),
    });

    const existing = await context.transaction.relationship.findUnique({
      where: { id: relationshipId },
      include: { currentVersionRecord: true },
    });
    const currentProjection = context.currentProjection ?? existing;

    if (currentProjection) {
      return {
        projectionId: currentProjection.id,
        targetType: EvidenceTargetType.RELATIONSHIP,
        projection: currentProjection,
        created: false,
      };
    }

    let createdProjection = true;
    const created = await context.transaction.relationship
      .create({
        data: {
          id: relationshipId,
          userId: context.evidence.userId,
          displayName: relationshipShape.displayName,
          relationshipType: relationshipShape.relationshipType,
          confidence: relationshipShape.confidence,
          status: relationshipShape.status,
        },
        include: { currentVersionRecord: true },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.relationship.findUnique({
            where: { id: relationshipId },
            include: { currentVersionRecord: true },
          });
          if (existing) {
            createdProjection = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      projectionId: created.id,
      targetType: EvidenceTargetType.RELATIONSHIP,
      projection: created,
      created: createdProjection,
    };
  },
  createVersion: async (
    context,
    projection
  ): Promise<ProjectionVersionOutput<RelationshipVersion>> => {
    const existingVersion = context.previousVersion ?? projection.projection.currentVersionRecord;
    if (existingVersion) {
      return {
        versionId: existingVersion.id,
        version: existingVersion.version,
        targetType: EvidenceTargetType.RELATIONSHIP_VERSION,
        versionRecord: existingVersion,
        created: false,
      };
    }

    const version = 1;
    const operationId = relationshipProjectionVersionOperationId({
      relationshipId: projection.projectionId,
      version,
    });
    const relationshipShape = createRelationshipShape(context);
    let createdVersion = true;
    const created = await context.transaction.relationshipVersion
      .create({
        data: {
          userId: context.evidence.userId,
          relationshipId: projection.projectionId,
          version,
          displayName: projection.projection.displayName,
          relationshipType: projection.projection.relationshipType,
          identityLabel: projection.projection.identityLabel,
          interactionFrequency: projection.projection.interactionFrequency,
          supportSignals: asNullableJson(projection.projection.supportSignals),
          conflictSignals: asNullableJson(projection.projection.conflictSignals),
          influenceSummary: projection.projection.influenceSummary,
          relatedTimelineEventIds: asNullableJson(projection.projection.relatedTimelineEventIds),
          relatedSemanticMemoryIds: asNullableJson(projection.projection.relatedSemanticMemoryIds),
          confidence: projection.projection.confidence,
          status: projection.projection.status,
          snapshot: relationshipShape.snapshot,
          changeType: VersionChangeType.CREATED,
          reason: "Created by Projection Framework from deterministic person candidate in RAW_SEGMENTATION evidence.",
          operationId,
          createdBy: MemoryActor.SYSTEM,
        },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await context.transaction.relationshipVersion.findUnique({
            where: { operationId },
          });
          if (existing) {
            createdVersion = false;
            return existing;
          }
        }
        throw error;
      });

    return {
      versionId: created.id,
      version: created.version,
      targetType: EvidenceTargetType.RELATIONSHIP_VERSION,
      versionRecord: created,
      created: createdVersion,
    };
  },
  updateCurrentVersion: async (
    context,
    projection,
    version
  ): Promise<ProjectionCurrentVersionOutput<RelationshipProjectionRecord>> => {
    if (projection.projection.currentVersionId === version.versionId) {
      return {
        projection: projection.projection,
        updated: false,
      };
    }

    const updated = await context.transaction.relationship.update({
      where: { id: projection.projectionId },
      data: {
        currentVersion: version.version,
        currentVersionId: version.versionId,
        displayName: version.versionRecord.displayName,
        relationshipType: version.versionRecord.relationshipType,
        identityLabel: version.versionRecord.identityLabel,
        interactionFrequency: version.versionRecord.interactionFrequency,
        supportSignals: asNullableJson(version.versionRecord.supportSignals),
        conflictSignals: asNullableJson(version.versionRecord.conflictSignals),
        influenceSummary: version.versionRecord.influenceSummary,
        relatedTimelineEventIds: asNullableJson(version.versionRecord.relatedTimelineEventIds),
        relatedSemanticMemoryIds: asNullableJson(version.versionRecord.relatedSemanticMemoryIds),
        confidence: version.versionRecord.confidence,
        status: version.versionRecord.status,
      },
      include: { currentVersionRecord: true },
    });

    return {
      projection: updated,
      updated: true,
    };
  },
};

const createStubProjection = (projectionName: string): MemoryProjection => ({
  projectionName,
  supportedEvidenceTypes: () => [EvidenceType.RAW_SEGMENTATION],
  shouldProject: () => false,
  project: async () => {
    throw new Error(`${projectionName} is a Phase 2 stub.`);
  },
  createVersion: async () => {
    throw new Error(`${projectionName} is a Phase 2 stub.`);
  },
  updateCurrentVersion: async () => {
    throw new Error(`${projectionName} is a Phase 2 stub.`);
  },
});

export class ProjectionRegistry {
  private readonly projections = new Map<string, MemoryProjection>();

  register(projection: MemoryProjection) {
    this.projections.set(projection.projectionName, projection);
    return this;
  }

  list() {
    return [...this.projections.values()];
  }

  get(projectionName: string) {
    return this.projections.get(projectionName) ?? null;
  }
}

export const createDefaultProjectionRegistry = () =>
  new ProjectionRegistry()
    .register(semanticProjection)
    .register(timelineProjection)
    .register(relationshipProjection)
    .register(understandingProjection);
