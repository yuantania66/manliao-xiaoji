CREATE TABLE "AccountCancellationFileDeletion" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AccountCancellationFileDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountCancellationFileDeletion_storageKey_key"
ON "AccountCancellationFileDeletion"("storageKey");

CREATE INDEX "AccountCancellationFileDeletion_completedAt_createdAt_idx"
ON "AccountCancellationFileDeletion"("completedAt", "createdAt");
