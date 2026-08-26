import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  P6CacheKind, P6FixtureClaimKind, P6FixtureDataClass, P6RecomputeStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const P6_SNAPSHOT_AUTHORITY_VERSION = "p6_local_fixture_snapshot_v1" as const;
export const P6_CACHE_SCHEMA_VERSION = "p6_relationship_growth_cache_v1" as const;
export const P6_PRINCIPAL_TIME_AUTHORITY_VERSION = "p6_principal_cache_time_integrity_v1" as const;
export const P6_PRINCIPAL_TIME_GOLD_SHA256 = "22926f8792dd8d59a8eb6d7d8ab0128789aa53a8603fca2a0338da4f6c839169";
export const P6_PRINCIPAL_TIME_REPAIR_GOLD_SHA256 = "dfc34c18069a749f6591c64342f6b678948c68d28e70628314c835f690194236";
export const P6_PREAUDIT_SHA256 = "9b3a15b4de5c5f59a3a9f9ca99a45f622acff3ea4c2386d56ee116a100fcf75c";
export const P6_RUNTIME_BOUNDARY = Object.freeze({
  productionIntegration: "pending",
  p4RuntimeIntegration: "pending",
  p5RuntimeIntegration: "pending",
  dataSource: "local_frozen_fixture_only",
  providerCalls: 0,
});

const fixtures = {
  relationship_fact_v1: { sourceMemoryVersionId: "rel-source", sourceVersion: 1, projection: P6CacheKind.RELATIONSHIP, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.ORDINARY, content: "用户明确说明一位重要人物会提供支持。" },
  relationship_fact_v2: { sourceMemoryVersionId: "rel-source", sourceVersion: 2, projection: P6CacheKind.RELATIONSHIP, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.ORDINARY, content: "用户明确说明这位重要人物最近仍会提供支持。" },
  growth_fact: { sourceMemoryVersionId: "growth-source", sourceVersion: 1, projection: P6CacheKind.GROWTH, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.ORDINARY, content: "用户明确说明本月持续完成既定练习。" },
  relationship_hypothesis: { sourceMemoryVersionId: "rel-hyp", sourceVersion: 1, projection: P6CacheKind.RELATIONSHIP, claimKind: P6FixtureClaimKind.HYPOTHESIS, dataClass: P6FixtureDataClass.ORDINARY, content: "模型假设这段关系可能带来压力。" },
  causality_hypothesis: { sourceMemoryVersionId: "cause-hyp", sourceVersion: 1, projection: P6CacheKind.GROWTH, claimKind: P6FixtureClaimKind.HYPOTHESIS, dataClass: P6FixtureDataClass.ORDINARY, content: "尚未确认的变化原因。" },
  safety: { sourceMemoryVersionId: "safety", sourceVersion: 1, projection: P6CacheKind.GROWTH, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.SAFETY, content: "隔离 Safety fixture" },
  secret: { sourceMemoryVersionId: "secret", sourceVersion: 1, projection: P6CacheKind.RELATIONSHIP, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.SECRET, content: "隔离 secret fixture" },
  credential: { sourceMemoryVersionId: "credential", sourceVersion: 1, projection: P6CacheKind.GROWTH, claimKind: P6FixtureClaimKind.FACT, dataClass: P6FixtureDataClass.SECRET, content: "隔离 credential fixture" },
} as const;

type FixtureId = keyof typeof fixtures;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const snapshotKeys = ["accepted", "artifactHash", "authorityVersion", "claimKind", "content", "dataClass", "descriptorId", "isCurrent", "projection", "sourceMemoryVersionId", "sourceVersion", "userId"] as const;

export type P6AuthContext = Readonly<{ sessionId: string; tokenHash: string }>;
const trustedNow = () => new Date(Date.now());
const cacheCommitmentKey = randomBytes(32);
const derivePrincipal = async (auth: P6AuthContext) => {
  const session = await prisma.session.findFirst({ where: { id: auth.sessionId, tokenHash: auth.tokenHash, expiresAt: { gt: trustedNow() } }, select: { userId: true } });
  if (!session) throw new Error("unauthorized auth context");
  return Object.freeze({ userId: session.userId });
};

