-- Additive only: old rows remain SQL NULL; no backfill or quota reset.
ALTER TABLE "Note" ADD COLUMN "wallpaperState" JSONB;
