import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const main = async () => {
const prisma = new PrismaClient();
const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "xinqing-cancel-"));
process.env.UPLOAD_DIR = uploadRoot;

const { cancelAccountData, drainAccountCancellationFiles } = await import(
  "../services/auth/accountCancellationService"
);

const createUserFixture = async (suffix: string) => {
  const user = await prisma.user.create({
    data: {
      phone: `1380000${suffix.padStart(4, "0")}`,
      wechatOpenid: `cancel-openid-${suffix}`,
      nickname: `cancel-canary-${suffix}`,
      avatarUrl: `https://private.invalid/${suffix}`,
    },
  });
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: `cancel-token-${suffix}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const feedback = await prisma.feedback.create({
    data: { userId: user.id, type: "cancel", content: `feedback-${suffix}` },
  });
  const note = await prisma.note.create({
    data: {
      userId: user.id,
      clientRequestId: `cancel-note-${suffix}`,
      requestHash: `cancel-hash-${suffix}`,
      content: `note-${suffix}`,
      recordDate: new Date("2026-08-26T00:00:00.000Z"),
    },
  });
  const storageKey = `${suffix}/private-image.bin`;
  await mkdir(path.join(uploadRoot, suffix), { recursive: true });
  await writeFile(path.join(uploadRoot, storageKey), `image-${suffix}`);
  await prisma.noteUpload.create({
    data: {
      id: `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
      userId: user.id,
      noteId: note.id,
      storageKey,
      mimeType: "image/png",
      size: 8,
      accessTokenHash: `access-${suffix}`,
    },
  });
  await prisma.rawMemory.create({
    data: {
      userId: user.id,
      kind: "NOTE",
      sourceType: "NOTE",
      sourceId: note.id,
      content: `memory-${suffix}`,
      payload: { canary: suffix },
      occurredAt: new Date(),
    },
  });
  await prisma.p4ProfileCache.create({
    data: {
      userId: user.id,
      version: 1,
      sourceMemoryVersionIds: [],
      generatedAt: new Date(),
      payload: { canary: suffix },
    },
  });
  await prisma.p6AcceptedMemorySnapshot.create({
    data: {
      userId: user.id,
      descriptorId: `cancel-${suffix}`,
      sourceMemoryVersionId: `cancel-source-${suffix}`,
      sourceVersion: 1,
      authorityVersion: "cancel-check-v1",
      artifactHash: `sha256:${suffix.padStart(64, "0")}`,
      projection: "RELATIONSHIP",
      claimKind: "FACT",
      dataClass: "ORDINARY",
      content: `derived-${suffix}`,
      accepted: true,
      isCurrent: true,
    },
  });
  return { user, note, storageKey, feedback };
};

