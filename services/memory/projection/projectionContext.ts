import {
  Evidence,
  EvidenceRole,
  EvidenceTargetType,
  Prisma,
  RawMemory,
  Relationship,
  RelationshipVersion,
  SemanticMemory,
  SemanticMemoryVersion,
  TimelineEvent,
  TimelineEventVersion,
  Understanding,
  UnderstandingVersion,
  User,
} from "@prisma/client";

import {
  timelineProjectionIdFromEvidenceId,
  understandingProjectionIdFromEvidenceId,
} from "./projectionIds";
import { MemoryProjection, ProjectionLogger } from "./projectionTypes";

export type ProjectionContext<TProjection = unknown, TVersion = unknown> = {
  user: Pick<User, "id" | "phone" | "nickname">;
  rawMemory: RawMemory | null;
  evidence: Evidence;
  currentProjection: TProjection | null;
  previousVersion: TVersion | null;
  sourceSemanticMemory: SemanticProjectionRecord | null;
  transaction: Prisma.TransactionClient;
  logger: ProjectionLogger;
};

const consoleProjectionLogger: ProjectionLogger = {
  info: (message, metadata) => console.info(message, metadata ?? {}),
  warn: (message, metadata) => console.warn(message, metadata ?? {}),
  error: (message, metadata) => console.error(message, metadata ?? {}),
};

const loadSemanticProjectionContext = async ({
  tx,
  evidenceId,
}: {
  tx: Prisma.TransactionClient;
  evidenceId: string;
}) => {
  const currentProjection = await tx.semanticMemory.findUnique({
    where: { projectionEvidenceId: evidenceId },
    include: { currentVersionRecord: true },
  });

  return {
    currentProjection,
    previousVersion: currentProjection?.currentVersionRecord ?? null,
    sourceSemanticMemory: null,
  };
};

const loadTimelineProjectionContext = async ({
  tx,
  evidenceId,
}: {
  tx: Prisma.TransactionClient;
  evidenceId: string;
}) => {
  const timelineLink = await tx.memoryEvidenceLink.findFirst({
    where: {
      evidenceId,
      targetType: EvidenceTargetType.TIMELINE_EVENT,
      role: EvidenceRole.SOURCE,
    },
    orderBy: { createdAt: "asc" },
  });
  const timelineEventId = timelineLink?.targetId ?? timelineProjectionIdFromEvidenceId(evidenceId);
  const currentProjection = await tx.timelineEvent.findUnique({
    where: { id: timelineEventId },
    include: { currentVersionRecord: true },
  });

  return {
    currentProjection,
    previousVersion: currentProjection?.currentVersionRecord ?? null,
    sourceSemanticMemory: null,
  };
};

const loadUnderstandingProjectionContext = async ({
  tx,
  evidenceId,
}: {
  tx: Prisma.TransactionClient;
  evidenceId: string;
}) => {
  const understandingLink = await tx.memoryEvidenceLink.findFirst({
    where: {
      evidenceId,
      targetType: EvidenceTargetType.UNDERSTANDING,
      role: EvidenceRole.SOURCE,
    },
    orderBy: { createdAt: "asc" },
  });
  const understandingId =
    understandingLink?.targetId ?? understandingProjectionIdFromEvidenceId(evidenceId);
  const currentProjection = await tx.understanding.findUnique({
    where: { id: understandingId },
    include: { currentVersionRecord: true },
  });
  const sourceSemanticMemory = await tx.semanticMemory.findUnique({
    where: { projectionEvidenceId: evidenceId },
    include: { currentVersionRecord: true },
  });

  return {
    currentProjection,
    previousVersion: currentProjection?.currentVersionRecord ?? null,
    sourceSemanticMemory,
  };
};

const loadCurrentProjectionContext = async ({
  tx,
  projection,
  evidenceId,
}: {
  tx: Prisma.TransactionClient;
  projection: MemoryProjection;
  evidenceId: string;
}) => {
  if (projection.projectionName === "SemanticProjection") {
    return loadSemanticProjectionContext({ tx, evidenceId });
  }
  if (projection.projectionName === "TimelineProjection") {
    return loadTimelineProjectionContext({ tx, evidenceId });
  }
  if (projection.projectionName === "UnderstandingProjection") {
    return loadUnderstandingProjectionContext({ tx, evidenceId });
  }

  return {
    currentProjection: null,
    previousVersion: null,
    sourceSemanticMemory: null,
  };
};

const shouldLoadRawMemory = (projection: MemoryProjection) =>
  projection.projectionName === "TimelineProjection";

export const buildProjectionContext = async <TProjection = unknown, TVersion = unknown>({
  tx,
  evidenceId,
  projection,
  logger = consoleProjectionLogger,
}: {
  tx: Prisma.TransactionClient;
  evidenceId: string;
  projection: MemoryProjection<TProjection, TVersion>;
  logger?: ProjectionLogger;
}): Promise<ProjectionContext<TProjection, TVersion>> => {
  const evidence = await tx.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
  });
  const user = await tx.user.findUniqueOrThrow({
    where: { id: evidence.userId },
    select: {
      id: true,
      phone: true,
      nickname: true,
    },
  });
  const rawMemory = evidence.rawMemoryId && shouldLoadRawMemory(projection)
    ? await tx.rawMemory.findUnique({ where: { id: evidence.rawMemoryId } })
    : null;
  const { currentProjection, previousVersion, sourceSemanticMemory = null } = await loadCurrentProjectionContext({
    tx,
    projection,
    evidenceId,
  });

  return {
    user,
    rawMemory,
    evidence,
    currentProjection: currentProjection as TProjection | null,
    previousVersion: previousVersion as TVersion | null,
    sourceSemanticMemory,
    transaction: tx,
    logger,
  };
};

export type SemanticProjectionRecord = SemanticMemory & {
  currentVersionRecord: SemanticMemoryVersion | null;
};

export type TimelineProjectionRecord = TimelineEvent & {
  currentVersionRecord: TimelineEventVersion | null;
};

export type UnderstandingProjectionRecord = Understanding & {
  currentVersionRecord: UnderstandingVersion | null;
};

export type RelationshipProjectionRecord = Relationship & {
  currentVersionRecord: RelationshipVersion | null;
};
