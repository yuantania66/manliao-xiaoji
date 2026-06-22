const { request } = require("../utils/request");

const loginWithWechat = (code) =>
  request({
    url: "/api/auth/wechat",
    method: "POST",
    auth: false,
    data: { code }
  });

const getMe = () =>
  request({
    url: "/api/auth/me"
  });

module.exports = {
  loginWithWechat,
  getMe
};
