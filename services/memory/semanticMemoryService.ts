import {
  EvidenceRole,
  EvidenceTargetType,
  EvidenceType,
  MemoryActor,
  Prisma,
  SemanticMemoryKind,
  SemanticMemoryStatus,
  VersionChangeType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { linkEvidenceToTarget } from "./evidenceService";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const getSemanticMemoryVersionOperationId = ({
  semanticMemoryId,
  version,
}: {
  semanticMemoryId: string;
  version: number;
}) => `memory_v2_phase1_semantic_memory:${semanticMemoryId}:v${version}`;

export const createSemanticMemoryVersion = async ({
  semanticMemoryId,
  version = 1,
  evidenceId,
  changeType = VersionChangeType.CREATED,
  reason = "Created from RAW_SEGMENTATION evidence.",
}: {
  semanticMemoryId: string;
  version?: number;
  evidenceId?: string;
  changeType?: VersionChangeType;
  reason?: string;
}) => {
  const semanticMemory = await prisma.semanticMemory.findUniqueOrThrow({
    where: { id: semanticMemoryId },
  });
  const operationId = getSemanticMemoryVersionOperationId({
    semanticMemoryId: semanticMemory.id,
    version,
  });

  const existing = await prisma.semanticMemoryVersion.findUnique({
    where: { operationId },
  });
  if (existing) {
    if (evidenceId) {
      await linkEvidenceToTarget({
        evidenceId,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
        targetId: existing.id,
        role: EvidenceRole.SOURCE,
      });
    }
    return existing;
  }

  try {
    const created = await prisma.semanticMemoryVersion.create({
      data: {
        userId: semanticMemory.userId,
        semanticMemoryId: semanticMemory.id,
        version,
        kind: semanticMemory.kind,
        title: semanticMemory.title,
        content: semanticMemory.content,
        confidence: semanticMemory.confidence,
        source: semanticMemory.source,
        status: semanticMemory.status,
        snapshot: asJson({
          semanticMemoryId: semanticMemory.id,
          projectionEvidenceId: semanticMemory.projectionEvidenceId,
          kind: semanticMemory.kind,
          title: semanticMemory.title,
          content: semanticMemory.content,
          confidence: semanticMemory.confidence,
          source: semanticMemory.source,
          status: semanticMemory.status,
        }),
        changeType,
        reason,
        operationId,
        createdBy: MemoryActor.SYSTEM,
      },
    });

    if (evidenceId) {
      await linkEvidenceToTarget({
        evidenceId,
        targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
        targetId: created.id,
        role: EvidenceRole.SOURCE,
      });
    }

    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedExisting = await prisma.semanticMemoryVersion.findUnique({
        where: { operationId },
      });
      if (racedExisting) return racedExisting;
    }
    throw error;
  }
};

export const setCurrentSemanticMemoryVersion = async ({
  semanticMemoryId,
  versionId,
}: {
  semanticMemoryId: string;
  versionId: string;
}) => {
  const version = await prisma.semanticMemoryVersion.findUniqueOrThrow({
    where: { id: versionId },
  });

  return prisma.semanticMemory.update({
    where: { id: semanticMemoryId },
    data: {
      currentVersion: version.version,
      currentVersionId: version.id,
      kind: version.kind,
      title: version.title,
      content: version.content,
      confidence: version.confidence,
      source: version.source,
      status: version.status,
      lastUpdatedAt: new Date(),
    },
  });
};

export const createSemanticMemoryFromEvidence = async ({ evidenceId }: { evidenceId: string }) => {
  const evidence = await prisma.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
  });

  if (evidence.evidenceType !== EvidenceType.RAW_SEGMENTATION) {
    throw new Error("Only RAW_SEGMENTATION evidence can create Phase 1 SemanticMemory projections.");
  }

  const existing = await prisma.semanticMemory.findUnique({
    where: { projectionEvidenceId: evidence.id },
  });

  const semanticMemory =
    existing ??
    (await prisma.semanticMemory
      .create({
        data: {
          userId: evidence.userId,
          projectionEvidenceId: evidence.id,
          kind: SemanticMemoryKind.RAW_SEGMENT,
          title: "Raw segment",
          content: evidence.evidenceText ?? "",
          confidence: evidence.confidence,
          source: "RAW_SEGMENTATION_EVIDENCE",
          status: SemanticMemoryStatus.ACTIVE,
        },
      })
      .catch(async (error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const racedExisting = await prisma.semanticMemory.findUnique({
            where: { projectionEvidenceId: evidence.id },
          });
          if (racedExisting) return racedExisting;
        }
        throw error;
      }));

  const version = await createSemanticMemoryVersion({
    semanticMemoryId: semanticMemory.id,
    version: 1,
    evidenceId: evidence.id,
  });
  const currentSemanticMemory =
    semanticMemory.currentVersionId === version.id
      ? semanticMemory
      : await setCurrentSemanticMemoryVersion({
          semanticMemoryId: semanticMemory.id,
          versionId: version.id,
        });

  await linkEvidenceToTarget({
    evidenceId: evidence.id,
    targetType: EvidenceTargetType.SEMANTIC_MEMORY,
    targetId: currentSemanticMemory.id,
    role: EvidenceRole.SOURCE,
  });
  await linkEvidenceToTarget({
    evidenceId: evidence.id,
    targetType: EvidenceTargetType.SEMANTIC_MEMORY_VERSION,
    targetId: version.id,
    role: EvidenceRole.SOURCE,
  });

  return {
    semanticMemory: currentSemanticMemory,
    version,
  };
};

export const listSemanticMemoriesForUser = async ({ userId }: { userId: string }) =>
  prisma.semanticMemory.findMany({
    where: { userId },
    include: {
      currentVersionRecord: true,
    },
    orderBy: { lastUpdatedAt: "desc" },
  });
