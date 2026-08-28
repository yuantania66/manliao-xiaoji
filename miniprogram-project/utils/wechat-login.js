const authApi = require("../api/auth");

const authenticateWithWechat = () => new Promise((resolve, reject) => {
  wx.login({
    success: ({ code }) => {
      if (!code) {
        reject(new Error("微信未返回有效登录凭证，请重试。"));
        return;
      }
      authApi.loginWithWechat(code).then(resolve, reject);
    },
    fail: () => reject(new Error("微信登录失败，请稍后重试。"))
  });
});

module.exports = { authenticateWithWechat };
