import { signServerValue, verifyServerValueSignature } from "@/lib/auth";
import { AppError } from "@/lib/errors";

const CONSENT_VERSION = "insights_observation_consent_v1";
const CONSENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type ConsentClaims = {
  version: typeof CONSENT_VERSION;
  userId: string;
  issuedAt: string;
  expiresAt: string;
};

const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const forbidden = () => new AppError("FORBIDDEN", "请先授权慢聊小记观察", 403);

const parseClaims = (encoded: string): ConsentClaims => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw forbidden();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw forbidden();
  const claims = value as Record<string, unknown>;
  if (
    !exactKeys(claims, ["version", "userId", "issuedAt", "expiresAt"]) ||
    claims.version !== CONSENT_VERSION ||
    typeof claims.userId !== "string" ||
    !claims.userId ||
    typeof claims.issuedAt !== "string" ||
    typeof claims.expiresAt !== "string"
  ) {
    throw forbidden();
  }
  return claims as ConsentClaims;
};

export const createInsightsConsent = ({ userId, now = new Date() }: { userId: string; now?: Date }) => {
  if (!userId) throw forbidden();
  const claims: ConsentClaims = {
    version: CONSENT_VERSION,
    userId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONSENT_TTL_MS).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return {
    consentToken: `${encoded}.${signServerValue(encoded)}`,
    expiresAt: claims.expiresAt,
  };
};

export const assertInsightsConsent = ({ token, userId, now = new Date() }: { token: string | null; userId: string; now?: Date }) => {
  const [encoded, signature, ...extra] = (token ?? "").split(".");
  if (!encoded || !signature || extra.length > 0 || !verifyServerValueSignature(encoded, signature)) throw forbidden();
  const claims = parseClaims(encoded);
  const issuedAt = new Date(claims.issuedAt).getTime();
  const expiresAt = new Date(claims.expiresAt).getTime();
  if (
    claims.userId !== userId ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now.getTime() ||
    expiresAt !== issuedAt + CONSENT_TTL_MS ||
    expiresAt <= now.getTime()
  ) {
    throw forbidden();
  }
  return claims;
};
