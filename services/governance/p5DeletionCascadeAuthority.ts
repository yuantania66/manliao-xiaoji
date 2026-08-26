import { createHash } from "node:crypto";

import {
  GovernanceAuditResult,
  GovernanceDeletionPhase,
  GovernanceDeletionStatus,
  GovernanceDerivativeKind,
  MessageStatus,
  Prisma,
  PrismaClient,
} from "../../.generated/p5-prisma";

export const p5Prisma = new PrismaClient();
const prisma = p5Prisma;

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const IMMEDIATE_KINDS = [GovernanceDerivativeKind.REPLAY] as const;
const DERIVATIVE_KINDS = [GovernanceDerivativeKind.MEMORY, GovernanceDerivativeKind.INDEX, GovernanceDerivativeKind.PROFILE] as const;

export class P5DeletionConflict extends Error {
  constructor(public readonly code: string) { super(code); }
}

export type P5Auth = Readonly<{ sessionId: string; tokenHash: string }>;
const deriveP5Principal = async (auth: P5Auth) => {
  const session = await prisma.session.findFirst({ where: { id: auth.sessionId, tokenHash: auth.tokenHash, expiresAt: { gt: new Date() } }, select: { userId: true } });
  if (!session) throw new P5DeletionConflict("unauthorized");
  return Object.freeze({ userId: session.userId });
};

const writeAudit = async (tx: Prisma.TransactionClient, input: {
  requestId: string; phase: GovernanceDeletionPhase; now: Date; effectCount: number; attempt: number;
}) => tx.governanceDeletionAudit.upsert({
  where: { requestId_phase: { requestId: input.requestId, phase: input.phase } },
  create: { requestId: input.requestId, requestIdHash: sha256(input.requestId), phase: input.phase, result: GovernanceAuditResult.APPLIED, occurredAt: input.now, durationMs: 0, effectCount: input.effectCount, attempt: input.attempt },
  update: {},
});

export const requestP5Deletion = async (input: {
  auth: P5Auth; chatSessionId: string; sourceMessageId: string; requestKey: string; now: Date;
}) => {
  const { userId } = await deriveP5Principal(input.auth);
  const existing = await prisma.governanceDeletionRequest.findUnique({ where: { userId_requestKey: { userId, requestKey: input.requestKey } } });
  if (existing) {
    if (existing.sourceMessageIdHash !== sha256(input.sourceMessageId)) throw new P5DeletionConflict("request_key_conflict");
    return existing;
  }
  return prisma.$transaction(async (tx) => {
    const source = await tx.chatMessage.findFirst({ where: { id: input.sourceMessageId, userId, sessionId: input.chatSessionId, contentDeletedAt: null } });
    if (!source) throw new P5DeletionConflict("source_not_found");
    const request = await tx.governanceDeletionRequest.create({ data: {
      userId, sessionId: input.chatSessionId, sourceMessageId: input.sourceMessageId,
      sourceMessageIdHash: sha256(input.sourceMessageId), requestKey: input.requestKey,
      status: GovernanceDeletionStatus.VISIBILITY_REVOKED, requestedAt: input.now, visibilityRevokedAt: input.now,
    } });
    await tx.governanceSourceEdge.updateMany({ where: { userId, sessionId: input.chatSessionId, sourceMessageId: input.sourceMessageId }, data: { requestId: request.id } });
    await tx.chatMessage.update({ where: { id: input.sourceMessageId }, data: { content: "", interactionMetadata: Prisma.DbNull, status: MessageStatus.BLOCKED, contentDeletedAt: input.now } });
    await tx.assistantPublication.updateMany({
      where: { userId, sessionId: input.chatSessionId, OR: [{ userMessageId: input.sourceMessageId }, { committedMessageId: input.sourceMessageId }] },
      data: { draftContent: "", finalContent: null, contentDeletedAt: input.now, leaseOwner: null, leaseExpiresAt: null },
    });
    const immediate = await tx.governanceSourceEdge.updateMany({ where: { requestId: request.id, targetKind: { in: [...IMMEDIATE_KINDS] }, invalidatedAt: null }, data: { invalidatedAt: input.now } });
    await tx.governanceDeletionRequest.update({ where: { id: request.id }, data: { replayPurgedAt: input.now } });
    await writeAudit(tx, { requestId: request.id, phase: GovernanceDeletionPhase.VISIBILITY, now: input.now, effectCount: 1 + immediate.count, attempt: 0 });
    return tx.governanceDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
  }, { isolationLevel: "Serializable" });
};

