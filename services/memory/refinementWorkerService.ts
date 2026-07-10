import { createHash } from "node:crypto";

import { EvidenceRole, EvidenceTargetType, EvidenceType, Prisma, RefinementStatus, RefinementStep } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { createEvidenceFromRawMemory, linkEvidenceToTarget } from "./evidenceService";
import { dispatchEvidenceToProjections } from "./projection/projectionDispatcher";
import {
  claimPendingRefinementJob,
  createRefinementJobForRawMemory,
  listPendingRefinementJobs,
  markRefinementJobFailed,
  markRefinementJobSucceeded,
} from "./refinementJobService";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const RAW_MEMORY_MISSING_ERROR = "RawMemory is missing for refinement job.";

export type ProcessRefinementJobResult =
  | { outcome: "succeeded"; jobId: string }
  | { outcome: "failed"; jobId: string; error: string }
  | {
      outcome: "skipped";
      jobId: string;
      reason: "already_succeeded" | "already_failed" | "already_running" | "claim_lost" | "unsupported_step";
    };

type ClaimedRefinementJob = NonNullable<Awaited<ReturnType<typeof claimPendingRefinementJob>>>;

const stableJsonStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
};

const getPayloadKeys = (payload: Prisma.JsonValue) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.keys(payload).sort();
};

const normalizePersonCandidate = (candidate: unknown) => {
  if (typeof candidate === "string") return candidate.trim();
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return "";
  const record = candidate as Record<string, unknown>;
  const displayName = record.displayName ?? record.name ?? record.label;
  return typeof displayName === "string" ? displayName.trim() : "";
};

