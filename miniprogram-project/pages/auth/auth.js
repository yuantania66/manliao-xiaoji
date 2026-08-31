const {
  abandonProfileSession,
  loginWithPhone,
  sendCode,
  updateMe,
  uploadProfileAvatar,
  discardProfileAvatar,
  downloadProfileAvatar
} = require("../../api/auth");
const { authenticateWithWechat } = require("../../utils/wechat-login");
const { authenticateWithWechatPhone, getWechatPhoneCode } = require("../../utils/wechat-phone-login");
const {
  clearAuth,
  enterGuest,
  getAuth,
  isGuest,
  saveAuth,
  setGuestProfile,
  updateCachedUser
} = require("../../utils/auth");
const {
  getLoginBackground,
  getLoginBackgroundInsetTop,
  getLoginBackgroundTopColor
} = require("../../utils/login-time-background");
const { requireWechatPrivacyAuthorization, openWechatPrivacyContract } = require("../../utils/wechat-privacy");

const BACKGROUNDS = Object.freeze({
  phone: "/assets/login-flow/login-phone.jpg",
  profile: "/assets/login-flow/login-profile.jpg",
  guest: "/assets/login-flow/login-guest.jpg"
});
const BACKGROUND_TOP_COLORS = Object.freeze({
  [BACKGROUNDS.phone]: "#e6daca",
  [BACKGROUNDS.profile]: "#ded5c5",
  [BACKGROUNDS.guest]: "#d2c8b4"
});
const createBackgroundBlend = (color) => {
  const [red, green, blue] = color.match(/[0-9a-f]{2}/giu).map((value) => parseInt(value, 16));
  return `linear-gradient(180deg, rgba(${red}, ${green}, ${blue}, 1) 0%, rgba(${red}, ${green}, ${blue}, 0) 100%)`;
};
const GUEST_NAMES = ["雾听", "小满", "晚风", "青禾", "云朵", "慢慢", "晴川", "木棉"];
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #71877b, #f4e4d3)",
  "linear-gradient(135deg, #8fa99a, #d9c5aa)",
  "linear-gradient(135deg, #6d7f86, #d8b9a2)",
  "linear-gradient(135deg, #84938b, #e7d8bf)"
];
const nextGuest = (current = -1) => (current + 1) % GUEST_NAMES.length;

