-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('RAW_SEGMENTATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceTargetType" ADD VALUE 'RAW_MEMORY';
ALTER TYPE "EvidenceTargetType" ADD VALUE 'RAW_SEGMENTATION';

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "evidenceType" "EvidenceType" NOT NULL DEFAULT 'RAW_SEGMENTATION';

-- CreateIndex
CREATE INDEX "Evidence_userId_evidenceType_idx" ON "Evidence"("userId", "evidenceType");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_userId_rawMemoryId_evidenceType_key" ON "Evidence"("userId", "rawMemoryId", "evidenceType");

