CREATE TYPE "P6CacheKind" AS ENUM ('RELATIONSHIP', 'GROWTH');
CREATE TYPE "P6FixtureClaimKind" AS ENUM ('FACT', 'HYPOTHESIS');
CREATE TYPE "P6FixtureDataClass" AS ENUM ('ORDINARY', 'SAFETY', 'SECRET');
CREATE TYPE "P6RecomputeStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "P6AcceptedMemorySnapshot" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "descriptorId" TEXT NOT NULL,
  "sourceMemoryVersionId" TEXT NOT NULL, "sourceVersion" INTEGER NOT NULL,
  "authorityVersion" TEXT NOT NULL, "artifactHash" TEXT NOT NULL,
  "projection" "P6CacheKind" NOT NULL, "claimKind" "P6FixtureClaimKind" NOT NULL,
  "dataClass" "P6FixtureDataClass" NOT NULL, "content" TEXT NOT NULL,
  "accepted" BOOLEAN NOT NULL, "isCurrent" BOOLEAN NOT NULL,
  "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P6AcceptedMemorySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "P6AcceptedMemorySnapshot_artifactHash_key" ON "P6AcceptedMemorySnapshot"("artifactHash");
CREATE UNIQUE INDEX "P6AcceptedMemorySnapshot_userId_sourceMemoryVersionId_sourceVersion_key" ON "P6AcceptedMemorySnapshot"("userId", "sourceMemoryVersionId", "sourceVersion");
CREATE INDEX "P6AcceptedMemorySnapshot_userId_accepted_isCurrent_deletedAt_idx" ON "P6AcceptedMemorySnapshot"("userId", "accepted", "isCurrent", "deletedAt");
ALTER TABLE "P6AcceptedMemorySnapshot" ADD CONSTRAINT "P6AcceptedMemorySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "P6RelationshipGrowthCache" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" "P6CacheKind" NOT NULL,
  "version" INTEGER NOT NULL, "sourceMemoryVersionIds" JSONB NOT NULL,
  "cycle" TEXT NOT NULL, "payload" JSONB NOT NULL, "commitmentHash" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL, "staleAt" TIMESTAMP(3) NOT NULL,
  "invalidatedAt" TIMESTAMP(3), CONSTRAINT "P6RelationshipGrowthCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "P6RelationshipGrowthCache_userId_kind_key" ON "P6RelationshipGrowthCache"("userId", "kind");
CREATE INDEX "P6RelationshipGrowthCache_userId_invalidatedAt_staleAt_idx" ON "P6RelationshipGrowthCache"("userId", "invalidatedAt", "staleAt");
ALTER TABLE "P6RelationshipGrowthCache" ADD CONSTRAINT "P6RelationshipGrowthCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "P6TargetedRecompute" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" "P6CacheKind" NOT NULL,
  "sourceMemoryVersionId" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "status" "P6RecomputeStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "P6TargetedRecompute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "P6TargetedRecompute_userId_kind_sourceMemoryVersionId_status_key" ON "P6TargetedRecompute"("userId", "kind", "sourceMemoryVersionId", "status");
CREATE INDEX "P6TargetedRecompute_userId_status_createdAt_idx" ON "P6TargetedRecompute"("userId", "status", "createdAt");
ALTER TABLE "P6TargetedRecompute" ADD CONSTRAINT "P6TargetedRecompute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
