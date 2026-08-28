const { formatDateLabel } = require("../../utils/local-data");
const { getAuth, saveAuth, enterGuest, isGuest } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { getMe } = require("../../api/auth");
const { authenticateWithWechatPhone } = require("../../utils/wechat-phone-login");
const { requireWechatPrivacyAuthorization, openWechatPrivacyContract } = require("../../utils/wechat-privacy");

const prompts = [
  { title: "今天过得怎么样？", lead: "不用急着说清楚。\n先选一个此刻更需要的方式。" },
  { title: "此刻想靠近哪里？", lead: "可以说一会儿，也可以写一点。\n先照顾现在的自己。" },
  { title: "今天的心情停在哪？", lead: "不必马上整理好。\n选一个舒服的方式开始。" },
  { title: "这一刻需要什么？", lead: "想说就慢慢说。\n想留下来，就轻轻记一下。" }
];

const chatCopies = [
  "开心也好，难过也好，都可以说说。",
  "有话想放下时，可以慢慢说。",
  "不清楚也没关系，先说一点点。",
  "把此刻交给对话，轻轻开始。"
];

const noteCopies = [
  "留下一点今天的痕迹。",
  "把今天的一小片留住。",
  "写下此刻经过你的事。",
  "给今天放一个温柔标记。"
];

const pick = (items) => items[Math.floor(Math.random() * items.length)];

Page({
  data: {
    pageTop: 92,
    entryBottom: 48,
    todayLabel: "",
    prompt: prompts[0],
    chatCopy: chatCopies[0],
    noteCopy: noteCopies[0],
    showEntry: false,
    isCheckingAuth: false,
    isLoggingIn: false,
    entryError: "",
    privacyConfirmed: false,
    phoneLoginReady: false,
    activeTab: "home",
    switchingTab: false
  },

  onLoad(options) {
    this.forceEntry = options.entry === "1";
    this.updateSafeLayout();
    this.setData({
      todayLabel: formatDateLabel(),
      prompt: pick(prompts),
      chatCopy: pick(chatCopies),
      noteCopy: pick(noteCopies),
      showEntry: this.forceEntry || (!getAuth() && !isGuest())
    });
  },

  onShow() {
    this.reconcileAuth();
  },

  reconcileAuth() {
    if (this.forceEntry || isGuest()) return;
    const auth = getAuth();
    if (!auth) {
      this.setData({ showEntry: true, isCheckingAuth: false });
      return;
    }
    if (this.authCheckPending) return;
    const checkId = (this.authCheckId || 0) + 1;
    this.authCheckId = checkId;
    this.authCheckPending = true;
    this.setData({ showEntry: true, isCheckingAuth: true, entryError: "" });
    getMe()
      .then(() => {
        if (this.authCheckId !== checkId || !getAuth()) return;
        this.setData({ showEntry: false, entryError: "" });
      })
      .catch(() => {
        if (this.authCheckId !== checkId) return;
        const stillStored = getAuth();
        this.setData({
          showEntry: true,
          entryError: stillStored
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
    this.setData({ privacyConfirmed, ...(privacyConfirmed ? {} : { phoneLoginReady: false }) });
  },

  openWechatPrivacy() {
    openWechatPrivacyContract();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      entryBottom: layout.bottomSafe + 24
    });
  },

  preparePhoneLogin() {
    if (this.data.isLoggingIn) return;
    if (!this.data.privacyConfirmed) {
      this.setData({ entryError: "请先阅读并同意隐私政策。" });
      return;
    }
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    const attemptId = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = attemptId;
    this.setData({ isCheckingAuth: false, isLoggingIn: true, entryError: "" });
    requireWechatPrivacyAuthorization()
      .then(() => {
        if (this.loginAttemptId === attemptId) {
          this.setData({ phoneLoginReady: true, isLoggingIn: false });
        }
      })
      .catch((error) => {
        if (this.loginAttemptId === attemptId) {
          this.setData({ isLoggingIn: false, entryError: error.message || "微信隐私授权未完成。" });
        }
      });
  },

  handlePhoneNumber(event) {
    if (!this.data.phoneLoginReady || this.data.isLoggingIn) return;
    const phoneCode = event.detail && event.detail.code;
    if (!phoneCode) {
      this.setData({ entryError: "你已取消手机号授权，可以稍后再试。" });
      return;
    }
    const attemptId = (this.loginAttemptId || 0) + 1;
    this.loginAttemptId = attemptId;
    const startingUserId = getAuth()?.user?.id || "";
    this.setData({ isLoggingIn: true, entryError: "" });
    authenticateWithWechatPhone(phoneCode)
      .then((auth) => {
        if (this.loginAttemptId !== attemptId || (getAuth()?.user?.id || "") !== startingUserId) return;
        saveAuth(auth);
        this.forceEntry = false;
        this.setData({ showEntry: false, phoneLoginReady: false, entryError: "" });
        if (!auth.user.nickname || !auth.user.avatarUrl) {
          wx.redirectTo({ url: "/pages/me/me?completeProfile=1" });
        } else {
          wx.showToast({ title: "登录成功，云端同步已开启", icon: "none" });
        }
      })
      .catch((error) => {
        if (this.loginAttemptId !== attemptId) return;
        this.setData({
          entryError: error.message === "网络暂时不可用"
            ? "登录服务暂不可用，可以先用游客模式体验。"
            : (error.message || "登录失败，可以先用游客模式体验。")
        });
      })
      .finally(() => {
        if (this.loginAttemptId === attemptId) this.setData({ isLoggingIn: false });
      });
  },

  enterGuest() {
    this.loginAttemptId = (this.loginAttemptId || 0) + 1;
    this.authCheckId = (this.authCheckId || 0) + 1;
    this.authCheckPending = false;
    this.forceEntry = false;
    enterGuest();
    this.setData({
      showEntry: false,
      isCheckingAuth: false,
      isLoggingIn: false,
      phoneLoginReady: false,
      entryError: ""
    });
  },

  goChat() {
    wx.navigateTo({ url: "/pages/chat/chat" });
  },

  goNote() {
    wx.navigateTo({ url: "/pages/note/note" });
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
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
