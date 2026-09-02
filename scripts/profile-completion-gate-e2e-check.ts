import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const databaseUrl = process.env.PROFILE_GATE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("PREREQUISITE_FAILED: PROFILE_GATE_TEST_DATABASE_URL is required");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
if (!/(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/iu.test(databaseName)) {
  throw new Error(`PREREQUISITE_FAILED: database must be visibly test-scoped; received ${databaseName}`);
}

const main = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_ENV = "development";
  process.env.ALLOW_WEB_MOCK_LOGIN = "true";
  process.env.SESSION_SECRET = "profile-gate-e2e-test-secret-32-characters";
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "xinqing-profile-gate-"));
  process.env.UPLOAD_DIR = uploadRoot;

  const { prisma } = await import("../lib/prisma");
  const { createSession, hashToken, hashVerificationCode } = await import("../lib/auth");
  const { hashUploadToken } = await import("../app/api/uploads/notes/storage");
  const profileMe = await import("../app/api/auth/me/route");
  const profileUpload = await import("../app/api/uploads/profile-avatar/route");
  const profileRead = await import("../app/api/uploads/profile-avatar/[uploadId]/route");
  const profileAbandon = await import("../app/api/auth/profile-abandon/route");
  const logout = await import("../app/api/auth/logout/route");
  const phoneLogin = await import("../app/api/auth/phone/route");
  const wechatLogin = await import("../app/api/auth/wechat/route");
  const events = await import("../app/api/events/route");
  const { VerificationScene } = await import("@prisma/client");

  type JsonResult = {
    status: number;
    body: { data?: unknown; error?: { details?: Record<string, unknown> } };
  };
  const jsonResult = async (response: Response): Promise<JsonResult> => ({
    status: response.status,
    body: await response.json() as JsonResult["body"],
  });
  const dataOf = <T>(result: JsonResult) => result.body.data as T;
  const request = (url: string, method: string, token?: string, body?: unknown) => new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const patchMe = (token: string, body: unknown) =>
    profileMe.PATCH(request("http://localhost/api/auth/me", "PATCH", token, body) as never).then(jsonResult);
  const getMe = (token: string) =>
    profileMe.GET(request("http://localhost/api/auth/me", "GET", token) as never).then(jsonResult);
  const ordinary = (token: string) => events.GET(request(
    "http://localhost/api/events?date=2026-08-31", "GET", token,
  ) as never).then(jsonResult);
  const uploadAvatar = async (token: string, bytes: Buffer) => {
    const form = new FormData();
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.set("file", new File([source], "avatar.png", { type: "image/png" }));
    return jsonResult(await profileUpload.POST(new Request("http://localhost/api/uploads/profile-avatar", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }) as never));
  };

  const fixtureIds: string[] = [];
  const phone = "13800000991";
  try {
    const code = "246810";
    await prisma.verificationCode.create({
      data: {
        phone,
        scene: VerificationScene.LOGIN,
        codeHash: hashVerificationCode({ phone, scene: VerificationScene.LOGIN, code }),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const phoneResult = await phoneLogin.POST(request(
      "http://localhost/api/auth/phone", "POST", undefined, { phone, code },
    ));
    const phoneAuth = await jsonResult(phoneResult);
    assert.equal(phoneAuth.status, 200, JSON.stringify(phoneAuth.body));
    const phoneData = dataOf<{ user: { id: string; isProvisional: boolean }; token: string }>(phoneAuth);
    const incompleteId = phoneData.user.id;
    const incompleteToken = phoneData.token;
    fixtureIds.push(incompleteId);
    assert.equal(phoneData.user.isProvisional, false, "successful login must create a durable registered account");

    assert.equal((await ordinary(incompleteToken)).status, 200, "optional profile must not block ordinary business");
    assert.equal((await getMe(incompleteToken)).status, 200, "profile completion endpoint must remain available");
    assert.equal((await patchMe(incompleteToken, { nickname: "晴" })).status, 400, "one-character nickname must fail");
    assert.equal((await patchMe(incompleteToken, { nickname: "ABCDEFGHIJKLM" })).status, 400, "13-character nickname must fail");
    assert.equal((await patchMe(incompleteToken, { nickname: "小满" })).status, 200, "two-character nickname must pass");
    assert.equal((await patchMe(incompleteToken, { nickname: "ABCDEFGHIJKL" })).status, 200, "12-character nickname must pass");

    const png = await sharp({
      create: { width: 128, height: 128, channels: 4, background: "#71877b" },
    }).png().toBuffer();
    const uploaded = await uploadAvatar(incompleteToken, png);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    const uploadId = dataOf<{ uploadId: string }>(uploaded).uploadId;
    const completed = await patchMe(incompleteToken, { avatarUploadId: uploadId });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    const completedData = dataOf<{ user: { isProvisional: boolean; profileCompletedAt: string | null } }>(completed);
    assert.equal(completedData.user.isProvisional, false);
    assert(completedData.user.profileCompletedAt);
    assert.equal((await ordinary(incompleteToken)).status, 200, "ordinary business must open after profile completion");
    assert.equal((await profileRead.GET(
      request(`http://localhost/api/uploads/profile-avatar/${uploadId}`, "GET", incompleteToken) as never,
      { params: Promise.resolve({ uploadId }) },
    )).status, 200, "bound avatar read must remain available");

    const wechatCode = "profile-gate-wechat-new";
    const wechatAuth = await jsonResult(await wechatLogin.POST(request(
      "http://localhost/api/auth/wechat", "POST", undefined, { code: wechatCode },
    )));
    assert.equal(wechatAuth.status, 200, JSON.stringify(wechatAuth.body));
    const wechatData = dataOf<{ user: { id: string; isProvisional: boolean } }>(wechatAuth);
    fixtureIds.push(wechatData.user.id);
    assert.equal(wechatData.user.isProvisional, false, "new WeChat login must count as a durable registration");

    const discardUser = await prisma.user.create({ data: { phone: "13800000992", isProvisional: true } });
    fixtureIds.push(discardUser.id);
    const discardToken = (await createSession(discardUser.id)).token;
    const readableId = "00000000-0000-4000-8000-000000000992";
    const readableStorageKey = `${discardUser.id}/profile/${readableId}.webp`;
    await mkdir(path.dirname(path.join(uploadRoot, readableStorageKey)), { recursive: true });
    await writeFile(path.join(uploadRoot, readableStorageKey), png);
    await prisma.noteUpload.create({
      data: {
        id: readableId,
        userId: discardUser.id,
        storageKey: readableStorageKey,
        mimeType: "image/webp",
        size: png.length,
        accessTokenHash: hashUploadToken("readable-profile-avatar"),
        purpose: "PROFILE_AVATAR",
        boundAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: discardUser.id },
      data: { avatarUrl: `/api/uploads/profile-avatar/${readableId}` },
    });
    assert.equal((await profileRead.GET(
      request(`http://localhost/api/uploads/profile-avatar/${readableId}`, "GET", discardToken) as never,
      { params: Promise.resolve({ uploadId: readableId }) },
    )).status, 200, "bound avatar read must remain available while profile is incomplete");
    const discardUpload = await uploadAvatar(discardToken, png);
    const discardId = dataOf<{ uploadId: string }>(discardUpload).uploadId;
    const discarded = await profileUpload.DELETE(request(
      "http://localhost/api/uploads/profile-avatar", "DELETE", discardToken, { uploadId: discardId },
    ) as never);
    assert.equal(discarded.status, 200, "unbound avatar deletion must remain available");
    assert.equal(await prisma.noteUpload.count({ where: { id: discardId } }), 0);

    const oldIncomplete = await prisma.user.create({ data: { phone: "13800000993", isProvisional: false } });
    fixtureIds.push(oldIncomplete.id);
    const oldSessionA = await createSession(oldIncomplete.id);
    const oldSessionB = await createSession(oldIncomplete.id);
    const oldAbandon = await jsonResult(await profileAbandon.POST(request(
      "http://localhost/api/auth/profile-abandon", "POST", oldSessionA.token,
    ) as never));
    assert.equal(oldAbandon.status, 200);
    assert.equal(dataOf<{ accountRemoved: boolean }>(oldAbandon).accountRemoved, false);
    assert.equal(await prisma.user.count({ where: { id: oldIncomplete.id } }), 1);
    assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(oldSessionA.token) } }), 0);
    assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(oldSessionB.token) } }), 1);
    assert.equal((await ordinary(oldSessionB.token)).status, 200, "legacy incomplete durable users must remain usable");

    const completeUser = await prisma.user.create({
      data: {
        phone: "13800000994",
        nickname: "完整用户",
        avatarUrl: "/avatar/complete",
        profileCompletedAt: new Date(),
        isProvisional: false,
      },
    });
    fixtureIds.push(completeUser.id);
    const completeSessionA = await createSession(completeUser.id);
    const completeSessionB = await createSession(completeUser.id);
    const completeAbandon = await jsonResult(await profileAbandon.POST(request(
      "http://localhost/api/auth/profile-abandon", "POST", completeSessionA.token,
    ) as never));
    assert.equal(completeAbandon.status, 200);
    assert.equal(dataOf<{ accountRemoved: boolean }>(completeAbandon).accountRemoved, false);
    assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(completeSessionA.token) } }), 0);
    assert.equal((await ordinary(completeSessionB.token)).status, 200);

    const provisional = await prisma.user.create({ data: { phone: "13800000995", isProvisional: true } });
    fixtureIds.push(provisional.id);
    const provisionalSessionA = await createSession(provisional.id);
    await createSession(provisional.id);
    const storageKey = `${provisional.id}/profile/abandoned.webp`;
    await mkdir(path.dirname(path.join(uploadRoot, storageKey)), { recursive: true });
    await writeFile(path.join(uploadRoot, storageKey), png);
    await prisma.noteUpload.create({
      data: {
        id: "00000000-0000-4000-8000-000000000991",
        userId: provisional.id,
        storageKey,
        mimeType: "image/webp",
        size: png.length,
        accessTokenHash: hashUploadToken("profile-gate-upload"),
        purpose: "PROFILE_AVATAR",
      },
    });
    const feedback = await prisma.feedback.create({
      data: { userId: provisional.id, type: "其他", content: "provisional feedback" },
    });
    const removed = await jsonResult(await profileAbandon.POST(request(
      "http://localhost/api/auth/profile-abandon", "POST", provisionalSessionA.token,
    ) as never));
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(dataOf<{ accountRemoved: boolean }>(removed).accountRemoved, true);
    assert.equal(await prisma.user.count({ where: { id: provisional.id } }), 0);
    assert.equal(await prisma.session.count({ where: { userId: provisional.id } }), 0);
    assert.equal(await prisma.noteUpload.count({ where: { userId: provisional.id } }), 0);
    assert.equal(await prisma.feedback.count({ where: { id: feedback.id } }), 0);
    await assert.rejects(access(path.join(uploadRoot, storageKey)));

    const logoutUser = await prisma.user.create({ data: { phone: "13800000996", isProvisional: false } });
    fixtureIds.push(logoutUser.id);
    const logoutSession = await createSession(logoutUser.id);
    assert.equal((await logout.POST(request(
      "http://localhost/api/auth/logout", "POST", logoutSession.token, {},
    ) as never)).status, 200, "logout must remain available to incomplete users");
    assert.equal(await prisma.user.count({ where: { id: logoutUser.id } }), 1);
    assert.equal(await prisma.session.count({ where: { tokenHash: hashToken(logoutSession.token) } }), 0);

    console.log("Optional profile and registration end-to-end checks passed.");
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: fixtureIds } } }).catch(() => undefined);
    await prisma.verificationCode.deleteMany({ where: { phone } }).catch(() => undefined);
    await prisma.accountCancellationFileDeletion.deleteMany({
      where: { storageKey: { contains: "profile-gate" } },
    }).catch(() => undefined);
    await prisma.$disconnect();
    await rm(uploadRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
