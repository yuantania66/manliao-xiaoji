const AUTH_KEY = "xinqingAuth";
const GUEST_KEY = "xinqingGuestMode";
const USER_CACHE_KEYS = [
  "xinqingMiniChatMessages",
  "xinqingMiniNotes"
];

const getAuth = () => {
  const auth = wx.getStorageSync(AUTH_KEY) || null;
  if (auth && auth.token && String(auth.token).startsWith("local_demo_")) {
    wx.removeStorageSync(AUTH_KEY);
    return null;
  }
  return auth;
};

const saveAuth = (auth) => {
  wx.setStorageSync(AUTH_KEY, auth);
  wx.removeStorageSync(GUEST_KEY);
  USER_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  const app = getApp();
  app.globalData.user = auth.user || null;
  app.globalData.token = auth.token || "";
};

const clearAuth = () => {
  wx.removeStorageSync(AUTH_KEY);
  wx.removeStorageSync(GUEST_KEY);
  USER_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  const app = getApp();
  app.globalData.user = null;
  app.globalData.token = "";
};

const enterGuest = () => {
  wx.removeStorageSync(AUTH_KEY);
  wx.setStorageSync(GUEST_KEY, true);
  const app = getApp();
  app.globalData.user = null;
  app.globalData.token = "";
};

const isGuest = () => wx.getStorageSync(GUEST_KEY) === true;

const isAuthenticated = () => {
  const auth = getAuth();
  return !!(auth && auth.token && !String(auth.token).startsWith("local_demo_"));
};

const getDataMode = () => {
  if (isAuthenticated()) return "authenticated";
  if (isGuest()) return "guest";
  return "none";
};

module.exports = {
  getAuth,
  saveAuth,
  clearAuth,
  enterGuest,
  isGuest,
  isAuthenticated,
  getDataMode
};
