ALTER TABLE "User"
ADD COLUMN "isProvisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "profileCompletedAt" TIMESTAMP(3);

UPDATE "User"
SET "profileCompletedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE NULLIF(BTRIM("nickname"), '') IS NOT NULL
  AND NULLIF(BTRIM("avatarUrl"), '') IS NOT NULL;
