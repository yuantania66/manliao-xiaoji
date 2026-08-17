/**
 * P2 publication feature flag — DEFAULT OFF.
 * Production V1 writer remains the default path until PM authorizes a controlled trial.
 */

export const P2_PUBLICATION_FLAG_ENV = "P2_PUBLICATION_ENABLED";
export const P2_PUBLICATION_COHORT_ENV = "P2_PUBLICATION_COHORT";
export const P2_PUBLICATION_COHORT_ALLOWLIST_ENV =
  "P2_PUBLICATION_COHORT_ALLOWLIST";

/** True only when env is exactly "1" or "true" (case-insensitive). Default: false. */
export function isP2PublicationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env[P2_PUBLICATION_FLAG_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Controlled cohort switch — still requires P2_PUBLICATION_ENABLED.
 * Default OFF. Does not flip site-wide writer.
 */
export function isP2PublicationCohortEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isP2PublicationEnabled(env)) return false;
  const raw = (env[P2_PUBLICATION_COHORT_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** Allowlist of user ids (comma/space separated). Empty = no cohort members. */
export function getP2PublicationCohortAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env[P2_PUBLICATION_COHORT_ALLOWLIST_ENV] ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isP2PublicationCohortMember(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isP2PublicationCohortEnabled(env)) return false;
  const id = userId?.trim();
  if (!id) return false;
  return getP2PublicationCohortAllowlist(env).includes(id);
}

/**
 * User-visible V2 entry for this process:
 * - preview/opt-in always when flag ON
 * - OR cohort member when cohort enabled + allowlisted
 */
export function canUseP2PublicationPath(args: {
  previewOptIn?: boolean;
  userId?: string | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = args.env ?? process.env;
  if (!isP2PublicationEnabled(env)) return false;
  if (args.previewOptIn) return true;
  return isP2PublicationCohortMember(args.userId, env);
}

export type P2PublicationStoreMode = "memory" | "file" | "prisma";

/**
 * Persistence backend when the flag is on.
 * Default "file" for eval without requiring a migrated DB; "prisma" for real table.
 */
export function getP2PublicationStoreMode(
  env: NodeJS.ProcessEnv = process.env,
): P2PublicationStoreMode {
  const raw = (env.P2_PUBLICATION_STORE ?? "file").trim().toLowerCase();
  if (raw === "memory" || raw === "prisma" || raw === "file") return raw;
  return "file";
}
