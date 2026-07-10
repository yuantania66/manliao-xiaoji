const { getAuth, saveAuth, enterGuest } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { loginWithWechat } = require("../../api/auth");

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
    activeTab: "me",
    switchingTab: false
  },

  onShow() {
    this.updateSafeLayout();
    const auth = getAuth();
    this.setData({
      isLoggedIn: Boolean(auth),
      membershipText: getMembershipText(auth)
    });
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({ pageTop: layout.pageTop });
  },

  login() {
    const enterGuestAfterLoginFailure = (message = "登录失败，可以先用游客模式体验。") => {
      enterGuest();
      this.setData({
        isLoggedIn: false,
        membershipText: "游客模式，仅保存在本机"
      });
      wx.showToast({ title: message, icon: "none" });
    };

    wx.login({
      success: ({ code }) => {
        loginWithWechat(code || `mini_me_${Date.now()}`)
          .then((auth) => {
            saveAuth(auth);
            this.setData({
              isLoggedIn: true,
              membershipText: getMembershipText(auth)
            });
          })
          .catch((error) => {
            enterGuestAfterLoginFailure(error.message || "登录失败，可以先用游客模式体验。");
          });
      },
      fail: () => {
        enterGuestAfterLoginFailure("微信登录失败，可以先用游客模式体验。");
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
    if (this.tabSwitchTimer) clearTimeout(this.tabSwitchTimer);
  }
});
