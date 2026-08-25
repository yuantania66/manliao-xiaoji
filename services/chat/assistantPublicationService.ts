import { createHash } from "node:crypto";

import {
  AssistantPublicationStatus,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

const LEASE_MS = 30_000;
const CLIENT_TURN_ID = /^[a-zA-Z0-9:_-]{8,160}$/u;
const FAILURE_CODES = ["PLAN_INVALID", "GENERATION_NONCONFORMANT", "SAFETY_BLOCKED", "PROVIDER_ERROR", "TIMEOUT", "PERSISTENCE_ERROR"] as const;
const publicationSelect = {
  id: true,
  sessionId: true,
  userId: true,
  clientTurnId: true,
  userMessageId: true,
  committedMessageId: true,
  status: true,
  leaseOwner: true,
  leaseExpiresAt: true,
  attempt: true,
  draftVersion: true,
  draftContent: true,
  finalContent: true,
  failureCode: true,
  contentDeletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssistantPublicationSelect;

export type AssistantPublicationSnapshot = Prisma.AssistantPublicationGetPayload<{ select: typeof publicationSelect }>;
export type AssistantPublicationFaultPoint = "after_user_write" | "after_reservation_write" | "after_assistant_write" | "after_commit";
export type AssistantPublicationFaultInjector = (point: AssistantPublicationFaultPoint) => void | Promise<void>;

export class AssistantPublicationConflict extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AssistantPublicationConflict";
  }
}

const contentHash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const hashAssistantPublicationDraft = contentHash;
const assertText = (value: string, field: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AssistantPublicationConflict(`invalid_${field}`);
};
const assertIdentity = ({ sessionId, userId, clientTurnId }: { sessionId: string; userId: string; clientTurnId: string }) => {
  assertText(sessionId, "session_id", 200);
  assertText(userId, "user_id", 200);
  if (!CLIENT_TURN_ID.test(clientTurnId)) throw new AssistantPublicationConflict("invalid_client_turn_id");
};
const isUniqueConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const isTransactionConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
type PublicationAuth = Readonly<{ sessionId: string; userId: string }>;
const loadPublication = ({ sessionId, userId }: PublicationAuth, clientTurnId: string) => prisma.assistantPublication.findFirst({ where: { sessionId, userId, clientTurnId }, select: publicationSelect });
const loadPublicationById = ({ sessionId, userId }: PublicationAuth, id: string) => prisma.assistantPublication.findFirst({ where: { id, sessionId, userId }, select: publicationSelect });
const assertMutable = (publication: AssistantPublicationSnapshot) => {
  if (publication.contentDeletedAt) throw new AssistantPublicationConflict("publication_content_deleted");
};
const validatePublicationIdentity = async (publication: AssistantPublicationSnapshot, userId: string, content?: string) => {
  if (publication.userId !== userId) throw new AssistantPublicationConflict("client_turn_identity_conflict");
  if (content !== undefined && publication.userMessageId) {
    const message = await prisma.chatMessage.findUnique({ where: { id: publication.userMessageId }, select: { content: true } });
    if (!message || message.content !== content) throw new AssistantPublicationConflict("client_turn_content_conflict");
  }
};

