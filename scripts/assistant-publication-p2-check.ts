import assert from "node:assert/strict";

import { AssistantPublicationStatus, MessageRole, MessageStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";
import {
  AssistantPublicationConflict,
  acquireAssistantPublicationLease as acquireOwned,
  appendAssistantPublicationDraft as appendOwned,
  beginAssistantPublicationStreaming as beginOwned,
  commitAssistantPublication as commitOwned,
  failAssistantPublication as failOwned,
  hashAssistantPublicationDraft,
  replayAssistantPublication as replayOwned,
  reserveAssistantPublicationTurn,
} from "../services/chat/assistantPublicationService";

const fixture = `p2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${fixture}-user`;
const sessionId = `${fixture}-session`;
const otherUserId = `${fixture}-other-user`;
const otherSessionId = `${fixture}-other-session`;
const turn = (name: string) => `${fixture}-${name}`;
const now = new Date("2026-08-25T00:00:00.000Z");
const conflict = (code: string) => (error: unknown) => error instanceof AssistantPublicationConflict && error.code === code;
const auth = { sessionId, userId };
type WithOptionalAuth<T> = Omit<T, keyof typeof auth> & Partial<typeof auth>;
const acquireAssistantPublicationLease = (input: WithOptionalAuth<Parameters<typeof acquireOwned>[0]>) => acquireOwned({ ...input, ...auth });
const appendAssistantPublicationDraft = (input: WithOptionalAuth<Parameters<typeof appendOwned>[0]>) => appendOwned({ ...input, ...auth });
const beginAssistantPublicationStreaming = (input: WithOptionalAuth<Parameters<typeof beginOwned>[0]>) => beginOwned({ ...input, ...auth });
const commitAssistantPublication = (input: WithOptionalAuth<Parameters<typeof commitOwned>[0]>) => commitOwned({ ...input, ...auth });
const failAssistantPublication = (input: WithOptionalAuth<Parameters<typeof failOwned>[0]>) => failOwned({ ...input, ...auth });
const replayAssistantPublication = (input: WithOptionalAuth<Parameters<typeof replayOwned>[0]>) => replayOwned({ ...input, ...auth });

const main = async () => {
await prisma.user.create({ data: { id: userId, nickname: "P2 synthetic fixture" } });
await prisma.chatSession.create({ data: { id: sessionId, userId } });
await prisma.user.create({ data: { id: otherUserId, nickname: "P2 cross-tenant fixture" } });
await prisma.chatSession.create({ data: { id: otherSessionId, userId: otherUserId } });

try {
  await assert.rejects(reserveAssistantPublicationTurn({ sessionId, userId: otherUserId, clientTurnId: turn("cross-owner-reserve"), content: "must not write", now }), conflict("publication_not_found"));
  assert.equal(await prisma.chatMessage.count({ where: { id: turn("cross-owner-reserve") } }), 0);
  const rollbackTurn = turn("rollback-turn");
  await assert.rejects(reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: rollbackTurn, content: "rollback", now, faultInjector: (point) => { if (point === "after_user_write") throw new Error("injected_after_user_write"); } }), /injected_after_user_write/);
  assert.equal(await prisma.chatMessage.count({ where: { id: rollbackTurn } }), 0);
  assert.equal(await prisma.assistantPublication.count({ where: { sessionId, clientTurnId: rollbackTurn } }), 0);

  const reservationRollbackTurn = turn("reservation-rollback");
  await assert.rejects(reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: reservationRollbackTurn, content: "rollback reservation", now, faultInjector: (point) => { if (point === "after_reservation_write") throw new Error("injected_after_reservation"); } }), /injected_after_reservation/);
  assert.equal(await prisma.chatMessage.count({ where: { id: reservationRollbackTurn } }), 0);
  assert.equal(await prisma.assistantPublication.count({ where: { sessionId, clientTurnId: reservationRollbackTurn } }), 0);

  const concurrentTurn = turn("concurrent-reserve");
  const reservations = await Promise.all(Array.from({ length: 20 }, () => reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: concurrentTurn, content: "same user message", now })));
  assert.equal(new Set(reservations.map((item) => item.id)).size, 1);
  assert.equal(await prisma.chatMessage.count({ where: { id: concurrentTurn, role: MessageRole.USER } }), 1);
  assert.equal(await prisma.assistantPublication.count({ where: { sessionId, clientTurnId: concurrentTurn } }), 1);
  await assert.rejects(reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: concurrentTurn, content: "different content", now }), conflict("client_turn_content_conflict"));

  const publication = reservations[0];
  await assert.rejects(acquireOwned({ sessionId, userId: otherUserId, clientTurnId: concurrentTurn, leaseOwner: "cross-owner", now }), conflict("publication_not_found"));
  await assert.rejects(beginOwned({ sessionId: otherSessionId, userId: otherUserId, publicationId: publication.id, leaseOwner: "cross-owner", attempt: 0, now }), conflict("publication_not_found"));
  let forcedCasConflicts = 0;
  await assert.rejects(acquireAssistantPublicationLease({ sessionId, clientTurnId: concurrentTurn, leaseOwner: "forced-conflict", now, forceCasConflict: (round) => { assert.equal(round, forcedCasConflicts); forcedCasConflicts += 1; return true; } }), conflict("lease_concurrency_exhausted"));
  assert.equal(forcedCasConflicts, 6);
  assert.equal((await replayAssistantPublication({ clientTurnId: concurrentTurn })).publication.attempt, 0);
  const firstLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: concurrentTurn, leaseOwner: "worker-a", now });
  assert.equal(firstLease.action, "acquired");
  assert.equal(firstLease.publication.attempt, 1);
  const attached = await acquireAssistantPublicationLease({ sessionId, clientTurnId: concurrentTurn, leaseOwner: "worker-b", now: new Date(now.getTime() + 1_000) });
  assert.equal(attached.action, "attached");
  const streaming = await beginAssistantPublicationStreaming({ publicationId: publication.id, leaseOwner: "worker-a", attempt: 1, now });
  assert.equal(streaming.status, AssistantPublicationStatus.streaming);
  const firstDraft = await appendAssistantPublicationDraft({ publicationId: publication.id, leaseOwner: "worker-a", attempt: 1, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "第一段。", now });
  assert.equal(firstDraft.draftVersion, 1);
  assert.equal(firstDraft.draftContent, "第一段。");
  const duplicateAppend = await appendAssistantPublicationDraft({ publicationId: publication.id, leaseOwner: "worker-a", attempt: 1, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "第一段。", now });
  assert.equal(duplicateAppend.draftVersion, 1);
  assert.equal(duplicateAppend.draftContent, "第一段。");
  await assert.rejects(appendAssistantPublicationDraft({ publicationId: publication.id, leaseOwner: "worker-b", attempt: 1, expectedDraftVersion: 1, expectedDraftHash: hashAssistantPublicationDraft("第一段。"), segment: "恶意段。", now }), conflict("stale_publication_fence"));
  await assert.rejects(appendAssistantPublicationDraft({ publicationId: publication.id, leaseOwner: "worker-a", attempt: 1, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "第一段。", now: new Date(now.getTime() + 31_000) }), conflict("stale_publication_fence"));

  const takeovers = await Promise.all(Array.from({ length: 10 }, (_, index) => acquireAssistantPublicationLease({ sessionId, clientTurnId: concurrentTurn, leaseOwner: `takeover-${index}`, now: new Date(now.getTime() + 31_000) })));
  assert.equal(takeovers.filter((item) => item.action === "acquired").length, 1);
  assert.equal(takeovers.filter((item) => item.action === "attached").length, 9);
  const takeover = takeovers.find((item) => item.action === "acquired")!;
  assert.equal(takeover.publication.attempt, 2);
  assert.equal(takeover.publication.status, AssistantPublicationStatus.reserved);
  assert.equal(takeover.publication.draftContent, "");
  assert.equal(takeover.publication.draftVersion, 0);
  await assert.rejects(beginAssistantPublicationStreaming({ publicationId: publication.id, leaseOwner: "worker-a", attempt: 1, now: new Date(now.getTime() + 31_000) }), conflict("stale_publication_fence"));

  const retryTurn = turn("retryable");
  const retryPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: retryTurn, content: "retry me", now });
  const retryLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: retryTurn, leaseOwner: "retry-worker", now });
  const retryFailed = await failAssistantPublication({ publicationId: retryPublication.id, leaseOwner: "retry-worker", attempt: retryLease.publication.attempt, failureCode: "PERSISTENCE_ERROR", terminal: false, now });
  assert.equal(retryFailed.status, AssistantPublicationStatus.failed_retryable);
  const retryAcquire = await acquireAssistantPublicationLease({ sessionId, clientTurnId: retryTurn, leaseOwner: "retry-worker-2", now: new Date(now.getTime() + 1) });
  assert.equal(retryAcquire.publication.status, AssistantPublicationStatus.reserved);
  assert.equal(retryAcquire.publication.attempt, 2);

  const terminalTurn = turn("terminal");
  const terminalPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: terminalTurn, content: "terminal", now });
  const terminalLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: terminalTurn, leaseOwner: "terminal-worker", now });
  const terminal = await failAssistantPublication({ publicationId: terminalPublication.id, leaseOwner: "terminal-worker", attempt: terminalLease.publication.attempt, failureCode: "SAFETY_BLOCKED", terminal: true, now });
  assert.equal(terminal.status, AssistantPublicationStatus.failed_terminal);
  const terminalReplay = await acquireAssistantPublicationLease({ sessionId, clientTurnId: terminalTurn, leaseOwner: "attacker", now: new Date(now.getTime() + 60_000) });
  assert.equal(terminalReplay.action, "replay_terminal");
  assert.equal(terminalReplay.publication.id, terminalPublication.id);

  const commitRollbackTurn = turn("commit-rollback");
  const commitRollbackPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: commitRollbackTurn, content: "commit rollback", now });
  const commitRollbackLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: commitRollbackTurn, leaseOwner: "commit-rollback-worker", now });
  await assert.rejects(commitAssistantPublication({ publicationId: commitRollbackPublication.id, leaseOwner: "commit-rollback-worker", attempt: commitRollbackLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "must roll back", now, faultInjector: (point) => { if (point === "after_assistant_write") throw new Error("injected_after_assistant"); } }), /injected_after_assistant/);
  assert.equal(await prisma.chatMessage.count({ where: { replyToMessageId: commitRollbackTurn } }), 0);
  assert.equal((await replayAssistantPublication({ clientTurnId: commitRollbackTurn })).publication.status, AssistantPublicationStatus.reserved);

  const draftCommitTurn = turn("draft-commit-binding");
  const draftCommitPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: draftCommitTurn, content: "draft binding", now });
  const draftCommitLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: draftCommitTurn, leaseOwner: "draft-commit-worker", now });
  await beginAssistantPublicationStreaming({ publicationId: draftCommitPublication.id, leaseOwner: "draft-commit-worker", attempt: draftCommitLease.publication.attempt, now });
  const safeDraft = await appendAssistantPublicationDraft({ publicationId: draftCommitPublication.id, leaseOwner: "draft-commit-worker", attempt: draftCommitLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "已安全展示。", now });
  await assert.rejects(commitAssistantPublication({ publicationId: draftCommitPublication.id, leaseOwner: "draft-commit-worker", attempt: draftCommitLease.publication.attempt, expectedDraftVersion: safeDraft.draftVersion, expectedDraftHash: hashAssistantPublicationDraft(safeDraft.draftContent), finalContent: "不一致终稿", now }), conflict("final_content_draft_conflict"));
  const boundFinal = await commitAssistantPublication({ publicationId: draftCommitPublication.id, leaseOwner: "draft-commit-worker", attempt: draftCommitLease.publication.attempt, expectedDraftVersion: safeDraft.draftVersion, expectedDraftHash: hashAssistantPublicationDraft(safeDraft.draftContent), finalContent: "已安全展示。完整终稿。", now });
  assert.equal(boundFinal.status, AssistantPublicationStatus.committed);

  const commitTurn = turn("concurrent-commit");
  const commitPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: commitTurn, content: "commit once", now });
  const commitLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: commitTurn, leaseOwner: "commit-worker", now });
  const commitCalls = await Promise.all(Array.from({ length: 20 }, () => commitAssistantPublication({ publicationId: commitPublication.id, leaseOwner: "commit-worker", attempt: commitLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "one final winner", now })));
  assert.equal(new Set(commitCalls.map((item) => item.committedMessageId)).size, 1);
  assert.equal(await prisma.chatMessage.count({ where: { replyToMessageId: commitTurn, role: MessageRole.ASSISTANT } }), 1);
  assert.equal((await acquireAssistantPublicationLease({ sessionId, clientTurnId: commitTurn, leaseOwner: "late-worker", now })).action, "replay_committed");
  await assert.rejects(commitAssistantPublication({ publicationId: commitPublication.id, leaseOwner: "commit-worker", attempt: commitLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "different winner", now }), conflict("committed_payload_conflict"));

  const responseLossTurn = turn("response-loss");
  const responseLossPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: responseLossTurn, content: "response loss", now });
  const responseLossLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: responseLossTurn, leaseOwner: "response-loss-worker", now });
  await assert.rejects(commitAssistantPublication({ publicationId: responseLossPublication.id, leaseOwner: "response-loss-worker", attempt: responseLossLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "durable final", now, faultInjector: (point) => { if (point === "after_commit") throw new Error("injected_response_loss"); } }), /injected_response_loss/);
  const recovered = await commitAssistantPublication({ publicationId: responseLossPublication.id, leaseOwner: "stale-owner-is-ignored-for-replay", attempt: 999, expectedDraftVersion: 999, expectedDraftHash: hashAssistantPublicationDraft("wrong"), finalContent: "durable final", now });
  assert.equal(recovered.status, AssistantPublicationStatus.committed);
  assert.equal(recovered.finalContent, "durable final");

  await assert.rejects(
    prisma.$queryRaw`SELECT CAST('UNREGISTERED_FAILURE' AS "AssistantPublicationFailureCode")`,
    /invalid input value for enum/u,
  );

  const deletedSourceTurn = turn("deleted-source");
  const deletedSourcePublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: deletedSourceTurn, content: "delete the source", now });
  const deletedSourceLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: deletedSourceTurn, leaseOwner: "delete-source-worker", now });
  await beginAssistantPublicationStreaming({ publicationId: deletedSourcePublication.id, leaseOwner: "delete-source-worker", attempt: deletedSourceLease.publication.attempt, now });
  await appendAssistantPublicationDraft({ publicationId: deletedSourcePublication.id, leaseOwner: "delete-source-worker", attempt: deletedSourceLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "temporary safe draft", now });
  await prisma.chatMessage.delete({ where: { id: deletedSourceTurn } });
  const sourceTombstone = await prisma.assistantPublication.findUniqueOrThrow({ where: { id: deletedSourcePublication.id } });
  assert.equal(sourceTombstone.userMessageId, null);
  assert.equal(sourceTombstone.draftContent, "");
  assert.equal(sourceTombstone.finalContent, null);
  assert(sourceTombstone.contentDeletedAt instanceof Date);
  assert.equal(sourceTombstone.leaseOwner, null);
  assert.equal(sourceTombstone.leaseExpiresAt, null);
  assert.equal((await replayAssistantPublication({ clientTurnId: deletedSourceTurn })).action, "deleted");
  assert.equal((await acquireAssistantPublicationLease({ sessionId, clientTurnId: deletedSourceTurn, leaseOwner: "late-after-delete", now })).action, "replay_deleted");
  await assert.rejects(beginAssistantPublicationStreaming({ publicationId: deletedSourcePublication.id, leaseOwner: "late-after-delete", attempt: deletedSourceLease.publication.attempt, now }), conflict("publication_content_deleted"));
  await assert.rejects(appendAssistantPublicationDraft({ publicationId: deletedSourcePublication.id, leaseOwner: "late-after-delete", attempt: deletedSourceLease.publication.attempt, expectedDraftVersion: 1, expectedDraftHash: hashAssistantPublicationDraft(""), segment: "must not append", now }), conflict("publication_content_deleted"));
  await assert.rejects(commitAssistantPublication({ publicationId: deletedSourcePublication.id, leaseOwner: "late-after-delete", attempt: deletedSourceLease.publication.attempt, expectedDraftVersion: 1, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "must not commit", now }), conflict("publication_content_deleted"));
  await assert.rejects(failAssistantPublication({ publicationId: deletedSourcePublication.id, leaseOwner: "late-after-delete", attempt: deletedSourceLease.publication.attempt, failureCode: "PERSISTENCE_ERROR", terminal: true, now }), conflict("publication_content_deleted"));
  const repeatedDeletedReservation = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: deletedSourceTurn, content: "delete the source", now });
  assert.equal(repeatedDeletedReservation.id, deletedSourcePublication.id);
  assert.equal(await prisma.chatMessage.count({ where: { id: deletedSourceTurn } }), 0);

  const deletedWinnerTurn = turn("deleted-winner");
  const deletedWinnerPublication = await reserveAssistantPublicationTurn({ sessionId, userId, clientTurnId: deletedWinnerTurn, content: "delete committed winner", now });
  const deletedWinnerLease = await acquireAssistantPublicationLease({ sessionId, clientTurnId: deletedWinnerTurn, leaseOwner: "delete-winner-worker", now });
  const deletedWinner = await commitAssistantPublication({ publicationId: deletedWinnerPublication.id, leaseOwner: "delete-winner-worker", attempt: deletedWinnerLease.publication.attempt, expectedDraftVersion: 0, expectedDraftHash: hashAssistantPublicationDraft(""), finalContent: "winner to delete", now });
  await prisma.chatMessage.delete({ where: { id: deletedWinner.committedMessageId! } });
  const winnerTombstone = await prisma.assistantPublication.findUniqueOrThrow({ where: { id: deletedWinnerPublication.id } });
  assert.equal(winnerTombstone.committedMessageId, null);
  assert.equal(winnerTombstone.draftContent, "");
  assert.equal(winnerTombstone.finalContent, null);
  assert(winnerTombstone.contentDeletedAt instanceof Date);
  assert.equal((await replayAssistantPublication({ clientTurnId: deletedWinnerTurn })).action, "deleted");

  const cascadeUserId = `${fixture}-cascade-user`;
  const cascadeSessionId = `${fixture}-cascade-session`;
  await prisma.user.create({ data: { id: cascadeUserId, nickname: "P2 cascade fixture" } });
  await prisma.chatSession.create({ data: { id: cascadeSessionId, userId: cascadeUserId } });
  const cascadePublication = await reserveAssistantPublicationTurn({ sessionId: cascadeSessionId, userId: cascadeUserId, clientTurnId: `${fixture}-cascade-turn`, content: "cascade", now });
  await prisma.chatSession.delete({ where: { id: cascadeSessionId } });
  assert.equal(await prisma.assistantPublication.count({ where: { id: cascadePublication.id } }), 0);
  await prisma.user.delete({ where: { id: cascadeUserId } });

  const userCascadeUserId = `${fixture}-user-cascade`;
  const userCascadeSessionId = `${fixture}-user-cascade-session`;
  await prisma.user.create({ data: { id: userCascadeUserId, nickname: "P2 user cascade fixture" } });
  await prisma.chatSession.create({ data: { id: userCascadeSessionId, userId: userCascadeUserId } });
  const userCascadePublication = await reserveAssistantPublicationTurn({ sessionId: userCascadeSessionId, userId: userCascadeUserId, clientTurnId: `${fixture}-user-cascade-turn`, content: "user cascade", now });
  await prisma.user.delete({ where: { id: userCascadeUserId } });
  assert.equal(await prisma.assistantPublication.count({ where: { id: userCascadePublication.id } }), 0);

  const publications = await prisma.assistantPublication.findMany({ where: { sessionId } });
  assert(publications.every((item) => [AssistantPublicationStatus.reserved, AssistantPublicationStatus.streaming, AssistantPublicationStatus.committed, AssistantPublicationStatus.failed_retryable, AssistantPublicationStatus.failed_terminal].includes(item.status)));
  assert.equal(
    await prisma.chatMessage.count({ where: { sessionId, role: MessageRole.ASSISTANT, status: MessageStatus.SAVED } }),
    publications.filter((item) => item.status === AssistantPublicationStatus.committed && item.contentDeletedAt === null).length,
  );

  console.log(JSON.stringify({ status: "PASS", fiveStates: true, concurrentReservations: 20, concurrentCommits: 20, singleWinner: true, leaseTakeover: true, staleFenceRejected: true, appendIdempotent: true, transactionRollback: true, responseLossReplay: true, tenantAuthority: true, contentTombstone: true, databaseFailureEnum: true, qwenCalled: false, productionRouteIntegrated: false }, null, 2));
} finally {
  await prisma.assistantPublication.deleteMany({ where: { sessionId } });
  await prisma.chatMessage.deleteMany({ where: { sessionId } });
  await prisma.chatSession.deleteMany({ where: { id: sessionId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.chatSession.deleteMany({ where: { id: otherSessionId } });
  await prisma.user.deleteMany({ where: { id: otherUserId } });
  await prisma.$disconnect();
}
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
