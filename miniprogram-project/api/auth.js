const { request } = require("../utils/request");
const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");
const { getAuth } = require("../utils/auth");

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

const getMe = () =>
  request({
    url: "/api/auth/me"
  });

const updateMe = (profilePatch) => request({
  url: "/api/auth/me",
  method: "PATCH",
  data: profilePatch
});

const uploadProfileAvatar = (filePath) => new Promise((resolve, reject) => {
  const auth = getAuth();
  const apiBaseUrl = getApiBaseUrl();
  if (!auth || !apiBaseUrl) return reject(new Error("请先登录"));
  wx.uploadFile({
    url: `${apiBaseUrl}/api/uploads/profile-avatar`,
    filePath,
    name: "file",
    timeout: API_TIMEOUT,
    header: { Authorization: `Bearer ${auth.token}` },
    success(res) {
      try {
        const body = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
        if (res.statusCode >= 400 || body.ok === false || !body.data?.uploadId) {
          throw new Error(body.message || "头像上传失败");
        }
        resolve(body.data);
      } catch (error) { reject(error); }
    },
    fail() { reject(new Error("头像上传失败，请检查网络")); }
  });
});

const discardProfileAvatar = (uploadId) => request({
  url: "/api/uploads/profile-avatar",
  method: "DELETE",
  data: { uploadId }
});

const downloadProfileAvatar = (avatarUrl) => new Promise((resolve, reject) => {
  const auth = getAuth();
  const apiBaseUrl = getApiBaseUrl();
  if (!auth || !avatarUrl || !apiBaseUrl) return resolve("");
  wx.downloadFile({
    url: avatarUrl.startsWith("/") ? `${apiBaseUrl}${avatarUrl}` : avatarUrl,
    header: { Authorization: `Bearer ${auth.token}` },
    success(res) { res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error("头像读取失败")); },
    fail() { reject(new Error("头像读取失败")); }
  });
});

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
  getMe,
  updateMe,
  uploadProfileAvatar,
  discardProfileAvatar,
  downloadProfileAvatar,
  sendCode,
  cancelAccount
};
