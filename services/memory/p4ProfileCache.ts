import { createHmac, randomBytes } from "node:crypto";
import { P4MinimumMemoryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateP4Memory } from "./p4MemoryPromotionAuthority";

export const P4_PROFILE_SCHEMA_VERSION = "p4_profile_cache_v1" as const;
export const P4_PROFILE_COMMITMENT_AUTHORITY_VERSION = "p4_profile_cache_commitment_authority_v1" as const;
export const P4_PROFILE_COMMITMENT_GOLD_SHA256 = "c5ce3b2740a39871f43985f006cee72c946b172e7b4fc5e64558f819755ccdaa";
export const P4_PROFILE_PAYLOAD_KEYS = ["schemaVersion", "commitmentAuthorityVersion", "profileVersion", "tenantId", "sourceIds", "generatedAt", "items", "sensitiveOptInRefs", "commitmentHash"] as const;
const P4_PROFILE_ITEM_KEYS = ["memoryId", "sourceMemoryVersionId", "eligibilityArtifactId", "category", "content", "isSensitive", "itemCommitment"] as const;
const keys = (value: object, expected: readonly string[]) => Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
const commitmentKey = randomBytes(32);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
const commit = (value: unknown) => `hmac-sha256:${createHmac("sha256", commitmentKey).update(canonical(value)).digest("hex")}`;
const itemWithoutCommitment = (memory: { id: string; sourceMemoryVersionId: string; eligibilityArtifactId: string; category: unknown; content: string; isSensitive: boolean }) => ({ memoryId: memory.id, sourceMemoryVersionId: memory.sourceMemoryVersionId, eligibilityArtifactId: memory.eligibilityArtifactId, category: memory.category, content: memory.content, isSensitive: memory.isSensitive });

export const projectP4ProfileCache = async ({ userId, generatedAt = new Date() }: { userId: string; generatedAt?: Date }) => {
  const previous = await prisma.p4ProfileCache.findUnique({ where: { userId } });
  const candidates = await prisma.p4MinimumMemory.findMany({ where: { userId, status: P4MinimumMemoryStatus.ACTIVE }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const memories = [] as typeof candidates;
  for (const candidate of candidates) if (await validateP4Memory(userId, candidate, generatedAt)) memories.push(candidate);
  const profileVersion = (previous?.version ?? 0) + 1;
  const sourceIds = memories.map((memory) => memory.sourceMemoryVersionId).sort();
  const items = memories.map((memory) => { const item = itemWithoutCommitment(memory); return { ...item, itemCommitment: commit(item) }; });
  const unsigned = { schemaVersion: P4_PROFILE_SCHEMA_VERSION, commitmentAuthorityVersion: P4_PROFILE_COMMITMENT_AUTHORITY_VERSION, profileVersion, tenantId: userId, sourceIds, generatedAt: generatedAt.toISOString(), items, sensitiveOptInRefs: memories.filter((memory) => memory.isSensitive).map((memory) => memory.eligibilityArtifactId) };
  const payload = { ...unsigned, commitmentHash: commit(unsigned) };
  return prisma.p4ProfileCache.upsert({ where: { userId }, create: { userId, version: profileVersion, sourceMemoryVersionIds: sourceIds, generatedAt, payload: payload as Prisma.InputJsonValue }, update: { version: profileVersion, sourceMemoryVersionIds: sourceIds, generatedAt, payload: payload as Prisma.InputJsonValue, invalidatedAt: null } });
};

export const readUsableP4ProfileCache = async ({ userId, now = new Date(), maxAgeMs = 60_000 }: { userId: string; now?: Date; maxAgeMs?: number }) => {
  const cache = await prisma.p4ProfileCache.findUnique({ where: { userId } });
  if (!cache || cache.invalidatedAt || now.getTime() - cache.generatedAt.getTime() > maxAgeMs || !Array.isArray(cache.sourceMemoryVersionIds)) return null;
  const payload = cache.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !keys(payload, P4_PROFILE_PAYLOAD_KEYS)) return null;
  const data = payload as Record<string, unknown>;
  if (data.schemaVersion !== P4_PROFILE_SCHEMA_VERSION || data.commitmentAuthorityVersion !== P4_PROFILE_COMMITMENT_AUTHORITY_VERSION || data.profileVersion !== cache.version || data.tenantId !== userId || data.generatedAt !== cache.generatedAt.toISOString() || JSON.stringify(data.sourceIds) !== JSON.stringify(cache.sourceMemoryVersionIds) || !Array.isArray(data.items) || !Array.isArray(data.sensitiveOptInRefs) || typeof data.commitmentHash !== "string") return null;
  const { commitmentHash, ...unsigned } = data;
  const commitmentInvalid = commitmentHash !== commit(unsigned) || data.items.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !keys(item, P4_PROFILE_ITEM_KEYS)) return true;
    const { itemCommitment, ...body } = item as Record<string, unknown>;
    return itemCommitment !== commit(body);
  });
  if (commitmentInvalid) return null;
  const memories = await prisma.p4MinimumMemory.findMany({ where: { userId, status: P4MinimumMemoryStatus.ACTIVE }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const valid = [] as typeof memories; for (const memory of memories) if (await validateP4Memory(userId, memory, now)) valid.push(memory);
  const expectedItems = valid.map((memory) => { const item = itemWithoutCommitment(memory); return { ...item, itemCommitment: commit(item) }; });
  const expectedSources = valid.map((memory) => memory.sourceMemoryVersionId).sort();
  const expectedConsent = valid.filter((memory) => memory.isSensitive).map((memory) => memory.eligibilityArtifactId);
  const itemMatch = canonical(data.items) === canonical(expectedItems), sourceMatch = JSON.stringify(cache.sourceMemoryVersionIds) === JSON.stringify(expectedSources), consentMatch = JSON.stringify(data.sensitiveOptInRefs) === JSON.stringify(expectedConsent);
  return itemMatch && sourceMatch && consentMatch ? cache : null;
};
