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
    tiles: [0, 1, 2, 3, 4, 5, 6]
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
    this.setData({
      phoneCodeSent: true,
      phoneCode: "",
      phoneError: ""
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
    if (this.data.phoneCode !== "246810") {
      this.setData({ phoneError: "验证码不正确，请重新输入" });
      return;
    }
    this.login();
  },

  login() {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    this.setData({ loggedIn: true, loginPanelOpen: false });
  }
});
