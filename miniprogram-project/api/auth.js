const { request } = require("../utils/request");
const { API_TIMEOUT, getApiBaseUrl, getRuntimeEnvVersion, isPinnedStagingPreview } = require("../config/api");
const { getAuth, captureAuthAuthority, isCurrentAuthAuthority } = require("../utils/auth");

const loginWithWechat = (code) =>
  request({
    url: "/api/auth/wechat",
    method: "POST",
    auth: false,
    data: { code }
  });

const loginWithWechatPhone = ({ wechatCode, phoneCode }) =>
  request({
    url: "/api/auth/wechat-phone",
    method: "POST",
    auth: false,
    data: { wechatCode, phoneCode }
  });

const loginWithPhone = ({ phone, code }) =>
  request({
    url: "/api/auth/phone",
    method: "POST",
    auth: false,
    data: { phone, code }
  });

const sessionRequest = (url, capturedToken = "") => request({
  url,
  method: "POST",
  auth: !capturedToken,
  ...(capturedToken ? { headers: { Authorization: `Bearer ${capturedToken}` } } : {})
});

const abandonProfileSession = (capturedToken = "") =>
  sessionRequest("/api/auth/profile-abandon", capturedToken).catch((error) => {
    if (error?.statusCode === 401) return { accountRemoved: false };
    if (error?.statusCode !== 404) throw error;
    return sessionRequest("/api/auth/logout", capturedToken).catch((logoutError) => {
      if (logoutError?.statusCode === 401) return { accountRemoved: false };
      throw logoutError;
    });
  });

const getMe = () =>
  request({
    url: "/api/auth/me"
  });

const updateMe = (profilePatch) => request({
  url: "/api/auth/me",
  method: "PATCH",
  data: profilePatch
});

// Only allowlisted scalar runtime fields and HTTP(S) authority hostnames may leave
// this diagnostic boundary. Never retain the native error, URL or system-info object.
const getAvatarRuntimeDiagnostic = () => {
  let account = {}, system = {};
  try { account = wx.getAccountInfoSync()?.miniProgram || {}; } catch { /* Unknown is explicit. */ }
  try {
    system = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
  } catch { /* Do not collect device identifiers or fall back after a failed API call. */ }
  const version = value => typeof value === "string" && /^\d{1,5}(?:\.\d{1,5}){0,3}$/u.test(value) ? value : "unknown";
  const appId = typeof account.appId === "string" && /^wx[a-f0-9]{16}$/u.test(account.appId) ? account.appId : "unknown";
  return [`AppID ${appId}`, `小程序版本 ${version(account.version)}`, `微信 ${version(system?.version)}`, `基础库 ${version(system?.SDKVersion)}`];
};

