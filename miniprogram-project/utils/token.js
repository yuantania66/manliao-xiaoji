const TOKEN_KEY = "xinqing_token";
const USER_KEY = "xinqing_user";

const getToken = () => wx.getStorageSync(TOKEN_KEY) || "";

const setToken = (token) => {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
};

const clearToken = () => {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
};

const clearAuth = () => {
  clearToken();
  try {
    const app = getApp();
    if (app?.globalData) {
      app.globalData.token = "";
      app.globalData.user = null;
      app.globalData.loggedIn = false;
    }
  } catch {
    // App may not be ready during early startup.
  }
};

const getUser = () => wx.getStorageSync(USER_KEY) || null;

const setUser = (user) => {
  if (user) wx.setStorageSync(USER_KEY, user);
};

module.exports = {
  clearAuth,
  clearToken,
  getToken,
  getUser,
  setToken,
  setUser
};
