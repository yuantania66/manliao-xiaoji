const AUTH_KEY = "xinqingAuth";
const GUEST_KEY = "xinqingGuestMode";
const GUEST_PROFILE_KEY = "xinqingGuestProfile";
const USER_CACHE_KEYS = [
  "xinqingMiniChatMessages",
  "xinqingMiniNotes",
  "xinqingMiniGuestChatMessages",
  "xinqingMiniGuestNotes",
  "xinqingInsightsAnalysisAuthorized",
  "xinqingInsightsAuthorization:v1"
];
const GUEST_CACHE_KEYS = new Set([
  "xinqingMiniGuestChatMessages",
  "xinqingMiniGuestNotes"
]);

const isUsableAuth = (auth, now = Date.now()) => {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return false;
  if (typeof auth.token !== "string" || !auth.token || auth.token.startsWith("local_demo_")) return false;
  if (typeof auth.expiresAt !== "string") return false;
  if (!auth.user || typeof auth.user !== "object" || Array.isArray(auth.user)) return false;
  if (typeof auth.user.id !== "string" || !auth.user.id.trim()) return false;
  const expiresAt = new Date(auth.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
};

const getAuth = () => {
  let auth = null;
  try {
    auth = wx.getStorageSync(AUTH_KEY) || null;
  } catch (error) {
    return null;
  }
  if (!isUsableAuth(auth)) {
    wx.removeStorageSync(AUTH_KEY);
    return null;
  }
  return auth;
};

const saveAuth = (auth) => {
  if (!isUsableAuth(auth)) throw new Error("登录响应无效");
  wx.removeStorageSync(GUEST_KEY);
  USER_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  wx.setStorageSync(AUTH_KEY, auth);
  const app = getApp();
  app.globalData.user = auth.user || null;
  app.globalData.token = auth.token || "";
};

const updateCachedUser = (expectedUserId, user) => {
  const auth = getAuth();
  if (!auth || !user || auth.user.id !== expectedUserId || user.id !== expectedUserId) {
    throw new Error("账号已切换，请重试");
  }
  const updated = { ...auth, user: { ...auth.user, ...user } };
  wx.setStorageSync(AUTH_KEY, updated);
  const app = getApp();
  app.globalData.user = updated.user;
  return updated;
};

const clearAuth = () => {
  wx.removeStorageSync(AUTH_KEY);
  wx.removeStorageSync(GUEST_KEY);
  USER_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  const app = getApp();
  app.globalData.user = null;
  app.globalData.token = "";
};

const clearCancelledAccount = (userId) => {
  if (!userId) throw new Error("当前账号标识不可用");
  wx.removeStorageSync(AUTH_KEY);
  const accountCacheKeys = USER_CACHE_KEYS.filter((key) => !GUEST_CACHE_KEYS.has(key));
  accountCacheKeys.forEach((key) => wx.removeStorageSync(key));
  if (userId) {
    [`xinqingMiniChatMessages:${userId}`, `xinqingMiniNotes:${userId}`]
      .forEach((key) => wx.removeStorageSync(key));
  }
  const remainingKeys = new Set([AUTH_KEY, ...accountCacheKeys, `xinqingMiniChatMessages:${userId}`, `xinqingMiniNotes:${userId}`]);
  const storedKeys = wx.getStorageInfoSync().keys || [];
  if (storedKeys.some((key) => remainingKeys.has(key))) {
    throw new Error("本机账号数据清理失败");
  }
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

const setGuestProfile = (profile) => {
  if (!profile || typeof profile.nickname !== "string" || !profile.nickname.trim()) {
    throw new Error("游客昵称无效");
  }
  wx.setStorageSync(GUEST_PROFILE_KEY, {
    nickname: profile.nickname.trim(),
    avatarIndex: Number.isInteger(profile.avatarIndex) ? profile.avatarIndex : 0
  });
};

const getGuestProfile = () => {
  const profile = wx.getStorageSync(GUEST_PROFILE_KEY);
  return profile && typeof profile.nickname === "string" ? profile : null;
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
  updateCachedUser,
  clearAuth,
  clearCancelledAccount,
  enterGuest,
  setGuestProfile,
  getGuestProfile,
  isGuest,
  isAuthenticated,
  getDataMode,
  isUsableAuth
};
