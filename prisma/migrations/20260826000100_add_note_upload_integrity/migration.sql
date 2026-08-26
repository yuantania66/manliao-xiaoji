ALTER TABLE "Note" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "Note" ADD COLUMN "requestHash" TEXT;

UPDATE "Note" SET
  "clientRequestId" = 'legacy:' || "id",
  "requestHash" = 'legacy:' || "id";

ALTER TABLE "Note" ALTER COLUMN "clientRequestId" SET NOT NULL;
ALTER TABLE "Note" ALTER COLUMN "requestHash" SET NOT NULL;
CREATE UNIQUE INDEX "Note_userId_clientRequestId_key" ON "Note"("userId", "clientRequestId");

CREATE TABLE "NoteUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "noteId" TEXT,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoteUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NoteUpload_storageKey_key" ON "NoteUpload"("storageKey");
CREATE INDEX "NoteUpload_userId_createdAt_idx" ON "NoteUpload"("userId", "createdAt");
CREATE INDEX "NoteUpload_noteId_idx" ON "NoteUpload"("noteId");
ALTER TABLE "NoteUpload" ADD CONSTRAINT "NoteUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteUpload" ADD CONSTRAINT "NoteUpload_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
