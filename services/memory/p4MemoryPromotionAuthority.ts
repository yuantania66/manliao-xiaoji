import { P4MinimumMemoryStatus, P4PromotionEligibility, P4PromotionReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { P4_ELIGIBILITY_READ_AUTHORITY_VERSION, loadP4BoundSource, p4Sha256, validateP4Artifact } from "./p4EligibilityReadIntegrityAuthority";

export { p4Sha256 };
export const P4_MEMORY_PROMOTION_AUTHORITY_VERSION = P4_ELIGIBILITY_READ_AUTHORITY_VERSION;

export const validateP4Memory = async (userId: string, memory: { sourceMemoryVersionId: string; eligibilityArtifactId: string; content: string; category: unknown; isSensitive: boolean; retrievalVector: unknown; sensitiveExpiresAt: Date | null }, now = new Date()) => {
  const artifact = await prisma.p4PromotionEligibilityArtifact.findFirst({ where: { id: memory.eligibilityArtifactId, userId } });
  if (!artifact || artifact.sourceMemoryVersionId !== memory.sourceMemoryVersionId) return null;
  const validated = await validateP4Artifact(userId, artifact); if (!validated) return null;
  const { decision, bound } = validated;
  if (decision.eligibility !== P4PromotionEligibility.ELIGIBLE || decision.reason !== P4PromotionReason.ALLOWLISTED || decision.category === null || memory.content !== bound.source.content || memory.category !== decision.category || memory.isSensitive !== decision.isSensitive || JSON.stringify(memory.retrievalVector) !== JSON.stringify(decision.retrievalVector)) return null;
  if (decision.isSensitive && (!memory.sensitiveExpiresAt || memory.sensitiveExpiresAt <= now)) return null;
  return validated;
};

export const promoteP4MinimumMemory = async ({ userId, eligibilityArtifactId, subjectKey, now = new Date() }: { userId: string; eligibilityArtifactId: string; subjectKey: string; now?: Date }) => {
  if (!subjectKey) return null;
  const artifact = await prisma.p4PromotionEligibilityArtifact.findFirst({ where: { id: eligibilityArtifactId, userId } });
  if (!artifact) return null;
  const validated = await validateP4Artifact(userId, artifact); if (!validated) return null;
  const { decision, bound } = validated;
  if (decision.eligibility !== P4PromotionEligibility.ELIGIBLE || decision.reason !== P4PromotionReason.ALLOWLISTED || !decision.category) return null;
  const category = decision.category;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.p4MinimumMemory.findUnique({ where: { eligibilityArtifactId } });
    if (existing) return await validateP4Memory(userId, existing, now) ? existing : null;
    const prior = await tx.p4MinimumMemory.findFirst({ where: { userId, subjectKey, status: P4MinimumMemoryStatus.ACTIVE }, orderBy: { version: "desc" } });
    if (prior) await tx.p4MinimumMemory.update({ where: { id: prior.id }, data: { status: P4MinimumMemoryStatus.SUPERSEDED, supersededAt: now } });
    await tx.p4ProfileCache.updateMany({ where: { userId, invalidatedAt: null }, data: { invalidatedAt: now } });
    return tx.p4MinimumMemory.create({ data: { userId, subjectKey, category, content: bound.source.content, sourceMemoryVersionId: artifact.sourceMemoryVersionId, version: (prior?.version ?? 0) + 1, isSensitive: decision.isSensitive, retrievalVector: decision.retrievalVector as Prisma.InputJsonValue, eligibilityArtifactId: artifact.id, sensitiveExpiresAt: decision.isSensitive ? new Date(now.getTime() + 30 * 86_400_000) : null } });
  });
};

export const isP4SourceVisible = loadP4BoundSource;
