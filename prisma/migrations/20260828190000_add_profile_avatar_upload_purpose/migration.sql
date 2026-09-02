CREATE TYPE "NoteUploadPurpose" AS ENUM ('NOTE_MEDIA', 'PROFILE_AVATAR');

ALTER TABLE "NoteUpload"
ADD COLUMN "purpose" "NoteUploadPurpose" NOT NULL DEFAULT 'NOTE_MEDIA',
ADD COLUMN "boundAt" TIMESTAMP(3);

CREATE INDEX "NoteUpload_userId_purpose_boundAt_idx"
ON "NoteUpload"("userId", "purpose", "boundAt");
