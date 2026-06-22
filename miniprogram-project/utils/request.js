const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");
const { getAuth, clearAuth } = require("./auth");

const request = ({ url, method = "GET", data, auth = true }) =>
  new Promise((resolve, reject) => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) {
      reject(new Error("请先在 config/api.js 配置 API 地址"));
      return;
    }

    const storedAuth = getAuth();
    const header = {
      "content-type": "application/json"
    };

    if (auth && storedAuth && storedAuth.token) {
      header.Authorization = `Bearer ${storedAuth.token}`;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header,
      timeout: API_TIMEOUT,
      success(res) {
        if (res.statusCode === 401) {
          clearAuth();
          reject(new Error("登录状态已过期，请重新登录"));
          return;
        }

        const body = res.data || {};
        if (res.statusCode >= 400 || body.ok === false) {
          const errorMessage =
            body.message ||
            (body.error && (body.error.message || body.error.code)) ||
            "服务暂时不可用";
          reject(new Error(errorMessage));
          return;
        }

        resolve(body.data || body);
      },
      fail() {
        reject(new Error("网络暂时不可用"));
      }
    });
  });

module.exports = {
  request
};
