const authUtils = require("../../utils/auth");
const { clearAuth, getAuth, saveAuth, updateCachedUser } = authUtils;
const getGuestProfile = authUtils.getGuestProfile || (() => null);
const isGuest = authUtils.isGuest || (() => false);
const { getSafeLayout } = require("../../utils/layout");
const {
  getMe,
  updateMe,
  uploadProfileAvatar,
  discardProfileAvatar,
  downloadProfileAvatar
} = require("../../api/auth");
const { authenticateWithWechatPhone, getWechatPhoneCode } = require("../../utils/wechat-phone-login");
const { authenticateWithWechat } = require("../../utils/wechat-login");
const { requireWechatPrivacyAuthorization, openWechatPrivacyContract } = require("../../utils/wechat-privacy");

const getMembershipDays = (createdAt) => {
  if (!createdAt) return null;
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return null;
  const diffDays = Math.floor((Date.now() - createdTime) / (24 * 60 * 60 * 1000));
  return Math.max(diffDays + 1, 1);
};

const getMembershipText = (auth) => {
  if (!auth) return "内容仅保存在本机";
  const membershipDays = getMembershipDays(auth.user && auth.user.createdAt);
  return membershipDays ? `已加入 ${membershipDays} 天` : "已登录";
};

const isProfileRequired = (user) => Boolean(user && (!user.nickname || !user.avatarUrl));
const GUEST_AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #71877b, #f4e4d3)",
  "linear-gradient(135deg, #8fa99a, #d9c5aa)",
  "linear-gradient(135deg, #6d7f86, #d8b9a2)",
  "linear-gradient(135deg, #84938b, #e7d8bf)"
];

