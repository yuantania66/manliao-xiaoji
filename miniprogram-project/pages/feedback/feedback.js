const { getSafeLayout } = require("../../utils/layout");
const { createFeedback } = require("../../api/feedback");

Page({
  data: {
    types: ["使用问题", "功能建议", "其他"],
    type: "使用问题",
    content: "",
    contentLength: 0,
    backTop: 54,
    isSubmitting: false,
    statusText: ""
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  chooseType(event) {
    this.setData({ type: event.currentTarget.dataset.type, statusText: "" });
  },

  onInput(event) {
    const content = event.detail.value;
    this.setData({ content, contentLength: content.length, statusText: "" });
  },

  submit() {
    const content = this.data.content.trim();
    if (!content) {
      wx.showToast({ title: "先写一点反馈", icon: "none" });
      return;
    }
    if (this.data.isSubmitting) return;

    this.setData({ isSubmitting: true, statusText: "正在提交..." });
    createFeedback({
      type: this.data.type,
      content
    })
      .then(() => {
        wx.showToast({ title: "已收到", icon: "none" });
        this.setData({ content: "", contentLength: 0, statusText: "反馈已保存，我们会认真看。" });
      })
      .catch((error) => {
        const message = error.message || "提交失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ isSubmitting: false });
      });
  }
});
