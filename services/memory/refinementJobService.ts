import { Prisma, RefinementStatus, RefinementStep } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DEFAULT_PIPELINE_VERSION = "memory_v2_phase1_raw";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const getOperationId = ({
  rawMemoryId,
  step,
  pipelineVersion,
}: {
  rawMemoryId: string;
  step: RefinementStep;
  pipelineVersion: string;
}) => `${pipelineVersion}:${rawMemoryId}:${step}`;

export const createRefinementJobForRawMemory = async ({
  rawMemoryId,
  step = RefinementStep.RAW_CAPTURED,
  pipelineVersion = DEFAULT_PIPELINE_VERSION,
  inputSnapshot,
}: {
  rawMemoryId: string;
  step?: RefinementStep;
  pipelineVersion?: string;
  inputSnapshot?: Prisma.InputJsonValue;
}) => {
  const rawMemory = await prisma.rawMemory.findUniqueOrThrow({
    where: { id: rawMemoryId },
    select: {
      id: true,
      userId: true,
      kind: true,
      sourceType: true,
      sourceId: true,
      sourceRevision: true,
      occurredAt: true,
    },
  });
  const operationId = getOperationId({ rawMemoryId, step, pipelineVersion });

  const existing = await prisma.refinementJob.findUnique({
    where: { operationId },
  });
  if (existing) return existing;

  try {
    return await prisma.refinementJob.create({
      data: {
        userId: rawMemory.userId,
        rawMemoryId,
        segmentKey: rawMemoryId,
        pipelineVersion,
        step,
        status: RefinementStatus.PENDING,
        operationId,
        inputSnapshot:
          inputSnapshot ??
          asJson({
            rawMemoryId: rawMemory.id,
            kind: rawMemory.kind,
            sourceType: rawMemory.sourceType,
            sourceId: rawMemory.sourceId,
            sourceRevision: rawMemory.sourceRevision,
            occurredAt: rawMemory.occurredAt.toISOString(),
          }),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedExisting = await prisma.refinementJob.findUnique({
        where: { operationId },
      });
      if (racedExisting) return racedExisting;
    }
    throw error;
  }
};

export const listPendingRefinementJobs = async ({
  take = 20,
  step,
}: {
  take?: number;
  step?: RefinementStep;
} = {}) =>
  prisma.refinementJob.findMany({
    where: {
      status: RefinementStatus.PENDING,
      ...(step ? { step } : {}),
    },
    orderBy: { createdAt: "asc" },
    take,
  });

export const claimPendingRefinementJob = async ({ jobId }: { jobId: string }) => {
  const claimedAt = new Date();
  const result = await prisma.refinementJob.updateMany({
    where: {
      id: jobId,
      status: RefinementStatus.PENDING,
    },
    data: {
      status: RefinementStatus.RUNNING,
      startedAt: claimedAt,
      finishedAt: null,
      error: null,
      attempt: { increment: 1 },
    },
  });

  if (result.count !== 1) return null;
  return prisma.refinementJob.findUniqueOrThrow({ where: { id: jobId } });
};

export const markRefinementJobRunning = async ({ jobId }: { jobId: string }) => {
  const claimedJob = await claimPendingRefinementJob({ jobId });
  if (!claimedJob) {
    throw new Error("RefinementJob could not be marked RUNNING because it is not PENDING.");
  }
  return claimedJob;
};

export const markRefinementJobSucceeded = async ({
  jobId,
  outputSnapshot,
}: {
  jobId: string;
  outputSnapshot?: Prisma.InputJsonValue;
}) =>
  prisma.refinementJob.update({
    where: { id: jobId },
    data: {
      status: RefinementStatus.SUCCEEDED,
      finishedAt: new Date(),
      outputSnapshot,
      error: null,
    },
  });

export const markRefinementJobFailed = async ({
  jobId,
  error,
  outputSnapshot,
}: {
  jobId: string;
  error: string;
  outputSnapshot?: Prisma.InputJsonValue;
}) =>
  prisma.refinementJob.update({
    where: { id: jobId },
    data: {
      status: RefinementStatus.FAILED,
      finishedAt: new Date(),
      error,
      outputSnapshot,
    },
  });
