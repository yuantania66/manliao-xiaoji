const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");
const { getAuth, clearAuth } = require("../utils/auth");
const { readPendingUploadCleanup, addPendingUploadCleanup, removePendingUploadCleanup } = require("../utils/local-data");

const parseUploadResponse = (res, apiBaseUrl) => {
  let body = res.data || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (error) {
      throw new Error("上传服务返回异常");
    }
  }

  if (res.statusCode === 401) {
    clearAuth();
    throw new Error("登录状态已过期，请重新登录");
  }

  if (res.statusCode >= 400 || body.ok === false) {
    const errorMessage =
      body.message ||
      (body.error && (body.error.message || body.error.code)) ||
      "图片上传失败";
    throw new Error(errorMessage);
  }

  const item = body.data && Array.isArray(body.data.items) ? body.data.items[0] : null;
  if (!item || !item.url) throw new Error("图片上传失败");

  return {
    ...item,
    url: item.url.startsWith("/") ? `${apiBaseUrl}${item.url}` : item.url
  };
};

const uploadNoteImage = (filePath) =>
  new Promise((resolve, reject) => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl) {
      reject(new Error("请先配置 API 地址"));
      return;
    }

    const storedAuth = getAuth();
    if (!storedAuth || !storedAuth.token) {
      reject(new Error("请先登录"));
      return;
    }

    wx.uploadFile({
      url: `${apiBaseUrl}/api/uploads/notes`,
      filePath,
      name: "file",
      timeout: API_TIMEOUT,
      header: {
        Authorization: `Bearer ${storedAuth.token}`
      },
      success: (res) => {
        try {
          resolve(parseUploadResponse(res, apiBaseUrl));
        } catch (error) {
          reject(error);
        }
      },
      fail: () => {
        reject(new Error("图片上传失败，请检查网络"));
      }
    });
  });

const uploadNoteImages = (filePaths = []) =>
  filePaths.reduce(
    (promise, filePath) =>
      promise.then((items) =>
        uploadNoteImage(filePath).then((item) => [...items, item])
      ),
    Promise.resolve([])
  );

const cleanupNoteUploads = (urls = []) => {
  if (!urls.length) return Promise.resolve();
  return require("../utils/request").request({
    url: "/api/uploads/notes",
    method: "DELETE",
    data: { urls }
  });
};

const cleanupOrQueueNoteUploads = async (urls = []) => {
  if (!urls.length) return;
  try {
    await cleanupNoteUploads(urls);
    removePendingUploadCleanup(urls);
  } catch (error) {
    addPendingUploadCleanup(urls);
    throw error;
  }
};

const retryPendingNoteUploadCleanup = async () => {
  const urls = readPendingUploadCleanup();
  if (!urls.length || !getAuth()) return false;
  for (let index = 0; index < urls.length; index += 9) {
    await cleanupOrQueueNoteUploads(urls.slice(index, index + 9));
  }
  return true;
};

const uploadNoteImagesWithCleanup = async (filePaths = []) => {
  const items = [];
  try {
    for (const filePath of filePaths) items.push(await uploadNoteImage(filePath));
    return items;
  } catch (error) {
    error.uploadedUrls = items.map((item) => item.url);
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