try {
  const target = await createUserFixture("1");
  const unrelated = await createUserFixture("2");
  const chatSession = await prisma.chatSession.create({
    data: { userId: target.user.id },
  });
  const sourceMessage = await prisma.chatMessage.create({
    data: {
      id: "cancel-source-message",
      sessionId: chatSession.id,
      userId: target.user.id,
      role: "USER",
      content: "cancel-message-canary",
    },
  });
  await prisma.assistantPublication.create({
    data: {
      sessionId: chatSession.id,
      userId: target.user.id,
      clientTurnId: "cancel-client-turn",
      userMessageId: sourceMessage.id,
      draftContent: "cancel-draft-canary",
    },
  });
  await prisma.governanceDeletionRequest.create({
    data: {
      userId: target.user.id,
      sessionId: chatSession.id,
      sourceMessageId: sourceMessage.id,
      sourceMessageIdHash: "sha256:cancel-source",
      requestKey: "cancel-governance",
      requestedAt: new Date(),
      visibilityRevokedAt: new Date(),
    },
  });
  const taskIds = await cancelAccountData({
    userId: target.user.id,
    phone: target.user.phone,
    cancelCodeId: null,
  });

  assert.equal(await prisma.user.count({ where: { id: target.user.id } }), 0);
  const tombstone = await prisma.user.findFirstOrThrow({
    where: { status: "CANCELLED", phone: null, wechatOpenid: null },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(tombstone.status, "CANCELLED");
  assert.notEqual(tombstone.id, target.user.id);
  assert.equal(tombstone.phone, null);
  assert.equal(tombstone.wechatOpenid, null);
  assert.equal(tombstone.nickname, null);
  assert.equal(tombstone.avatarUrl, null);
  assert.equal(await prisma.session.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.chatSession.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.assistantPublication.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.governanceDeletionRequest.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.note.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.noteUpload.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.rawMemory.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.p4ProfileCache.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.p6AcceptedMemorySnapshot.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await prisma.feedback.count({ where: { userId: target.user.id } }), 0);
  const anonymousFeedback = await prisma.feedback.findUniqueOrThrow({
    where: { id: target.feedback.id },
  });
  assert.equal(anonymousFeedback.userId, null);
  assert.equal(anonymousFeedback.content, "[account_cancelled]");
  assert.equal(anonymousFeedback.contact, null);
  assert.equal(anonymousFeedback.userAgent, null);
  assert.equal(taskIds.length, 1);
  assert.equal(await drainAccountCancellationFiles(taskIds), 0);
  assert.equal(existsSync(path.join(uploadRoot, target.storageKey)), false);
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { id: { in: taskIds } } }), 0);

  assert.equal(await prisma.user.count({ where: { id: unrelated.user.id, status: "ACTIVE" } }), 1);
  assert.equal(await prisma.note.count({ where: { userId: unrelated.user.id } }), 1);
  assert.equal(existsSync(path.join(uploadRoot, unrelated.storageKey)), true);

  const rollback = await createUserFixture("3");
  await assert.rejects(() => cancelAccountData({
    userId: rollback.user.id,
    phone: rollback.user.phone,
    cancelCodeId: "missing-code",
  }));
  assert.equal(await prisma.user.count({ where: { id: rollback.user.id, status: "ACTIVE" } }), 1);
  assert.equal(await prisma.note.count({ where: { userId: rollback.user.id } }), 1);
  assert.equal(existsSync(path.join(uploadRoot, rollback.storageKey)), true);

  const retryStorageKey = "retry/private-image.bin";
  await mkdir(path.join(uploadRoot, retryStorageKey), { recursive: true });
  const retryTask = await prisma.accountCancellationFileDeletion.create({
    data: { storageKey: retryStorageKey },
  });
  assert.equal(await drainAccountCancellationFiles([retryTask.id]), 1);
  assert.equal(
    (await prisma.accountCancellationFileDeletion.findUniqueOrThrow({ where: { id: retryTask.id } })).completedAt,
    null,
  );
  await import("node:fs/promises").then(({ rm }) => rm(path.join(uploadRoot, retryStorageKey), { recursive: true }));
  await writeFile(path.join(uploadRoot, retryStorageKey), "retry-image");
  assert.equal(await drainAccountCancellationFiles([retryTask.id]), 0);
  assert.equal(existsSync(path.join(uploadRoot, retryStorageKey)), false);
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { id: retryTask.id } }), 0);

  process.env.ACCOUNT_CANCELLATION_CLEANUP_SECRET = "synthetic-cleanup-secret";
  const { POST: runCleanupEndpoint } = await import(
    "../app/api/internal/account-cancellation-files/route"
  );
  assert.equal((await runCleanupEndpoint(new Request("http://local/internal", { method: "POST" }))).status, 401);
  assert.equal((await runCleanupEndpoint(new Request("http://local/internal", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-cleanup-secret" },
  }))).status, 200);

  const serviceSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../services/auth/accountCancellationService.ts", import.meta.url), "utf8")
  );
  assert.match(serviceSource, /FROM "User" WHERE "id" = \$\{userId\} FOR UPDATE/);

  const race = await createUserFixture("4");
  const raceKeys = Array.from({ length: 8 }, (_, index) => `race-${index}/private-image.bin`);
  await Promise.all(raceKeys.map(async (storageKey) => {
    await mkdir(path.dirname(path.join(uploadRoot, storageKey)), { recursive: true });
    await writeFile(path.join(uploadRoot, storageKey), storageKey);
  }));
  const raceCancellation = cancelAccountData({
    userId: race.user.id,
    phone: race.user.phone,
    cancelCodeId: null,
  }).then((ids) => drainAccountCancellationFiles(ids));
  const lateUploads = raceKeys.map((storageKey, index) => prisma.noteUpload.create({
    data: {
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      userId: race.user.id,
      noteId: race.note.id,
      storageKey,
      mimeType: "image/png",
      size: 8,
      accessTokenHash: `race-access-${index}`,
    },
  }).catch(async () => {
    await import("node:fs/promises").then(({ rm }) => rm(path.join(uploadRoot, storageKey), { force: true }));
  }));
  const lateFeedback = Array.from({ length: 8 }, (_, index) => prisma.feedback.create({
    data: {
      userId: race.user.id,
      type: "race",
      content: `race-feedback-${index}`,
      contact: `race-${index}@private.invalid`,
      userAgent: "race-private-agent",
    },
  }).catch(() => undefined));
  await Promise.all([raceCancellation, ...lateUploads, ...lateFeedback]);
  assert.equal(await prisma.user.count({ where: { id: race.user.id } }), 0);
  assert.equal(await prisma.feedback.count({ where: { content: { startsWith: "race-feedback-" } } }), 0);
  assert.equal(raceKeys.some((storageKey) => existsSync(path.join(uploadRoot, storageKey))), false);

  console.log(JSON.stringify({
    status: "PASS",
    tombstone: "anonymous",
    relatedData: "cascade_deleted",
    feedback: "anonymized",
    privateFiles: "deleted_after_commit",
    rollback: "atomic",
    crossUser: "unchanged",
  }));
} finally {
  await prisma.accountCancellationFileDeletion.deleteMany();
  await prisma.user.deleteMany({ where: { wechatOpenid: { startsWith: "cancel-openid-" } } });
  await prisma.feedback.deleteMany({ where: { content: { startsWith: "feedback-" } } });
  await prisma.$disconnect();
}
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "account_cancellation_check_failed");
  process.exitCode = 1;
});
