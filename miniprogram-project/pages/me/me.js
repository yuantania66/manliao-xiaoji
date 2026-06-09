const { getCurrentUser, loginByPhone, loginByWechat, requestPhoneCode } = require("../../api/auth");

Page({
  data: {
    loggedIn: false,
    agreed: false,
    legalPanel: "",
    loginPanelOpen: false,
    loginMode: "methods",
    phone: "",
    phoneCode: "",
    phoneCodeSent: false,
    phoneError: "",
    loginLoading: false,
    tiles: [0, 1, 2, 3, 4, 5, 6]
  },

  onShow() {
    const app = getApp();
    this.setData({ loggedIn: !!app.globalData.loggedIn });
    if (app.globalData.loggedIn) {
      getCurrentUser()
        .then((user) => {
          app.setAuth({ token: app.globalData.token, user });
          this.setData({ loggedIn: true });
        })
        .catch(() => {
          app.clearAuth();
          this.setData({ loggedIn: false });
        });
    }
  },

  goHome() {
    wx.navigateTo({ url: "/pages/home/home" });
  },

  goSettings() {
    wx.navigateTo({ url: "/pages/settings/settings" });
  },

  toggleAgreement() {
    this.setData({ agreed: !this.data.agreed });
  },

  openLegal(event) {
    this.setData({ legalPanel: event.currentTarget.dataset.type });
  },

  closeLegal() {
    this.setData({ legalPanel: "" });
  },

  openLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    this.setData({
      loginPanelOpen: true,
      loginMode: "methods",
      phone: "",
      phoneCode: "",
      phoneCodeSent: false,
      phoneError: ""
    });
  },

  closeLogin() {
    this.setData({ loginPanelOpen: false, phoneError: "" });
  },

  openPhoneLogin() {
    this.setData({
      loginMode: "phone",
      phone: "",
      phoneCode: "",
      phoneCodeSent: false,
      phoneError: ""
    });
  },

  backToLoginMethods() {
    this.setData({ loginMode: "methods", phoneError: "" });
  },

  onPhoneInput(event) {
    this.setData({
      phone: event.detail.value.replace(/\D/g, "").slice(0, 11),
      phoneError: ""
    });
  },

  onPhoneCodeInput(event) {
    this.setData({
      phoneCode: event.detail.value.replace(/\D/g, "").slice(0, 6),
      phoneError: ""
    });
  },

  sendPhoneCode() {
    if (!this.data.agreed) {
      this.setData({ phoneError: "请先阅读并同意协议" });
      return;
    }
    if (this.data.phone.length !== 11) {
      this.setData({ phoneError: "请输入 11 位手机号码" });
      return;
    }
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true, phoneError: "" });
    requestPhoneCode(this.data.phone)
      .then((data) => {
        this.setData({
          phoneCodeSent: true,
          phoneCode: data.devCode || "",
          phoneError: data.devCode ? "开发环境验证码已自动填入" : ""
        });
      })
      .catch((error) => {
        this.setData({ phoneError: error.message || "验证码发送失败" });
      })
      .finally(() => {
        this.setData({ loginLoading: false });
      });
  },

  phoneLogin() {
    if (this.data.phone.length !== 11) {
      this.setData({ phoneError: "请输入 11 位手机号码" });
      return;
    }
    if (!this.data.phoneCodeSent) {
      this.setData({ phoneError: "请先获取验证码" });
      return;
    }
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true, phoneError: "" });
    loginByPhone({
      phone: this.data.phone,
      code: this.data.phoneCode
    })
      .then((data) => {
        getApp().setAuth({ token: data.token, user: data.user });
        this.setData({ loggedIn: true, loginPanelOpen: false });
        wx.showToast({ title: "已登录", icon: "success" });
      })
      .catch((error) => {
        this.setData({ phoneError: error.message || "登录失败" });
      })
      .finally(() => {
        this.setData({ loginLoading: false });
      });
  },

  login() {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    wx.login({
      success: (res) => {
        if (!res.code) {
          wx.showToast({ title: "微信登录失败", icon: "none" });
          this.setData({ loginLoading: false });
          return;
        }
        loginByWechat(res.code)
          .then((data) => {
            getApp().setAuth({ token: data.token, user: data.user });
            this.setData({ loggedIn: true, loginPanelOpen: false });
            wx.showToast({ title: "已登录", icon: "success" });
          })
          .finally(() => {
            this.setData({ loginLoading: false });
          });
      },
      fail: () => {
        wx.showToast({ title: "微信登录失败", icon: "none" });
        this.setData({ loginLoading: false });
      }
    });
  }
});
