/* eslint-disable @typescript-eslint/no-require-imports -- Mini Program production modules use CommonJS. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const wxml = readFileSync(require.resolve("../miniprogram-project/pages/auth/auth.wxml"), "utf8");
const wxss = readFileSync(require.resolve("../miniprogram-project/pages/auth/auth.wxss"), "utf8");
const meWxml = readFileSync(require.resolve("../miniprogram-project/pages/me/me.wxml"), "utf8");
const settingsWxml = readFileSync(require.resolve("../miniprogram-project/pages/settings/settings.wxml"), "utf8");
const { getAvatarStyle, getGeneratedIdentity, getIdentityAt } = require("../miniprogram-project/utils/generated-identity.js");
for (const label of ["微信登录", "微信绑定手机号码登录", "游客模式", "微信绑定号码", "返回登录方式"]) assert.ok(wxml.includes(label));
assert.doesNotMatch(wxml, /bindtap="showPhoneMethods"/u);
assert.doesNotMatch(wxml, /bindtap="showSms"/u);
assert.match(wxml, /open-type="getPhoneNumber"[^>]*bindgetphonenumber="handleWechatPhone"/u);
assert.match(wxml, /open-type="chooseAvatar"[^>]*bindchooseavatar="chooseWechatAvatar"/u);
assert.match(wxml, /<view class="profile-row"><text>头像<\/text><button class="profile-avatar-choice"[^>]*bindtap="showAvatarSources"/u);
assert.match(wxml, /<view class="profile-row nickname-row"><text>昵称<\/text><input/u);
assert.match(wxss, /\.profile-row\{[^}]*align-items:center[^}]*justify-content:space-between[^}]*width:100%/u);
assert.match(wxss, /\.profile-avatar-choice\{[^}]*width:54px[^}]*height:54px[^}]*margin:0[^}]*padding:0/u);
assert.match(wxml, /type="nickname"[^>]*maxlength="12"/u);
assert.match(wxml, /bindtap="chooseAlbum"/u);
assert.match(wxml, /bindtap="takePhoto"/u);
assert.match(wxml, /《隐私政策》/u);
assert.doesNotMatch(wxml, /用户协议/u);
assert.match(wxml, /class="auth-background"[^>]*mode="widthFix"[^>]*backgroundInsetTop/u);
assert.match(wxml, /class="auth-screen"[^>]*backgroundTopColor/u);
assert.match(wxml, /class="auth-background-blend"[^>]*backgroundInsetTop[^>]*backgroundBlend/u);
assert.match(wxml, /稍后再说不影响登录/u);
assert.match(wxml, /bindtap="cancelProfileEdit"[^>]*>稍后再说<\/button>/u);
assert.doesNotMatch(wxml, /放弃登录/u);
assert.doesNotMatch(wxml, /头像 \*|昵称 \*/u);
assert.match(wxss, /\.auth-mask\s*\{\s*background:\s*transparent\s*;?\s*\}/u);
assert.match(wxss, /\.auth-background\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/u);
assert.match(wxss, /\.auth-background-blend\s*\{[^}]*height:\s*28px[^}]*pointer-events:\s*none/u);
assert.match(wxss, /\.choice-sheet \.action\s*\{[^}]*align-self:\s*stretch[^}]*width:\s*auto[^}]*flex:\s*none[^}]*\}/u);
assert.match(wxss, /\.wechat-phone-sheet>\.bound-phone,\.guest-warn-sheet>\.action,\.guest-identity-sheet>\.action\s*\{[^}]*width:\s*auto[^}]*margin-left:\s*0[^}]*margin-right:\s*0[^}]*\}/u);
assert.match(wxml, /consentInvalid[^\n]*consentShake/u);
assert.match(wxss, /\.consent-invalid[^}]*#a95f55/u);
assert.match(wxss, /@keyframes consent-shake/u);
assert.match(wxss, /\.guest\{[^}]*align-self:stretch[^}]*width:auto[^}]*margin:-2px 0 0[^}]*text-align:center/u);
assert.match(wxml, /名字和头像已随机生成。[^\n]*bindtap="randomizeGuest"[^>]*>重新生成/u);
assert.match(wxml, /class="guest-avatar-choice"[^>]*bindtap="cycleGuestAvatar"/u);
assert.match(wxml, /class="guest-profile-row guest-nickname-row"[^\n]*bindinput="inputGuestNickname"/u);
assert.doesNotMatch(wxss, /\.guest-change\{[^}]*position:absolute/u);
for (const markup of [meWxml, settingsWxml]) {
  assert.match(markup, /wx:if="\{\{(?:!isLoggedIn|dataMode === 'guest')\}\}"[^>]*url="\/pages\/auth\/auth\?mode=login"[^>]*>登录或注册/u);
}
assert.deepEqual(getGeneratedIdentity("same-user"), getGeneratedIdentity("same-user"));
assert.match(getAvatarStyle(999), /linear-gradient/u);
assert.equal(getIdentityAt(-1, -1).nickname.length > 0, true);