export const reserveAssistantPublicationTurn = async ({ sessionId, userId, clientTurnId, content, now = new Date(), faultInjector }: { sessionId: string; userId: string; clientTurnId: string; content: string; now?: Date; faultInjector?: AssistantPublicationFaultInjector }): Promise<AssistantPublicationSnapshot> => {
  assertIdentity({ sessionId, userId, clientTurnId });
  assertText(content, "content", 2000);
  for (let retry = 0; retry < 6; retry += 1) {
    const ownedSession = await prisma.chatSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
    if (!ownedSession) throw new AssistantPublicationConflict("publication_not_found");
    const existing = await loadPublication({ sessionId, userId }, clientTurnId);
    if (existing) { await validatePublicationIdentity(existing, userId, content); return existing; }
    try {
      return await prisma.$transaction(async (tx) => {
        const inserted = await tx.chatMessage.createMany({ data: [{ id: clientTurnId, sessionId, userId, role: MessageRole.USER, content, status: MessageStatus.SAVED }], skipDuplicates: true });
        const userMessage = await tx.chatMessage.findUniqueOrThrow({ where: { id: clientTurnId }, select: { id: true, sessionId: true, userId: true, role: true, content: true } });
        if (userMessage.sessionId !== sessionId || userMessage.userId !== userId || userMessage.role !== MessageRole.USER || userMessage.content !== content) throw new AssistantPublicationConflict("client_turn_content_conflict");
        await faultInjector?.("after_user_write");
        const publication = await tx.assistantPublication.create({ data: { sessionId, userId, clientTurnId, userMessageId: userMessage.id }, select: publicationSelect });
        await faultInjector?.("after_reservation_write");
        if (inserted.count === 1) await tx.chatSession.update({ where: { id: sessionId }, data: { lastMessage: content, lastMessageAt: now } });
        return publication;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isUniqueConflict(error) && !isTransactionConflict(error)) throw error;
      const concurrent = await loadPublication({ sessionId, userId }, clientTurnId);
      if (concurrent) { await validatePublicationIdentity(concurrent, userId, content); return concurrent; }
      if (retry === 5) throw new AssistantPublicationConflict("reservation_concurrency_exhausted");
    }
  }
  throw new AssistantPublicationConflict("reservation_concurrency_exhausted");
};

export type AssistantPublicationLeaseResult = Readonly<{ action: "acquired" | "attached" | "replay_committed" | "replay_terminal" | "replay_deleted"; publication: AssistantPublicationSnapshot }>;
export type AssistantPublicationLeaseCasHook = (round: number) => boolean | Promise<boolean>;
export const acquireAssistantPublicationLease = async ({ sessionId, userId, clientTurnId, leaseOwner, now = new Date(), forceCasConflict }: PublicationAuth & { clientTurnId: string; leaseOwner: string; now?: Date; forceCasConflict?: AssistantPublicationLeaseCasHook }): Promise<AssistantPublicationLeaseResult> => {
  assertText(leaseOwner, "lease_owner", 160);
  for (let round = 0; round < 6; round += 1) {
    const current = await loadPublication({ sessionId, userId }, clientTurnId);
    if (!current) throw new AssistantPublicationConflict("publication_not_found");
    if (current.contentDeletedAt) return { action: "replay_deleted", publication: current };
    if (current.status === AssistantPublicationStatus.committed) return { action: "replay_committed", publication: current };
    if (current.status === AssistantPublicationStatus.failed_terminal) return { action: "replay_terminal", publication: current };
    if (current.leaseExpiresAt && current.leaseExpiresAt > now) {
      if (current.leaseOwner === leaseOwner) return { action: "acquired", publication: current };
      return { action: "attached", publication: current };
    }
    if (await forceCasConflict?.(round)) continue;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const resetDraft = current.status === AssistantPublicationStatus.streaming || current.status === AssistantPublicationStatus.failed_retryable;
    const updated = await prisma.assistantPublication.updateMany({
      where: { id: current.id, sessionId, userId, contentDeletedAt: null, status: current.status, attempt: current.attempt, leaseOwner: current.leaseOwner, leaseExpiresAt: current.leaseExpiresAt },
      data: { status: AssistantPublicationStatus.reserved, leaseOwner, leaseExpiresAt, attempt: { increment: 1 }, failureCode: null, ...(resetDraft ? { draftContent: "", draftVersion: 0 } : {}) },
    });
    if (updated.count === 1) return { action: "acquired", publication: await prisma.assistantPublication.findFirstOrThrow({ where: { id: current.id, sessionId, userId }, select: publicationSelect }) };
  }
  throw new AssistantPublicationConflict("lease_concurrency_exhausted");
};

const liveFenceWhere = ({ id, leaseOwner, attempt, now }: { id: string; leaseOwner: string; attempt: number; now: Date }) => ({ id, leaseOwner, attempt, leaseExpiresAt: { gt: now } });
export const beginAssistantPublicationStreaming = async ({ sessionId, userId, publicationId, leaseOwner, attempt, now = new Date() }: PublicationAuth & { publicationId: string; leaseOwner: string; attempt: number; now?: Date }) => {
  const current = await loadPublicationById({ sessionId, userId }, publicationId);
  if (!current) throw new AssistantPublicationConflict("publication_not_found");
  assertMutable(current);
  const updated = await prisma.assistantPublication.updateMany({ where: { ...liveFenceWhere({ id: publicationId, leaseOwner, attempt, now }), sessionId, userId, contentDeletedAt: null, status: AssistantPublicationStatus.reserved }, data: { status: AssistantPublicationStatus.streaming } });
  if (updated.count !== 1) throw new AssistantPublicationConflict("stale_publication_fence");
  return prisma.assistantPublication.findFirstOrThrow({ where: { id: publicationId, sessionId, userId }, select: publicationSelect });
};

export const appendAssistantPublicationDraft = async ({ sessionId, userId, publicationId, leaseOwner, attempt, expectedDraftVersion, expectedDraftHash, segment, now = new Date() }: PublicationAuth & { publicationId: string; leaseOwner: string; attempt: number; expectedDraftVersion: number; expectedDraftHash: string; segment: string; now?: Date }) => {
  assertText(segment, "segment", 4000);
  return prisma.$transaction(async (tx) => {
    const current = await tx.assistantPublication.findFirst({ where: { id: publicationId, sessionId, userId }, select: publicationSelect });
    if (!current) throw new AssistantPublicationConflict("publication_not_found");
    assertMutable(current);
    if (current.status !== AssistantPublicationStatus.streaming || current.leaseOwner !== leaseOwner || current.attempt !== attempt || !current.leaseExpiresAt || current.leaseExpiresAt <= now) throw new AssistantPublicationConflict("stale_publication_fence");
    if (current.draftVersion === expectedDraftVersion + 1 && current.draftContent.endsWith(segment) && contentHash(current.draftContent.slice(0, -segment.length)) === expectedDraftHash) return current;
    if (current.draftVersion !== expectedDraftVersion || contentHash(current.draftContent) !== expectedDraftHash) throw new AssistantPublicationConflict("draft_version_conflict");
    const nextContent = `${current.draftContent}${segment}`;
    const updated = await tx.assistantPublication.updateMany({ where: { ...liveFenceWhere({ id: publicationId, leaseOwner, attempt, now }), sessionId, userId, contentDeletedAt: null, status: AssistantPublicationStatus.streaming, draftVersion: expectedDraftVersion }, data: { draftContent: nextContent, draftVersion: { increment: 1 }, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } });
    if (updated.count !== 1) throw new AssistantPublicationConflict("stale_publication_fence");
    return tx.assistantPublication.findFirstOrThrow({ where: { id: publicationId, sessionId, userId }, select: publicationSelect });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const assertCommitReplay = (publication: AssistantPublicationSnapshot, finalContent: string) => {
  if (publication.finalContent !== finalContent || !publication.committedMessageId) throw new AssistantPublicationConflict("committed_payload_conflict");
  return publication;
};
type CommitAssistantPublicationInput = PublicationAuth & { publicationId: string; leaseOwner: string; attempt: number; expectedDraftVersion: number; expectedDraftHash: string; finalContent: string; now?: Date; faultInjector?: AssistantPublicationFaultInjector };
const commitAssistantPublicationAttempt = async ({ sessionId, userId, publicationId, leaseOwner, attempt, expectedDraftVersion, expectedDraftHash, finalContent, now = new Date(), faultInjector }: CommitAssistantPublicationInput, transactionRetry: number): Promise<AssistantPublicationSnapshot> => {
  assertText(finalContent, "final_content", 12_000);
  const before = await loadPublicationById({ sessionId, userId }, publicationId);
  if (!before) throw new AssistantPublicationConflict("publication_not_found");
  assertMutable(before);
  if (before.status === AssistantPublicationStatus.committed) return assertCommitReplay(before, finalContent);
  if (before.status === AssistantPublicationStatus.failed_terminal) throw new AssistantPublicationConflict("publication_terminal");
  try {
    const committed = await prisma.$transaction(async (tx) => {
      const current = await tx.assistantPublication.findFirst({ where: { id: publicationId, sessionId, userId }, select: publicationSelect });
      if (!current) throw new AssistantPublicationConflict("publication_not_found");
      assertMutable(current);
      if (current.status === AssistantPublicationStatus.committed) return assertCommitReplay(current, finalContent);
      if ((current.status !== AssistantPublicationStatus.reserved && current.status !== AssistantPublicationStatus.streaming) || current.leaseOwner !== leaseOwner || current.attempt !== attempt || !current.leaseExpiresAt || current.leaseExpiresAt <= now) throw new AssistantPublicationConflict("stale_publication_fence");
      if (current.draftVersion !== expectedDraftVersion || contentHash(current.draftContent) !== expectedDraftHash) throw new AssistantPublicationConflict("draft_version_conflict");
      if (!finalContent.startsWith(current.draftContent)) throw new AssistantPublicationConflict("final_content_draft_conflict");
      if (!current.userMessageId) throw new AssistantPublicationConflict("source_message_deleted");
      const winnerId = `${current.id}:winner`;
      await tx.chatMessage.createMany({ data: [{ id: winnerId, sessionId: current.sessionId, userId: current.userId, role: MessageRole.ASSISTANT, content: finalContent, status: MessageStatus.SAVED, replyToMessageId: current.userMessageId }], skipDuplicates: true });
      await faultInjector?.("after_assistant_write");
      const winner = await tx.chatMessage.findUniqueOrThrow({ where: { replyToMessageId: current.userMessageId }, select: { id: true, sessionId: true, userId: true, role: true, content: true } });
      if (winner.id !== winnerId || winner.sessionId !== current.sessionId || winner.userId !== current.userId || winner.role !== MessageRole.ASSISTANT || winner.content !== finalContent) throw new AssistantPublicationConflict("committed_payload_conflict");
      const updated = await tx.assistantPublication.updateMany({ where: { ...liveFenceWhere({ id: publicationId, leaseOwner, attempt, now }), sessionId, userId, contentDeletedAt: null, status: { in: [AssistantPublicationStatus.reserved, AssistantPublicationStatus.streaming] }, draftVersion: expectedDraftVersion }, data: { status: AssistantPublicationStatus.committed, committedMessageId: winner.id, finalContent, failureCode: null, leaseOwner: null, leaseExpiresAt: null } });
      if (updated.count !== 1) throw new AssistantPublicationConflict("publication_commit_race");
      await tx.chatSession.update({ where: { id: current.sessionId }, data: { lastMessage: finalContent, lastMessageAt: now } });
      return tx.assistantPublication.findFirstOrThrow({ where: { id: publicationId, sessionId, userId }, select: publicationSelect });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await faultInjector?.("after_commit");
    return committed;
  } catch (error) {
    if (isTransactionConflict(error)) {
      const winner = await loadPublicationById({ sessionId, userId }, publicationId);
      if (!winner) throw new AssistantPublicationConflict("publication_not_found");
      if (winner.status === AssistantPublicationStatus.committed) return assertCommitReplay(winner, finalContent);
      if (transactionRetry >= 5) throw new AssistantPublicationConflict("commit_concurrency_exhausted");
      return commitAssistantPublicationAttempt({ sessionId, userId, publicationId, leaseOwner, attempt, expectedDraftVersion, expectedDraftHash, finalContent, now, faultInjector }, transactionRetry + 1);
    }
    if (!(error instanceof AssistantPublicationConflict && error.code === "publication_commit_race") && !isUniqueConflict(error)) throw error;
    const winner = await loadPublicationById({ sessionId, userId }, publicationId);
    if (!winner) throw new AssistantPublicationConflict("publication_not_found");
    if (winner.status !== AssistantPublicationStatus.committed) throw error;
    return assertCommitReplay(winner, finalContent);
  }
};
export const commitAssistantPublication = (input: CommitAssistantPublicationInput) => commitAssistantPublicationAttempt(input, 0);

export const failAssistantPublication = async ({ sessionId, userId, publicationId, leaseOwner, attempt, failureCode, terminal, now = new Date() }: PublicationAuth & { publicationId: string; leaseOwner: string; attempt: number; failureCode: typeof FAILURE_CODES[number]; terminal: boolean; now?: Date }) => {
  if (!FAILURE_CODES.includes(failureCode)) throw new AssistantPublicationConflict("invalid_failure_code");
  const current = await loadPublicationById({ sessionId, userId }, publicationId);
  if (!current) throw new AssistantPublicationConflict("publication_not_found");
  assertMutable(current);
  const status = terminal ? AssistantPublicationStatus.failed_terminal : AssistantPublicationStatus.failed_retryable;
  const updated = await prisma.assistantPublication.updateMany({ where: { ...liveFenceWhere({ id: publicationId, leaseOwner, attempt, now }), sessionId, userId, contentDeletedAt: null, status: { in: [AssistantPublicationStatus.reserved, AssistantPublicationStatus.streaming] } }, data: { status, failureCode, leaseOwner: null, leaseExpiresAt: null } });
  if (updated.count !== 1) throw new AssistantPublicationConflict("stale_publication_fence");
  return prisma.assistantPublication.findUniqueOrThrow({ where: { id: publicationId }, select: publicationSelect });
};

export const replayAssistantPublication = async ({ sessionId, userId, clientTurnId }: PublicationAuth & { clientTurnId: string }) => {
  const publication = await loadPublication({ sessionId, userId }, clientTurnId);
  if (!publication) throw new AssistantPublicationConflict("publication_not_found");
  return publication.contentDeletedAt ? { action: "deleted" as const, publication } : { action: "available" as const, publication };
};