export const listVisibleP5Messages = async (input: { auth: P5Auth; chatSessionId: string }) => {
  const { userId } = await deriveP5Principal(input.auth);
  return prisma.chatMessage.findMany({ where: { userId, sessionId: input.chatSessionId, contentDeletedAt: null, status: MessageStatus.SAVED }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
};

export const acquireP5DeletionLease = async (input: { auth: P5Auth; requestId: string; leaseOwner: string; now: Date; leaseMs?: number }) => {
  const { userId } = await deriveP5Principal(input.auth);
  const leaseMs = input.leaseMs ?? 30_000;
  for (let round = 0; round < 6; round += 1) {
    const current = await prisma.governanceDeletionRequest.findFirst({ where: { id: input.requestId, userId } });
    if (!current) throw new P5DeletionConflict("request_not_found");
    if (current.status === GovernanceDeletionStatus.COMPLETED || current.status === GovernanceDeletionStatus.FAILED_TERMINAL) return { action: "replay" as const, request: current };
    if (current.leaseOwner && current.leaseExpiresAt && current.leaseExpiresAt > input.now && current.leaseOwner !== input.leaseOwner) return { action: "attached" as const, request: current };
    const nextAttempt = current.leaseOwner === input.leaseOwner && current.leaseExpiresAt && current.leaseExpiresAt > input.now ? current.attempt : current.attempt + 1;
    const updated = await prisma.governanceDeletionRequest.updateMany({
      where: { id: current.id, userId, attempt: current.attempt, leaseOwner: current.leaseOwner, leaseExpiresAt: current.leaseExpiresAt },
      data: { leaseOwner: input.leaseOwner, leaseExpiresAt: new Date(input.now.getTime() + leaseMs), attempt: nextAttempt },
    });
    if (updated.count === 1) return { action: "acquired" as const, request: await prisma.governanceDeletionRequest.findUniqueOrThrow({ where: { id: current.id } }) };
  }
  throw new P5DeletionConflict("lease_concurrency_exhausted");
};

export const advanceP5Deletion = async (input: {
  auth: P5Auth; requestId: string; leaseOwner: string; attempt: number; now: Date;
  faultInjector?: (point: "after_derivatives" | "after_recompute") => void;
}) => {
 const { userId } = await deriveP5Principal(input.auth);
 return prisma.$transaction(async (tx) => {
  const request = await tx.governanceDeletionRequest.findFirst({ where: { id: input.requestId, userId, leaseOwner: input.leaseOwner, attempt: input.attempt, leaseExpiresAt: { gt: input.now } } });
  if (!request) throw new P5DeletionConflict("stale_fence");
  const elapsed = input.now.getTime() - request.requestedAt.getTime();
  if (request.status === GovernanceDeletionStatus.VISIBILITY_REVOKED && elapsed > 60_000) {
    return tx.governanceDeletionRequest.update({ where: { id: request.id }, data: { status: GovernanceDeletionStatus.FAILED_TERMINAL, failureCode: "DERIVATIVE_DEADLINE_MISSED", leaseOwner: null, leaseExpiresAt: null } });
  }
  if (request.status === GovernanceDeletionStatus.VISIBILITY_REVOKED && elapsed >= 60_000) {
    const changed = await tx.governanceSourceEdge.updateMany({ where: { requestId: request.id, targetKind: { in: [...DERIVATIVE_KINDS] }, invalidatedAt: null }, data: { invalidatedAt: input.now } });
    await tx.governanceDeletionRequest.update({ where: { id: request.id }, data: { status: GovernanceDeletionStatus.DERIVATIVES_INVALIDATED, derivativesInvalidatedAt: input.now } });
    await writeAudit(tx, { requestId: request.id, phase: GovernanceDeletionPhase.DERIVATIVES, now: input.now, effectCount: changed.count, attempt: input.attempt });
    input.faultInjector?.("after_derivatives");
  }
  const refreshed = await tx.governanceDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
  if (refreshed.status === GovernanceDeletionStatus.DERIVATIVES_INVALIDATED && elapsed > 86_400_000) {
    return tx.governanceDeletionRequest.update({ where: { id: request.id }, data: { status: GovernanceDeletionStatus.FAILED_TERMINAL, failureCode: "RECOMPUTE_DEADLINE_MISSED", leaseOwner: null, leaseExpiresAt: null } });
  }
  if (elapsed >= 86_400_000 && (refreshed.status === GovernanceDeletionStatus.DERIVATIVES_INVALIDATED || refreshed.status === GovernanceDeletionStatus.VISIBILITY_REVOKED)) {
    const changed = await tx.governanceSourceEdge.updateMany({ where: { requestId: request.id, targetKind: { in: [GovernanceDerivativeKind.RELATIONSHIP, GovernanceDerivativeKind.GROWTH, GovernanceDerivativeKind.SHADOW] }, invalidatedAt: null }, data: { invalidatedAt: input.now } });
    await tx.governanceDeletionRequest.update({ where: { id: request.id }, data: { status: GovernanceDeletionStatus.RECOMPUTE_MARKED, recomputeMarkedAt: input.now } });
    await writeAudit(tx, { requestId: request.id, phase: GovernanceDeletionPhase.RECOMPUTE, now: input.now, effectCount: changed.count, attempt: input.attempt });
    input.faultInjector?.("after_recompute");
  }
  return tx.governanceDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
 }, { isolationLevel: "Serializable" });
};

export const P5_PREAUDIT_HASH = "2b77052f5272d59f62ae4cb676a72bff5f788f69660f543913d2795b27dd5e6a";