const getPayloadPersonCandidates = (payload: Prisma.JsonValue) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const rawCandidates = record.personCandidates ?? record.people ?? record.persons;
  if (!Array.isArray(rawCandidates)) return [];

  return [...new Set(rawCandidates.map(normalizePersonCandidate).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
};

const createDeterministicSegmentationMetadata = ({
  rawMemoryId,
  payload,
}: {
  rawMemoryId: string;
  payload: Prisma.JsonValue;
}) => {
  const payloadText = stableJsonStringify(payload);
  const payloadHash = createHash("sha256").update(payloadText).digest("hex");
  const payloadKeys = getPayloadKeys(payload);
  const personCandidates = getPayloadPersonCandidates(payload);

  return {
    algorithm: "deterministic_payload_v1",
    rawMemoryId,
    payloadHash,
    payloadKeys,
    personCandidates,
    payloadLength: payloadText.length,
    segmentCount: 1,
    segments: [
      {
        index: 0,
        kind: "raw_payload",
        charStart: 0,
        charEnd: payloadText.length,
        sourceFields: payloadKeys,
      },
    ],
  };
};

const processClaimedRawCapturedJob = async (
  runningJob: ClaimedRefinementJob
): Promise<ProcessRefinementJobResult> => {
  const job = await prisma.refinementJob.findUnique({
    where: { id: runningJob.id },
    select: {
      id: true,
      rawMemoryId: true,
      step: true,
      status: true,
    },
  });
  if (!job) {
    return { outcome: "skipped", jobId: runningJob.id, reason: "claim_lost" };
  }

  if (job.step !== RefinementStep.RAW_CAPTURED) {
    return { outcome: "skipped", jobId: job.id, reason: "unsupported_step" };
  }
  if (job.status === RefinementStatus.SUCCEEDED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_succeeded" };
  }
  if (job.status === RefinementStatus.FAILED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_failed" };
  }
  if (job.status !== RefinementStatus.RUNNING) {
    return { outcome: "skipped", jobId: job.id, reason: "claim_lost" };
  }

  if (!runningJob.rawMemoryId) {
    await markRefinementJobFailed({
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
      outputSnapshot: asJson({
        processedBy: "memory_v2_phase1_raw_worker",
        processedAt: new Date().toISOString(),
        rawMemoryFound: false,
      }),
    });
    return {
      outcome: "failed",
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
    };
  }

  const rawMemory = await prisma.rawMemory.findUnique({
    where: { id: runningJob.rawMemoryId },
    select: {
      id: true,
      userId: true,
      kind: true,
      sourceType: true,
      sourceId: true,
      sourceRevision: true,
      occurredAt: true,
      createdAt: true,
    },
  });

  if (!rawMemory) {
    await markRefinementJobFailed({
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
      outputSnapshot: asJson({
        processedBy: "memory_v2_phase1_raw_worker",
        processedAt: new Date().toISOString(),
        rawMemoryId: runningJob.rawMemoryId,
        rawMemoryFound: false,
      }),
    });
    return {
      outcome: "failed",
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
    };
  }

  const nextJob = await createRefinementJobForRawMemory({
    rawMemoryId: rawMemory.id,
    step: RefinementStep.RAW_TO_SEGMENTATION,
    inputSnapshot: asJson({
      rawMemoryId: rawMemory.id,
      previousJobId: runningJob.id,
      previousStep: RefinementStep.RAW_CAPTURED,
    }),
  });

  await markRefinementJobSucceeded({
    jobId: runningJob.id,
    outputSnapshot: asJson({
      processedBy: "memory_v2_phase1_raw_worker",
      processedAt: new Date().toISOString(),
      rawMemoryFound: true,
      rawMemory: {
        id: rawMemory.id,
        userId: rawMemory.userId,
        kind: rawMemory.kind,
        sourceType: rawMemory.sourceType,
        sourceId: rawMemory.sourceId,
        sourceRevision: rawMemory.sourceRevision,
        occurredAt: rawMemory.occurredAt.toISOString(),
        createdAt: rawMemory.createdAt.toISOString(),
      },
      nextJob: {
        id: nextJob.id,
        step: nextJob.step,
        status: nextJob.status,
      },
    }),
  });

  return { outcome: "succeeded", jobId: runningJob.id };
};

const processClaimedRawToSegmentationJob = async (
  runningJob: ClaimedRefinementJob
): Promise<ProcessRefinementJobResult> => {
  const job = await prisma.refinementJob.findUnique({
    where: { id: runningJob.id },
    select: {
      id: true,
      rawMemoryId: true,
      step: true,
      status: true,
    },
  });
  if (!job) {
    return { outcome: "skipped", jobId: runningJob.id, reason: "claim_lost" };
  }

  if (job.step !== RefinementStep.RAW_TO_SEGMENTATION) {
    return { outcome: "skipped", jobId: job.id, reason: "unsupported_step" };
  }
  if (job.status === RefinementStatus.SUCCEEDED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_succeeded" };
  }
  if (job.status === RefinementStatus.FAILED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_failed" };
  }
  if (job.status !== RefinementStatus.RUNNING) {
    return { outcome: "skipped", jobId: job.id, reason: "claim_lost" };
  }

  if (!runningJob.rawMemoryId) {
    await markRefinementJobFailed({
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
      outputSnapshot: asJson({
        processedBy: "memory_v2_phase1_segmentation_worker",
        processedAt: new Date().toISOString(),
        rawMemoryFound: false,
      }),
    });
    return { outcome: "failed", jobId: runningJob.id, error: RAW_MEMORY_MISSING_ERROR };
  }

  const rawMemory = await prisma.rawMemory.findUnique({
    where: { id: runningJob.rawMemoryId },
    select: {
      id: true,
      userId: true,
      sourceType: true,
      sourceId: true,
      sourceRevision: true,
      payload: true,
      occurredAt: true,
    },
  });

  if (!rawMemory) {
    await markRefinementJobFailed({
      jobId: runningJob.id,
      error: RAW_MEMORY_MISSING_ERROR,
      outputSnapshot: asJson({
        processedBy: "memory_v2_phase1_segmentation_worker",
        processedAt: new Date().toISOString(),
        rawMemoryId: runningJob.rawMemoryId,
        rawMemoryFound: false,
      }),
    });
    return { outcome: "failed", jobId: runningJob.id, error: RAW_MEMORY_MISSING_ERROR };
  }

  const segmentation = createDeterministicSegmentationMetadata({
    rawMemoryId: rawMemory.id,
    payload: rawMemory.payload,
  });
  const evidence = await createEvidenceFromRawMemory({
    rawMemoryId: rawMemory.id,
    evidenceType: EvidenceType.RAW_SEGMENTATION,
    evidenceText: stableJsonStringify(segmentation),
    confidence: 0.5,
    weight: 0.5,
  });
  const evidenceLink = await linkEvidenceToTarget({
    evidenceId: evidence.id,
    targetType: EvidenceTargetType.RAW_SEGMENTATION,
    targetId: runningJob.id,
    role: EvidenceRole.SOURCE,
  });
  const projectionResults = await dispatchEvidenceToProjections({
    evidence,
  });
  const semanticMemoryProjection = projectionResults.find(
    (result) => result.projectionName === "SemanticProjection"
  );

  await markRefinementJobSucceeded({
    jobId: runningJob.id,
    outputSnapshot: asJson({
      processedBy: "memory_v2_phase1_segmentation_worker",
      processedAt: new Date().toISOString(),
      rawMemoryFound: true,
      rawMemory: {
        id: rawMemory.id,
        userId: rawMemory.userId,
        sourceType: rawMemory.sourceType,
        sourceId: rawMemory.sourceId,
        sourceRevision: rawMemory.sourceRevision,
        occurredAt: rawMemory.occurredAt.toISOString(),
      },
      segmentation,
      evidence: {
        id: evidence.id,
        evidenceType: evidence.evidenceType,
        linkId: evidenceLink.id,
        targetType: evidenceLink.targetType,
        targetId: evidenceLink.targetId,
        role: evidenceLink.role,
      },
      semanticMemory: {
        id: semanticMemoryProjection?.projectionId,
        versionId: semanticMemoryProjection?.versionId,
        status: semanticMemoryProjection?.status,
      },
      projectionResults,
    }),
  });

  return { outcome: "succeeded", jobId: runningJob.id };
};

const processClaimedRefinementJob = async (
  runningJob: ClaimedRefinementJob
): Promise<ProcessRefinementJobResult> => {
  switch (runningJob.step) {
    case RefinementStep.RAW_CAPTURED:
      return processClaimedRawCapturedJob(runningJob);
    case RefinementStep.RAW_TO_SEGMENTATION:
      return processClaimedRawToSegmentationJob(runningJob);
    default:
      return { outcome: "skipped", jobId: runningJob.id, reason: "unsupported_step" };
  }
};

export const processRawCapturedJob = async ({
  jobId,
}: {
  jobId: string;
}): Promise<ProcessRefinementJobResult> => {
  const job = await prisma.refinementJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      step: true,
      status: true,
    },
  });

  if (job.step !== RefinementStep.RAW_CAPTURED) {
    return { outcome: "skipped", jobId: job.id, reason: "unsupported_step" };
  }
  if (job.status === RefinementStatus.SUCCEEDED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_succeeded" };
  }
  if (job.status === RefinementStatus.FAILED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_failed" };
  }
  if (job.status === RefinementStatus.RUNNING) {
    return { outcome: "skipped", jobId: job.id, reason: "already_running" };
  }

  const claimedJob = await claimPendingRefinementJob({ jobId: job.id });
  if (!claimedJob) {
    return { outcome: "skipped", jobId: job.id, reason: "claim_lost" };
  }

  return processClaimedRawCapturedJob(claimedJob);
};

