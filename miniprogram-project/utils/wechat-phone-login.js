const authApi = require("../api/auth");

const getWechatPhoneCode = (detail) => {
  const normalized = detail && typeof detail === "object" && !Array.isArray(detail) ? detail : {};
  if (typeof normalized.code === "string" && normalized.code) return normalized.code;
  if (normalized.encryptedData && normalized.iv) {
    throw new Error("当前微信版本返回的是旧版手机号凭证，暂不支持，请升级微信后重试。");
  }
  const errMsg = typeof normalized.errMsg === "string" ? normalized.errMsg : "";
  if (/cancel|deny/u.test(errMsg.toLowerCase())) {
    throw new Error("你已取消手机号授权，可以稍后再试。");
  }
  if (Number(normalized.errno) === 1400001) {
    throw new Error("微信手机号授权额度不足，请先使用微信登录。");
  }
  if (/no permission|permission denied/u.test(errMsg.toLowerCase())) {
    throw new Error("当前小程序尚未开通微信手机号授权，请先使用微信登录。");
  }
  throw new Error("微信暂未提供手机号凭证，请先使用微信登录或稍后重试。");
};

const authenticateWithWechatPhone = (phoneCode) => new Promise((resolve, reject) => {
  if (!phoneCode) {
    reject(new Error("你已取消手机号授权，可以稍后再试。"));
    return;
  }
  wx.login({
    success: ({ code: wechatCode }) => {
      if (!wechatCode) {
        reject(new Error("微信未返回有效登录凭证，请重试。"));
        return;
      }
      authApi.loginWithWechatPhone({ wechatCode, phoneCode }).then(resolve, reject);
    },
    fail: () => reject(new Error("微信登录失败，请稍后重试。"))
  });
});

module.exports = { authenticateWithWechatPhone, getWechatPhoneCode };
