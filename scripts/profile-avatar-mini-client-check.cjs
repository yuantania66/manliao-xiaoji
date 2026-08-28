/* eslint-disable @typescript-eslint/no-require-imports -- Mini Program production modules require CommonJS cache mocks. */
const assert = require("node:assert/strict");

const future = new Date(Date.now() + 60_000).toISOString();
let auth = { token: "token-a", expiresAt: future, user: { id: "user-a", nickname: "旧昵称", avatarUrl: "/avatar/a" } };
let pageDefinition;
let uploadCalls = 0;
let updateCalls = [];
let discardCalls = 0;
let cacheCalls = 0;
let cacheShouldFail = false;
let uploadImplementation = () => Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000001" });
let meImplementation = () => Promise.resolve({ user: auth.user });

global.getApp = () => ({ globalData: {} });
global.wx = { redirectTo: () => undefined, login: () => undefined };
global.Page = (definition) => { pageDefinition = definition; };

const authPath = require.resolve("../miniprogram-project/utils/auth");
require.cache[authPath] = { exports: {
  getAuth: () => auth,
  saveAuth: () => undefined,
  updateCachedUser: (expectedId, user) => {
    cacheCalls += 1;
    assert.equal(expectedId, user.id);
    if (cacheShouldFail) throw new Error("injected storage failure");
    auth = { ...auth, user: { ...auth.user, ...user } };
  }
} };

const apiPath = require.resolve("../miniprogram-project/api/auth");
require.cache[apiPath] = { exports: {
  loginWithWechat: () => Promise.reject(new Error("not used")),
  getMe: () => meImplementation(),
  updateMe: (body) => {
    updateCalls.push(body);
    return Promise.resolve({ user: { ...auth.user, ...body, avatarUrl: body.avatarUploadId ? "/avatar/new" : auth.user.avatarUrl } });
  },
  uploadProfileAvatar: (filePath) => {
    uploadCalls += 1;
    assert(filePath.startsWith("wxfile://"));
    return uploadImplementation();
  },
  discardProfileAvatar: () => { discardCalls += 1; return Promise.resolve(); },
  downloadProfileAvatar: (avatarUrl) => Promise.resolve(`downloaded:${avatarUrl}`)
} };

const layoutPath = require.resolve("../miniprogram-project/utils/layout");
require.cache[layoutPath] = { exports: { getSafeLayout: () => ({ pageTop: 92 }) } };
const privacyPath = require.resolve("../miniprogram-project/utils/wechat-privacy");
require.cache[privacyPath] = { exports: {
  requireWechatPrivacyAuthorization: () => Promise.resolve(),
  openWechatPrivacyContract: () => undefined
} };

require("../miniprogram-project/pages/me/me");

const createPage = () => ({
  ...pageDefinition,
  data: { ...pageDefinition.data },
  setData(values) { Object.assign(this.data, values); }
});
const settle = async (rounds = 4) => {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  const page = createPage();
  page.onShow();
  await settle();
  assert.equal(page.data.profileNickname, "旧昵称");
  assert.equal(page.data.avatarPreview, "downloaded:/avatar/a");

  page.editProfile();
  page.chooseAvatar({ detail: {} });
  page.skipProfile();
  assert.equal(uploadCalls, 0, "cancelled chooser and skip must make no upload request");
  assert.equal(updateCalls.length, 0, "skip must make no profile request");

  page.editProfile();
  page.chooseAvatar({ detail: { avatarUrl: "wxfile://avatar-a.jpg" } });
  assert.equal(uploadCalls, 0, "choosing an avatar must only create a local preview");
  cacheShouldFail = true;
  page.inputNickname({ detail: { value: "新昵称" } });
  page.saveProfile();
  await settle();
  assert.equal(uploadCalls, 1);
  assert.deepEqual(updateCalls[0], {
    nickname: "新昵称",
    avatarUploadId: "00000000-0000-4000-8000-000000000001"
  });
  assert.equal(page.data.profileEditing, false);
  assert.equal(page.data.profileNickname, "新昵称");
  assert.match(page.data.loginError, /已保存到云端/u, "storage failure must not be reported as upload failure");
  assert.equal(discardCalls, 0, "committed upload must never be discarded after cache failure");

  cacheShouldFail = false;
  auth = { ...auth, user: { id: "user-a", nickname: "新昵称", avatarUrl: "/avatar/new" } };
  page.editProfile();
  page.inputNickname({ detail: { value: "只改昵称" } });
  page.saveProfile();
  await settle();
  assert.equal(uploadCalls, 1, "nickname-only update must not upload");
  assert.deepEqual(updateCalls[1], { nickname: "只改昵称" });

  const lateUpload = deferred();
  uploadImplementation = () => lateUpload.promise;
  page.editProfile();
  page.chooseAvatar({ detail: { avatarUrl: "wxfile://late-a.jpg" } });
  page.saveProfile();
  assert.equal(uploadCalls, 2);
  auth = { token: "token-b", expiresAt: future, user: { id: "user-b", nickname: "用户 B", avatarUrl: "/avatar/b" } };
  meImplementation = () => Promise.resolve({ user: auth.user });
  page.onShow();
  lateUpload.resolve({ uploadId: "00000000-0000-4000-8000-000000000002" });
  await settle();
  assert.equal(updateCalls.length, 2, "late A upload must not patch B");
  assert.equal(page.data.profileNickname, "用户 B");
  assert.equal(page.data.avatarPreview, "downloaded:/avatar/b");
  assert.equal(auth.user.id, "user-b");
  assert.equal(cacheCalls >= 2, true);

  console.log("Profile avatar Mini Program client checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
