CREATE TYPE "P4MinimumMemoryCategory" AS ENUM (
  'STABLE_PREFERENCE', 'PERSONAL_FACT', 'IMPORTANT_RELATIONSHIP',
  'COMMITMENT_PLAN_GOAL', 'SIGNIFICANT_EVENT', 'UNRESOLVED_TOPIC',
  'EXPLICIT_REMEMBER_REQUEST'
);

CREATE TYPE "P4MinimumMemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TYPE "P4PromotionEligibility" AS ENUM ('ELIGIBLE', 'INELIGIBLE');
CREATE TYPE "P4PromotionReason" AS ENUM (
  'ALLOWLISTED', 'NOT_ALLOWLISTED', 'HYPOTHESIS', 'SAFETY_DATA', 'SECRET',
  'SENSITIVE_WITHOUT_OPT_IN'
);

CREATE UNIQUE INDEX "SemanticMemoryVersion_id_userId_key"
  ON "SemanticMemoryVersion"("id", "userId");

CREATE TABLE "P4MinimumMemory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "category" "P4MinimumMemoryCategory" NOT NULL,
  "content" TEXT NOT NULL,
  "sourceMemoryVersionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  "retrievalVector" JSONB NOT NULL,
  "eligibilityArtifactId" TEXT NOT NULL,
  "sensitiveExpiresAt" TIMESTAMP(3),
  "status" "P4MinimumMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P4MinimumMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "P4MinimumMemory_userId_subjectKey_version_key"
  ON "P4MinimumMemory"("userId", "subjectKey", "version");
CREATE UNIQUE INDEX "P4MinimumMemory_userId_sourceMemoryVersionId_key"
  ON "P4MinimumMemory"("userId", "sourceMemoryVersionId");
CREATE UNIQUE INDEX "P4MinimumMemory_eligibilityArtifactId_key"
  ON "P4MinimumMemory"("eligibilityArtifactId");
CREATE UNIQUE INDEX "P4MinimumMemory_eligibilityArtifactId_userId_key"
  ON "P4MinimumMemory"("eligibilityArtifactId", "userId");
CREATE INDEX "P4MinimumMemory_userId_status_createdAt_idx"
  ON "P4MinimumMemory"("userId", "status", "createdAt");
ALTER TABLE "P4MinimumMemory" ADD CONSTRAINT "P4MinimumMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "P4MinimumMemory" ADD CONSTRAINT "P4MinimumMemory_sourceMemoryVersionId_userId_fkey"
  FOREIGN KEY ("sourceMemoryVersionId", "userId") REFERENCES "SemanticMemoryVersion"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "P4PromotionEligibilityArtifact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceMemoryVersionId" TEXT NOT NULL,
  "descriptorId" TEXT NOT NULL,
  "authorityVersion" TEXT NOT NULL,
  "artifactHash" TEXT NOT NULL,
  "eligibility" "P4PromotionEligibility" NOT NULL,
  "reason" "P4PromotionReason" NOT NULL,
  "category" "P4MinimumMemoryCategory",
  "retrievalVector" JSONB NOT NULL,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  "consentUtf16Start" INTEGER,
  "consentUtf16End" INTEGER,
  "consentTextHash" TEXT,
  "decisionPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P4PromotionEligibilityArtifact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "P4PromotionEligibilityArtifact_sourceMemoryVersionId_key"
  ON "P4PromotionEligibilityArtifact"("sourceMemoryVersionId");
CREATE UNIQUE INDEX "P4PromotionEligibilityArtifact_artifactHash_key"
  ON "P4PromotionEligibilityArtifact"("artifactHash");
CREATE UNIQUE INDEX "P4PromotionEligibilityArtifact_id_userId_key"
  ON "P4PromotionEligibilityArtifact"("id", "userId");
CREATE INDEX "P4PromotionEligibilityArtifact_userId_eligibility_createdAt_idx"
  ON "P4PromotionEligibilityArtifact"("userId", "eligibility", "createdAt");
ALTER TABLE "P4PromotionEligibilityArtifact" ADD CONSTRAINT "P4PromotionEligibilityArtifact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "P4PromotionEligibilityArtifact" ADD CONSTRAINT "P4PromotionEligibilityArtifact_sourceMemoryVersionId_userId_fkey"
  FOREIGN KEY ("sourceMemoryVersionId", "userId") REFERENCES "SemanticMemoryVersion"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "P4MinimumMemory" ADD CONSTRAINT "P4MinimumMemory_eligibilityArtifactId_userId_fkey"
  FOREIGN KEY ("eligibilityArtifactId", "userId") REFERENCES "P4PromotionEligibilityArtifact"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "P4ProfileCache" (
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceMemoryVersionIds" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "invalidatedAt" TIMESTAMP(3),
  CONSTRAINT "P4ProfileCache_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "P4ProfileCache" ADD CONSTRAINT "P4ProfileCache_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