const buildEnvelope = ({ userId, fixtureId }: { userId: string; fixtureId: FixtureId }) => {
  const fixture = fixtures[fixtureId];
  const bound = { userId, descriptorId: fixtureId, sourceMemoryVersionId: fixture.sourceMemoryVersionId, sourceVersion: fixture.sourceVersion, authorityVersion: P6_SNAPSHOT_AUTHORITY_VERSION, projection: fixture.projection, claimKind: fixture.claimKind, dataClass: fixture.dataClass, content: fixture.content, accepted: true, isCurrent: true };
  return { ...bound, artifactHash: sha(JSON.stringify(bound)) };
};

export const assertP6SnapshotEnvelope = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid snapshot");
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...snapshotKeys].sort())) throw new Error("snapshot schema mismatch");
  if (typeof record.descriptorId !== "string" || !(record.descriptorId in fixtures)) throw new Error("unknown fixture");
  if (typeof record.userId !== "string" || typeof record.sourceMemoryVersionId !== "string" || !record.userId || !record.sourceMemoryVersionId || !Number.isInteger(record.sourceVersion) || Number(record.sourceVersion) < 1) throw new Error("invalid source binding");
  const expected = buildEnvelope({ userId: record.userId, fixtureId: record.descriptorId as FixtureId });
  if (JSON.stringify(record) !== JSON.stringify(expected)) throw new Error("tampered snapshot");
  return expected;
};

export const registerP6FrozenFixture = async (auth: P6AuthContext, fixtureId: FixtureId) => {
  const { userId } = await derivePrincipal(auth);
  const envelope = assertP6SnapshotEnvelope(buildEnvelope({ userId, fixtureId }));
  return prisma.$transaction(async (tx) => {
    await tx.p6AcceptedMemorySnapshot.updateMany({ where: { userId, sourceMemoryVersionId: envelope.sourceMemoryVersionId, isCurrent: true }, data: { isCurrent: false } });
    return tx.p6AcceptedMemorySnapshot.create({ data: envelope });
  });
};

const verifySnapshot = (snapshot: { userId: string; descriptorId: string; sourceMemoryVersionId: string; sourceVersion: number; authorityVersion: string; projection: P6CacheKind; claimKind: P6FixtureClaimKind; dataClass: P6FixtureDataClass; content: string; accepted: boolean; isCurrent: boolean; artifactHash: string }) => {
  const envelope = { userId: snapshot.userId, descriptorId: snapshot.descriptorId, sourceMemoryVersionId: snapshot.sourceMemoryVersionId, sourceVersion: snapshot.sourceVersion, authorityVersion: snapshot.authorityVersion, projection: snapshot.projection, claimKind: snapshot.claimKind, dataClass: snapshot.dataClass, content: snapshot.content, accepted: snapshot.accepted, isCurrent: snapshot.isCurrent, artifactHash: snapshot.artifactHash };
  try { assertP6SnapshotEnvelope(envelope); return true; } catch { return false; }
};

const validCycle = (kind: P6CacheKind, cycle: string) => kind === P6CacheKind.RELATIONSHIP ? /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/u.test(cycle) : /^\d{4}-\d{2}$/u.test(cycle);
export const p6CurrentCycle = (kind: P6CacheKind, now: Date) => kind === P6CacheKind.RELATIONSHIP
  ? `${now.toISOString().slice(0, 13)}:00Z`
  : now.toISOString().slice(0, 7);

const cacheTtlMs = (kind: P6CacheKind) => kind === P6CacheKind.RELATIONSHIP ? 3_600_000 : 86_400_000;
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
const cacheCommitment = (value: unknown) => `hmac-sha256:${createHmac("sha256", cacheCommitmentKey).update(canonicalJson(value)).digest("hex")}`;

