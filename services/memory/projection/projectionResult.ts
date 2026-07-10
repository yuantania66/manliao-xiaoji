import { EvidenceTargetType } from "@prisma/client";

export type ProjectionResultStatus = "created" | "updated" | "skipped" | "failed";

export type ProjectionEvidenceLinkResult = {
  id: string;
  targetType: EvidenceTargetType;
  targetId: string;
  created: boolean;
};

export type ProjectionResult = {
  projectionName: string;
  status: ProjectionResultStatus;
  projectionId?: string;
  versionId?: string;
  evidenceLinks: ProjectionEvidenceLinkResult[];
  reason?: string;
  error?: string;
};

export const createSkippedProjectionResult = ({
  projectionName,
  reason,
}: {
  projectionName: string;
  reason: string;
}): ProjectionResult => ({
  projectionName,
  status: "skipped",
  evidenceLinks: [],
  reason,
});

export const createFailedProjectionResult = ({
  projectionName,
  error,
}: {
  projectionName: string;
  error: unknown;
}): ProjectionResult => ({
  projectionName,
  status: "failed",
  evidenceLinks: [],
  error: error instanceof Error ? error.message : String(error),
});
