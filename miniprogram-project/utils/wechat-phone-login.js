const authApi = require("../api/auth");

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

module.exports = { authenticateWithWechatPhone };
