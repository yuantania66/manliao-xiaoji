const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");
const { clearAuth, captureAuthAuthority, isCurrentAuthAuthority, captureIdentityAuthority } = require("../utils/auth");
const { readPendingUploadCleanup, addPendingUploadCleanup, removePendingUploadCleanup } = require("../utils/local-data");

const parseUploadResponse = (res, apiBaseUrl, authority) => {
  if (res.statusCode === 401) {
    const error = new Error("登录状态已过期，请重新登录");
    error.statusCode = 401;
    if (isCurrentAuthAuthority(authority)) {
      clearAuth();
      error.authClearance = { source: authority, cleared: captureIdentityAuthority() };
    }
    throw error;
  }

  let body = res.data;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const isObject = body && typeof body === "object" && !Array.isArray(body);
  if (!Number.isInteger(res.statusCode) || res.statusCode < 200 || res.statusCode >= 300 ||
      !isObject || body.ok !== true || !Object.prototype.hasOwnProperty.call(body, "data")) {
    const errorMessage =
      (isObject && (body.message || (body.error && (body.error.message || body.error.code)))) ||
      "图片上传失败";
    const error = new Error(errorMessage);
    error.statusCode = res.statusCode;
    throw error;
  }

  const item = body.data && Array.isArray(body.data.items) ? body.data.items[0] : null;
  if (!item || typeof item.url !== "string" || !item.url.trim()) {
    const error = new Error("图片上传失败");
    error.statusCode = res.statusCode;
    throw error;
  }

  return {
    ...item,
    url: item.url.startsWith("/") ? `${apiBaseUrl}${item.url}` : item.url
  };
};

const assertUploadAuthority = (authority) => {
  if (!authority || !isCurrentAuthAuthority(authority)) throw new Error("身份已变化，请重新进入本页");
};
const cleanupOwner = (authority) => authority ? `authenticated:${authority.userId}` : "none";

const uploadNoteImage = (filePath, authority = captureAuthAuthority()) =>
  new Promise((resolve, reject) => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) {
      reject(new Error("请先配置 API 地址"));
      return;
    }

    try { assertUploadAuthority(authority); } catch (error) { reject(error); return; }

    wx.uploadFile({
      url: `${apiBaseUrl}/api/uploads/notes`,
      filePath,
      name: "file",
      timeout: API_TIMEOUT,
      header: {
        Authorization: `Bearer ${authority.token}`
      },
      success: (res) => {
        try {
          const item = parseUploadResponse(res, apiBaseUrl, authority);
          try { assertUploadAuthority(authority); }
          catch (error) { error.uploadedUrls = [item.url]; throw error; }
          resolve(item);
        } catch (error) {
          reject(error);
        }
      },
      fail: () => {
        reject(new Error("图片上传失败，请检查网络"));
      }
    });
  });

const uploadNoteImages = (filePaths = [], authority = captureAuthAuthority()) =>
  uploadNoteImagesWithCleanup(filePaths, authority);

const cleanupNoteUploads = (urls = [], authority = captureAuthAuthority()) => {
  if (!urls.length) return Promise.resolve();
  try { assertUploadAuthority(authority); } catch (error) { return Promise.reject(error); }
  return require("../utils/request").request({
    url: "/api/uploads/notes",
    method: "DELETE",
    data: { urls }
  });
};

const cleanupOrQueueNoteUploads = async (urls = [], authority = captureAuthAuthority()) => {
  if (!urls.length) return;
  try {
    await cleanupNoteUploads(urls, authority);
    removePendingUploadCleanup(urls, cleanupOwner(authority));
  } catch (error) {
    addPendingUploadCleanup(urls, cleanupOwner(authority));
    throw error;
  }
};

const retryPendingNoteUploadCleanup = async () => {
  const authority = captureAuthAuthority();
  if (!authority) return false;
  const urls = readPendingUploadCleanup(cleanupOwner(authority));
  if (!urls.length) return false;
  for (let index = 0; index < urls.length; index += 9) {
    await cleanupOrQueueNoteUploads(urls.slice(index, index + 9), authority);
  }
  return true;
};

const uploadNoteImagesWithCleanup = async (filePaths = [], authority = captureAuthAuthority()) => {
  const items = [];
  try {
    for (const filePath of filePaths) items.push(await uploadNoteImage(filePath, authority));
    return items;
  } catch (error) {
    error.uploadedUrls = [...new Set([...items.map((item) => item.url), ...(error.uploadedUrls || [])])];
    throw error;
  }
};

module.exports = {
  uploadNoteImage,
  uploadNoteImages,
  uploadNoteImagesWithCleanup,
  cleanupNoteUploads,
  cleanupOrQueueNoteUploads,
  retryPendingNoteUploadCleanup
};
