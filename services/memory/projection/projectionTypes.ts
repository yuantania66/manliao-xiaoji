import {
  EvidenceTargetType,
  EvidenceType,
  Prisma,
} from "@prisma/client";

import { ProjectionContext } from "./projectionContext";

export type ProjectionProjectOutput<TProjection = unknown> = {
  projectionId: string;
  targetType: EvidenceTargetType;
  projection: TProjection;
  created: boolean;
};

export type ProjectionVersionOutput<TVersion = unknown> = {
  versionId: string;
  version: number;
  targetType: EvidenceTargetType;
  versionRecord: TVersion;
  created: boolean;
};

export type ProjectionCurrentVersionOutput<TProjection = unknown> = {
  projection: TProjection;
  updated: boolean;
};

export interface MemoryProjection<TProjection = unknown, TVersion = unknown> {
  projectionName: string;
  supportedEvidenceTypes(): EvidenceType[];
  shouldProject(context: ProjectionContext<TProjection, TVersion>): Promise<boolean> | boolean;
  project(
    context: ProjectionContext<TProjection, TVersion>
  ): Promise<ProjectionProjectOutput<TProjection>>;
  createVersion(
    context: ProjectionContext<TProjection, TVersion>,
    projection: ProjectionProjectOutput<TProjection>
  ): Promise<ProjectionVersionOutput<TVersion>>;
  updateCurrentVersion(
    context: ProjectionContext<TProjection, TVersion>,
    projection: ProjectionProjectOutput<TProjection>,
    version: ProjectionVersionOutput<TVersion>
  ): Promise<ProjectionCurrentVersionOutput<TProjection>>;
}

export type ProjectionLogger = {
  info(message: string, metadata?: Prisma.InputJsonValue): void;
  warn(message: string, metadata?: Prisma.InputJsonValue): void;
  error(message: string, metadata?: Prisma.InputJsonValue): void;
};
