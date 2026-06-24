const { getAuth, saveAuth } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { loginWithWechat } = require("../../api/auth");

Page({
  data: {
    pageTop: 92,
    isLoggedIn: false,
    activeTab: "me",
    switchingTab: false
  },

  onShow() {
    this.updateSafeLayout();
    this.setData({ isLoggedIn: Boolean(getAuth()) });
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({ pageTop: layout.pageTop });
  },

  login() {
    wx.login({
      success: ({ code }) => {
        loginWithWechat(code || `mini_me_${Date.now()}`)
          .then((auth) => {
            saveAuth(auth);
            this.setData({ isLoggedIn: true });
          })
          .catch(() => {
            saveAuth({
              token: `local_demo_${Date.now()}`,
              user: {
                id: "local-demo-user",
                nickname: "本地演示用户"
              }
            });
            this.setData({ isLoggedIn: true });
          });
      },
      fail: () => {
        saveAuth({
          token: `local_demo_${Date.now()}`,
          user: {
            id: "local-demo-user",
            nickname: "本地演示用户"
          }
        });
        this.setData({ isLoggedIn: true });
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
