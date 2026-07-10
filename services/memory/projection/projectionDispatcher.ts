import { Evidence } from "@prisma/client";

import { ProjectionResult } from "./projectionResult";
import { createDefaultProjectionRegistry, ProjectionRegistry } from "./projectionRegistry";
import { runProjection } from "./projectionRunner";
import { ProjectionLogger } from "./projectionTypes";

export const dispatchEvidenceToProjections = async ({
  evidence,
  registry = createDefaultProjectionRegistry(),
  logger,
}: {
  evidence: Pick<Evidence, "id" | "evidenceType">;
  registry?: ProjectionRegistry;
  logger?: ProjectionLogger;
}): Promise<ProjectionResult[]> => {
  const results: ProjectionResult[] = [];

  for (const projection of registry.list()) {
    if (!projection.supportedEvidenceTypes().includes(evidence.evidenceType)) {
      results.push({
        projectionName: projection.projectionName,
        status: "skipped",
        evidenceLinks: [],
        reason: "unsupported_evidence_type",
      });
      continue;
    }

    results.push(
      await runProjection({
        evidenceId: evidence.id,
        projection,
        logger,
      })
    );
  }

  return results;
};
