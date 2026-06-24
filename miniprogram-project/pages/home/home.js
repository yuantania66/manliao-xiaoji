const { formatDateLabel } = require("../../utils/local-data");
const { getAuth, saveAuth, enterGuest, isGuest } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { loginWithWechat } = require("../../api/auth");

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
    isLoggingIn: false,
    entryError: "",
    activeTab: "home",
    switchingTab: false
  },

  onLoad(options) {
    this.updateSafeLayout();
    this.setData({
      todayLabel: formatDateLabel(),
      prompt: pick(prompts),
      chatCopy: pick(chatCopies),
      noteCopy: pick(noteCopies),
      showEntry: options.entry === "1" || (!getAuth() && !isGuest())
    });
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      entryBottom: layout.bottomSafe + 24
    });
  },

  handleLogin() {
    if (this.data.isLoggingIn) return;
    this.setData({ isLoggingIn: true, entryError: "" });
    wx.login({
      success: ({ code }) => {
        loginWithWechat(code || `mini_home_${Date.now()}`)
          .then((auth) => {
            saveAuth(auth);
            this.setData({ showEntry: false, entryError: "" });
          })
          .catch((error) => {
            this.setData({
              entryError: error.message === "网络暂时不可用"
                ? "登录服务暂不可用，可以先用游客模式体验。"
                : (error.message || "登录失败，可以先用游客模式体验。")
            });
          })
          .finally(() => {
            this.setData({ isLoggingIn: false });
          });
      },
      fail: () => {
        this.setData({
          isLoggingIn: false,
          entryError: "微信登录失败，可以先用游客模式体验。"
        });
      }
    });
  },

  enterGuest() {
    enterGuest();
    this.setData({ showEntry: false, entryError: "" });
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
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
