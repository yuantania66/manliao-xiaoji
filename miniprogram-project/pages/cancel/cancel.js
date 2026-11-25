const { getSafeLayout } = require("../../utils/layout");
const { getAuth, clearCancelledAccount, captureIdentityAuthority, isCurrentIdentityAuthority, isCurrentAuthFailure } = require("../../utils/auth");
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
    statusText: "",
    accountAvailable: true,
    userId: "",
    cloudCancelled: false,
    mediaCleanupPending: false
  },

  onLoad() {
    this.cancelPageEpoch = (this.cancelPageEpoch || 0) + 1;
    this.ownerAuthority = captureIdentityAuthority();
    const layout = getSafeLayout();
    const auth = getAuth();
    if (!auth) {
      this.setData({
        backTop: layout.backTop,
        accountAvailable: false,
        statusText: "当前没有可注销的登录账号。"
      });
      return;
    }
    const phone = auth && auth.user && auth.user.phone ? auth.user.phone : "";
    this.setData({
      backTop: layout.backTop,
      phone,
      maskedPhone: maskPhone(phone),
      needsCode: Boolean(phone && !auth.user.wechatOpenid),
      userId: auth && auth.user ? auth.user.id : ""
    });
  },

  nextStep() {
    if (!this.data.accountAvailable) return;
    this.setData({ confirmStep: "sms", statusText: "" });
  },

  sendCancelCode() {
    const isCurrent = this.captureCancellationGuard();
    if (!isCurrent() || !this.data.phone || this.data.isSendingCode) return;
    let failure = null;
    this.setData({ isSendingCode: true, statusText: "正在发送验证码..." });
    sendCode({ phone: this.data.phone, scene: "cancel_account" })
      .then(() => {
        if (!isCurrent()) return;
        this.setData({
          code: "",
          codeSent: true,
          statusText: "验证码已发送"
        });
      })
      .catch((error) => {
        failure = error;
        if (!isCurrent(error)) return;
        const message = error.message || "验证码发送失败";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        if (isCurrent(failure)) this.setData({ isSendingCode: false });
      });
  },

  onCodeInput(event) {
    const code = event.detail.value.replace(/\D/g, "").slice(0, 6);
    this.setData({ code, statusText: "" });
  },

  cancelAccount() {
    const isCurrent = this.captureCancellationGuard();
    if (!isCurrent()) return;
    if (this.data.isCancelling) return;
    if (this.data.mediaCleanupPending && !this.data.cloudCancelled) return;
    if (!this.data.userId) {
      this.setData({ statusText: "当前账号信息不完整，请重新登录后再试" });
      return;
    }
    if (this.data.cloudCancelled) {
      this.performCancel();
      return;
    }
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
        if (!res.confirm || !isCurrent()) return;
        this.performCancel();
      }
    });
  },

  performCancel() {
    const isCurrent = this.captureCancellationGuard();
    if (!isCurrent() || this.data.isCancelling) return;
    this.setData({ isCancelling: true, statusText: "正在注销..." });
    let cloudCancellationCompleted = this.data.cloudCancelled;
    let failure = null;
    const verifyIdentity = this.data.cloudCancelled
      ? Promise.resolve(null)
      : this.data.needsCode
      ? Promise.resolve({ code: this.data.code })
      : new Promise((resolve, reject) => wx.login({
          success: ({ code }) => code ? resolve({ wechatCode: code }) : reject(new Error("微信身份验证失败")),
          fail: reject
        }));
    verifyIdentity
      .then((credentials) => {
        if (!isCurrent()) throw new Error("账号已切换，已停止注销");
        return credentials ? cancelRemoteAccount(credentials) : null;
      })
      .then((result) => {
        if (!isCurrent()) return;
        if (result && result.mediaCleanup === "pending") {
          this.setData({ mediaCleanupPending: true });
        }
        if (!cloudCancellationCompleted) {
          cloudCancellationCompleted = true;
          this.setData({ cloudCancelled: true });
        }
        clearCancelledAccount(this.data.userId, this.ownerAuthority);
        this.setData({ cloudCancelled: false });
        if (this.data.mediaCleanupPending) {
          this.setData({ statusText: "账号已注销，媒体清理待完成" });
          wx.showToast({ title: "账号已注销，媒体清理待完成", icon: "none" });
        } else {
          wx.showToast({ title: "已注销", icon: "none" });
          setTimeout(() => { if (isCurrent()) wx.reLaunch({ url: "/pages/home/home?entry=1" }); }, 600);
        }
      })
      .catch((error) => {
        failure = error;
        if (!isCurrent(error)) return;
        const message = cloudCancellationCompleted
          ? "云端账号已注销但本机清理未完成"
          : error.message || "注销失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        if (isCurrent(failure)) this.setData({ isCancelling: false });
      });
  },

  captureCancellationGuard() {
    const epoch = this.cancelPageEpoch;
    const authority = this.ownerAuthority;
    return (failure) => this.cancelPageEpoch === epoch && this.ownerAuthority === authority &&
      (isCurrentIdentityAuthority(authority) || isCurrentAuthFailure(authority?.auth, failure)) && Boolean(this.data.userId) &&
      (authority.auth?.userId === this.data.userId || this.data.cloudCancelled || !authority.auth);
  },

  onUnload() {
    this.cancelPageEpoch = (this.cancelPageEpoch || 0) + 1;
  }
});
