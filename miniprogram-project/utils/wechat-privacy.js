const privacyApiUnavailable = () => new Error("当前微信版本不支持隐私授权，请升级微信后重试。");

const getWechatPrivacySetting = () => new Promise((resolve, reject) => {
  if (typeof wx.getPrivacySetting !== "function") {
    reject(privacyApiUnavailable());
    return;
  }
  wx.getPrivacySetting({
    success: resolve,
    fail: () => reject(new Error("暂时无法读取微信隐私授权状态，请重试。"))
  });
});

const requireWechatPrivacyAuthorization = async () => {
  const setting = await getWechatPrivacySetting();
  if (!setting.needAuthorization) return true;
  if (typeof wx.requirePrivacyAuthorize !== "function") throw privacyApiUnavailable();
  await new Promise((resolve, reject) => {
    wx.requirePrivacyAuthorize({
      success: resolve,
      fail: () => reject(new Error("需要同意微信隐私保护指引后才能登录。"))
    });
  });
  return true;
};

const openWechatPrivacyContract = () => {
  if (typeof wx.openPrivacyContract !== "function") {
    wx.navigateTo({ url: "/pages/privacy/privacy" });
    return;
  }
  wx.openPrivacyContract({
    fail: () => wx.navigateTo({ url: "/pages/privacy/privacy" })
  });
};

module.exports = {
  requireWechatPrivacyAuthorization,
  openWechatPrivacyContract
};
