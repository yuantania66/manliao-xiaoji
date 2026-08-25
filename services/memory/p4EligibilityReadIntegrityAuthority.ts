import { createHash } from "node:crypto";
import { EvidenceStatus, P4MinimumMemoryCategory, P4PromotionEligibility, P4PromotionReason, SemanticMemoryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const P4_ELIGIBILITY_READ_AUTHORITY_VERSION = "p4_eligibility_read_integrity_v1" as const;
export const P4_ELIGIBILITY_READ_GOLD_SHA256 = "a84734324a4ff7f64f79b854a0fabf6f800ee35213ef66e3db7228f7930f76f9";
export const P4_RUNTIME_BOUNDARY = Object.freeze({ productionIntegration: "pending", providerCalls: "local_injected_only", qwenCalls: 0 });
export const p4Sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const exact = (value: object, keys: readonly string[]) => Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const canonical = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;

export type P4AuthorityPrincipal = Readonly<{ userId: string; fixtureTenant: "tenant-a" | "tenant-b" }>;
const principals = new WeakSet<object>();
export const createP4LocalAuthorityPrincipal = async (fixtureTenant: "tenant-a" | "tenant-b") => {
  const user = await prisma.user.findFirstOrThrow({ where: { nickname: `p4-authority:${fixtureTenant}` }, select: { id: true } });
  const principal = Object.freeze({ userId: user.id, fixtureTenant });
  principals.add(principal);
  return principal;
};
export const requireP4Principal = (principal: P4AuthorityPrincipal) => { if (!principals.has(principal)) throw new Error("unauthorized P4 authority principal"); return principal.userId; };

export const loadP4BoundSource = async (userId: string, sourceMemoryVersionId: string) => {
  const source = await prisma.semanticMemoryVersion.findFirst({ where: { id: sourceMemoryVersionId, userId }, include: { semanticMemory: true } });
  if (!source || source.semanticMemory.currentVersionId !== source.id || source.semanticMemory.status !== SemanticMemoryStatus.ACTIVE && source.semanticMemory.status !== SemanticMemoryStatus.USER_CORRECTED) return null;
  const evidence = source.semanticMemory.projectionEvidenceId ? await prisma.evidence.findUnique({ where: { id: source.semanticMemory.projectionEvidenceId }, include: { rawMemory: { include: { events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } } } }) : null;
  if (!evidence || evidence.userId !== userId || evidence.status !== EvidenceStatus.ACTIVE || !evidence.rawMemory || ["TOMBSTONE", "REDACTION"].includes(evidence.rawMemory.events[0]?.eventType ?? "")) return null;
  return { source, evidence, raw: evidence.rawMemory };
};

export type P4EligibilityRequest = Readonly<{ schemaVersion: "p4_eligibility_request_v1"; authorityVersion: typeof P4_ELIGIBILITY_READ_AUTHORITY_VERSION; userId: string; sourceMemoryVersionId: string; sourceVersion: number; sourceText: string; sourceHash: string; evidenceId: string; evidenceText: string; evidenceHash: string; requestHash: string }>;
export type P4EligibilityProvider = (request: P4EligibilityRequest & { signal: AbortSignal }) => Promise<unknown>;
export const createP4EligibilityRequest = (userId: string, bound: NonNullable<Awaited<ReturnType<typeof loadP4BoundSource>>>): P4EligibilityRequest => {
  const base = { schemaVersion: "p4_eligibility_request_v1" as const, authorityVersion: P4_ELIGIBILITY_READ_AUTHORITY_VERSION, userId, sourceMemoryVersionId: bound.source.id, sourceVersion: bound.source.version, sourceText: bound.source.content, sourceHash: p4Sha256(bound.source.content), evidenceId: bound.evidence.id, evidenceText: bound.evidence.evidenceText ?? "", evidenceHash: p4Sha256(bound.evidence.evidenceText ?? "") };
  return Object.freeze({ ...base, requestHash: p4Sha256(JSON.stringify(base)) });
};

const span = (value: unknown, text: string) => {
  if (!record(value) || !exact(value, ["utf16Start", "utf16End", "textHash"]) || !Number.isInteger(value.utf16Start) || !Number.isInteger(value.utf16End)) return false;
  const start = value.utf16Start as number, end = value.utf16End as number;
  return start >= 0 && end > start && end <= text.length && value.textHash === p4Sha256(text.slice(start, end));
};
export type P4EligibilityDecision = Readonly<{ schemaVersion: "p4_eligibility_decision_v1"; authorityVersion: typeof P4_ELIGIBILITY_READ_AUTHORITY_VERSION; requestHash: string; eligibility: P4PromotionEligibility; reason: P4PromotionReason; category: P4MinimumMemoryCategory | null; isSensitive: boolean; retrievalVector: number[]; evidence: Array<{ utf16Start: number; utf16End: number; textHash: string }>; consent: null | { semantic: "explicit_sensitive_memory_opt_in"; sourceMemoryVersionId: string; evidence: { utf16Start: number; utf16End: number; textHash: string } } }>;
export const assertP4EligibilityDecision = (request: P4EligibilityRequest, value: unknown): P4EligibilityDecision => {
  const keys = ["schemaVersion", "authorityVersion", "requestHash", "eligibility", "reason", "category", "isSensitive", "retrievalVector", "evidence", "consent"];
  if (!record(value) || !exact(value, keys) || value.schemaVersion !== "p4_eligibility_decision_v1" || value.authorityVersion !== request.authorityVersion || value.requestHash !== request.requestHash || !Object.values(P4PromotionEligibility).includes(value.eligibility as P4PromotionEligibility) || !Object.values(P4PromotionReason).includes(value.reason as P4PromotionReason) || typeof value.isSensitive !== "boolean" || !Array.isArray(value.retrievalVector) || !value.retrievalVector.length || value.retrievalVector.some((item) => typeof item !== "number" || !Number.isFinite(item)) || !Array.isArray(value.evidence) || !value.evidence.length || value.evidence.some((item) => !span(item, request.sourceText))) throw new Error("invalid eligibility decision");
  const eligible = value.eligibility === P4PromotionEligibility.ELIGIBLE;
  if (eligible !== (value.reason === P4PromotionReason.ALLOWLISTED) || (eligible ? !Object.values(P4MinimumMemoryCategory).includes(value.category as P4MinimumMemoryCategory) : value.category !== null)) throw new Error("invalid eligibility semantics");
  if (value.isSensitive && eligible) {
    if (!record(value.consent) || !exact(value.consent, ["semantic", "sourceMemoryVersionId", "evidence"]) || value.consent.semantic !== "explicit_sensitive_memory_opt_in" || value.consent.sourceMemoryVersionId !== request.sourceMemoryVersionId || !span(value.consent.evidence, request.sourceText)) throw new Error("invalid sensitive consent");
  } else if (value.consent !== null) throw new Error("unexpected consent");
  return value as P4EligibilityDecision;
};

export const p4ArtifactHash = (request: P4EligibilityRequest, decision: P4EligibilityDecision) => p4Sha256(canonical({ authorityVersion: P4_ELIGIBILITY_READ_AUTHORITY_VERSION, request, decision }));
export const issueP4EligibilityArtifact = async ({ principal, sourceMemoryVersionId, descriptorId, provider }: { principal: P4AuthorityPrincipal; sourceMemoryVersionId: string; descriptorId: string; provider: P4EligibilityProvider }) => {
  const userId = requireP4Principal(principal);
  const bound = await loadP4BoundSource(userId, sourceMemoryVersionId); if (!bound) throw new Error("source not visible");
  const request = createP4EligibilityRequest(userId, bound);
  const decision = assertP4EligibilityDecision(request, await provider({ ...request, signal: new AbortController().signal }));
  const consent = decision.consent?.evidence ?? null;
  return prisma.p4PromotionEligibilityArtifact.create({ data: { userId, sourceMemoryVersionId, descriptorId, authorityVersion: P4_ELIGIBILITY_READ_AUTHORITY_VERSION, artifactHash: p4ArtifactHash(request, decision), eligibility: decision.eligibility, reason: decision.reason, category: decision.category, retrievalVector: decision.retrievalVector, isSensitive: decision.isSensitive, consentUtf16Start: consent?.utf16Start, consentUtf16End: consent?.utf16End, consentTextHash: consent?.textHash, decisionPayload: decision } });
};

export const validateP4Artifact = async (userId: string, artifact: { sourceMemoryVersionId: string; authorityVersion: string; artifactHash: string; decisionPayload: unknown }) => {
  if (artifact.authorityVersion !== P4_ELIGIBILITY_READ_AUTHORITY_VERSION) return null;
  const bound = await loadP4BoundSource(userId, artifact.sourceMemoryVersionId); if (!bound) return null;
  const request = createP4EligibilityRequest(userId, bound);
  try { const decision = assertP4EligibilityDecision(request, artifact.decisionPayload); return artifact.artifactHash === p4ArtifactHash(request, decision) ? { bound, request, decision } : null; } catch { return null; }
};
