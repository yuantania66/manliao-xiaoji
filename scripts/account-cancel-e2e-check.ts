import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const databaseUrl = process.env.CANCEL_ACCOUNT_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("PREREQUISITE_FAILED: CANCEL_ACCOUNT_TEST_DATABASE_URL is required");
}
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
if (!/(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/i.test(databaseName)) {
  throw new Error(`PREREQUISITE_FAILED: database must be visibly test-scoped; received ${databaseName}`);
}

const run = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ENV = "development";
  process.env.SESSION_SECRET = "account-cancel-e2e-test-secret-32-characters";
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "xinqing-cancel-media-"));
  process.env.UPLOAD_DIR = uploadRoot;

const { prisma } = await import("../lib/prisma");
const { createSession, hashVerificationCode } = await import("../lib/auth");
const { POST: cancelAccount } = await import("../app/api/auth/cancel/route");
const { POST: loginWithWechat } = await import("../app/api/auth/wechat/route");
const { hashUploadToken } = await import("../app/api/uploads/notes/storage");
const { drainPendingAccountCancellationFiles } = await import("../services/auth/accountCancellationService");

const invokeCancel = async (token: string, body: Record<string, unknown>) => {
  const response = await cancelAccount(new Request("http://localhost/api/auth/cancel", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
  return { status: response.status, json: await response.json() as Record<string, unknown> };
};

const userOwnedDelegates = [
  "session", "verificationCode", "chatSession", "chatMessage", "note", "fact",
  "experienceSlice", "interpretation", "hypothesis", "understandingGraphNode",
  "understandingGraphEdge", "event", "emotionSlice", "eventRelation", "feedback",
  "aiMessageFeedback", "aiGeneration", "aiJudgeResult", "rawMemory", "rawMemoryEvent",
  "evidence", "memoryEvidenceLink", "semanticMemory", "semanticMemoryVersion",
  "understanding", "understandingVersion", "timelineEvent", "timelineEventVersion",
  "relationship", "relationshipVersion", "versionHistory", "refinementJob",
] as const;

const countOwned = async (userId: string) => {
  const entries = await Promise.all(userOwnedDelegates.map(async (name) => [
    name,
    await (prisma[name] as unknown as { count(args: { where: { userId: string } }): Promise<number> })
      .count({ where: { userId } }),
  ] as const));
  return Object.fromEntries(entries) as Record<(typeof userOwnedDelegates)[number], number>;
};

const seedAllDataClasses = async (userId: string, mediaUrl: string) => {
  await prisma.verificationCode.create({
    data: { userId, phone: `1${String(Date.now()).slice(-10)}`, scene: "LOGIN", codeHash: "fixture", expiresAt: new Date(Date.now() + 60_000) },
  });
  const chat = await prisma.chatSession.create({ data: { userId, title: "cancel fixture" } });
  const message = await prisma.chatMessage.create({
    data: { userId, sessionId: chat.id, role: "USER", content: "synthetic fixture" },
  });
  await prisma.note.create({ data: { userId, content: "fixture", recordDate: new Date(), mediaUrls: [mediaUrl] } });
  const fact = await prisma.fact.create({
    data: { userId, sourceType: "CHAT", sourceId: message.id, eventText: "fixture" },
  });
  await prisma.experienceSlice.create({ data: { userId, sourceType: "CHAT", sourceId: message.id, eventId: fact.id } });
  await prisma.interpretation.create({ data: { userId, eventId: fact.id, interpretationText: "fixture" } });
  await prisma.hypothesis.create({ data: { userId, hypothesisText: "fixture" } });
  const nodeA = await prisma.understandingGraphNode.create({ data: { userId, type: "PERSON", label: "A" } });
  const nodeB = await prisma.understandingGraphNode.create({ data: { userId, type: "EVENT", label: "B" } });
  await prisma.understandingGraphEdge.create({ data: { userId, fromNodeId: nodeA.id, toNodeId: nodeB.id, type: "RELATED_TO" } });
  const eventA = await prisma.event.create({ data: { userId, title: "A", eventDate: new Date() } });
  const eventB = await prisma.event.create({ data: { userId, title: "B", eventDate: new Date() } });
  await prisma.emotionSlice.create({ data: { userId, eventId: eventA.id, date: new Date(), emotionType: "calm" } });
  await prisma.eventRelation.create({ data: { userId, fromEventId: eventA.id, toEventId: eventB.id, relationType: "UNRELATED" } });
  await prisma.feedback.create({ data: { userId, type: "fixture", content: `cancel-feedback-${userId}` } });
  const generation = await prisma.aiGeneration.create({
    data: { userId, sessionId: chat.id, sourceType: "CHAT", model: "fixture", promptVersion: "fixture", inputText: "fixture", outputText: "fixture", status: "GENERATED" },
  });
  const assistant = await prisma.chatMessage.create({
    data: { userId, sessionId: chat.id, role: "ASSISTANT", content: "fixture", aiGenerationId: generation.id },
  });
  await prisma.aiJudgeResult.create({
    data: { userId, generationId: generation.id, passed: true, riskLevel: "LOW", issues: [], rewriteRequired: false, reason: "fixture", judgeModel: "fixture", promptVersion: "fixture" },
  });
  await prisma.aiMessageFeedback.create({ data: { userId, messageId: assistant.id, signal: "HELPFUL" } });

  const raw = await prisma.rawMemory.create({
    data: { userId, kind: "CONVERSATION_MESSAGE", sourceType: "CHAT_MESSAGE", sourceId: message.id, content: "fixture", payload: {}, occurredAt: new Date() },
  });
  await prisma.rawMemoryEvent.create({ data: { userId, rawMemoryId: raw.id, eventType: "CREATED" } });
  const evidence = await prisma.evidence.create({
    data: { userId, sourceKind: "RAW_MEMORY", sourceId: raw.id, rawMemoryId: raw.id, evidenceText: "fixture" },
  });
  await prisma.memoryEvidenceLink.create({
    data: { userId, evidenceId: evidence.id, targetType: "RAW_MEMORY", targetId: raw.id, role: "SOURCE" },
  });
  const semantic = await prisma.semanticMemory.create({ data: { userId, kind: "RAW_SEGMENT", title: "fixture", content: "fixture", source: "fixture" } });
  const semanticVersion = await prisma.semanticMemoryVersion.create({
    data: { userId, semanticMemoryId: semantic.id, version: 1, kind: "RAW_SEGMENT", title: "fixture", content: "fixture", source: "fixture", status: "ACTIVE", snapshot: {}, changeType: "CREATED", operationId: randomUUID() },
  });
  await prisma.semanticMemory.update({ where: { id: semantic.id }, data: { currentVersionId: semanticVersion.id } });
  const understanding = await prisma.understanding.create({ data: { userId, title: "fixture", understanding: "fixture" } });
  const understandingVersion = await prisma.understandingVersion.create({
    data: { userId, understandingId: understanding.id, version: 1, title: "fixture", understanding: "fixture", status: "OPEN", snapshot: {}, changeType: "CREATED", operationId: randomUUID() },
  });
  await prisma.understanding.update({ where: { id: understanding.id }, data: { currentVersionId: understandingVersion.id } });
  const timeline = await prisma.timelineEvent.create({ data: { userId, title: "fixture" } });
  const timelineVersion = await prisma.timelineEventVersion.create({
    data: { userId, timelineEventId: timeline.id, version: 1, title: "fixture", endStatus: "UNKNOWN", confidence: 0.5, importanceScore: 0, status: "ACTIVE", snapshot: {}, changeType: "CREATED", operationId: randomUUID() },
  });
  await prisma.timelineEvent.update({ where: { id: timeline.id }, data: { currentVersionId: timelineVersion.id } });
  const relationship = await prisma.relationship.create({ data: { userId, displayName: "fixture" } });
  const relationshipVersion = await prisma.relationshipVersion.create({
    data: { userId, relationshipId: relationship.id, version: 1, displayName: "fixture", relationshipType: "OTHER", confidence: 0.5, status: "ACTIVE", snapshot: {}, changeType: "CREATED", operationId: randomUUID() },
  });
  await prisma.relationship.update({ where: { id: relationship.id }, data: { currentVersionId: relationshipVersion.id } });
  await prisma.versionHistory.create({ data: { userId, targetType: "SEMANTIC_MEMORY", targetId: semantic.id, version: 1, changeType: "CREATED", snapshot: {}, operationId: randomUUID() } });
  await prisma.refinementJob.create({ data: { userId, rawMemoryId: raw.id, segmentKey: "fixture", pipelineVersion: "fixture", step: "RAW_CAPTURED", operationId: randomUUID() } });
};

const main = async () => {
  const [{ databaseName: actualDatabase, nonCascadeCount }] = await prisma.$queryRaw<Array<{ databaseName: string; nonCascadeCount: bigint }>>`
    SELECT current_database() AS "databaseName", (
      SELECT COUNT(*)::bigint
      FROM pg_constraint c
      JOIN pg_class child ON child.oid = c.conrelid
      JOIN pg_class parent ON parent.oid = c.confrelid
      WHERE c.contype = 'f' AND parent.relname = 'User'
        AND child.relname NOT IN ('Feedback', 'VerificationCode') AND c.confdeltype <> 'c'
    ) AS "nonCascadeCount"
  `;
  assert.equal(actualDatabase, databaseName);
  assert.equal(Number(nonCascadeCount), 0, "every user-owned FK except explicit SetNull records must cascade");

  const other = await prisma.user.create({ data: { nickname: `other-${randomUUID()}` } });
  await prisma.note.create({ data: { userId: other.id, content: "other", recordDate: new Date(), mediaUrls: [] } });

  const code = `cancel-e2e-${randomUUID()}`;
  const wechatOpenid = `mock_${createHash("sha256").update(code).digest("hex").slice(0, 28)}`;
  const user = await prisma.user.create({ data: { wechatOpenid, nickname: "delete me" } });
  const { token } = await createSession(user.id);
  const mediaName = `${randomUUID()}.png`;
  const mediaDirectory = path.join(uploadRoot, user.id);
  const mediaPath = path.join(mediaDirectory, mediaName);
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(mediaPath, "synthetic media");
  const upload = await prisma.noteUpload.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      storageKey: `${user.id}/${mediaName}`,
      mimeType: "image/png",
      size: 15,
      accessTokenHash: hashUploadToken("synthetic-token"),
      purpose: "PROFILE_AVATAR",
      boundAt: new Date(),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { avatarUrl: `/api/uploads/profile-avatar/${upload.id}` },
  });
  await seedAllDataClasses(user.id, `/api/uploads/profile-avatar/${upload.id}`);
  const before = await countOwned(user.id);
  for (const [name, count] of Object.entries(before)) assert(count > 0, `${name} fixture must exist`);

  const cancelled = await invokeCancel(token, { wechatCode: code });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  assert.equal(await readFile(mediaPath).then(() => true).catch(() => false), false);
  await assert.rejects(access(mediaPath));
  for (const [name, count] of Object.entries(await countOwned(user.id))) assert.equal(count, 0, `${name} must be deleted`);
  assert.equal(await prisma.feedback.count({ where: { content: `cancel-feedback-${user.id}` } }), 0);
  assert.equal(await prisma.note.count({ where: { userId: other.id } }), 1, "other user data must remain");
  assert.equal((await invokeCancel(token, { confirm: true })).status, 401, "old token must be invalid");

  const relogin = await loginWithWechat(new Request("http://localhost/api/auth/wechat", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  }));
  assert.equal(relogin.status, 200);
  const recreated = await prisma.user.findUniqueOrThrow({ where: { wechatOpenid } });
  assert.notEqual(recreated.id, user.id, "re-registration must create a fresh account");

  const mismatchOwnerCode = `mismatch-owner-${randomUUID()}`;
  const mismatchOpenid = `mock_${createHash("sha256").update(mismatchOwnerCode).digest("hex").slice(0, 28)}`;
  const mismatch = await prisma.user.create({ data: { wechatOpenid: mismatchOpenid } });
  const mismatchSession = await createSession(mismatch.id);
  assert.equal((await invokeCancel(mismatchSession.token, { wechatCode: `wrong-${randomUUID()}` })).status, 403);
  assert.equal((await invokeCancel(mismatchSession.token, {})).status, 400);
  assert.equal(await prisma.user.count({ where: { id: mismatch.id } }), 1);

  const createPhoneFixture = async (phone: string, codeValue?: string, expiresAt = new Date(Date.now() + 60_000)) => {
    const phoneUser = await prisma.user.create({ data: { phone } });
    const phoneSession = await createSession(phoneUser.id);
    if (codeValue) {
      await prisma.verificationCode.create({
        data: {
          userId: phoneUser.id,
          phone,
          scene: "CANCEL_ACCOUNT",
          codeHash: hashVerificationCode({ phone, scene: "CANCEL_ACCOUNT", code: codeValue }),
          expiresAt,
        },
      });
    }
    return { user: phoneUser, token: phoneSession.token };
  };
  const phoneCode = "123456";
  const phoneSuffix = String(Date.now()).slice(-8);
  const phone = (digit: number) => `13${digit}${phoneSuffix}`;
  const phoneSuccess = await createPhoneFixture(phone(1), phoneCode);
  assert.equal((await invokeCancel(phoneSuccess.token, { code: phoneCode })).status, 200);
  const reused = await createPhoneFixture(phone(1));
  assert.equal((await invokeCancel(reused.token, { code: phoneCode })).status, 422, "deleted code must not be reusable");
  const wrong = await createPhoneFixture(phone(2), phoneCode);
  assert.equal((await invokeCancel(wrong.token, { code: "654321" })).status, 422);
  const expired = await createPhoneFixture(phone(3), phoneCode, new Date(Date.now() - 1_000));
  assert.equal((await invokeCancel(expired.token, { code: phoneCode })).status, 422);
  const unsent = await createPhoneFixture(phone(4));
  assert.equal((await invokeCancel(unsent.token, { code: phoneCode })).status, 422);

  const rollbackCode = `rollback-${randomUUID()}`;
  const rollbackOpenid = `mock_${createHash("sha256").update(rollbackCode).digest("hex").slice(0, 28)}`;
  const rollbackUser = await prisma.user.create({ data: { wechatOpenid: rollbackOpenid, nickname: "cancel-rollback-fixture" } });
  const rollbackSession = await createSession(rollbackUser.id);
  const rollbackStorageKey = `${rollbackUser.id}/${randomUUID()}.webp`;
  const rollbackPath = path.join(uploadRoot, rollbackStorageKey);
  await mkdir(path.dirname(rollbackPath), { recursive: true });
  await writeFile(rollbackPath, "rollback");
  await prisma.noteUpload.create({
    data: {
      id: randomUUID(), userId: rollbackUser.id, storageKey: rollbackStorageKey,
      mimeType: "image/webp", size: 8, accessTokenHash: hashUploadToken("rollback"),
      purpose: "PROFILE_AVATAR", boundAt: new Date(),
    },
  });
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION cancel_rollback_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.nickname = 'cancel-rollback-fixture' THEN RAISE EXCEPTION 'injected rollback'; END IF; RETURN OLD; END $$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS cancel_rollback_fail_trigger ON "User"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER cancel_rollback_fail_trigger BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cancel_rollback_fail()`);
  assert.equal((await invokeCancel(rollbackSession.token, { wechatCode: rollbackCode })).status, 500);
  assert.equal(await prisma.user.count({ where: { id: rollbackUser.id } }), 1);
  assert.equal(await readFile(rollbackPath).then(() => true), true, "DB rollback must leave private media intact");
  assert.equal(await prisma.noteUpload.count({ where: { userId: rollbackUser.id } }), 1);
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { storageKey: rollbackStorageKey } }), 0);
  await prisma.$executeRawUnsafe(`DROP TRIGGER cancel_rollback_fail_trigger ON "User"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION cancel_rollback_fail()`);

  const finalizeCode = `finalize-${randomUUID()}`;
  const finalizeOpenid = `mock_${createHash("sha256").update(finalizeCode).digest("hex").slice(0, 28)}`;
  const finalizeUser = await prisma.user.create({ data: { wechatOpenid: finalizeOpenid } });
  const finalizeSession = await createSession(finalizeUser.id);
  const finalizeStorageKey = `${finalizeUser.id}/${randomUUID()}.webp`;
  const finalizePath = path.join(uploadRoot, finalizeStorageKey);
  await mkdir(path.dirname(finalizePath), { recursive: true });
  await writeFile(finalizePath, "finalize");
  await prisma.noteUpload.create({
    data: {
      id: randomUUID(), userId: finalizeUser.id, storageKey: finalizeStorageKey,
      mimeType: "image/webp", size: 8, accessTokenHash: hashUploadToken("finalize"),
      purpose: "PROFILE_AVATAR", boundAt: new Date(),
    },
  });
  process.env.ACCOUNT_CANCEL_TEST_FAIL_FILE_DELETE_ONCE = "1";
  const finalizeResult = await invokeCancel(finalizeSession.token, { wechatCode: finalizeCode });
  assert.equal(finalizeResult.status, 200, "post-commit cleanup failure must not report cancellation failure");
  assert.equal(
    ((finalizeResult.json.data as Record<string, unknown>)?.mediaCleanup),
    "pending"
  );
  assert.equal(await prisma.user.count({ where: { id: finalizeUser.id } }), 0);
  assert.equal(await readFile(finalizePath).then(() => true).catch(() => false), true, "failed physical delete must remain private and retryable");
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { storageKey: finalizeStorageKey } }), 1);
  assert.equal((await drainPendingAccountCancellationFiles()).pending, 0);
  await assert.rejects(access(finalizePath));
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { storageKey: finalizeStorageKey } }), 0);
  assert.equal(await prisma.user.count({ where: { id: other.id } }), 1, "cleanup must not affect another user");

  console.log("Account cancellation end-to-end checks passed.");
};

  try {
    await main();
  } finally {
    await prisma.$disconnect();
    await rm(uploadRoot, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