const future = new Date(Date.now() + 60000).toISOString();
let storedAuth = null;
let guest = false;
let guestProfile = null;
let pageDefinition;
let redirected = "";
let sendCalls = 0;
let loginCalls = 0;
let wechatLoginCalls = 0;
let wechatPhoneCalls = 0;
let uploadCalls = 0;
let uploadImpl = () => Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000001" });
let updateBody = null;
let nextAuth = null;
let updateCalls = 0;
let abandonCalls = 0;
let abandonImpl = () => Promise.resolve({ accountRemoved: true });

global.getApp = () => ({ globalData: {} });
global.wx = {
  navigateTo: () => undefined,
  redirectTo: ({ url }) => { redirected = url; },
  chooseImage: () => undefined,
  getSystemInfoSync: () => ({ windowWidth: 390, statusBarHeight: 47 }),
  getMenuButtonBoundingClientRect: () => ({ bottom: 88 })
};
global.Page = (definition) => { pageDefinition = definition; };
require.cache[require.resolve("../miniprogram-project/api/auth.js")] = { exports: {
  abandonProfileSession: (token) => { abandonCalls += 1; assert.ok(token); return abandonImpl(); },
  loginWithPhone: ({ phone }) => { loginCalls += 1; assert.equal(phone, "13800000000"); return Promise.resolve(nextAuth); },
  sendCode: ({ phone }) => { sendCalls += 1; assert.equal(phone, "13800000000"); return Promise.resolve(); },
  uploadProfileAvatar: () => { uploadCalls += 1; return uploadImpl(); },
  updateMe: (body) => { updateCalls += 1; updateBody = body; return Promise.resolve({ user: { id: "new", nickname: body.nickname ?? storedAuth?.user?.nickname ?? null, avatarUrl: body.avatarUploadId ? "/avatar" : (storedAuth?.user?.avatarUrl || null) } }); },
  discardProfileAvatar: () => Promise.resolve(),
  downloadProfileAvatar: () => Promise.resolve("wxfile://downloaded-avatar.jpg")
} };
require.cache[require.resolve("../miniprogram-project/utils/auth.js")] = { exports: {
  clearAuth: () => { storedAuth = null; }, enterGuest: () => { guest = true; }, getAuth: () => storedAuth, saveAuth: (auth) => { storedAuth = auth; },
  isGuest: () => guest, setGuestProfile: (profile) => { guestProfile = profile; }, updateCachedUser: (_id, user) => { storedAuth = { ...storedAuth, user }; }
} };
require.cache[require.resolve("../miniprogram-project/utils/wechat-login.js")] = { exports: { authenticateWithWechat: () => { wechatLoginCalls += 1; return Promise.resolve(nextAuth); } } };
require.cache[require.resolve("../miniprogram-project/utils/wechat-phone-login.js")] = { exports: { authenticateWithWechatPhone: () => { wechatPhoneCalls += 1; return Promise.resolve(nextAuth); }, getWechatPhoneCode: (detail) => { if (!detail?.code) throw new Error("没有取得手机号"); return detail.code; } } };
require.cache[require.resolve("../miniprogram-project/utils/wechat-privacy.js")] = { exports: { requireWechatPrivacyAuthorization: () => Promise.resolve(), openWechatPrivacyContract: () => undefined } };
require.cache[require.resolve("../miniprogram-project/utils/login-time-background.js")] = { exports: {
  getLoginBackground: () => "/assets/login-times/login-day.jpg",
  getLoginBackgroundInsetTop: () => 67,
  getLoginBackgroundTopColor: () => "#ddd5c3"
} };
require("../miniprogram-project/pages/auth/auth.js");
const makePage = () => ({ ...pageDefinition, data: { ...pageDefinition.data }, setData(values) { Object.assign(this.data, values); } });
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

