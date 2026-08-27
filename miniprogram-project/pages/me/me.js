const { getAuth, saveAuth } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { loginWithWechat, getMe } = require("../../api/auth");
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
    switchingTab: false
  },

  onShow() {
    this.updateSafeLayout();
    const auth = getAuth();
    this.setData({
      isLoggedIn: Boolean(auth),
      membershipText: getMembershipText(auth),
      connectionText: auth ? "微信账号已连接 · 云端同步已开启" : "未连接微信账号"
    });
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
      .then(() => {
        if (this.authCheckId !== checkId || !getAuth()) return;
        this.setData({ isLoggedIn: true, membershipText: getMembershipText(getAuth()), connectionText: "微信账号已连接 · 云端同步已开启" });
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
              loginError: ""
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
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