export const processRawToSegmentationJob = async ({
  jobId,
}: {
  jobId: string;
}): Promise<ProcessRefinementJobResult> => {
  const job = await prisma.refinementJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      step: true,
      status: true,
    },
  });

  if (job.step !== RefinementStep.RAW_TO_SEGMENTATION) {
    return { outcome: "skipped", jobId: job.id, reason: "unsupported_step" };
  }
  if (job.status === RefinementStatus.SUCCEEDED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_succeeded" };
  }
  if (job.status === RefinementStatus.FAILED) {
    return { outcome: "skipped", jobId: job.id, reason: "already_failed" };
  }
  if (job.status === RefinementStatus.RUNNING) {
    return { outcome: "skipped", jobId: job.id, reason: "already_running" };
  }

  const claimedJob = await claimPendingRefinementJob({ jobId: job.id });
  if (!claimedJob) {
    return { outcome: "skipped", jobId: job.id, reason: "claim_lost" };
  }

  return processClaimedRawToSegmentationJob(claimedJob);
};

export const processPendingRefinementJobs = async ({
  take = 20,
  step,
}: {
  take?: number;
  step?: RefinementStep;
} = {}) => {
  const jobs = await listPendingRefinementJobs({
    step,
    take,
  });

  const results: ProcessRefinementJobResult[] = [];
  for (const job of jobs) {
    const claimedJob = await claimPendingRefinementJob({ jobId: job.id });
    if (!claimedJob) {
      results.push({ outcome: "skipped", jobId: job.id, reason: "claim_lost" });
      continue;
    }
    results.push(await processClaimedRefinementJob(claimedJob));
  }
  return results;
};