Page({
  data: {
    stage: "choice",
    background: getLoginBackground(),
    backgroundTopColor: getLoginBackgroundTopColor(),
    backgroundBlend: createBackgroundBlend(getLoginBackgroundTopColor()),
    backgroundInsetTop: getLoginBackgroundInsetTop(),
    privacyConfirmed: false,
    busy: false,
    error: "",
    phone: "",
    code: "",
    codeSeconds: 0,
    profileRequired: false,
    profileNickname: "",
    originalProfileNickname: "",
    avatarLocalPath: "",
    avatarPreview: "",
    guestNameIndex: 0,
    guestNickname: GUEST_NAMES[0],
    guestInitial: GUEST_NAMES[0].slice(0, 1),
    guestAvatarIndex: 0,
    guestAvatarStyle: AVATAR_GRADIENTS[0]
  },

  onLoad(options) {
    this.editMode = options.mode === "edit";
    const auth = getAuth();
    if (auth) {
      if (this.editMode) this.openProfile(auth);
      else this.finishAccountLogin();
    } else if (isGuest()) {
      this.finishAccountLogin();
    }
  },

  onShow() {
    const backgroundInsetTop = getLoginBackgroundInsetTop();
    if (this.data.stage === "choice") {
      const backgroundTopColor = getLoginBackgroundTopColor();
      this.setData({
        background: getLoginBackground(),
        backgroundTopColor,
        backgroundBlend: createBackgroundBlend(backgroundTopColor),
        backgroundInsetTop
      });
    } else {
      this.setData({ backgroundInsetTop });
    }
  },

  setStage(stage) {
    const group = ["phoneMethod", "wechatPhone", "sms"].includes(stage)
      ? "phone"
      : ["profile", "avatarSource"].includes(stage)
        ? "profile"
        : ["guestWarn", "guestIdentity"].includes(stage)
          ? "guest"
          : "choice";
    const background = group === "choice" ? getLoginBackground() : BACKGROUNDS[group];
    const backgroundTopColor = group === "choice"
      ? getLoginBackgroundTopColor()
      : BACKGROUND_TOP_COLORS[background];
    this.setData({
      stage,
      background,
      backgroundTopColor,
      backgroundBlend: createBackgroundBlend(backgroundTopColor),
      error: ""
    });
  },

  togglePrivacy(event) {
    const privacyConfirmed = event.detail.value.includes("confirmed");
    if (!privacyConfirmed) this.invalidateAttempts();
    this.setData({ privacyConfirmed, busy: false, error: "" });
  },

  openPrivacy() { wx.navigateTo({ url: "/pages/privacy/privacy" }); },
  openWechatPrivacy() { openWechatPrivacyContract(); },

  assertConsent() {
    if (this.data.privacyConfirmed) return true;
    this.setData({ error: "请先同意协议" });
    return false;
  },

  showPhoneMethods() {
    if (this.assertConsent()) this.setStage("phoneMethod");
  },

  showWechatPhone() {
    if (!this.assertConsent() || this.data.busy) return;
    const attempt = this.beginAttempt();
    this.setData({ busy: true });
    requireWechatPrivacyAuthorization()
      .then(() => {
        if (!this.isCurrentAttempt(attempt)) return;
        this.setStage("wechatPhone");
      })
      .catch((error) => this.showAttemptError(attempt, error, "微信授权未完成"))
      .finally(() => this.finishAttempt(attempt));
  },

  showSms() { if (this.assertConsent()) this.setStage("sms"); },
  backToChoice() { this.invalidateAttempts(); this.setStage("choice"); },
  backToPhoneMethods() { this.invalidateAttempts(); this.setStage("phoneMethod"); },

  loginWechat() {
    if (!this.assertConsent() || this.data.busy) return;
    const attempt = this.beginAttempt();
    this.setData({ busy: true });
    requireWechatPrivacyAuthorization()
      .then(() => this.isCurrentAttempt(attempt) ? authenticateWithWechat() : null)
      .then((auth) => auth && this.acceptAuth(attempt, auth))
      .catch((error) => this.showAttemptError(attempt, error, "微信登录失败"))
      .finally(() => this.finishAttempt(attempt));
  },

  handleWechatPhone(event) {
    if (this.data.busy || !this.assertConsent()) return;
    let phoneCode;
    try { phoneCode = getWechatPhoneCode(event.detail); }
    catch (error) { this.setData({ error: error.message }); return; }
    const attempt = this.beginAttempt();
    this.setData({ busy: true });
    authenticateWithWechatPhone(phoneCode)
      .then((auth) => this.acceptAuth(attempt, auth))
      .catch((error) => this.showAttemptError(attempt, error, "手机号登录失败"))
      .finally(() => this.finishAttempt(attempt));
  },

  inputPhone(event) { this.setData({ phone: String(event.detail.value || "").replace(/\D/gu, "").slice(0, 11), error: "" }); },
  inputCode(event) { this.setData({ code: String(event.detail.value || "").replace(/\D/gu, "").slice(0, 6), error: "" }); },

  sendSmsCode() {
    if (this.data.busy || this.data.codeSeconds > 0) return;
    if (!/^1\d{10}$/u.test(this.data.phone)) { this.setData({ error: "请输入正确的手机号" }); return; }
    const attempt = this.beginAttempt();
    this.setData({ busy: true, error: "" });
    sendCode({ phone: this.data.phone })
      .then(() => {
        if (!this.isCurrentAttempt(attempt)) return;
        this.startCodeTimer(60);
      })
      .catch((error) => this.showAttemptError(attempt, error, "验证码发送失败"))
      .finally(() => this.finishAttempt(attempt));
  },

  loginSms() {
    if (this.data.busy) return;
    if (!/^1\d{10}$/u.test(this.data.phone)) { this.setData({ error: "请输入正确的手机号" }); return; }
    if (!/^\d{6}$/u.test(this.data.code)) { this.setData({ error: "请输入 6 位验证码" }); return; }
    const attempt = this.beginAttempt();
    this.setData({ busy: true, error: "" });
    loginWithPhone({ phone: this.data.phone, code: this.data.code })
      .then((auth) => this.acceptAuth(attempt, auth))
      .catch((error) => this.showAttemptError(attempt, error, "验证码登录失败"))
      .finally(() => this.finishAttempt(attempt));
  },

  acceptAuth(attempt, auth) {
    if (!this.isCurrentAttempt(attempt)) {
      if (typeof auth?.token === "string" && auth.token) {
        abandonProfileSession(auth.token).catch(() => undefined);
      }
      return;
    }
    saveAuth(auth);
    this.visibleUserId = auth.user.id;
    this.finishAccountLogin();
  },

  openProfile(auth) {
    const userId = auth.user.id;
    this.visibleUserId = userId;
    this.setData({
      stage: "profile",
      background: BACKGROUNDS.profile,
      profileRequired: false,
      profileNickname: auth.user.nickname || "",
      originalProfileNickname: auth.user.nickname || "",
      avatarLocalPath: "",
      avatarPreview: "",
      busy: false,
      error: ""
    });
    if (auth.user.avatarUrl) {
      downloadProfileAvatar(auth.user.avatarUrl)
        .then((filePath) => {
          if (this.visibleUserId === userId && this.data.stage === "profile" && !this.data.avatarLocalPath) {
            this.setData({ avatarPreview: filePath });
          }
        })
        .catch(() => {
          if (this.visibleUserId === userId && this.data.stage === "profile") {
            this.setData({ error: "头像暂时没有加载出来" });
          }
        });
    }
  },

  showAvatarSources() { if (!this.data.busy) this.setStage("avatarSource"); },
  cancelAvatarSources() { this.setStage("profile"); },
  chooseWechatAvatar(event) {
    const filePath = event.detail?.avatarUrl;
    if (filePath) this.applyAvatarDraft(filePath);
    else this.setData({ error: "没有选中头像" });
  },
  chooseAlbum() { this.chooseImage(["album"]); },
  takePhoto() { this.chooseImage(["camera"]); },
  chooseImage(sourceType) {
    const userId = getAuth()?.user?.id;
    if (!userId || this.data.busy) return;
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType,
      success: (result) => {
        if (getAuth()?.user?.id !== userId) return;
        const filePath = result.tempFilePaths?.[0];
        if (filePath) this.applyAvatarDraft(filePath);
      },
      fail: (error) => {
        if (!String(error?.errMsg || "").includes("cancel") && getAuth()?.user?.id === userId) {
          this.setData({ error: "图片没有选好，请再试一次" });
        }
      }
    });
  },
  applyAvatarDraft(filePath) {
    this.setData({ avatarLocalPath: filePath, avatarPreview: filePath, stage: "profile", background: BACKGROUNDS.profile, error: "" });
  },
  inputNickname(event) { this.setData({ profileNickname: String(event.detail.value || ""), error: "" }); },

  saveProfile() {
    const auth = getAuth();
    if (!auth || this.data.busy) return;
    const nickname = this.data.profileNickname.trim();
    const length = Array.from(nickname).length;
    if (length < 2 || length > 12) { this.setData({ error: "昵称请填写 2–12 个字" }); return; }
    if (!this.data.avatarLocalPath && !auth.user.avatarUrl) { this.setData({ error: "请先选择头像" }); return; }
    if (!this.data.profileRequired && !this.data.avatarLocalPath && nickname === this.data.originalProfileNickname) {
      this.setData({ error: "资料还没有变化" });
      return;
    }
    const userId = auth.user.id;
    const token = auth.token;
    const operation = this.beginProfileOperation();
    let uploadId = "";
    let committed = false;
    this.setData({ busy: true, error: "" });
    const upload = this.data.avatarLocalPath ? uploadProfileAvatar(this.data.avatarLocalPath) : Promise.resolve(null);
    upload
      .then((uploaded) => {
        uploadId = uploaded?.uploadId || "";
        if (!this.isCurrentProfileOperation(operation, userId)) throw new Error("账号已切换");
        return updateMe({
          ...(nickname !== this.data.originalProfileNickname ? { nickname } : {}),
          ...(uploadId ? { avatarUploadId: uploadId } : {})
        });
      })
      .then(({ user }) => {
        committed = true;
        if (!this.isCurrentProfileOperation(operation, userId)) return;
        updateCachedUser(userId, user);
        this.finishAccountLogin();
      })
      .catch((error) => {
        if (uploadId && !committed) discardProfileAvatar(uploadId, token).catch(() => undefined);
        if (this.isCurrentProfileOperation(operation, userId)) {
          const serviceMismatch = error?.statusCode === 404 || error?.statusCode === 405;
          this.setData({
            error: serviceMismatch
              ? "当前预览服务尚未更新，可点“稍后再说”返回"
              : error.message || "资料保存失败"
          });
        }
      })
      .finally(() => {
        if (this.profileOperationId === operation) this.setData({ busy: false });
      });
  },

  abandonProfile() {
    const auth = getAuth();
    if (!auth) { this.setStage("choice"); return; }
    this.beginProfileOperation();
    this.invalidateAttempts();
    clearAuth();
    this.visibleUserId = "";
    this.setStage("choice");
    this.setData({ busy: false });
    abandonProfileSession(auth.token).catch(() => undefined);
  },

  cancelProfileEdit() {
    if (!this.data.profileRequired && !this.data.busy) this.finishAccountLogin();
  },

  showGuestWarning() { this.invalidateAttempts(); this.setStage("guestWarn"); },
  showGuestIdentity() { this.randomizeGuest(); this.setStage("guestIdentity"); },
  randomizeGuest() {
    const guestNameIndex = nextGuest(this.data.guestNameIndex);
    const guestAvatarIndex = (this.data.guestAvatarIndex + 1) % AVATAR_GRADIENTS.length;
    this.setData({
      guestNameIndex,
      guestNickname: GUEST_NAMES[guestNameIndex],
      guestInitial: GUEST_NAMES[guestNameIndex].slice(0, 1),
      guestAvatarIndex,
      guestAvatarStyle: AVATAR_GRADIENTS[guestAvatarIndex]
    });
  },
  startGuest() {
    setGuestProfile({ nickname: this.data.guestNickname, avatarIndex: this.data.guestAvatarIndex });
    enterGuest();
    wx.redirectTo({ url: "/pages/me/me" });
  },
  backToGuestWarning() { this.setStage("guestWarn"); },

  finishAccountLogin() { wx.redirectTo({ url: "/pages/me/me" }); },
  beginAttempt() {
    const id = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = id;
    return { id, userId: getAuth()?.user?.id || "" };
  },
  isCurrentAttempt(attempt) {
    return this.loginAttemptId === attempt.id && (getAuth()?.user?.id || "") === attempt.userId;
  },
  showAttemptError(attempt, error, fallback) {
    if (this.loginAttemptId === attempt.id) this.setData({ error: error?.message || fallback });
  },
  finishAttempt(attempt) { if (this.loginAttemptId === attempt.id) this.setData({ busy: false }); },
  invalidateAttempts() { this.loginAttemptId = (this.loginAttemptId || 0) + 1; },
  beginProfileOperation() { this.profileOperationId = (this.profileOperationId || 0) + 1; return this.profileOperationId; },
  isCurrentProfileOperation(operation, userId) {
    return this.profileOperationId === operation && getAuth()?.user?.id === userId;
  },
  startCodeTimer(seconds) {
    if (this.codeTimer) clearInterval(this.codeTimer);
    this.setData({ codeSeconds: seconds });
    this.codeTimer = setInterval(() => {
      const next = this.data.codeSeconds - 1;
      this.setData({ codeSeconds: Math.max(next, 0) });
      if (next <= 0) { clearInterval(this.codeTimer); this.codeTimer = null; }
    }, 1000);
  },
  onUnload() {
    this.invalidateAttempts();
    this.profileOperationId = (this.profileOperationId || 0) + 1;
    if (this.codeTimer) clearInterval(this.codeTimer);
  }
});
