import type { EnvBag } from "./p2-publication-flag";
import { isP2PublicationEnabled } from "./p2-publication-flag";

export const P2_PUBLICATION_FIXTURE_ENV = "P2_PUBLICATION_FIXTURE_ENABLED";
export const P2_PUBLICATION_FIXTURE_LABEL =
  "模拟评测流（非真实 Qwen）";

const enabled = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

/**
 * Evaluation fixture is deliberately unavailable in production processes.
 * Both the existing P2 preview flag and the dedicated fixture flag are required.
 */
export function isP2PublicationFixtureEnabled(
  env: EnvBag = process.env,
): boolean {
  if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production") return false;
  return (
    isP2PublicationEnabled(env) &&
    enabled(env[P2_PUBLICATION_FIXTURE_ENV])
  );
}

export function fixtureTransitionDelayMs(
  env: EnvBag = process.env,
): number {
  const value = Number(env.P2_PUBLICATION_FIXTURE_DELAY_MS ?? "600");
  if (!Number.isFinite(value)) return 600;
  return Math.max(0, Math.min(Math.trunc(value), 3_000));
}
