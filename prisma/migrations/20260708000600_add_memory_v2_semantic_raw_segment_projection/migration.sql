-- AlterEnum
ALTER TYPE "SemanticMemoryKind" ADD VALUE 'RAW_SEGMENT';

-- AlterTable
ALTER TABLE "SemanticMemory" ADD COLUMN     "projectionEvidenceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SemanticMemory_projectionEvidenceId_key" ON "SemanticMemory"("projectionEvidenceId");

-- CreateIndex
CREATE INDEX "SemanticMemory_userId_projectionEvidenceId_idx" ON "SemanticMemory"("userId", "projectionEvidenceId");