Page({
  data: {
    pageTop: 92,
    isLoggedIn: false,
    membershipText: "内容仅保存在本机",
    connectionText: "未连接微信账号",
    isCheckingAuth: false,
    isLoggingIn: false,
    loginError: "",
    privacyConfirmed: false,
    phoneLoginReady: false,
    activeTab: "me",
    switchingTab: false,
    profileEditing: false,
    profileRequired: false,
    profileNickname: "",
    originalProfileNickname: "",
    avatarLocalPath: "",
    avatarPreview: "",
    guestInitial: "晴",
    guestAvatarStyle: GUEST_AVATAR_GRADIENTS[0],
    isSavingProfile: false
  },

  onLoad(options) {
    this.completeProfileAfterLogin = options.completeProfile === "1";
  },

  onShow() {
    this.updateSafeLayout();
    const auth = getAuth();
    const userId = auth?.user?.id || "";
    const userChanged = this.visibleUserId !== undefined && this.visibleUserId !== userId;
    const profileRequired = isProfileRequired(auth?.user);
    if (!auth && !isGuest()) {
      this.setData({ isLoggedIn: false, profileEditing: false, profileRequired: false, isSavingProfile: false });
      wx.redirectTo({ url: "/pages/auth/auth" });
      return;
    }
    if (profileRequired) {
      this.visibleUserId = userId;
      this.setData({
        isLoggedIn: false,
        profileEditing: false,
        profileRequired: false,
        isSavingProfile: false,
        loginError: ""
      });
      wx.redirectTo({ url: "/pages/auth/auth" });
      return;
    }
    const guestProfile = !auth ? getGuestProfile() : null;
    const preserveProfileDraft = Boolean(auth && !userChanged && this.data.profileEditing);
    this.visibleUserId = userId;
    if (userChanged) this.profileSaveId = (this.profileSaveId || 0) + 1;
    this.setData({
      isLoggedIn: Boolean(auth),
      membershipText: getMembershipText(auth),
      connectionText: auth ? "微信账号已连接 · 云端同步已开启" : "游客内容只保存在本机",
      profileNickname: preserveProfileDraft ? this.data.profileNickname : (auth?.user?.nickname || guestProfile?.nickname || ""),
      originalProfileNickname: preserveProfileDraft ? this.data.originalProfileNickname : (auth?.user?.nickname || ""),
      avatarLocalPath: preserveProfileDraft ? this.data.avatarLocalPath : "",
      avatarPreview: preserveProfileDraft ? this.data.avatarPreview : "",
      guestInitial: guestProfile?.nickname?.slice(0, 1) || "晴",
      guestAvatarStyle: GUEST_AVATAR_GRADIENTS[guestProfile?.avatarIndex] || GUEST_AVATAR_GRADIENTS[0],
      isSavingProfile: userChanged ? false : this.data.isSavingProfile,
      loginError: userChanged ? "" : this.data.loginError,
      profileRequired,
      profileEditing: Boolean(auth && (profileRequired || (!userChanged && this.data.profileEditing)))
    });
    if (auth?.user?.avatarUrl) {
      const userId = auth.user.id;
      downloadProfileAvatar(auth.user.avatarUrl).then((filePath) => {
        if (getAuth()?.user?.id === userId && !this.data.avatarLocalPath) {
          this.setData({ avatarPreview: filePath });
        }
      }).catch(() => undefined);
    }
    if (auth) this.reconcileAuth();
  },

  reconcileAuth() {
    if (this.authCheckPending) return;
    const auth = getAuth();
    if (!auth) return;
    const checkId = (this.authCheckId || 0) + 1;
    this.authCheckId = checkId;
    this.authCheckPending = true;
    this.setData({ isCheckingAuth: true, membershipText: "正在验证登录状态...", loginError: "" });
    getMe()
      .then(({ user }) => {
        if (this.authCheckId !== checkId || getAuth()?.user?.id !== auth.user.id || user.id !== auth.user.id) return;
        const preserveProfileDraft = this.data.profileEditing;
        const profileRequired = isProfileRequired(user);
        if (profileRequired) {
          wx.redirectTo({ url: "/pages/auth/auth" });
          return;
        }
        let cacheWarning = "";
        try {
          updateCachedUser(auth.user.id, user);
        } catch {
          cacheWarning = "资料已从云端同步，但本机缓存暂未更新。";
        }
        this.setData({
          isLoggedIn: true,
          membershipText: getMembershipText({ ...auth, user }),
          connectionText: "微信账号已连接 · 云端同步已开启",
          profileNickname: preserveProfileDraft ? this.data.profileNickname : (user.nickname || ""),
          originalProfileNickname: preserveProfileDraft ? this.data.originalProfileNickname : (user.nickname || ""),
          profileRequired,
          profileEditing: preserveProfileDraft || profileRequired,
          loginError: cacheWarning
        });
        if (user.avatarUrl) {
          downloadProfileAvatar(user.avatarUrl).then((filePath) => {
            if (getAuth()?.user?.id === user.id && !this.data.avatarLocalPath) {
              this.setData({ avatarPreview: filePath });
            }
          }).catch(() => undefined);
        }
      })
      .catch(() => {
        if (this.authCheckId !== checkId) return;
        const stillStored = getAuth();
        this.setData({
          isLoggedIn: Boolean(stillStored),
          membershipText: getMembershipText(stillStored),
          connectionText: stillStored ? "微信账号已连接 · 云端同步已开启" : "未连接微信账号",
          loginError: stillStored
            ? "暂时无法验证登录状态，请检查网络后重试。"
            : "登录状态已失效，请重新登录。"
        });
      })
      .finally(() => {
        if (this.authCheckId === checkId) {
          this.authCheckPending = false;
          this.setData({ isCheckingAuth: false });
        }
      });
  },

  togglePrivacy(event) {
    const privacyConfirmed = event.detail.value.includes("confirmed");
    if (!privacyConfirmed) this.loginAttemptId = (this.loginAttemptId || 0) + 1;
    this.setData({ privacyConfirmed, ...(privacyConfirmed ? {} : { phoneLoginReady: false, isLoggingIn: false }) });
  },

  openWechatPrivacy() {
    openWechatPrivacyContract();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({ pageTop: layout.pageTop });
  },

  preparePhoneLogin() {
    if (this.data.isLoggingIn) return;
    if (getAuth()) {
      this.setData({ phoneLoginReady: false, isLoggingIn: false, loginError: "当前已有登录账号，无需再次登录。" });
      return;
    }
    if (!this.data.privacyConfirmed) {
      this.setData({ loginError: "请先阅读并同意隐私政策。" });
      return;
    }
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    const attemptId = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = attemptId;
    this.phoneLoginAttemptId = attemptId;
    const startingUserId = getAuth()?.user?.id || "";
    this.setData({ isCheckingAuth: false, isLoggingIn: true, loginError: "" });

    requireWechatPrivacyAuthorization()
      .then(() => {
        if (this.loginAttemptId !== attemptId) return;
        if (this.data.privacyConfirmed && (getAuth()?.user?.id || "") === startingUserId) {
          this.phoneLoginAttemptId = attemptId;
          this.phoneLoginStartingUserId = startingUserId;
          this.setData({ phoneLoginReady: true, isLoggingIn: false });
        } else {
          this.setData({ phoneLoginReady: false, isLoggingIn: false });
        }
      })
      .catch((error) => {
        if (this.loginAttemptId === attemptId) {
          this.setData({ isLoggingIn: false, loginError: error.message || "微信隐私授权未完成。" });
        }
      });
  },

  cancelPhoneLogin() {
    this.loginAttemptId = (this.loginAttemptId || 0) + 1;
    this.phoneLoginAttemptId = null;
    this.phoneLoginStartingUserId = null;
    this.setData({ phoneLoginReady: false, isLoggingIn: false, loginError: "" });
  },

  loginWithWechatAccount() {
    if (this.data.isLoggingIn) return;
    if (!this.data.privacyConfirmed) {
      this.setData({ loginError: "请先阅读并同意隐私政策。" });
      return;
    }
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    const attemptId = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = attemptId;
    const startingUserId = getAuth()?.user?.id || "";
    this.setData({ isCheckingAuth: false, isLoggingIn: true, phoneLoginReady: false, loginError: "" });
    requireWechatPrivacyAuthorization()
      .then(() => {
        if (
          this.loginAttemptId !== attemptId ||
          !this.data.privacyConfirmed ||
          (getAuth()?.user?.id || "") !== startingUserId
        ) return null;
        return authenticateWithWechat();
      })
      .then((auth) => {
        if (!auth) return;
        if (this.loginAttemptId !== attemptId || (getAuth()?.user?.id || "") !== startingUserId) return;
        saveAuth(auth);
        this.visibleUserId = auth.user.id;
        this.completeProfileAfterLogin = false;
        const profileRequired = isProfileRequired(auth.user);
        this.setData({
          isLoggedIn: true,
          membershipText: getMembershipText(auth),
          connectionText: "微信账号已连接 · 云端同步已开启",
          loginError: "",
          profileRequired,
          profileEditing: profileRequired,
          profileNickname: auth.user.nickname || "",
          originalProfileNickname: auth.user.nickname || "",
          avatarLocalPath: ""
        });
      })
      .catch((error) => {
        if (this.loginAttemptId === attemptId) {
          this.setData({ loginError: error.message || "微信登录失败，请稍后重试。" });
        }
      })
      .finally(() => {
        if (this.loginAttemptId === attemptId) this.setData({ isLoggingIn: false });
      });
  },

  handlePhoneNumber(event) {
    if (!this.data.phoneLoginReady || this.data.isLoggingIn) return;
    if (
      this.phoneLoginAttemptId !== this.loginAttemptId ||
      !this.data.privacyConfirmed ||
      (getAuth()?.user?.id || "") !== this.phoneLoginStartingUserId
    ) {
      this.setData({ phoneLoginReady: false, isLoggingIn: false });
      return;
    }
    let phoneCode;
    try {
      phoneCode = getWechatPhoneCode(event.detail);
    } catch (error) {
      this.setData({ loginError: error.message });
      return;
    }
    const attemptId = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = attemptId;
    this.phoneLoginAttemptId = attemptId;
    const startingUserId = getAuth()?.user?.id || "";
    this.setData({ isLoggingIn: true, loginError: "" });
    authenticateWithWechatPhone(phoneCode)
      .then((auth) => {
        if (this.loginAttemptId !== attemptId || (getAuth()?.user?.id || "") !== startingUserId) return;
        saveAuth(auth);
        this.visibleUserId = auth.user.id;
        this.completeProfileAfterLogin = false;
        const profileRequired = isProfileRequired(auth.user);
        this.setData({
          isLoggedIn: true,
          membershipText: getMembershipText(auth),
          connectionText: "手机号已验证 · 云端同步已开启",
          loginError: "",
          phoneLoginReady: false,
          profileRequired,
          profileEditing: profileRequired,
          profileNickname: auth.user.nickname || "",
          originalProfileNickname: auth.user.nickname || "",
          avatarLocalPath: ""
        });
      })
      .catch((error) => {
        if (this.loginAttemptId === attemptId) {
          this.setData({ loginError: error.message || "登录失败，请稍后重试。" });
        }
      })
      .finally(() => {
        if (this.loginAttemptId === attemptId) this.setData({ isLoggingIn: false });
      });
  },

  chooseProfileAvatarFromMedia() {
    const auth = getAuth();
    if (!auth || this.data.isSavingProfile) return;
    const userId = auth.user.id;
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const filePath = result.tempFilePaths?.[0];
        if (getAuth()?.user?.id !== userId || this.data.isSavingProfile) return;
        if (!filePath) {
          this.setData({ loginError: "未能读取头像，请重新选择。" });
          return;
        }
        this.setData({ avatarLocalPath: filePath, avatarPreview: filePath, loginError: "" });
      },
      fail: (error) => {
        if (String(error?.errMsg || "").includes("cancel")) return;
        if (getAuth()?.user?.id === userId && !this.data.isSavingProfile) {
          this.setData({ loginError: "头像选择失败，请稍后重试。" });
        }
      }
    });
  },

  inputNickname(event) {
    this.setData({ profileNickname: event.detail.value });
  },

  saveProfile() {
    const auth = getAuth();
    if (!auth || this.data.isSavingProfile) return;
    const userId = auth.user.id;
    const authToken = auth.token;
    const nickname = this.data.profileNickname.trim();
    const nicknameChanged = nickname !== this.data.originalProfileNickname;
    const avatarLocalPath = this.data.avatarLocalPath;
    if (!nickname) {
      this.setData({ loginError: "请输入昵称。" });
      return;
    }
    if (!avatarLocalPath && !auth.user.avatarUrl) {
      this.setData({ loginError: "请选择头像。" });
      return;
    }
    if (!nicknameChanged && !avatarLocalPath) {
      this.setData({ loginError: "资料没有变化，可以直接取消。" });
      return;
    }
    const operationId = (this.profileSaveId || 0) + 1;
    this.profileSaveId = operationId;
    this.setData({ isSavingProfile: true, loginError: "" });
    let uploadedId = "";
    let committed = false;
    const upload = avatarLocalPath ? uploadProfileAvatar(avatarLocalPath) : Promise.resolve(null);
    upload
      .then((uploaded) => {
        uploadedId = uploaded ? uploaded.uploadId : "";
        if (this.profileSaveId !== operationId || getAuth()?.user?.id !== userId) {
          throw new Error("账号已切换，已停止保存");
        }
        return updateMe({
          ...(nicknameChanged ? { nickname } : {}),
          ...(uploaded ? { avatarUploadId: uploaded.uploadId } : {})
        });
      })
      .then(({ user }) => {
        committed = true;
        if (this.profileSaveId !== operationId || getAuth()?.user?.id !== userId || user.id !== userId) return;
        const profileRequired = isProfileRequired(user);
        let cacheWarning = "";
        try {
          updateCachedUser(userId, user);
        } catch {
          cacheWarning = "资料已保存到云端，但本机缓存暂未更新；重新进入后会再次同步。";
        }
        this.setData({
          profileRequired,
          profileEditing: profileRequired,
          profileNickname: user.nickname || "",
          originalProfileNickname: user.nickname || "",
          avatarLocalPath: "",
          loginError: profileRequired ? "请补齐昵称和头像。" : cacheWarning
        });
        if (user.avatarUrl) {
          return downloadProfileAvatar(user.avatarUrl).then((filePath) => {
            if (this.profileSaveId === operationId && getAuth()?.user?.id === userId) {
              this.setData({ avatarPreview: filePath });
            }
          }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (uploadedId && !committed) discardProfileAvatar(uploadedId, authToken).catch(() => undefined);
        if (this.profileSaveId === operationId && getAuth()?.user?.id === userId) {
          this.setData({ loginError: error.message || "资料保存失败" });
        }
      })
      .finally(() => {
        if (this.profileSaveId === operationId) this.setData({ isSavingProfile: false });
      });
  },

  skipProfile() {
    if (this.data.isSavingProfile || this.data.profileRequired) return;
    const auth = getAuth();
    this.completeProfileAfterLogin = false;
    this.setData({
      profileEditing: false,
      profileNickname: auth?.user?.nickname || "",
      originalProfileNickname: auth?.user?.nickname || "",
      avatarLocalPath: "",
      avatarPreview: this.data.avatarLocalPath ? "" : this.data.avatarPreview,
      loginError: ""
    });
    if (auth?.user?.avatarUrl) {
      const userId = auth.user.id;
      downloadProfileAvatar(auth.user.avatarUrl).then((filePath) => {
        if (getAuth()?.user?.id === userId) this.setData({ avatarPreview: filePath });
      }).catch(() => undefined);
    }
  },

  exitRequiredProfile() {
    if (!this.data.profileRequired || this.data.isSavingProfile) return;
    this.loginAttemptId = (this.loginAttemptId || 0) + 1;
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    this.profileSaveId = (this.profileSaveId || 0) + 1;
    this.completeProfileAfterLogin = false;
    clearAuth();
    this.onShow();
    wx.showToast({ title: "已退出登录", icon: "none" });
  },

  editProfile() {
    const auth = getAuth();
    if (!auth) return;
    const profileRequired = isProfileRequired(auth.user);
    this.setData({
      profileEditing: true,
      profileRequired,
      profileNickname: auth.user.nickname || "",
      originalProfileNickname: auth.user.nickname || "",
      avatarLocalPath: "",
      loginError: ""
    });
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    const routes = {
      home: "/pages/home/home",
      me: "/pages/me/me"
    };
    if (!routes[tab] || tab === this.data.activeTab) return;

    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
    this.setData({ activeTab: tab, switchingTab: true });
    this.tabSwitchTimer = setTimeout(() => {
      this.tabSwitchTimer = null;
      wx.redirectTo({ url: routes[tab] });
    }, 190);
  },

  onUnload() {
    this.loginAttemptId = (this.loginAttemptId || 0) + 1;
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.profileSaveId = (this.profileSaveId || 0) + 1;
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
