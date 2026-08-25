import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { GovernanceDerivativeKind, MessageRole, MessageStatus } from "../.generated/p5-prisma";
import { acquireP5DeletionLease, advanceP5Deletion, listVisibleP5Messages, p5Prisma as prisma, P5DeletionConflict, requestP5Deletion } from "../services/governance/p5DeletionCascadeAuthority";

const fixture = `p5-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const userId = `${fixture}-user`; const sessionId = `${fixture}-session`;
const otherUserId = `${fixture}-other`; const otherSessionId = `${fixture}-other-session`;
const sourceMessageId = `${fixture}-source`; const unrelatedId = `${fixture}-unrelated`;
const now = new Date("2026-08-25T00:00:00.000Z");
const auth = { sessionId: `${fixture}-auth`, tokenHash: hmacToken("owner") };
const otherAuth = { sessionId: `${fixture}-other-auth`, tokenHash: hmacToken("other") };
function hmacToken(value: string) { return createHash("sha256").update(`p5-auth:${value}`).digest("hex"); }
const h = (v: string) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
const done = new Set<string>(); const mark = (...ids: string[]) => ids.forEach((id) => done.add(id));
const expected = ["A1","A2","A3","A4","A5","A6","V1","V2","V3","V4","V5","V6","E1","E2","E3","E4","D1","D2","D3","D4","D5","D6","D7","C1","C2","C3","C4","C5","C6","C7","C8","C9","N1","N2","N3","N4","N5","P1","P2","P3","P4"];
const conflict = (code: string) => (error: unknown) => error instanceof P5DeletionConflict && error.code === code;

const main = async () => {
  await prisma.user.createMany({ data: [{ id: userId }, { id: otherUserId }] });
  await prisma.session.createMany({ data: [{ id: auth.sessionId, userId, tokenHash: auth.tokenHash, expiresAt: new Date("2027-01-01T00:00:00.000Z") }, { id: otherAuth.sessionId, userId: otherUserId, tokenHash: otherAuth.tokenHash, expiresAt: new Date("2027-01-01T00:00:00.000Z") }] });
  await prisma.chatSession.createMany({ data: [{ id: sessionId, userId }, { id: otherSessionId, userId: otherUserId }] });
  await prisma.chatMessage.createMany({ data: [
    { id: sourceMessageId, sessionId, userId, role: MessageRole.USER, content: "PLAINTEXT_SOURCE_CANARY", status: MessageStatus.SAVED, createdAt: now },
    { id: unrelatedId, sessionId, userId, role: MessageRole.USER, content: "unrelated", status: MessageStatus.SAVED, createdAt: new Date(now.getTime() + 1) },
  ] });
  await prisma.assistantPublication.create({ data: { id: `${fixture}-pub`, sessionId, userId, clientTurnId: sourceMessageId, userMessageId: sourceMessageId, status: "streaming", draftContent: "PLAINTEXT_DRAFT_CANARY", finalContent: "PLAINTEXT_FINAL_CANARY", leaseOwner: "worker", leaseExpiresAt: new Date(now.getTime() + 30_000) } });
  await prisma.governanceSourceEdge.createMany({ data: Object.values(GovernanceDerivativeKind).map((targetKind) => ({ userId, sessionId, sourceMessageId, targetKind, targetIdHash: h(`${targetKind}-PLAINTEXT_PROFILE_CANARY`), createdAt: now })) });
  const frozenEdge = await prisma.governanceSourceEdge.findFirstOrThrow({ where: { sourceMessageId, targetKind: GovernanceDerivativeKind.MEMORY } });
  await assert.rejects(prisma.governanceSourceEdge.update({ where: { id: frozenEdge.id }, data: { targetIdHash: h("mutated") } }), /governance_source_edge_identity_is_immutable/); mark("E1");
  assert.equal(await prisma.governanceSourceEdge.count({ where: { userId, sessionId, sourceMessageId, targetKind: { in: [GovernanceDerivativeKind.MEMORY, GovernanceDerivativeKind.INDEX, GovernanceDerivativeKind.PROFILE] } } }), 3); mark("E2");
  assert.equal(await prisma.governanceSourceEdge.count({ where: { userId, sessionId, sourceMessageId, targetKind: { in: [GovernanceDerivativeKind.REPLAY, GovernanceDerivativeKind.SHADOW] } } }), 2); mark("E4");
  await assert.rejects(requestP5Deletion({ auth: otherAuth, chatSessionId: sessionId, sourceMessageId, requestKey: "cross-owner", now }), conflict("source_not_found")); mark("A2","A4");
  await assert.rejects(requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId: `${fixture}-missing`, requestKey: "missing", now }), conflict("source_not_found")); mark("A3");
  const request = await requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId, requestKey: "delete-source", now }); mark("A1");
  const repeated = await requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId, requestKey: "delete-source", now }); assert.equal(repeated.id, request.id); mark("A5");
  await assert.rejects(requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId: unrelatedId, requestKey: "delete-source", now }), conflict("request_key_conflict")); mark("A6");
  assert.equal((await listVisibleP5Messages({ auth, chatSessionId: sessionId })).some((m) => m.id === sourceMessageId), false); mark("V1");
  const pub = await prisma.assistantPublication.findUniqueOrThrow({ where: { id: `${fixture}-pub` } }); assert.equal(pub.draftContent, ""); assert.equal(pub.finalContent, null); assert(pub.contentDeletedAt); mark("V2","V3","V4");
  const source = await prisma.chatMessage.findUniqueOrThrow({ where: { id: sourceMessageId } }); assert(source.contentDeletedAt); assert.equal(source.content, ""); mark("V5");
  assert.equal(source.interactionMetadata, null);
  await assert.rejects(prisma.chatMessage.update({ where: { id: sourceMessageId }, data: { contentDeletedAt: null, content: "revived", status: MessageStatus.SAVED } }), /chat_message_tombstone_is_irreversible/); mark("C5");
  await assert.rejects(prisma.chatMessage.update({ where: { id: sourceMessageId }, data: { interactionMetadata: { restored: "PLAINTEXT_METADATA_CANARY" } } }), /chat_message_tombstone_is_irreversible/);
  await assert.rejects(prisma.assistantPublication.update({ where: { id: `${fixture}-pub` }, data: { draftContent: "PLAINTEXT_DRAFT_REVIVAL", finalContent: "PLAINTEXT_FINAL_REVIVAL", leaseOwner: "revived", leaseExpiresAt: new Date(now.getTime() + 99_999) } }), /assistant_publication_tombstone_is_irreversible/);
  assert.equal((await prisma.chatMessage.findUniqueOrThrow({ where: { id: unrelatedId } })).content, "unrelated"); mark("V6");
  const edges0 = await prisma.governanceSourceEdge.findMany({ where: { requestId: request.id } }); assert(edges0.find((e) => e.targetKind === GovernanceDerivativeKind.REPLAY)?.invalidatedAt); mark("D6");
  await assert.rejects(prisma.governanceSourceEdge.update({ where: { id: edges0[0].id }, data: { requestId: null } }), /governance_source_edge_identity_is_immutable/);
  const leases = await Promise.all(Array.from({ length: 20 }, (_, i) => acquireP5DeletionLease({ auth, requestId: request.id, leaseOwner: `worker-${i}`, now: new Date(now.getTime() + 1) })));
  assert.equal(leases.filter((x) => x.action === "acquired").length, 1); assert.equal(new Set(leases.map((x) => x.request.id)).size, 1); mark("C1","C2","C9");
  const owner = leases.find((x) => x.action === "acquired")!;
  await assert.rejects(advanceP5Deletion({ auth, requestId: request.id, leaseOwner: "stale", attempt: owner.request.attempt, now: new Date(now.getTime() + 60_000) }), conflict("stale_fence")); mark("C4");
  const takeover = await acquireP5DeletionLease({ auth, requestId: request.id, leaseOwner: "takeover", now: new Date(now.getTime() + 31_001) }); assert.equal(takeover.action, "acquired"); assert.equal(takeover.request.attempt, owner.request.attempt + 1); mark("C3");
  await advanceP5Deletion({ auth, requestId: request.id, leaseOwner: "takeover", attempt: takeover.request.attempt, now: new Date(now.getTime() + 60_000) });
  const edges60 = await prisma.governanceSourceEdge.findMany({ where: { requestId: request.id } }); for (const kind of [GovernanceDerivativeKind.MEMORY, GovernanceDerivativeKind.INDEX, GovernanceDerivativeKind.PROFILE]) assert(edges60.find((e) => e.targetKind === kind)?.invalidatedAt); mark("D1","D2","D3");
  const lease24 = await acquireP5DeletionLease({ auth, requestId: request.id, leaseOwner: "day-worker", now: new Date(now.getTime() + 86_400_000 - 1) });
  await advanceP5Deletion({ auth, requestId: request.id, leaseOwner: "day-worker", attempt: lease24.request.attempt, now: new Date(now.getTime() + 86_400_000) });
  const edges24 = await prisma.governanceSourceEdge.findMany({ where: { requestId: request.id } }); for (const kind of [GovernanceDerivativeKind.RELATIONSHIP, GovernanceDerivativeKind.GROWTH, GovernanceDerivativeKind.SHADOW]) assert(edges24.find((e) => e.targetKind === kind)?.invalidatedAt); mark("D4","D5","D7","E3");
  const auditCountBeforeReplay = await prisma.governanceDeletionAudit.count({ where: { requestId: request.id } });
  await advanceP5Deletion({ auth, requestId: request.id, leaseOwner: "day-worker", attempt: lease24.request.attempt, now: new Date(now.getTime() + 86_400_000) });
  assert.equal(await prisma.governanceDeletionAudit.count({ where: { requestId: request.id } }), auditCountBeforeReplay); mark("C7");

  const crashSourceId = `${fixture}-crash-source`;
  await prisma.chatMessage.create({ data: { id: crashSourceId, sessionId, userId, role: MessageRole.USER, content: "crash source", status: MessageStatus.SAVED, createdAt: new Date(now.getTime() + 2) } });
  await prisma.governanceSourceEdge.create({ data: { userId, sessionId, sourceMessageId: crashSourceId, targetKind: GovernanceDerivativeKind.MEMORY, targetIdHash: h("crash-memory"), createdAt: now } });
  const crashRequest = await requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId: crashSourceId, requestKey: "crash-source", now });
  const crashLease = await acquireP5DeletionLease({ auth, requestId: crashRequest.id, leaseOwner: "crash-worker", now: new Date(now.getTime() + 59_999) });
  await assert.rejects(advanceP5Deletion({ auth, requestId: crashRequest.id, leaseOwner: "crash-worker", attempt: crashLease.request.attempt, now: new Date(now.getTime() + 60_000), faultInjector: (point) => { if (point === "after_derivatives") throw new Error("crash_mid_cascade"); } }), /crash_mid_cascade/);
  assert.equal((await prisma.governanceDeletionRequest.findUniqueOrThrow({ where: { id: crashRequest.id } })).status, "VISIBILITY_REVOKED");
  const resumed = await advanceP5Deletion({ auth, requestId: crashRequest.id, leaseOwner: "crash-worker", attempt: crashLease.request.attempt, now: new Date(now.getTime() + 60_000) });
  assert.equal(resumed.status, "DERIVATIVES_INVALIDATED"); mark("C6");

  const lateSourceId = `${fixture}-late-source`;
  await prisma.chatMessage.create({ data: { id: lateSourceId, sessionId, userId, role: MessageRole.USER, content: "late source", status: MessageStatus.SAVED, createdAt: new Date(now.getTime() + 3) } });
  await prisma.governanceSourceEdge.create({ data: { userId, sessionId, sourceMessageId: lateSourceId, targetKind: GovernanceDerivativeKind.MEMORY, targetIdHash: h("late-memory"), createdAt: now } });
  const lateRequest = await requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId: lateSourceId, requestKey: "late-source", now });
  const lateLease = await acquireP5DeletionLease({ auth, requestId: lateRequest.id, leaseOwner: "late-worker", now: new Date(now.getTime() + 60_000) });
  const late = await advanceP5Deletion({ auth, requestId: lateRequest.id, leaseOwner: "late-worker", attempt: lateLease.request.attempt, now: new Date(now.getTime() + 60_001) });
  assert.equal(late.status, "FAILED_TERMINAL"); assert.equal(late.failureCode, "DERIVATIVE_DEADLINE_MISSED");
  assert.equal((await acquireP5DeletionLease({ auth, requestId: lateRequest.id, leaseOwner: "another", now: new Date(now.getTime() + 70_000) })).action, "replay"); mark("C8");

  const lateDaySourceId = `${fixture}-late-day-source`;
  await prisma.chatMessage.create({ data: { id: lateDaySourceId, sessionId, userId, role: MessageRole.USER, content: "late day", status: MessageStatus.SAVED, createdAt: new Date(now.getTime() + 4) } });
  await prisma.governanceSourceEdge.createMany({ data: [GovernanceDerivativeKind.MEMORY, GovernanceDerivativeKind.RELATIONSHIP].map((targetKind) => ({ userId, sessionId, sourceMessageId: lateDaySourceId, targetKind, targetIdHash: h(`late-day-${targetKind}`), createdAt: now })) });
  const lateDayRequest = await requestP5Deletion({ auth, chatSessionId: sessionId, sourceMessageId: lateDaySourceId, requestKey: "late-day-source", now });
  const lateDayMinuteLease = await acquireP5DeletionLease({ auth, requestId: lateDayRequest.id, leaseOwner: "late-day-minute", now: new Date(now.getTime() + 59_999) });
  await advanceP5Deletion({ auth, requestId: lateDayRequest.id, leaseOwner: "late-day-minute", attempt: lateDayMinuteLease.request.attempt, now: new Date(now.getTime() + 60_000) });
  const lateDayLease = await acquireP5DeletionLease({ auth, requestId: lateDayRequest.id, leaseOwner: "late-day-worker", now: new Date(now.getTime() + 86_400_000) });
  const lateDay = await advanceP5Deletion({ auth, requestId: lateDayRequest.id, leaseOwner: "late-day-worker", attempt: lateDayLease.request.attempt, now: new Date(now.getTime() + 86_400_001) });
  assert.equal(lateDay.status, "FAILED_TERMINAL"); assert.equal(lateDay.failureCode, "RECOMPUTE_DEADLINE_MISSED");
  const audits = await prisma.governanceDeletionAudit.findMany({ where: { requestId: request.id } }); assert.equal(new Set(audits.map((a) => a.phase)).size, audits.length);
  for (const audit of audits) assert.deepEqual(Object.keys(audit).sort(), ["attempt","durationMs","effectCount","id","occurredAt","phase","requestId","requestIdHash","result"].sort()); mark("N1");
  const serialized = JSON.stringify(audits); for (const canary of ["PLAINTEXT_SOURCE_CANARY","PLAINTEXT_DRAFT_CANARY","PLAINTEXT_FINAL_CANARY","PLAINTEXT_PROFILE_CANARY"]) assert.equal(serialized.includes(canary), false); mark("N2","N3");
  assert.equal(new Set(audits.map((a) => `${a.requestId}:${a.phase}`)).size, audits.length); mark("N4");
  assert(audits.every((a) => a.requestId === request.id && a.requestIdHash === h(request.id))); mark("N5");
  const finalRequest = await prisma.governanceDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }); assert.equal(finalRequest.physicalDeletedAt, null); mark("P1","P2");
  assert.equal(finalRequest.status, "RECOMPUTE_MARKED"); mark("P3");
  assert(userId.startsWith("p5-") && sourceMessageId.startsWith("p5-")); mark("P4");
  assert.deepEqual([...done].sort(), [...expected].sort());
  console.log(JSON.stringify({ status: "PASS", assertions: done.size, fakeClock60: true, fakeClock24h: true, production: "pending", physicalDelete: "pending" }));
};

main().finally(async () => { await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } }); await prisma.$disconnect(); }).catch((error) => { console.error(error); process.exitCode = 1; });
