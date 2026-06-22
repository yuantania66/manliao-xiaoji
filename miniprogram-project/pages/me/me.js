const { getAuth, saveAuth } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");
const { loginWithWechat } = require("../../api/auth");

Page({
  data: {
    pageTop: 92,
    isLoggedIn: false
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
  }
});
