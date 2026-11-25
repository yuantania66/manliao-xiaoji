const { isOwnerPreview } = require("../../utils/owner-preview");
const trialDiagnostic = require("../../utils/trial-diagnostic");
const { getDeliveryLabel } = require("../../config/delivery");
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
  captureAuthAuthority,
  isCurrentAuthAuthority,
  isCurrentAuthFailure,
  captureIdentityAuthority,
  isCurrentIdentityAuthority,
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
const {
  getGeneratedIdentity,
  getIdentityAt,
  getNextAvatarIndex,
  getRandomIdentity,
  getRandomProfileIdentity
} = require("../../utils/generated-identity");

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
const INITIAL_GUEST_IDENTITY = getRandomIdentity();

Page({
  data: {
    ownerPreview: isOwnerPreview(),
    trialDiagnostic: { visible: false },
    stage: "choice",
    deliveryLabel: "",
    background: getLoginBackground(),
    backgroundTopColor: getLoginBackgroundTopColor(),
    backgroundBlend: createBackgroundBlend(getLoginBackgroundTopColor()),
    backgroundInsetTop: getLoginBackgroundInsetTop(),
    privacyConfirmed: false,
    consentInvalid: false,
    consentShake: false,
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
    profileAvatarSelected: false,
    profileGeneratedAvatar: null,
    profileRandomLabel: "随机生成",
    profileRandomConfirm: false,
    profileRandomMessage: "",
    profileRandomTitle: "",
    profileAvatarError: "",
    profileNicknameError: "",
    profileCanvasMounted: false,
    profileInitial: "慢",
    profileAvatarStyle: INITIAL_GUEST_IDENTITY.avatarStyle,
    guestNameIndex: INITIAL_GUEST_IDENTITY.nameIndex,
    guestNickname: INITIAL_GUEST_IDENTITY.nickname,
    guestInitial: INITIAL_GUEST_IDENTITY.initial,
    guestAvatarIndex: INITIAL_GUEST_IDENTITY.avatarIndex,
    guestAvatarStyle: INITIAL_GUEST_IDENTITY.avatarStyle
  },

  onLoad(options) {
    this.setData({ deliveryLabel: getDeliveryLabel() });
    this.editMode = options.mode === "edit";
    this.loginMode = options.mode === "login";
    const auth = getAuth();
    if (auth) {
      if (this.editMode) this.openProfile(auth);
      else this.finishAccountLogin();
    } else if (isGuest() && !this.loginMode) {
      this.finishAccountLogin();
    }
  },

  onReady() {
    this._trialDiagnosticReady = true;
    trialDiagnostic.attach(this);
  },

  onHide() {
    if (this._trialDiagnosticReady) trialDiagnostic.detach(this);
  },

  onShow() {
    if (this._trialDiagnosticReady) trialDiagnostic.attach(this);
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
    const leavingProfile = this.data.stage === "profile" && stage !== "profile";
    if (leavingProfile) {
      this.profileOperationId = (this.profileOperationId || 0) + 1;
      this.profileAuthority = null;
    }
    const group = ["phoneMethod", "wechatPhone", "sms"].includes(stage)
      ? "phone"
      : stage === "profile"
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
      error: "",
      ...(leavingProfile ? { busy: false, profileRandomConfirm: false, profileRandomMessage: "", profileCanvasMounted: false } : {})
    });
  },

  togglePrivacy(event) {
    const privacyConfirmed = event.detail.value.includes("confirmed");
    if (!privacyConfirmed) this.invalidateAttempts();
    if (privacyConfirmed && this.consentShakeStartTimer) {
      clearTimeout(this.consentShakeStartTimer);
      this.consentShakeStartTimer = null;
    }
    if (privacyConfirmed && this.consentShakeTimer) {
      clearTimeout(this.consentShakeTimer);
      this.consentShakeTimer = null;
    }
    this.setData({
      privacyConfirmed,
      consentInvalid: privacyConfirmed ? false : this.data.consentInvalid,
      consentShake: false,
      busy: false,
      error: ""
    });
  },

  openPrivacy() { wx.navigateTo({ url: "/pages/privacy/privacy" }); },
  openWechatPrivacy() { openWechatPrivacyContract(); },

  assertConsent() {
    if (this.data.privacyConfirmed) return true;
    if (this.consentShakeStartTimer) clearTimeout(this.consentShakeStartTimer);
    if (this.consentShakeTimer) clearTimeout(this.consentShakeTimer);
    this.setData({ consentInvalid: true, consentShake: false, error: "" });
    this.consentShakeStartTimer = setTimeout(() => {
      this.consentShakeStartTimer = null;
      this.setData({ consentShake: true });
    }, 0);
    this.consentShakeTimer = setTimeout(() => {
      this.consentShakeTimer = null;
      this.setData({ consentShake: false });
    }, 360);
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
    attempt.identity = captureIdentityAuthority();
    this.visibleUserId = auth.user.id;
    const user = auth.user;
    const hasSavedProfile = Boolean(user.nickname?.trim() && user.avatarUrl?.trim() && user.profileCompletedAt);
    if (hasSavedProfile && !this.editMode) this.finishAccountLogin();
    else this.openProfile(auth);
  },

  openProfile(auth) {
    const operation = this.beginProfileOperation();
    this.profileAuthority = operation.authority;
    this.profileRandomHistory = [];
    const userId = auth.user.id;
    const generated = getGeneratedIdentity(userId);
    const nickname = auth.user.nickname || "";
    this.visibleUserId = userId;
    this.setData({
      stage: "profile",
      background: BACKGROUNDS.profile,
      profileRequired: false,
      profileNickname: nickname,
      originalProfileNickname: auth.user.nickname || "",
      avatarLocalPath: "",
      avatarPreview: "",
      profileAvatarSelected: Boolean(auth.user.avatarUrl),
      profileGeneratedAvatar: null,
      profileRandomLabel: "随机生成",
      profileRandomConfirm: false,
      profileRandomMessage: "",
      profileAvatarError: "",
      profileNicknameError: "",
      profileCanvasMounted: false,
      profileInitial: nickname.slice(0, 1),
      profileAvatarStyle: generated.avatarStyle,
      busy: false,
      error: ""
    });
    if (auth.user.avatarUrl) {
      downloadProfileAvatar(auth.user.avatarUrl)
        .then((filePath) => {
          if (this.isCurrentProfileOperation(operation, userId) && this.data.stage === "profile" && !this.data.avatarLocalPath && !this.data.profileGeneratedAvatar) {
            this.setData({ avatarPreview: filePath });
          }
        })
        .catch(() => {
          if (this.isCurrentProfileOperation(operation, userId) && this.data.stage === "profile" && !this.data.avatarLocalPath && !this.data.profileGeneratedAvatar) {
            this.setData({ error: "头像暂时没有加载出来" });
          }
        });
    }
  },

  chooseWechatAvatar(event) {
    if (!this.canEditProfile() || this.data.profileRandomConfirm) return;
    const filePath = event.detail?.avatarUrl;
    if (filePath) this.applyAvatarDraft(filePath);
    else this.setData({ error: "没有选中头像" });
  },
  applyAvatarDraft(filePath) {
    if (!this.canEditProfile() || this.data.profileRandomConfirm) return;
    this.setData({ avatarLocalPath: filePath, avatarPreview: filePath, profileAvatarSelected: true,
      profileGeneratedAvatar: null, profileAvatarError: "", error: "" });
  },
  inputNickname(event) {
    if (!this.canEditProfile() || this.data.profileRandomConfirm) return;
    const profileNickname = String(event.detail.value || "");
    this.setData({ profileNickname, profileNicknameError: "", error: "" });
  },
  canEditProfile() {
    return this.data.stage === "profile" && !this.data.busy && isCurrentAuthAuthority(this.profileAuthority);
  },
  randomizeProfile() {
    if (!this.canEditProfile() || this.data.profileRandomConfirm) return;
    const avatar = this.data.profileAvatarSelected;
    const nickname = Boolean(this.data.profileNickname.trim());
    if (!avatar && !nickname) { this.generateProfileDraft(); return; }
    const fields = avatar && nickname ? "头像和昵称" : avatar ? "头像" : "昵称";
    this.setData({ profileRandomConfirm: true, profileRandomTitle: `确认替换${fields}？`,
      profileRandomMessage: `你已设置过${fields}，继续操作将会替换已设置过的内容，确认继续吗？` });
  },
  confirmRandomProfile() {
    if (!this.canEditProfile() || !this.data.profileRandomConfirm) return;
    this.generateProfileDraft();
  },
  cancelRandomProfile() {
    this.setData({ profileRandomConfirm: false, profileRandomMessage: "" });
  },
  stopProfileTap() {},
  generateProfileDraft() {
    const generated = getRandomProfileIdentity(this.profileRandomHistory, {
      nickname: this.data.profileNickname.trim(), avatarStyle: this.data.profileAvatarStyle
    });
    this.profileRandomHistory = [...(this.profileRandomHistory || []), generated].slice(-8);
    this.setData({ profileNickname: generated.nickname, profileInitial: generated.initial,
      profileAvatarStyle: generated.avatarStyle, profileAvatarSelected: true,
      profileGeneratedAvatar: { avatarStyle: generated.avatarStyle, initial: generated.initial },
      avatarLocalPath: "", avatarPreview: "", profileRandomLabel: "重新生成",
      profileRandomConfirm: false, profileRandomMessage: "", profileAvatarError: "", profileNicknameError: "", error: "" });
  },
  createProfileAvatarImage(generated, operation) {
    const isCurrent = () => this.isCurrentProfileOperation(operation, operation.authority?.userId);
    // Reuse the existing mounted-canvas/export pattern; no upload before Save.
    return new Promise((resolve, reject) => {
      this.setData({ profileCanvasMounted: true }, () => {
        wx.nextTick(() => {
          try {
            if (!isCurrent()) { reject(new Error("账号已切换")); return; }
            const ctx = wx.createCanvasContext("profileAvatarCanvas", this);
            const colors = generated.avatarStyle.match(/#[0-9a-f]{6}/giu);
            const gradient = ctx.createLinearGradient(0, 0, 256, 256);
            gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
            ctx.setFillStyle(gradient); ctx.fillRect(0, 0, 256, 256);
            ctx.setFillStyle("#ffffff"); ctx.setFontSize(96); ctx.setTextAlign("center"); ctx.setTextBaseline("middle");
            ctx.fillText(generated.initial, 128, 128);
            ctx.draw(false, () => {
              try {
                if (!isCurrent()) { reject(new Error("账号已切换")); return; }
                wx.canvasToTempFilePath({ canvasId: "profileAvatarCanvas", x: 0, y: 0,
                  width: 256, height: 256, destWidth: 256, destHeight: 256, fileType: "png",
                  success: (result) => result.tempFilePath ? resolve(result.tempFilePath) : reject(new Error("头像生成失败，请重试")),
                  fail: () => reject(new Error("头像生成失败，请重试")) }, this);
              } catch (error) { reject(error); }
            });
          } catch (error) { reject(error); }
        });
      });
    }).finally(() => isCurrent() ? new Promise((resolve) => this.setData({ profileCanvasMounted: false }, resolve)) : undefined);
  },

  saveProfile() {
    const auth = getAuth();
    if (!auth || !this.canEditProfile() || this.data.profileRandomConfirm) return;
    const nickname = this.data.profileNickname.trim();
    const length = Array.from(nickname).length;
    const profileAvatarError = this.data.profileAvatarSelected ? "" : "请选择头像，或使用随机生成";
    const profileNicknameError = !nickname ? "请输入昵称，或使用随机生成" :
      length < 2 || length > 12 ? "昵称请填写 2–12 个字" : "";
    this.setData({ profileAvatarError, profileNicknameError, error: "" });
    if (profileAvatarError || profileNicknameError) return;
    if (!this.data.avatarLocalPath && !this.data.profileGeneratedAvatar && nickname === this.data.originalProfileNickname) {
      this.finishAccountLogin();
      return;
    }
    const userId = auth.user.id;
    const token = auth.token;
    const operation = this.beginProfileOperation();
    let uploadId = "";
    let committed = false;
    let failure = null;
    this.setData({ busy: true, error: "" });
    const avatarPath = this.data.profileGeneratedAvatar
      ? this.createProfileAvatarImage({ ...this.data.profileGeneratedAvatar }, operation)
      : Promise.resolve(this.data.avatarLocalPath);
    const upload = avatarPath.then((filePath) => {
      if (!this.isCurrentProfileOperation(operation, userId)) throw new Error("账号已切换");
      return filePath ? uploadProfileAvatar(filePath) : null;
    });
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
        updateCachedUser(userId, user, operation.authority);
        this.finishAccountLogin();
      })
      .catch((error) => {
        failure = error;
        if (uploadId && !committed) discardProfileAvatar(uploadId, token).catch(() => undefined);
        if (this.isCurrentProfileOperation(operation, userId, error)) {
          const serviceMismatch = error?.statusCode === 404 || error?.statusCode === 405;
          const message = serviceMismatch ? "当前预览服务尚未更新，请稍后重试" : error.message || "资料保存失败";
          this.setData({ error: [message, error.avatarUploadDiagnostic].filter(Boolean).join("\n") });
        }
      })
      .finally(() => {
        if (this.isCurrentProfileOperation(operation, userId, failure)) this.setData({ busy: false });
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
    if (!this.data.busy) { this.cancelRandomProfile(); this.finishAccountLogin(); }
  },

  showGuestWarning() {
    if (isOwnerPreview()) return wx.showToast({ title: "此测试版暂不开放游客模式", icon: "none" });
    if (!this.assertConsent() || this.data.busy) return;
    this.invalidateAttempts();
    this.setStage("guestWarn");
  },
  showGuestIdentity() { this.randomizeGuest(); this.setStage("guestIdentity"); },
  randomizeGuest() {
    const randomIdentity = getRandomIdentity();
    const generated = randomIdentity.nameIndex === this.data.guestNameIndex && randomIdentity.avatarIndex === this.data.guestAvatarIndex
      ? getIdentityAt(this.data.guestNameIndex + 1, this.data.guestAvatarIndex + 1)
      : randomIdentity;
    this.setData({
      guestNameIndex: generated.nameIndex,
      guestNickname: generated.nickname,
      guestInitial: generated.initial,
      guestAvatarIndex: generated.avatarIndex,
      guestAvatarStyle: generated.avatarStyle,
      error: ""
    });
  },
  cycleGuestAvatar() {
    const generated = getIdentityAt(this.data.guestNameIndex, getNextAvatarIndex(this.data.guestAvatarIndex));
    this.setData({
      guestAvatarIndex: generated.avatarIndex,
      guestAvatarStyle: generated.avatarStyle,
      error: ""
    });
  },
  inputGuestNickname(event) {
    const guestNickname = String(event.detail.value || "");
    this.setData({ guestNickname, guestInitial: guestNickname.trim().slice(0, 1) || "慢", error: "" });
  },
  startGuest() {
    if (isOwnerPreview()) return;
    const nickname = this.data.guestNickname.trim();
    const length = Array.from(nickname).length;
    if (length < 2 || length > 12) { this.setData({ error: "昵称请填写 2–12 个字" }); return; }
    setGuestProfile({ nickname, avatarIndex: this.data.guestAvatarIndex });
    enterGuest();
    wx.redirectTo({ url: "/pages/me/me" });
  },
  backToGuestWarning() { this.setStage("guestWarn"); },

  finishAccountLogin() { wx.redirectTo({ url: "/pages/me/me" }); },
  beginAttempt() {
    const id = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = id;
    return { id, identity: captureIdentityAuthority() };
  },
  isCurrentAttempt(attempt) {
    return this.loginAttemptId === attempt.id && isCurrentIdentityAuthority(attempt.identity);
  },
  showAttemptError(attempt, error, fallback) {
    if (this.isCurrentAttempt(attempt)) this.setData({ error: error?.message || fallback });
  },
  finishAttempt(attempt) { if (this.isCurrentAttempt(attempt)) this.setData({ busy: false }); },
  invalidateAttempts() { this.loginAttemptId = (this.loginAttemptId || 0) + 1; },
  beginProfileOperation() {
    this.profileOperationId = (this.profileOperationId || 0) + 1;
    return { id: this.profileOperationId, authority: captureAuthAuthority() };
  },
  isCurrentProfileOperation(operation, userId, failure) {
    return this.data.stage === "profile" && this.profileOperationId === operation.id && operation.authority?.userId === userId &&
      (isCurrentAuthAuthority(operation.authority) || isCurrentAuthFailure(operation.authority, failure));
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
    this.profileAuthority = null;
    if (this._trialDiagnosticReady) trialDiagnostic.detach(this);
    this.invalidateAttempts();
    this.profileOperationId = (this.profileOperationId || 0) + 1;
    if (this.codeTimer) clearInterval(this.codeTimer);
    if (this.consentShakeStartTimer) clearTimeout(this.consentShakeStartTimer);
    if (this.consentShakeTimer) clearTimeout(this.consentShakeTimer);
  }
});
