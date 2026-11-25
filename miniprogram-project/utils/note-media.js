const { STAGING_ORIGIN, isOwnerPreview } = require("./owner-preview");
const { captureAuthAuthority, isCurrentAuthAuthority } = require("./auth");
const { API_TIMEOUT } = require("../config/api");

// No global or persisted cache: a temporary result belongs to one page load and
// one auth generation. Never send a session to a URL supplied by another origin.
const isTrustedNoteMediaUrl = (url) => typeof url === "string" &&
  /^https:\/\/staging\.manliaoxiaoji\.com\/api\/uploads\/notes\/[A-Za-z0-9_-]+(?:\?token=[A-Za-z0-9._~-]+)?$/.test(url);
const discardTempMedia = (path) => {
  if (!path) return;
  try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (error) {}
};
const downloadNoteMedia = (url, authority = captureAuthAuthority()) => {
  if (!isOwnerPreview()) return Promise.resolve(url);
  if (!isTrustedNoteMediaUrl(url) || !url.startsWith(STAGING_ORIGIN + "/api/uploads/notes/")) {
    return Promise.reject(new Error("图片地址不可用"));
  }
  if (!isCurrentAuthAuthority(authority)) return Promise.reject(new Error("登录状态已变化，请重新打开小记"));
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url, timeout: API_TIMEOUT,
      header: { Authorization: `Bearer ${authority.token}` },
      success: (res) => {
        if (!isCurrentAuthAuthority(authority) || res.statusCode !== 200 || !res.tempFilePath) {
          discardTempMedia(res.tempFilePath);
          reject(new Error("图片加载失败，请重试"));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail: () => reject(new Error("图片加载失败，请检查网络后重试"))
    });
  });
};
module.exports = { downloadNoteMedia, discardTempMedia, isTrustedNoteMediaUrl };
