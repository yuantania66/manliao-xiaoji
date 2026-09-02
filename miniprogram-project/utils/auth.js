const AUTH_KEY = "xinqingAuth";
const GUEST_KEY = "xinqingGuestMode";
const GUEST_PROFILE_KEY = "xinqingGuestProfile";
const ACCOUNT_CACHE_KEYS = [
  "xinqingInsightsAnalysisAuthorized",
  "xinqingInsightsAuthorization:v1"
];

// Login contract without the freshness check: token, expiresAt, and user.id must
// all be well-formed. Only structurally valid sessions may mint a draft owner claim.
const isStructurallyValidAuth = (auth) => {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return false;
  if (typeof auth.token !== "string" || !auth.token || auth.token.startsWith("local_demo_")) return false;
  if (typeof auth.expiresAt !== "string") return false;
  if (!auth.user || typeof auth.user !== "object" || Array.isArray(auth.user)) return false;
  if (typeof auth.user.id !== "string" || !auth.user.id.trim()) return false;
  const expiresAt = new Date(auth.expiresAt).getTime();
  return Number.isFinite(expiresAt);
};

const isUsableAuth = (auth, now = Date.now()) => {
  if (!isStructurallyValidAuth(auth)) return false;
  return new Date(auth.expiresAt).getTime() > now;
};

const extractClaimableAuthenticatedOwner = (auth) => {
  if (!isStructurallyValidAuth(auth)) return null;
  return `authenticated:${auth.user.id.trim()}`;
};

const readRawAuth = () => {
  try {
    return wx.getStorageSync(AUTH_KEY) || null;
  } catch (error) {
    return null;
  }
};

const removeRawAuthQuietly = () => {
  try {
    wx.removeStorageSync(AUTH_KEY);
  } catch (error) {}
};

const claimLegacyDraftForStoredOwner = (owner) => {
  if (!owner || owner === "none" || owner === "guest") return;
  require("./local-data").claimLegacyNoteDraft(owner);
};

// Soft read path: never restore expired/malformed login. On claim/seal failure keep the
// raw record for retry and return null without throwing.
const getAuth = () => {
  const auth = readRawAuth();
  if (!auth) return null;
  if (isUsableAuth(auth)) return auth;

  const expiredOwner = extractClaimableAuthenticatedOwner(auth);
  if (expiredOwner) {
    try {
      claimLegacyDraftForStoredOwner(expiredOwner);
    } catch (error) {
      return null;
    }
  } else {
    try {
      require("./local-data").sealUnownedLegacyNoteDraft();
    } catch (error) {
      return null;
    }
  }
  removeRawAuthQuietly();
  return null;
};

const getDataOwner = () => {
  const auth = getAuth();
  if (auth) return `authenticated:${auth.user.id}`;
  if (isGuest()) return "guest";
  return "none";
};

// Hard prep path for identity changes. Claim/seal must succeed before any caller
// writes a new login, enters guest, or clears identity. Failure throws and leaves
// the previous raw auth / guest marker / legacy draft untouched.
const ensureLegacyDraftSafeBeforeIdentityChange = (nextOwner) => {
  const localData = require("./local-data");
  let rawAuth = null;
  try {
    rawAuth = wx.getStorageSync(AUTH_KEY) || null;
  } catch (error) {
    throw new Error("草稿归属暂时无法确认");
  }

  if (rawAuth) {
    if (isUsableAuth(rawAuth)) {
      const owner = `authenticated:${rawAuth.user.id.trim()}`;
      if (owner !== nextOwner) localData.claimLegacyNoteDraft(owner);
    } else if (isStructurallyValidAuth(rawAuth)) {
      const owner = extractClaimableAuthenticatedOwner(rawAuth);
      if (owner) localData.claimLegacyNoteDraft(owner);
      removeRawAuthQuietly();
    } else {
      localData.sealUnownedLegacyNoteDraft();
      removeRawAuthQuietly();
    }
  }

  if (isGuest() && nextOwner !== "guest") {
    localData.claimLegacyNoteDraft("guest");
  }
};

const saveAuth = (auth) => {
  if (!isUsableAuth(auth)) throw new Error("登录响应无效");
  ensureLegacyDraftSafeBeforeIdentityChange(`authenticated:${auth.user.id}`);
  // Persist the authenticated identity before changing the active guest marker.
  // Guest-owned content stays isolated in its own keys and remains recoverable.
  wx.setStorageSync(AUTH_KEY, auth);
  try { wx.removeStorageSync(GUEST_KEY); } catch (error) {}
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
  ensureLegacyDraftSafeBeforeIdentityChange("none");
  wx.removeStorageSync(AUTH_KEY);
  wx.removeStorageSync(GUEST_KEY);
  ACCOUNT_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  const app = getApp();
  app.globalData.user = null;
  app.globalData.token = "";
};

const clearCancelledAccount = (userId) => {
  if (!userId) throw new Error("当前账号标识不可用");
  wx.removeStorageSync(AUTH_KEY);
  ACCOUNT_CACHE_KEYS.forEach((key) => wx.removeStorageSync(key));
  if (userId) {
    [`xinqingMiniChatMessages:${userId}`, `xinqingMiniNotes:${userId}`]
      .forEach((key) => wx.removeStorageSync(key));
  }
  const remainingKeys = new Set([AUTH_KEY, ...ACCOUNT_CACHE_KEYS, `xinqingMiniChatMessages:${userId}`, `xinqingMiniNotes:${userId}`]);
  const storedKeys = wx.getStorageInfoSync().keys || [];
  if (storedKeys.some((key) => remainingKeys.has(key))) {
    throw new Error("本机账号数据清理失败");
  }
  const app = getApp();
  app.globalData.user = null;
  app.globalData.token = "";
};

const enterGuest = () => {
  const rawBefore = readRawAuth();
  const previousAuth = isUsableAuth(rawBefore) ? rawBefore : null;
  ensureLegacyDraftSafeBeforeIdentityChange("guest");
  wx.setStorageSync(GUEST_KEY, true);
  if (previousAuth) {
    try {
      wx.removeStorageSync(AUTH_KEY);
      if (getAuth()) throw new Error("账号状态暂时无法切换");
    } catch (error) {
      let rollbackError = null;
      try { wx.setStorageSync(AUTH_KEY, previousAuth); } catch (restoreError) { rollbackError = restoreError; }
      try { wx.removeStorageSync(GUEST_KEY); } catch (removeError) {
        try { wx.setStorageSync(GUEST_KEY, false); } catch (deactivateError) { rollbackError = rollbackError || deactivateError; }
      }
      const app = getApp();
      app.globalData.user = previousAuth.user;
      app.globalData.token = previousAuth.token;
      if (rollbackError) throw new Error("身份切换回滚失败");
      throw error;
    }
  }
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
  getDataOwner,
  isUsableAuth
};