export const rebuildP6Cache = async ({ auth, kind, cycle, now = new Date() }: { auth: P6AuthContext; kind: P6CacheKind; cycle: string; now?: Date }) => {
  const { userId } = await derivePrincipal(auth);
  if (!validCycle(kind, cycle) || cycle !== p6CurrentCycle(kind, now)) throw new Error("invalid cycle");
  const rows = await prisma.p6AcceptedMemorySnapshot.findMany({ where: { userId, projection: kind, accepted: true, isCurrent: true, deletedAt: null } });
  const sources = rows.filter((row) => row.dataClass === P6FixtureDataClass.ORDINARY && verifySnapshot(row)).sort((left, right) => left.sourceMemoryVersionId.localeCompare(right.sourceMemoryVersionId) || left.sourceVersion - right.sourceVersion);
  const prior = await prisma.p6RelationshipGrowthCache.findUnique({ where: { userId_kind: { userId, kind } } });
  const version = (prior?.version ?? 0) + 1;
  const sourceMemoryVersionIds = sources.map((source) => source.sourceMemoryVersionId).sort();
  const ttlMs = cacheTtlMs(kind);
  const staleAt = new Date(now.getTime() + ttlMs);
  const items = sources.map((source) => ({ sourceMemoryVersionId: source.sourceMemoryVersionId, sourceVersion: source.sourceVersion, claimKind: source.claimKind, text: source.content, snapshotCommitment: source.artifactHash }));
  const payload = { schemaVersion: P6_CACHE_SCHEMA_VERSION, authority: "derived_optional", authorityVersion: P6_PRINCIPAL_TIME_AUTHORITY_VERSION, kind, version, sourceMemoryVersionIds, cycle, generatedAt: now.toISOString(), staleAt: staleAt.toISOString(), ttlMs, items };
  const commitmentHash = cacheCommitment(payload);
  return prisma.p6RelationshipGrowthCache.upsert({ where: { userId_kind: { userId, kind } }, create: { userId, kind, version, sourceMemoryVersionIds, cycle, payload, commitmentHash, generatedAt: now, staleAt }, update: { version, sourceMemoryVersionIds, cycle, payload, commitmentHash, generatedAt: now, staleAt, invalidatedAt: null } });
};

