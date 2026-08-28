import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const databaseUrl = process.env.PROFILE_AVATAR_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("PREREQUISITE_FAILED: PROFILE_AVATAR_TEST_DATABASE_URL is required");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
if (!/(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/iu.test(databaseName)) {
  throw new Error(`PREREQUISITE_FAILED: database must be visibly test-scoped; received ${databaseName}`);
}

const main = async () => {
process.env.DATABASE_URL = databaseUrl;
process.env.APP_ENV = "development";
process.env.SESSION_SECRET = "profile-avatar-e2e-test-secret-32-characters";
const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "xinqing-profile-avatar-"));
process.env.UPLOAD_DIR = uploadRoot;

const { prisma } = await import("../lib/prisma");
const { createSession } = await import("../lib/auth");
const { hashUploadToken } = await import("../app/api/uploads/notes/storage");
const { drainPendingAccountCancellationFiles } = await import("../services/auth/accountCancellationService");
const profileUpload = await import("../app/api/uploads/profile-avatar/route");
const profileRead = await import("../app/api/uploads/profile-avatar/[uploadId]/route");
const profileMe = await import("../app/api/auth/me/route");
const { POST: cancelAccount } = await import("../app/api/auth/cancel/route");

type JsonResult = { status: number; body: Record<string, unknown> };
const jsonResult = async (response: Response): Promise<JsonResult> => ({
  status: response.status,
  body: await response.json() as Record<string, unknown>,
});
const dataOf = <T>(result: JsonResult) => result.body.data as T;

