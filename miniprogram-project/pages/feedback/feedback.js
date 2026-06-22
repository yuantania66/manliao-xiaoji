const { getSafeLayout } = require("../../utils/layout");

Page({
  data: {
    types: ["使用问题", "功能建议", "其他"],
    type: "使用问题",
    content: "",
    contentLength: 0,
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  chooseType(event) {
    this.setData({ type: event.currentTarget.dataset.type });
  },

  onInput(event) {
    const content = event.detail.value;
    this.setData({ content, contentLength: content.length });
  },

  submit() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: "先写一点反馈", icon: "none" });
      return;
    }
    wx.showToast({ title: "已收到", icon: "none" });
    this.setData({ content: "", contentLength: 0 });
  }
});