const empty = { status: "empty" as const, items: [] as never[] };
export const readP6Cache = async ({ auth, kind, now = new Date(), timeoutMs = 80 }: { auth: P6AuthContext; kind: P6CacheKind; now?: Date; timeoutMs?: number }) => {
  const { userId } = await derivePrincipal(auth);
  if (timeoutMs <= 0) return empty;
  const cache = await Promise.race([prisma.p6RelationshipGrowthCache.findUnique({ where: { userId_kind: { userId, kind } } }), new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]).catch(() => null);
  const ttlMs = cacheTtlMs(kind);
  if (!cache || cache.invalidatedAt || cache.generatedAt > now || cache.staleAt <= now || cache.staleAt.getTime() !== cache.generatedAt.getTime() + ttlMs || cache.cycle !== p6CurrentCycle(kind, now) || !Array.isArray(cache.sourceMemoryVersionIds)) return empty;
  const payload = cache.payload as Record<string, unknown>;
  const payloadKeys = ["authority", "authorityVersion", "cycle", "generatedAt", "items", "kind", "schemaVersion", "sourceMemoryVersionIds", "staleAt", "ttlMs", "version"];
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(payloadKeys) || payload.schemaVersion !== P6_CACHE_SCHEMA_VERSION || payload.authority !== "derived_optional" || payload.authorityVersion !== P6_PRINCIPAL_TIME_AUTHORITY_VERSION || payload.kind !== kind || payload.version !== cache.version || payload.cycle !== cache.cycle || payload.generatedAt !== cache.generatedAt.toISOString() || payload.staleAt !== cache.staleAt.toISOString() || payload.ttlMs !== ttlMs || cache.commitmentHash !== cacheCommitment(payload) || JSON.stringify(payload.sourceMemoryVersionIds) !== JSON.stringify(cache.sourceMemoryVersionIds) || !Array.isArray(payload.items)) return empty;
  if (payload.items.some((item) => !item || typeof item !== "object" || Array.isArray(item) || JSON.stringify(Object.keys(item as object).sort()) !== JSON.stringify(["claimKind", "snapshotCommitment", "sourceMemoryVersionId", "sourceVersion", "text"]))) return empty;
  const sourceIds = cache.sourceMemoryVersionIds.filter((id): id is string => typeof id === "string");
  if (sourceIds.length !== cache.sourceMemoryVersionIds.length || new Set(sourceIds).size !== sourceIds.length || JSON.stringify([...sourceIds].sort()) !== JSON.stringify(sourceIds)) return empty;
  const visible = await prisma.p6AcceptedMemorySnapshot.findMany({ where: { userId, projection: kind, sourceMemoryVersionId: { in: sourceIds }, accepted: true, isCurrent: true, deletedAt: null } });
  const orderedVisible = visible.sort((left, right) => left.sourceMemoryVersionId.localeCompare(right.sourceMemoryVersionId) || left.sourceVersion - right.sourceVersion);
  const expectedItems = orderedVisible.map((source) => ({ sourceMemoryVersionId: source.sourceMemoryVersionId, sourceVersion: source.sourceVersion, claimKind: source.claimKind, text: source.content, snapshotCommitment: source.artifactHash }));
  const actualItems = payload.items as Array<Record<string, unknown>>;
  const itemsMatch = actualItems.length === expectedItems.length && actualItems.every((item, index) => item.sourceMemoryVersionId === expectedItems[index].sourceMemoryVersionId && item.sourceVersion === expectedItems[index].sourceVersion && item.claimKind === expectedItems[index].claimKind && item.text === expectedItems[index].text && item.snapshotCommitment === expectedItems[index].snapshotCommitment);
  if (orderedVisible.length !== sourceIds.length || orderedVisible.some((row) => row.dataClass !== P6FixtureDataClass.ORDINARY || !verifySnapshot(row)) || JSON.stringify(orderedVisible.map((row) => row.sourceMemoryVersionId)) !== JSON.stringify(sourceIds) || !itemsMatch) return empty;
  return { status: "ready" as const, items: payload.items, cycle: cache.cycle, version: cache.version };
};

export const deleteP6FixtureSourceLocally = async ({ auth, sourceMemoryVersionId }: { auth: P6AuthContext; sourceMemoryVersionId: string }) => {
  const { userId } = await derivePrincipal(auth);
  return prisma.$transaction(async (tx) => {
  const source = await tx.p6AcceptedMemorySnapshot.findFirst({ where: { userId, sourceMemoryVersionId, isCurrent: true, deletedAt: null } });
  if (!source) return [];
  await tx.p6AcceptedMemorySnapshot.update({ where: { id: source.id }, data: { deletedAt: new Date(), isCurrent: false } });
  const cache = await tx.p6RelationshipGrowthCache.findUnique({ where: { userId_kind: { userId, kind: source.projection } } });
  const sourceIds = Array.isArray(cache?.sourceMemoryVersionIds) ? cache.sourceMemoryVersionIds : [];
  if (!cache || !sourceIds.includes(sourceMemoryVersionId)) return [];
  await tx.p6RelationshipGrowthCache.update({ where: { id: cache.id }, data: { invalidatedAt: new Date() } });
  const request = await tx.p6TargetedRecompute.upsert({ where: { userId_kind_sourceMemoryVersionId_status: { userId, kind: source.projection, sourceMemoryVersionId, status: P6RecomputeStatus.PENDING } }, create: { userId, kind: source.projection, sourceMemoryVersionId, reason: "LOCAL_SOURCE_DELETED" }, update: {} });
  return [request];
  });
};

export const p6FixtureIds = Object.freeze(Object.keys(fixtures) as FixtureId[]);
