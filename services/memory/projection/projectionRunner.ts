import {
  EvidenceRole,
  EvidenceTargetType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { buildProjectionContext } from "./projectionContext";
import {
  createFailedProjectionResult,
  createSkippedProjectionResult,
  ProjectionEvidenceLinkResult,
  ProjectionResult,
} from "./projectionResult";
import { MemoryProjection, ProjectionLogger } from "./projectionTypes";

const ensureEvidenceLink = async ({
  tx,
  userId,
  evidenceId,
  targetType,
  targetId,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  evidenceId: string;
  targetType: EvidenceTargetType;
  targetId: string;
}): Promise<ProjectionEvidenceLinkResult> => {
  const role = EvidenceRole.SOURCE;
  const existing = await tx.memoryEvidenceLink.findUnique({
    where: {
      evidenceId_targetType_targetId_role: {
        evidenceId,
        targetType,
        targetId,
        role,
      },
    },
  });
  if (existing) {
    return {
      id: existing.id,
      targetType: existing.targetType,
      targetId: existing.targetId,
      created: false,
    };
  }

  const created = await tx.memoryEvidenceLink.create({
    data: {
      userId,
      evidenceId,
      targetType,
      targetId,
      role,
    },
  });

  return {
    id: created.id,
    targetType: created.targetType,
    targetId: created.targetId,
    created: true,
  };
};

export const runProjection = async ({
  evidenceId,
  projection,
  logger,
}: {
  evidenceId: string;
  projection: MemoryProjection;
  logger?: ProjectionLogger;
}): Promise<ProjectionResult> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const context = await buildProjectionContext({
        tx,
        evidenceId,
        projection,
        logger,
      });

      if (!projection.supportedEvidenceTypes().includes(context.evidence.evidenceType)) {
        return createSkippedProjectionResult({
          projectionName: projection.projectionName,
          reason: "unsupported_evidence_type",
        });
      }

      const shouldProject = await projection.shouldProject(context);
      if (!shouldProject) {
        return createSkippedProjectionResult({
          projectionName: projection.projectionName,
          reason: "should_project_false",
        });
      }

      context.logger.info("memory projection started", {
        projectionName: projection.projectionName,
        evidenceId,
      });

      const projected = await projection.project(context);
      const version = await projection.createVersion(context, projected);
      const evidenceLinks = [
        await ensureEvidenceLink({
          tx,
          userId: context.evidence.userId,
          evidenceId: context.evidence.id,
          targetType: projected.targetType,
          targetId: projected.projectionId,
        }),
        await ensureEvidenceLink({
          tx,
          userId: context.evidence.userId,
          evidenceId: context.evidence.id,
          targetType: version.targetType,
          targetId: version.versionId,
        }),
      ];
      const current = await projection.updateCurrentVersion(context, projected, version);

      const changed =
        projected.created ||
        version.created ||
        current.updated ||
        evidenceLinks.some((link) => link.created);
      const status = !changed ? "skipped" : projected.created ? "created" : "updated";

      context.logger.info("memory projection finished", {
        projectionName: projection.projectionName,
        evidenceId,
        projectionId: projected.projectionId,
        versionId: version.versionId,
        status,
      });

      return {
        projectionName: projection.projectionName,
        status,
        projectionId: projected.projectionId,
        versionId: version.versionId,
        evidenceLinks,
        reason: changed ? undefined : "already_projected",
      };
    });
  } catch (error) {
    logger?.error("memory projection failed", {
      projectionName: projection.projectionName,
      evidenceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return createFailedProjectionResult({
      projectionName: projection.projectionName,
      error,
    });
  }
};
