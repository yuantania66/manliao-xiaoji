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

const sendCode = ({ phone, scene = "login" }) =>
  request({
    url: "/api/auth/code",
    method: "POST",
    auth: scene !== "login",
    data: { phone, scene }
  });

const cancelAccount = ({ code, confirm = false } = {}) =>
  request({
    url: "/api/auth/cancel",
    method: "POST",
    data: confirm ? { confirm: true } : { code }
  });

module.exports = {
  loginWithWechat,
  getMe,
  sendCode,
  cancelAccount
};
