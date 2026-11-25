const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");
const { captureAuthAuthority, isCurrentAuthAuthority, captureIdentityAuthority, clearAuth } = require("./auth");

const request = ({ url, method = "GET", data, auth = true, headers = {}, timeout = API_TIMEOUT }) =>
  new Promise((resolve, reject) => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) {
      reject(new Error("请先在 config/api.js 配置 API 地址"));
      return;
    }

    const authority = auth ? captureAuthAuthority() : null;
    const header = {
      "content-type": "application/json",
      ...headers
    };

    if (authority) {
      header.Authorization = `Bearer ${authority.token}`;
    }

    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header,
      timeout,
      success(res) {
        if (res.statusCode === 401) {
          const error = new Error("登录状态已过期，请重新登录");
          if (isCurrentAuthAuthority(authority)) {
            try { clearAuth(); } catch (error) { reject(error); return; }
            error.authClearance = { source: authority, cleared: captureIdentityAuthority() };
          }
          error.statusCode = 401;
          reject(error);
          return;
        }

        const body = res.data;
        const isObject = body && typeof body === "object" && !Array.isArray(body);
        if (!Number.isInteger(res.statusCode) || res.statusCode < 200 || res.statusCode >= 300 ||
            !isObject || body.ok !== true || !Object.prototype.hasOwnProperty.call(body, "data")) {
          const errorMessage =
            (isObject && (body.message || (body.error && (body.error.message || body.error.code)))) ||
            "服务暂时不可用";
          const error = new Error(errorMessage);
          error.statusCode = res.statusCode;
          reject(error);
          return;
        }

        resolve(body.data);
      },
      fail(failure = {}) {
        const error = new Error("网络暂时不可用");
        // Native error strings may contain URLs and user queries; retain categories only.
        const message = String(failure?.errMsg || "").toLowerCase();
        const reason = /domain.*(?:list|valid)|url.*domain|合法域名/u.test(message) ? "domain"
          : /timed?\s*out|timeout/u.test(message) ? "timeout"
          : /ssl|tls|certificate|证书/u.test(message) ? "tls"
          : /dns|resolve|name.*resolution/u.test(message) ? "dns"
          : /abort|cancel/u.test(message) ? "abort" : "unknown";
        error.transportFailure = {
          reason,
          ...(Number.isSafeInteger(failure?.errno) && Math.abs(failure.errno) <= 2147483647 ? { errno: failure.errno } : {})
        };
        console.warn("[mini-request-transport-failure]", error.transportFailure);
        reject(error);
      }
    });
  });

module.exports = {
  request
};
