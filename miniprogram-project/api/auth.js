const { request } = require("../utils/request");
const { clearAuth, setToken, setUser } = require("../utils/token");

const requestPhoneCode = (phone) =>
  request({
    url: "/api/auth/code",
    method: "POST",
    data: { phone, scene: "login" },
    auth: false
  });

const loginByPhone = ({ phone, code }) =>
  request({
    url: "/api/auth/phone",
    method: "POST",
    data: { phone, code },
    auth: false
  }).then((data) => {
    setToken(data.token);
    setUser(data.user);
    return data;
  });

const loginByWechat = (code) =>
  request({
    url: "/api/auth/wechat",
    method: "POST",
    data: { code },
    auth: false
  }).then((data) => {
    setToken(data.token);
    setUser(data.user);
    return data;
  });

const getCurrentUser = () =>
  request({
    url: "/api/auth/me",
    method: "GET",
    silent: true
  }).then((data) => {
    setUser(data.user);
    return data.user;
  });

const logout = () =>
  request({
    url: "/api/auth/logout",
    method: "POST",
    silent: true
  })
    .catch(() => null)
    .then(() => {
      clearAuth();
    });

module.exports = {
  getCurrentUser,
  loginByPhone,
  loginByWechat,
  logout,
  requestPhoneCode
};
