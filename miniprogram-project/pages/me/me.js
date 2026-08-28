const { getAuth, saveAuth, updateCachedUser } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const {
  loginWithWechat,
  getMe,
  updateMe,
  uploadProfileAvatar,
  discardProfileAvatar,
  downloadProfileAvatar
} = require("../../api/auth");
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
    activeTab: "me",
    switchingTab: false,
    profileEditing: false,
    profileNickname: "",
    originalProfileNickname: "",
    avatarLocalPath: "",
    avatarPreview: "",
    isSavingProfile: false
  },

  onShow() {
    this.updateSafeLayout();
    const auth = getAuth();
    this.setData({
      isLoggedIn: Boolean(auth),
      membershipText: getMembershipText(auth),
      connectionText: auth ? "微信账号已连接 · 云端同步已开启" : "未连接微信账号",
      profileNickname: auth?.user?.nickname || "",
      originalProfileNickname: auth?.user?.nickname || "",
      avatarLocalPath: "",
      avatarPreview: ""
    });
    if (auth?.user?.avatarUrl) {
      const userId = auth.user.id;
      downloadProfileAvatar(auth.user.avatarUrl).then((filePath) => {
        if (getAuth()?.user?.id === userId) this.setData({ avatarPreview: filePath });
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
          profileNickname: user.nickname || "",
          originalProfileNickname: user.nickname || "",
          loginError: cacheWarning
        });
        if (user.avatarUrl) {
          downloadProfileAvatar(user.avatarUrl).then((filePath) => {
            if (getAuth()?.user?.id === user.id) this.setData({ avatarPreview: filePath });
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
    this.setData({ privacyConfirmed: event.detail.value.includes("confirmed") });
  },

  openWechatPrivacy() {
    openWechatPrivacyContract();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({ pageTop: layout.pageTop });
  },

  login() {
    if (this.data.isLoggingIn) return;
    if (!this.data.privacyConfirmed) {
      this.setData({ loginError: "请先阅读并同意隐私政策。" });
      return;
    }
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    this.setData({ isCheckingAuth: false, isLoggingIn: true, loginError: "" });

    requireWechatPrivacyAuthorization()
      .then(() => this.loginWithWechatCode())
      .catch((error) => {
        this.setData({ isLoggingIn: false, loginError: error.message || "微信隐私授权未完成。" });
      });
  },

  loginWithWechatCode() {
    wx.login({
      success: ({ code }) => {
        if (!code) {
          this.setData({ isLoggingIn: false, loginError: "微信未返回有效登录凭证，请重试。" });
          return;
        }
        loginWithWechat(code)
          .then((auth) => {
            saveAuth(auth);
            this.setData({
              isLoggedIn: true,
              membershipText: getMembershipText(auth),
              connectionText: "微信账号已连接 · 云端同步已开启",
              loginError: "",
              profileEditing: !auth.user.nickname || !auth.user.avatarUrl,
              profileNickname: auth.user.nickname || "",
              originalProfileNickname: auth.user.nickname || "",
              avatarLocalPath: ""
            });
          })
          .catch((error) => {
            this.setData({ loginError: error.message || "登录失败，请稍后重试。" });
          })
          .finally(() => {
            this.setData({ isLoggingIn: false });
          });
      },
      fail: () => {
        this.setData({ isLoggingIn: false, loginError: "微信登录失败，请稍后重试。" });
      }
    });
  },

  chooseAvatar(event) {
    const filePath = event.detail && event.detail.avatarUrl;
    if (!filePath || this.data.isSavingProfile) return;
    if (!getAuth()?.user?.id) return;
    this.setData({ avatarLocalPath: filePath, avatarPreview: filePath, loginError: "" });
  },

  inputNickname(event) {
    this.setData({ profileNickname: event.detail.value });
  },

  saveProfile() {
    const auth = getAuth();
    if (!auth || this.data.isSavingProfile) return;
    const userId = auth.user.id;
    const nickname = this.data.profileNickname.trim();
    const nicknameChanged = nickname !== this.data.originalProfileNickname;
    const avatarLocalPath = this.data.avatarLocalPath;
    if (!nickname || (!nicknameChanged && !avatarLocalPath)) return;
    const operationId = (this.profileSaveId || 0) + 1;
    this.profileSaveId = operationId;
    this.setData({ isSavingProfile: true, loginError: "" });
    let uploadedId = "";
    const upload = avatarLocalPath ? uploadProfileAvatar(avatarLocalPath) : Promise.resolve(null);
    upload
      .then((uploaded) => {
        if (this.profileSaveId !== operationId || getAuth()?.user?.id !== userId) {
          throw new Error("账号已切换，已停止保存");
        }
        uploadedId = uploaded ? uploaded.uploadId : "";
        return updateMe({
          ...(nicknameChanged ? { nickname } : {}),
          ...(uploaded ? { avatarUploadId: uploaded.uploadId } : {})
        });
      })
      .then(({ user }) => {
        if (this.profileSaveId !== operationId || getAuth()?.user?.id !== userId || user.id !== userId) return;
        let cacheWarning = "";
        try {
          updateCachedUser(userId, user);
        } catch {
          cacheWarning = "资料已保存到云端，但本机缓存暂未更新；重新进入后会再次同步。";
        }
        this.setData({
          profileEditing: false,
          profileNickname: user.nickname || "",
          originalProfileNickname: user.nickname || "",
          avatarLocalPath: "",
          loginError: cacheWarning
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
        if (this.profileSaveId === operationId && getAuth()?.user?.id === userId) {
          this.setData({ loginError: error.message || "资料保存失败" });
          if (uploadedId) discardProfileAvatar(uploadedId).catch(() => undefined);
        }
      })
      .finally(() => {
        if (this.profileSaveId === operationId) this.setData({ isSavingProfile: false });
      });
  },

  skipProfile() {
    if (this.data.isSavingProfile) return;
    const auth = getAuth();
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

  editProfile() {
    const auth = getAuth();
    if (!auth) return;
    this.setData({
      profileEditing: true,
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
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.profileSaveId = (this.profileSaveId || 0) + 1;
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