(async () => {
  const page = makePage(); page.onLoad({}); page.showPhoneMethods(); page.loginWechat(); assert.equal(page.data.stage, "choice"); assert.equal(page.data.error, ""); assert.equal(page.data.consentInvalid, true); assert.equal(wechatLoginCalls, 0); assert.equal(wechatPhoneCalls, 0); await settle(); assert.equal(page.data.consentShake, true);
  page.showGuestWarning(); assert.equal(page.data.stage, "choice"); assert.equal(page.data.consentInvalid, true); assert.equal(wechatLoginCalls, 0); assert.equal(wechatPhoneCalls, 0);
  page.togglePrivacy({ detail: { value: ["confirmed"] } }); assert.equal(page.data.consentInvalid, false); page.showWechatPhone(); await settle(); assert.equal(page.data.stage, "wechatPhone");
  nextAuth = { token: "new", expiresAt: future, user: { id: "new", nickname: null, avatarUrl: null } };
  page.handleWechatPhone({ detail: { code: "phone-code" } }); await settle(); assert.equal(wechatPhoneCalls, 1); assert.equal(page.data.stage, "profile"); assert.equal(redirected, ""); assert.ok(page.data.profileNickname.length >= 2); assert.match(page.data.profileAvatarStyle, /linear-gradient/u);
  page.cancelProfileEdit(); assert.equal(redirected, "/pages/me/me", "optional profile may be skipped after registration");
  redirected = "";
  const optionalProfile = makePage(); optionalProfile.onLoad({ mode: "edit" }); assert.equal(optionalProfile.data.stage, "profile");
  optionalProfile.inputNickname({ detail: { value: "" } }); optionalProfile.saveProfile(); assert.equal(updateCalls, 0); assert.match(optionalProfile.data.error, /昵称/u);
  optionalProfile.inputNickname({ detail: { value: "小满" } }); optionalProfile.saveProfile(); await settle(); assert.equal(uploadCalls, 0); assert.deepEqual(updateBody, { nickname: "小满" }); assert.equal(redirected, "/pages/me/me");

  redirected = "";
  const avatarProfile = makePage(); avatarProfile.onLoad({ mode: "edit" }); avatarProfile.chooseWechatAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); avatarProfile.inputNickname({ detail: { value: "小满" } }); avatarProfile.saveProfile(); await settle();
  assert.equal(uploadCalls, 1); assert.deepEqual(updateBody, { avatarUploadId: "00000000-0000-4000-8000-000000000001" }); assert.equal(redirected, "/pages/me/me");

  storedAuth = { token: "legacy", expiresAt: future, user: { id: "legacy", nickname: null, avatarUrl: null, profileCompletedAt: null } };
  redirected = ""; uploadImpl = () => Promise.reject(Object.assign(new Error("not found"), { statusCode: 404 }));
  const legacyProfile = makePage(); legacyProfile.onLoad({}); assert.equal(redirected, "/pages/me/me", "legacy incomplete sessions must no longer be trapped by profile completion");
  redirected = "";
  const unavailableOptionalProfile = makePage(); unavailableOptionalProfile.onLoad({ mode: "edit" }); unavailableOptionalProfile.chooseWechatAvatar({ detail: { avatarUrl: "wxfile://avatar.jpg" } }); unavailableOptionalProfile.inputNickname({ detail: { value: "小满" } });
  unavailableOptionalProfile.saveProfile(); await settle(); assert.match(unavailableOptionalProfile.data.error, /稍后再说/u); assert.doesNotMatch(unavailableOptionalProfile.data.error, /放弃登录/u);
  uploadImpl = () => Promise.resolve({ uploadId: "00000000-0000-4000-8000-000000000001" });

  const dormantSms = makePage(); dormantSms.togglePrivacy({ detail: { value: ["confirmed"] } }); dormantSms.showSms(); assert.equal(dormantSms.data.stage, "sms");
  dormantSms.inputPhone({ detail: { value: "13800000000" } }); dormantSms.sendSmsCode(); await settle(); assert.equal(sendCalls, 1);
  dormantSms.onUnload(); dormantSms.inputCode({ detail: { value: "123456" } }); nextAuth = { token: "sms", expiresAt: future, user: { id: "sms", nickname: null, avatarUrl: null } };
  dormantSms.loginSms(); await settle(); assert.equal(loginCalls, 1, "deferred SMS implementation must remain available for a future release");

  const stale = makePage(); const staleAttempt = stale.beginAttempt(); stale.invalidateAttempts(); stale.acceptAuth(staleAttempt, { token: "stale", expiresAt: future, user: { id: "stale", nickname: null, avatarUrl: null, profileCompletedAt: null } }); await settle();
  assert.equal(abandonCalls, 1, "a discarded login result must revoke its server session"); assert.equal(storedAuth?.user?.id, "sms");

  storedAuth = null; redirected = ""; const visitor = makePage(); visitor.togglePrivacy({ detail: { value: ["confirmed"] } }); visitor.showGuestWarning(); visitor.showGuestIdentity();
  const firstAvatar = visitor.data.guestAvatarIndex;
  visitor.inputGuestNickname({ detail: { value: "我的昵称" } }); visitor.cycleGuestAvatar(); assert.equal(visitor.data.guestNickname, "我的昵称"); assert.notEqual(visitor.data.guestAvatarIndex, firstAvatar);
  visitor.randomizeGuest(); assert.notEqual(visitor.data.guestNickname, "我的昵称");
  visitor.inputGuestNickname({ detail: { value: " " } }); visitor.startGuest(); assert.match(visitor.data.error, /昵称/u); assert.equal(guest, false);
  visitor.inputGuestNickname({ detail: { value: "慢慢来" } }); visitor.startGuest();
  redirected = "";
  const guestLoginChoice = makePage(); guestLoginChoice.onLoad({ mode: "login" });
  assert.equal(guestLoginChoice.data.stage, "choice", "guest login entry must stay on the unified login choice");
  assert.equal(redirected, "", "guest login entry must not bounce back to Me");
  assert.equal(guest, true, "opening login must not discard the current guest identity");
  const guestDefaultEntry = makePage(); guestDefaultEntry.onLoad({});
  assert.equal(redirected, "/pages/me/me", "ordinary guest entry must still return to the product");
  assert.equal(guest, true); assert.equal(guestProfile.nickname, "慢慢来"); assert.equal(redirected, "/pages/me/me");
  redirected = ""; const returningGuest = makePage(); returningGuest.onLoad({}); assert.equal(redirected, "/pages/me/me");
  console.log("Unified auth-flow checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
