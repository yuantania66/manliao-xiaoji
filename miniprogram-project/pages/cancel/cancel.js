const { getSafeLayout } = require("../../utils/layout");

Page({
  data: {
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  cancelAccount() {
    wx.showModal({
      title: "确认注销？",
      content: "当前小程序演示版会清空本机数据。",
      success(res) {
        if (!res.confirm) return;
        wx.clearStorageSync();
        wx.showToast({ title: "已清空本机数据", icon: "none" });
        setTimeout(() => wx.reLaunch({ url: "/pages/home/home?entry=1" }), 600);
      }
    });
  }
});
