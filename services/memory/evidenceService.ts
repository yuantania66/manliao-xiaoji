import {
  EvidenceRole,
  EvidenceSourceKind,
  EvidenceTargetType,
  EvidenceType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const createEvidenceFromRawMemory = async ({
  rawMemoryId,
  evidenceType = EvidenceType.RAW_SEGMENTATION,
  evidenceText,
  confidence = 0.5,
  weight = 0.5,
}: {
  rawMemoryId: string;
  evidenceType?: EvidenceType;
  evidenceText?: string;
  confidence?: number;
  weight?: number;
}) => {
  const rawMemory = await prisma.rawMemory.findUniqueOrThrow({
    where: { id: rawMemoryId },
    select: {
      id: true,
      userId: true,
      occurredAt: true,
    },
  });

  const existing = await prisma.evidence.findFirst({
    where: {
      userId: rawMemory.userId,
      rawMemoryId: rawMemory.id,
      evidenceType,
    },
  });
  if (existing) return existing;

  try {
    return await prisma.evidence.create({
      data: {
        userId: rawMemory.userId,
        sourceKind: EvidenceSourceKind.RAW_MEMORY,
        sourceId: rawMemory.id,
        rawMemoryId: rawMemory.id,
        evidenceType,
        evidenceText,
        occurredAt: rawMemory.occurredAt,
        confidence,
        weight,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedExisting = await prisma.evidence.findFirst({
        where: {
          userId: rawMemory.userId,
          rawMemoryId: rawMemory.id,
          evidenceType,
        },
      });
      if (racedExisting) return racedExisting;
    }
    throw error;
  }
};

export const linkEvidenceToTarget = async ({
  evidenceId,
  targetType,
  targetId,
  role = EvidenceRole.SOURCE,
}: {
  evidenceId: string;
  targetType: EvidenceTargetType;
  targetId: string;
  role?: EvidenceRole;
}) => {
  const evidence = await prisma.evidence.findUniqueOrThrow({
    where: { id: evidenceId },
    select: { id: true, userId: true },
  });

  const existing = await prisma.memoryEvidenceLink.findUnique({
    where: {
      evidenceId_targetType_targetId_role: {
        evidenceId: evidence.id,
        targetType,
        targetId,
        role,
      },
    },
  });
  if (existing) return existing;

  try {
    return await prisma.memoryEvidenceLink.create({
      data: {
        userId: evidence.userId,
        evidenceId: evidence.id,
        targetType,
        targetId,
        role,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedExisting = await prisma.memoryEvidenceLink.findUnique({
        where: {
          evidenceId_targetType_targetId_role: {
            evidenceId: evidence.id,
            targetType,
            targetId,
            role,
          },
        },
      });
      if (racedExisting) return racedExisting;
    }
    throw error;
  }
};

export const listEvidenceForTarget = async ({
  targetType,
  targetId,
  role,
}: {
  targetType: EvidenceTargetType;
  targetId: string;
  role?: EvidenceRole;
}) =>
  prisma.memoryEvidenceLink.findMany({
    where: {
      targetType,
      targetId,
      ...(role ? { role } : {}),
    },
    include: {
      evidence: true,
    },
    orderBy: { createdAt: "asc" },
  });
