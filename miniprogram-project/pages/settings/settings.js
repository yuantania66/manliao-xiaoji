const { clearAuth } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");

Page({
  data: {
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  logout() {
    clearAuth();
    wx.removeStorageSync("xinqingGuestMode");
    wx.removeStorageSync("xinqingMiniChatMessages");
    wx.removeStorageSync("xinqingMiniNotes");
    wx.showToast({ title: "已退出登录", icon: "none" });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