const getAvatarErrorHostname = message => {
  if (typeof message !== "string" || message.length > 8192) return "unknown";
  const hosts = [];
  // Consume an entire authority before validation, preventing partial matches from
  // credentials, malformed ports, Unicode hosts or percent-encoded authorities.
  const urls = message.matchAll(/https?:\/\/([^\s/\?#<>"']+)/giu);
  for (const match of urls) {
    const authority = match[1];
    const valid = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::([0-9]{1,5}))?$/iu.exec(authority);
    if (!valid || valid[1].length > 253 || (valid[2] && (Number(valid[2]) < 1 || Number(valid[2]) > 65535))) continue;
    const host = valid[1].toLowerCase();
    if (!hosts.includes(host)) hosts.push(host);
  }
  // Multiple distinct URLs are ambiguous; never guess which caused the failure.
  return hosts.length === 1 ? hosts[0] : "unknown";
};

const uploadProfileAvatar = (filePath) => new Promise((resolve, reject) => {
  const auth = getAuth();
  const apiBaseUrl = getApiBaseUrl();
  // Keep this attempt's safe context; never expose URLs, files or raw SDK/server errors.
  let runtime = "unknown";
  if (isPinnedStagingPreview === true) {
    try {
      const value = getRuntimeEnvVersion();
      if (["develop", "trial", "release"].includes(value)) runtime = value;
    } catch { /* Missing runtime remains an explicit unknown. */ }
  }
  const runtimeDiagnostic = isPinnedStagingPreview === true ? getAvatarRuntimeDiagnostic() : [];
  const target = !apiBaseUrl ? "empty" : apiBaseUrl === "https://staging.manliaoxiaoji.com" ? "staging" : "other";
  const rejectWithDiagnostic = (error, reason, errno, hostname) => {
    if (isPinnedStagingPreview === true) {
      const fields = [reason, `环境 ${runtime}`, `目标 ${target}`];
      if (Number.isSafeInteger(errno) && Math.abs(errno) <= 2147483647) fields.push(`errno ${errno}`);
      if (Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) {
        fields.push(`HTTP ${error.statusCode}`);
      }
      fields.push(...runtimeDiagnostic);
      if (hostname) fields.push(`错误主机 ${hostname}`);
      error.avatarUploadDiagnostic = `诊断：${fields.join(" · ")}`;
    }
    reject(error);
  };
  if (!auth?.token) return rejectWithDiagnostic(new Error("请先登录"), "auth");
  if (!apiBaseUrl) return rejectWithDiagnostic(new Error("头像上传暂不可用，请稍后再试"), "target");
  if (typeof filePath !== "string" || !filePath) return rejectWithDiagnostic(new Error("请重新选择头像"), "file");

  const rejectTransport = (failure) => {
    // Classify in memory; native messages can contain private file paths or URLs.
    const details = failure || {};
    const message = String(details.errMsg || details.message || "").toLowerCase();
    const reason = /url not in domain list|domain not allowed/u.test(message) ? "domain"
      : /timeout|timed out/u.test(message) ? "timeout"
        : /no such file|file.*not.*(?:found|exist)|(?:open|read).*file.*fail|invalid file/u.test(message) ? "file"
          : /network|connect|socket|dns|ssl|tls|certificate|resolve/u.test(message) ? "network" : "unknown";
    const messages = {
      domain: "头像上传暂不可用，请稍后再试",
      timeout: "头像上传超时，请稍后再试",
      file: "头像文件无法读取，请重新选择头像",
      network: "头像上传失败，请检查网络",
      unknown: "头像上传失败，请稍后再试"
    };
    const error = new Error(messages[reason]);
    error.code = "AVATAR_UPLOAD_TRANSPORT_ERROR";
    error.transportFailure = { reason, ...(Number.isFinite(details.errno) ? { errno: details.errno } : {}) };
    console.warn("[profile-avatar-upload-failure]", error.transportFailure);
    rejectWithDiagnostic(error, reason, details.errno, isPinnedStagingPreview === true ? getAvatarErrorHostname(message) : undefined);
  };

  try {
    wx.uploadFile({
      url: `${apiBaseUrl}/api/uploads/profile-avatar`,
      filePath,
      name: "file",
      timeout: API_TIMEOUT,
      header: { Authorization: `Bearer ${auth.token}` },
      success(res) {
        const statusCode = Number.isInteger(res.statusCode) ? res.statusCode : 0;
        let body = null;
        try { body = typeof res.data === "string" ? JSON.parse(res.data) : res.data; } catch { /* Gateways can return HTML. */ }
        const uploadId = body?.data?.uploadId;
        if (statusCode >= 200 && statusCode < 300 && body?.ok === true &&
            typeof uploadId === "string" && uploadId.trim()) {
          resolve(body.data);
          return;
        }
        const fallback = statusCode === 401 ? "登录状态已过期，请重新登录"
          : statusCode === 413 ? "头像图片过大，请选择较小的图片"
            : statusCode === 404 || statusCode === 405 ? "当前预览服务尚未更新，请稍后重试"
              : statusCode >= 400 ? "头像上传服务暂时不可用，请稍后再试" : "头像上传服务返回异常，请稍后再试";
        const apiMessage = typeof body?.error?.message === "string" ? body.error.message
          : typeof body?.message === "string" ? body.message : "";
        const error = new Error(apiMessage || fallback);
        error.statusCode = statusCode;
        const apiCode = body?.error?.code;
        error.code = typeof apiCode === "string" && /^[A-Z_]{1,64}$/u.test(apiCode) ? apiCode
          : statusCode > 0 && (statusCode < 200 || statusCode >= 300)
            ? "AVATAR_UPLOAD_HTTP_ERROR" : "AVATAR_UPLOAD_INVALID_RESPONSE";
        console.warn("[profile-avatar-upload-failure]", { statusCode });
        rejectWithDiagnostic(error, statusCode >= 300 ? "http" : "response");
      },
      fail: rejectTransport
    });
  } catch (failure) { rejectTransport(failure); }
});

const discardProfileAvatar = (uploadId, capturedToken = "") => request({
  url: "/api/uploads/profile-avatar",
  method: "DELETE",
  auth: !capturedToken,
  ...(capturedToken ? { headers: { Authorization: `Bearer ${capturedToken}` } } : {}),
  data: { uploadId }
});

// Process-local, one active authority/URL only. Never persist private temporary paths.
let avatarDownload = null;
const discardAvatarPath = (path) => {
  if (!path) return;
  try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) {}
};
const resetAvatarDownload = () => {
  if (avatarDownload) discardAvatarPath(avatarDownload.path);
  avatarDownload = null;
};
const getCachedProfileAvatar = (avatarUrl) => {
  if (!avatarDownload) return "";
  if (!isCurrentAuthAuthority(avatarDownload.authority) || avatarDownload.url !== avatarUrl) {
    resetAvatarDownload(); return "";
  }
  if (!avatarDownload.path) return "";
  try { wx.getFileSystemManager().accessSync(avatarDownload.path); }
  catch (_) { resetAvatarDownload(); return ""; }
  return avatarDownload.path;
};
const downloadProfileAvatar = (avatarUrl) => {
  const authority = captureAuthAuthority();
  const apiBaseUrl = getApiBaseUrl();
  if (!authority || !avatarUrl || !apiBaseUrl) { resetAvatarDownload(); return Promise.resolve(""); }
  const url = avatarUrl.startsWith("/") ? `${apiBaseUrl}${avatarUrl}` : avatarUrl;
  // Do not forward the session to arbitrary URLs or sibling-origin lookalikes.
  const relative = url.startsWith(apiBaseUrl + "/") ? url.slice(apiBaseUrl.length) : "";
  if (!/^\/api\/uploads\/profile-avatar\/[A-Za-z0-9_-]+$/.test(relative)) {
    resetAvatarDownload(); return Promise.reject(new Error("头像地址不可用"));
  }
  const cached = getCachedProfileAvatar(avatarUrl);
  if (cached) return Promise.resolve(cached);
  if (avatarDownload) return avatarDownload.promise;
  const entry = avatarDownload = { authority, url: avatarUrl, path: "", promise: null };
  entry.promise = new Promise((resolve, reject) => {
    wx.downloadFile({
      url, timeout: API_TIMEOUT,
      header: { Authorization: `Bearer ${authority.token}` },
      success(res) {
        if (avatarDownload !== entry || !isCurrentAuthAuthority(authority) || res.statusCode !== 200 || !res.tempFilePath) {
          discardAvatarPath(res.tempFilePath);
          reject(new Error("头像读取失败")); return;
        }
        entry.path = res.tempFilePath;
        resolve(entry.path);
      },
      fail() { reject(new Error("头像读取失败")); }
    });
  }).catch(error => { if (avatarDownload === entry) resetAvatarDownload(); throw error; });
  return entry.promise;
};

const sendCode = ({ phone, scene = "login" }) =>
  request({
    url: "/api/auth/code",
    method: "POST",
    auth: scene !== "login",
    data: { phone, scene }
  });

const cancelAccount = ({ code, wechatCode } = {}) =>
  request({
    url: "/api/auth/cancel",
    method: "POST",
    data: wechatCode ? { wechatCode } : { code }
  });

module.exports = {
  loginWithWechat,
  loginWithWechatPhone,
  loginWithPhone,
  abandonProfileSession,
  getMe,
  updateMe,
  uploadProfileAvatar,
  discardProfileAvatar,
  downloadProfileAvatar,
  getCachedProfileAvatar,
  sendCode,
  cancelAccount
};
