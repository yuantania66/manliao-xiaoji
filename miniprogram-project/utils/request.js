const { getApiBaseUrl } = require("../config/api");
const { clearAuth, getToken } = require("./token");

const showError = (message) => {
  wx.showToast({
    title: message || "请求失败，请稍后再试",
    icon: "none"
  });
};

const request = ({
  url,
  method = "GET",
  data,
  header = {},
  auth = true,
  silent = false
}) =>
  new Promise((resolve, reject) => {
    const token = getToken();
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) {
      const error = new Error("请先配置 API 地址");
      error.code = "API_BASE_URL_MISSING";
      if (!silent) showError(error.message);
      reject(error);
      return;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header: {
        "content-type": "application/json",
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...header
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode === 401 || body?.error?.code === "UNAUTHORIZED") {
          clearAuth();
          const error = new Error(body?.error?.message || "请先登录");
          error.code = "UNAUTHORIZED";
          error.statusCode = 401;
          if (!silent) showError(error.message);
          reject(error);
          return;
        }

        if (body.ok === false) {
          const error = new Error(body?.error?.message || "请求失败");
          error.code = body?.error?.code || "REQUEST_FAILED";
          error.statusCode = res.statusCode;
          if (!silent) showError(error.message);
          reject(error);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error("请求失败，请稍后再试");
          error.statusCode = res.statusCode;
          if (!silent) showError(error.message);
          reject(error);
          return;
        }

        resolve(body.data);
      },
      fail: () => {
        const error = new Error("网络连接失败，请稍后再试");
        error.code = "NETWORK_FAILED";
        if (!silent) showError(error.message);
        reject(error);
      }
    });
  });

module.exports = {
  request,
  showError
};
