/* eslint-disable @typescript-eslint/no-require-imports -- Mini Program production modules require CommonJS cache mocks. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const meWxml = readFileSync(require.resolve("../miniprogram-project/pages/me/me.wxml"), "utf8");
const meWxss = readFileSync(require.resolve("../miniprogram-project/pages/me/me.wxss"), "utf8");
assert.match(meWxml, /profile-editor-layer[^>]*role="dialog"/u);
assert.match(meWxml, /profile-avatar-preview/u);
assert.ok(meWxml.includes('wx:if="{{isLoggedIn && profileEditing}}" class="profile-editor-layer"'));
assert.doesNotMatch(meWxml, /profile-editor-mask/u);
assert.doesNotMatch(meWxss, /profile-editor-mask/u);
assert.match(meWxml, /class="profile-avatar-button"[^>]*bindtap="chooseProfileAvatarFromMedia"/u);
assert.doesNotMatch(meWxml, /open-type="chooseAvatar"/u);
assert.match(meWxml, /class="profile-nickname-input"[^>]*type="text"[^>]*bindinput="inputNickname"/u);
assert.doesNotMatch(meWxml, /type="nickname"/u);
assert.match(meWxml, /bindtap="saveProfile"[^>]*>保存<\/button>/u);
assert.ok(meWxml.includes('wx:if="{{profileRequired}}" class="secondary-button" bindtap="exitRequiredProfile"'));
assert.match(meWxml, /wx:else[^>]*bindtap="skipProfile"[^>]*>取消<\/button>/u);

const future = new Date(Date.now() + 60_000).toISOString();
let auth = { token: "token-a", expiresAt: future, user: { id: "user-a", nickname: "旧昵称", avatarUrl: "/avatar/a" } };
let pageDefinition;
let uploadCalls = 0;
let updateCalls = [];
let discardCalls = 0;
let discardTokens = [];
let cacheCalls = 0;
let cacheShouldFail = false;
let chooseImageCalls = 0;
const redirectUrls = [];
let chooseImageImplementation = (options) => options.fail({ errMsg: "chooseImage:fail cancel" });
let uploadImplementation = () => Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000001" });
let meImplementation = () => Promise.resolve({ user: auth.user });
let updateImplementation = (body) => Promise.resolve({
  user: { ...auth.user, ...body, avatarUrl: body.avatarUploadId ? "/avatar/new" : auth.user.avatarUrl }
});

global.getApp = () => ({ globalData: {} });
global.wx = {
  redirectTo: ({ url }) => { redirectUrls.push(url); },
  login: () => undefined,
  showToast: () => undefined,
  chooseImage: (options) => {
    chooseImageCalls += 1;
    assert.deepEqual(options.count, 1);
    assert.deepEqual(options.sizeType, ["compressed"]);
    assert.deepEqual(options.sourceType, ["album", "camera"]);
    chooseImageImplementation(options);
  }
};
global.Page = (definition) => { pageDefinition = definition; };

const authPath = require.resolve("../miniprogram-project/utils/auth");
require.cache[authPath] = { exports: {
  clearAuth: () => { auth = null; },
  getAuth: () => auth,
  getGuestProfile: () => null,
  isGuest: () => false,
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
    return updateImplementation(body);
  },
  uploadProfileAvatar: (filePath) => {
    uploadCalls += 1;
    assert(filePath.startsWith("wxfile://"));
    return uploadImplementation();
  },
  discardProfileAvatar: (_uploadId, capturedToken) => {
    discardCalls += 1;
    discardTokens.push(capturedToken);
    return Promise.resolve();
  },
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
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const selectAvatar = (page, filePath) => {
  chooseImageImplementation = (options) => options.success({ tempFilePaths: [filePath] });
  page.chooseProfileAvatarFromMedia();
};

(async () => {
  const page = createPage();
  page.onShow();
  await settle();
  assert.equal(page.data.profileNickname, "旧昵称");
  assert.equal(page.data.avatarPreview, "downloaded:/avatar/a");
  assert.equal(page.data.profileRequired, false);

  page.editProfile();
  const authBeforeGuards = auth;
  auth = null;
  page.chooseProfileAvatarFromMedia();
  assert.equal(chooseImageCalls, 0, "logged-out users must not open the image chooser");
  auth = authBeforeGuards;
  page.setData({ isSavingProfile: true });
  page.chooseProfileAvatarFromMedia();
  assert.equal(chooseImageCalls, 0, "saving must lock the image chooser");
  page.setData({ isSavingProfile: false });

  page.setData({ loginError: "" });
  const avatarBeforeCancel = page.data.avatarPreview;
  page.chooseProfileAvatarFromMedia();
  assert.equal(chooseImageCalls, 1, "cancel must still open the image chooser once");
  assert.equal(page.data.loginError, "", "cancelling image selection must not show an error");
  assert.equal(page.data.avatarPreview, avatarBeforeCancel, "cancelling image selection must preserve the current avatar");
  assert.equal(page.data.avatarLocalPath, "", "cancelling image selection must not create an avatar draft");

  chooseImageImplementation = (options) => options.fail({ errMsg: "chooseImage:fail unavailable" });
  page.chooseProfileAvatarFromMedia();
  assert.equal(page.data.loginError, "头像选择失败，请稍后重试。");

  selectAvatar(page, "wxfile://resume-picked.jpg");
  page.inputNickname({ detail: { value: "恢复后保留" } });
  page.onShow();
  await settle();
  assert.equal(page.data.avatarLocalPath, "wxfile://resume-picked.jpg", "returning from the native chooser must preserve the selected avatar");
  assert.equal(page.data.avatarPreview, "wxfile://resume-picked.jpg", "late cloud avatar download must not replace the local preview");
  assert.equal(page.data.profileNickname, "恢复后保留", "returning from the native chooser must preserve the nickname draft");
  page.skipProfile();
  assert.equal(page.data.profileEditing, false, "skip must close the profile sheet");
  assert.equal(page.data.isSavingProfile, false, "skip must leave the page interactive");
  assert.equal(uploadCalls, 0, "cancelled chooser and skip must make no upload request");
  assert.equal(updateCalls.length, 0, "skip must make no profile request");

  page.editProfile();
  selectAvatar(page, "wxfile://avatar-a.jpg");
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
  selectAvatar(page, "wxfile://late-a.jpg");
  page.saveProfile();
  assert.equal(uploadCalls, 2);
  auth = { token: "token-b", expiresAt: future, user: { id: "user-b", nickname: "用户 B", avatarUrl: "/avatar/b" } };
  meImplementation = () => Promise.resolve({ user: auth.user });
  page.onShow();
  assert.equal(page.data.profileEditing, false, "switching users must close A's profile sheet");
  assert.equal(page.data.isSavingProfile, false, "switching users must release A's saving lock");
  assert.equal(page.data.avatarLocalPath, "");
  lateUpload.resolve({ uploadId: "00000000-0000-4000-8000-000000000002" });
  await settle();
  assert.equal(updateCalls.length, 2, "late A upload must not patch B");
  assert.equal(discardCalls, 1, "late unbound A upload must be discarded");
  assert.deepEqual(discardTokens, ["token-a"], "late cleanup must use A's captured token");
  assert.equal(page.data.profileNickname, "用户 B");
  assert.equal(page.data.avatarPreview, "downloaded:/avatar/b");
  assert.equal(auth.user.id, "user-b");
  assert.equal(cacheCalls >= 2, true);

  auth = { token: "token-patch-a", expiresAt: future, user: { id: "patch-a", nickname: "A", avatarUrl: null } };
  meImplementation = () => Promise.resolve({ user: auth.user });
  uploadImplementation = () => Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000004" });
  const pendingPatch = deferred();
  updateImplementation = () => pendingPatch.promise;
  page.onShow();
  await settle();
  page.editProfile();
  selectAvatar(page, "wxfile://patch-pending.jpg");
  page.saveProfile();
  await settle(1);
  auth = { token: "token-patch-b", expiresAt: future, user: { id: "patch-b", nickname: "B", avatarUrl: null } };
  page.onShow();
  pendingPatch.reject(new Error("patch rejected"));
  await settle();
  assert.equal(discardCalls, 2, "rejected pending PATCH must discard its unbound upload");
  assert.equal(discardTokens.at(-1), "token-patch-a");
  assert.equal(auth.user.id, "patch-b");

  auth = { token: "token-c", expiresAt: future, user: { id: "user-c", nickname: null, avatarUrl: null } };
  meImplementation = () => Promise.resolve({ user: auth.user });
  const redirectsBeforeRequiredProfile = redirectUrls.length;
  page.onShow();
  await settle();
  assert.deepEqual(
    redirectUrls.slice(redirectsBeforeRequiredProfile),
    ["/pages/auth/auth"],
    "missing profile must be handed to the unified required-profile flow"
  );
  assert.equal(page.data.profileRequired, false);
  assert.equal(page.data.profileEditing, false);

  auth = { ...auth, user: { ...auth.user, nickname: "新用户", avatarUrl: "/avatar/new-c" } };
  page.editProfile();
  const updatesBeforeNoop = updateCalls.length;
  page.saveProfile();
  assert.equal(updateCalls.length, updatesBeforeNoop);
  assert.match(page.data.loginError, /没有变化|取消/u, "complete profile no-op must explain that editing can be cancelled");

  page.skipProfile();
  assert.equal(page.data.profileEditing, false, "complete profile editing must remain cancellable");

  auth = { token: "token-required-exit", expiresAt: future, user: { id: "required-exit", nickname: null, avatarUrl: null } };
  meImplementation = () => Promise.resolve({ user: auth.user });
  const redirectsBeforeRequiredExit = redirectUrls.length;
  page.onShow();
  assert.deepEqual(redirectUrls.slice(redirectsBeforeRequiredExit), ["/pages/auth/auth"]);
  assert.equal(auth.user.id, "required-exit", "the unified auth page owns explicit abandonment");
  assert.equal(page.data.isLoggedIn, false);
  assert.equal(page.data.profileEditing, false);
  assert.equal(page.data.profileRequired, false);

  console.log("Profile avatar Mini Program client checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