const jsonRequest = (url: string, method: string, token: string | null, body: unknown) => new Request(url, {
  method,
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

const invokePatch = (token: string | null, body: unknown) =>
  profileMe.PATCH(jsonRequest("http://localhost/api/auth/me", "PATCH", token, body) as never).then(jsonResult);

const invokeDiscard = (token: string | null, uploadId: string) =>
  profileUpload.DELETE(jsonRequest("http://localhost/api/uploads/profile-avatar", "DELETE", token, { uploadId }) as never).then(jsonResult);

const invokeRead = (token: string | null, uploadId: string) => profileRead.GET(
  new Request(`http://localhost/api/uploads/profile-avatar/${uploadId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as never,
  { params: Promise.resolve({ uploadId }) },
);

const uploadFile = async (token: string | null, bytes: Buffer, mimeType: string, name = "private-fixture") => {
  const form = new FormData();
  const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set("file", new File([fileBytes], name, { type: mimeType }));
  const response = await profileUpload.POST(new Request("http://localhost/api/uploads/profile-avatar", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  }) as never);
  return jsonResult(response);
};

const fixtureIds: string[] = [];
try {
  const userA = await prisma.user.create({ data: { nickname: "原昵称" } });
  const userB = await prisma.user.create({ data: { nickname: "用户 B" } });
  fixtureIds.push(userA.id, userB.id);
  const tokenA = (await createSession(userA.id)).token;
  const tokenB = (await createSession(userB.id)).token;

  const jpegWithMetadata = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#71877b" },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const png = await sharp({
    create: { width: 300, height: 300, channels: 4, background: "#d7e2dc" },
  }).png().toBuffer();

  assert.equal((await uploadFile(null, jpegWithMetadata, "image/jpeg")).status, 401);
  assert.equal((await invokePatch(null, { nickname: "匿名" })).status, 401);

  const uploaded = await uploadFile(tokenA, jpegWithMetadata, "image/jpeg", "must-not-be-returned.jpg");
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.deepEqual(Object.keys(dataOf<Record<string, unknown>>(uploaded)).sort(), ["uploadId"]);
  const firstId = dataOf<{ uploadId: string }>(uploaded).uploadId;
  const first = await prisma.noteUpload.findUniqueOrThrow({ where: { id: firstId } });
  assert.equal(first.userId, userA.id);
  assert.equal(first.purpose, "PROFILE_AVATAR");
  assert.equal(first.boundAt, null);
  assert(!first.storageKey.includes("must-not-be-returned"));
  assert(!path.resolve(uploadRoot, first.storageKey).startsWith(path.resolve(process.cwd(), "public")));
  assert.equal((await invokeRead(tokenA, firstId)).status, 404, "unbound avatar must not be readable");

  const storedMetadata = await sharp(await readFile(path.join(uploadRoot, first.storageKey))).metadata();
  assert.equal(storedMetadata.format, "webp");
  assert.equal(storedMetadata.width, 512);
  assert.equal(storedMetadata.height, 512);
  assert.equal(storedMetadata.pages ?? 1, 1);
  assert.equal(storedMetadata.exif, undefined, "output must strip EXIF metadata");

  assert.equal((await uploadFile(tokenA, Buffer.from("not an image"), "image/jpeg")).status, 400);
  assert.equal((await uploadFile(tokenA, png, "image/jpeg")).status, 400, "declared MIME must match decoded format");
  assert.equal((await uploadFile(tokenA, Buffer.from("<svg/>"), "image/svg+xml")).status, 400);
  assert.equal((await uploadFile(tokenA, Buffer.from("GIF89a"), "image/gif")).status, 400);
  assert.equal((await invokePatch(tokenA, { avatarUrl: "https://attacker.invalid/avatar" })).status, 400);
  assert.equal((await invokePatch(tokenA, { nickname: "bad\nname" })).status, 400);
  assert.equal((await invokePatch(tokenA, { nickname: "\u202Eevil" })).status, 400);

  const nicknameOnly = await invokePatch(tokenA, { nickname: "新昵称🙂" });
  assert.equal(nicknameOnly.status, 200);
  assert.equal(dataOf<{ user: { nickname: string } }>(nicknameOnly).user.nickname, "新昵称🙂");
  assert.equal(dataOf<{ user: { avatarUrl: string | null } }>(nicknameOnly).user.avatarUrl, null);
  assert.equal((await invokePatch(tokenB, { avatarUploadId: firstId })).status, 404);

  const noteUploadId = randomUUID();
  const noteStorageKey = `${userA.id}/${noteUploadId}.png`;
  await writeFile(path.join(uploadRoot, noteStorageKey), png);
  await prisma.noteUpload.create({
    data: {
      id: noteUploadId,
      userId: userA.id,
      storageKey: noteStorageKey,
      mimeType: "image/png",
      size: png.length,
      accessTokenHash: hashUploadToken(randomBytes(32).toString("base64url")),
      purpose: "NOTE_MEDIA",
    },
  });
  assert.equal((await invokePatch(tokenA, { avatarUploadId: noteUploadId })).status, 404);

  const bound = await invokePatch(tokenA, { avatarUploadId: firstId });
  assert.equal(bound.status, 200, JSON.stringify(bound.body));
  assert.equal(dataOf<{ user: { nickname: string } }>(bound).user.nickname, "新昵称🙂", "avatar-only update must preserve nickname");
  assert.equal((await invokeRead(tokenA, firstId)).status, 200);
  assert.equal((await invokeRead(tokenB, firstId)).status, 404);
  assert.equal((await invokeRead(null, firstId)).status, 401);
  assert.equal((await invokePatch(tokenA, { avatarUploadId: firstId })).status, 404, "bound upload cannot be replayed");

  const rollbackUpload = await uploadFile(tokenA, png, "image/png");
  const rollbackId = dataOf<{ uploadId: string }>(rollbackUpload).uploadId;
  process.env.PROFILE_AVATAR_TEST_FAIL_TRANSACTION_ONCE = "1";
  assert.equal((await invokePatch(tokenA, { nickname: "不得提交", avatarUploadId: rollbackId })).status, 500);
  const afterRollback = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
  assert.equal(afterRollback.nickname, "新昵称🙂");
  assert.equal(afterRollback.avatarUrl, `/api/uploads/profile-avatar/${firstId}`);
  assert.equal((await invokeRead(tokenA, rollbackId)).status, 404);
  assert.equal((await invokeDiscard(tokenA, rollbackId)).status, 200);
  assert.equal(await prisma.noteUpload.count({ where: { id: rollbackId } }), 0);

  const pendingUpload = await uploadFile(tokenA, png, "image/png");
  const pendingId = dataOf<{ uploadId: string }>(pendingUpload).uploadId;
  process.env.PROFILE_AVATAR_TEST_FAIL_FILE_DELETE_ONCE = "1";
  const pendingSwap = await invokePatch(tokenA, { avatarUploadId: pendingId });
  assert.equal(pendingSwap.status, 200);
  assert.equal(dataOf<{ fileCleanup: string }>(pendingSwap).fileCleanup, "pending");
  assert.equal((await invokeRead(tokenA, firstId)).status, 404, "old avatar must be revoked at commit");
  assert.equal((await invokeRead(tokenA, pendingId)).status, 200);
  assert.equal(await prisma.accountCancellationFileDeletion.count({ where: { storageKey: first.storageKey } }), 1);
  assert.equal((await drainPendingAccountCancellationFiles()).pending, 0);
  await assert.rejects(access(path.join(uploadRoot, first.storageKey)));

  const concurrentA = dataOf<{ uploadId: string }>(await uploadFile(tokenA, png, "image/png")).uploadId;
  const concurrentB = dataOf<{ uploadId: string }>(await uploadFile(tokenA, jpegWithMetadata, "image/jpeg")).uploadId;
  const concurrentResults = await Promise.all([
    invokePatch(tokenA, { avatarUploadId: concurrentA }),
    invokePatch(tokenA, { avatarUploadId: concurrentB }),
  ]);
  assert(concurrentResults.every((result) => result.status === 200), JSON.stringify(concurrentResults));
  const finalUser = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
  const finalId = finalUser.avatarUrl?.split("/").pop();
  assert(finalId === concurrentA || finalId === concurrentB);
  assert.equal(await prisma.noteUpload.count({
    where: { userId: userA.id, purpose: "PROFILE_AVATAR", boundAt: { not: null } },
  }), 1, "concurrent replacements must leave exactly one current avatar");
  assert.equal((await invokeRead(tokenA, finalId!)).status, 200);

  const cancelCode = `profile-cancel-${randomUUID()}`;
  const cancelOpenid = `mock_${createHash("sha256").update(cancelCode).digest("hex").slice(0, 28)}`;
  await prisma.user.update({ where: { id: userA.id }, data: { wechatOpenid: cancelOpenid } });
  const cancelResponse = await cancelAccount(jsonRequest(
    "http://localhost/api/auth/cancel",
    "POST",
    tokenA,
    { wechatCode: cancelCode },
  ) as never);
  assert.equal(cancelResponse.status, 200);
  assert.equal(await prisma.user.count({ where: { id: userA.id } }), 0);
  assert.equal((await invokeRead(tokenA, finalId!)).status, 401);
  assert.equal((await invokeRead(tokenB, finalId!)).status, 404);
  assert.equal(await prisma.user.count({ where: { id: userB.id } }), 1);

  console.log("Profile avatar end-to-end checks passed.");
} finally {
  await prisma.user.deleteMany({ where: { id: { in: fixtureIds } } }).catch(() => undefined);
  await prisma.accountCancellationFileDeletion.deleteMany({
    where: { storageKey: { startsWith: fixtureIds[0] ? `${fixtureIds[0]}/` : "never/" } },
  }).catch(() => undefined);
  await prisma.$disconnect();
  await rm(uploadRoot, { recursive: true, force: true });
}
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
