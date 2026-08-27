const { clearAuth, getDataMode } = require("../../utils/auth");
const { getSafeLayout } = require("../../utils/layout");

Page({
  data: {
    backTop: 54,
    dataMode: "none",
    isAuthenticated: false
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  onShow() {
    const dataMode = getDataMode();
    this.setData({ dataMode, isAuthenticated: dataMode === "authenticated" });
  },

  logout() {
    if (!this.data.isAuthenticated) return;
    clearAuth();
    wx.removeStorageSync("xinqingGuestMode");
    wx.removeStorageSync("xinqingMiniChatMessages");
    wx.removeStorageSync("xinqingMiniNotes");
    wx.showToast({ title: "已退出登录", icon: "none" });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
