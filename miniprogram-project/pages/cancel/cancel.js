const { getSafeLayout } = require("../../utils/layout");
const { getAuth, clearAuth } = require("../../utils/auth");
const { sendCode, cancelAccount: cancelRemoteAccount } = require("../../api/auth");

const maskPhone = (phone = "") => phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "未绑定手机号";

Page({
  data: {
    backTop: 54,
    confirmStep: "risk",
    phone: "",
    maskedPhone: "未绑定手机号",
    needsCode: false,
    code: "",
    codeSent: false,
    isSendingCode: false,
    isCancelling: false,
    statusText: ""
  },

  onLoad() {
    const layout = getSafeLayout();
    const auth = getAuth();
    const phone = auth && auth.user && auth.user.phone ? auth.user.phone : "";
    this.setData({
      backTop: layout.backTop,
      phone,
      maskedPhone: maskPhone(phone),
      needsCode: Boolean(phone)
    });
  },

  nextStep() {
    this.setData({ confirmStep: "sms", statusText: "" });
  },

  sendCancelCode() {
    if (!this.data.phone || this.data.isSendingCode) return;
    this.setData({ isSendingCode: true, statusText: "正在发送验证码..." });
    sendCode({ phone: this.data.phone, scene: "cancel_account" })
      .then((data) => {
        this.setData({
          code: "",
          codeSent: true,
          statusText: data.devCode ? `开发环境验证码：${data.devCode}` : "验证码已发送"
        });
      })
      .catch((error) => {
        const message = error.message || "验证码发送失败";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ isSendingCode: false });
      });
  },

  onCodeInput(event) {
    const code = event.detail.value.replace(/\D/g, "").slice(0, 6);
    this.setData({ code, statusText: "" });
  },

  cancelAccount() {
    if (this.data.isCancelling) return;
    if (this.data.needsCode && !this.data.codeSent) {
      this.setData({ statusText: "请先发送验证码" });
      return;
    }
    if (this.data.needsCode && this.data.code.length !== 6) {
      this.setData({ statusText: "请输入 6 位验证码" });
      return;
    }

    wx.showModal({
      title: "确认注销？",
      content: "注销后账号和云端记录会被清空，且不可恢复。",
      success: (res) => {
        if (!res.confirm) return;
        this.performCancel();
      }
    });
  },

  performCancel() {
    this.setData({ isCancelling: true, statusText: "正在注销..." });
    cancelRemoteAccount(
      this.data.needsCode
        ? { code: this.data.code }
        : { confirm: true }
    )
      .then(() => {
        clearAuth();
        wx.clearStorageSync();
        wx.showToast({ title: "已注销", icon: "none" });
        setTimeout(() => wx.reLaunch({ url: "/pages/home/home?entry=1" }), 600);
      })
      .catch((error) => {
        const message = error.message || "注销失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ isCancelling: false });
      });
  }
});
