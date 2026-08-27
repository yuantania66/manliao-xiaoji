const { getSafeLayout } = require("../../utils/layout");
const { getAuth, getDataMode } = require("../../utils/auth");
const { authorizeInsights, getInsights } = require("../../api/insights");

const INSIGHTS_AUTH_KEY = "xinqingInsightsAuthorization:v1";

const ranges = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "90d", label: "最近90天" }
];

const getIdentityKey = (auth, authorization) =>
  auth && auth.user && authorization
    ? `${auth.user.id}:${authorization.consentToken}`
    : "";

Page({
  data: {
    authorized: false,
    isAuthenticated: false,
    ranges,
    range: "30d",
    words: [],
    sourceCounts: { notes: 0, userMessages: 0 },
    isLoading: false,
    errorText: "",
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    const auth = getAuth();
    const authorized = Boolean(this.getStoredAuthorization(auth));
    const authorization = this.getStoredAuthorization(auth);
    const isAuthenticated = Boolean(auth);
    this.insightsIdentityKey = getIdentityKey(auth, authorization);
    this.setData({
      authorized,
      isAuthenticated,
      backTop: layout.backTop
    });
    if (authorized && isAuthenticated) this.loadInsights("30d");
  },

  onShow() {
    const auth = getAuth();
    const authorization = this.getStoredAuthorization(auth);
    const authorized = Boolean(authorization);
    const isAuthenticated = Boolean(auth);
    const identityKey = getIdentityKey(auth, authorization);
    const identityChanged = identityKey !== (this.insightsIdentityKey || "");
    if (identityChanged) {
      this.insightsRequestId = (this.insightsRequestId || 0) + 1;
      this.insightsAuthorizationId = (this.insightsAuthorizationId || 0) + 1;
      this.authorizationPending = false;
      this.insightsIdentityKey = identityKey;
    }
    this.setData({
      authorized,
      isAuthenticated,
      ...(identityChanged
        ? { words: [], sourceCounts: { notes: 0, userMessages: 0 }, isLoading: false, errorText: "" }
        : {})
    });
    if (authorized && isAuthenticated && this.data.words.length === 0) {
      this.loadInsights(this.data.range);
    }
  },

  getStoredAuthorization(auth = getAuth()) {
    if (!auth || !auth.user || typeof auth.user.id !== "string") return null;
    const stored = wx.getStorageSync(INSIGHTS_AUTH_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const expiresAt = new Date(stored.expiresAt).getTime();
    if (
      stored.userId !== auth.user.id ||
      typeof stored.consentToken !== "string" ||
      !stored.consentToken ||
      typeof stored.expiresAt !== "string" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return null;
    }
    return stored;
  },

  isCurrentAuthorization(userId, consentToken) {
    const auth = getAuth();
    const authorization = this.getStoredAuthorization(auth);
    return Boolean(auth && auth.user && auth.user.id === userId && authorization && authorization.consentToken === consentToken);
  },

  isCurrentAuth(userId, token) {
    const auth = getAuth();
    return Boolean(auth && auth.user && auth.user.id === userId && auth.token === token);
  },

  authorize() {
    if (this.authorizationPending) return;
    if (getDataMode() !== "authenticated") {
      this.setData({ isAuthenticated: false, errorText: "请先登录，再查看基于云端记录生成的观察。" });
      return;
    }
    const auth = getAuth();
    if (!auth || !auth.user || !auth.user.id) return;
    const authorizationId = (this.insightsAuthorizationId || 0) + 1;
    const requestUserId = auth.user.id;
    const requestAuthToken = auth.token;
    this.insightsAuthorizationId = authorizationId;
    this.authorizationPending = true;
    this.setData({ errorText: "" });
    authorizeInsights()
      .then((result) => {
        if (this.insightsAuthorizationId !== authorizationId || !this.isCurrentAuth(requestUserId, requestAuthToken)) return;
        const authorization = {
          userId: requestUserId,
          consentToken: result.consentToken,
          expiresAt: result.expiresAt
        };
        wx.setStorageSync(INSIGHTS_AUTH_KEY, authorization);
        this.insightsIdentityKey = getIdentityKey(auth, authorization);
        this.setData({ authorized: true, isAuthenticated: true });
        return this.loadInsights(this.data.range, authorization);
      })
      .catch((error) => {
        if (this.insightsAuthorizationId !== authorizationId || !this.isCurrentAuth(requestUserId, requestAuthToken)) return;
        this.setData({ authorized: false, errorText: error.message || "观察授权暂时无法完成，请稍后重试。" });
      })
      .finally(() => {
        if (this.insightsAuthorizationId === authorizationId) this.authorizationPending = false;
      });
  },

  changeRange(event) {
    const range = event.currentTarget.dataset.key;
    this.setData({ range });
    this.loadInsights(range);
  },

  loadInsights(range, suppliedAuthorization = null) {
    if (getDataMode() !== "authenticated" || this.data.isLoading) return;
    const authorization = suppliedAuthorization || this.getStoredAuthorization();
    if (!authorization) {
      this.setData({ authorized: false, words: [], sourceCounts: { notes: 0, userMessages: 0 } });
      return;
    }
    const requestId = (this.insightsRequestId || 0) + 1;
    const auth = getAuth();
    const requestUserId = auth && auth.user && auth.user.id;
    const requestConsentToken = authorization.consentToken;
    this.insightsRequestId = requestId;
    this.setData({ isLoading: true, errorText: "", words: [], sourceCounts: { notes: 0, userMessages: 0 } });
    return getInsights(Number(range.replace("d", "")), authorization.consentToken)
      .then((result) => {
        if (this.insightsRequestId !== requestId || !this.isCurrentAuthorization(requestUserId, requestConsentToken)) return;
        this.setData({
          words: (result.words || []).map((item) => ({ ...item, countText: `${item.count} 次` })),
          sourceCounts: result.sourceCounts || { notes: 0, userMessages: 0 }
        });
      })
      .catch((error) => {
        if (this.insightsRequestId !== requestId || !this.isCurrentAuthorization(requestUserId, requestConsentToken)) return;
        const authorizationRejected = String(error.message || "").includes("授权慢聊小记观察");
        if (authorizationRejected) wx.removeStorageSync(INSIGHTS_AUTH_KEY);
        this.setData({
          authorized: authorizationRejected ? false : this.data.authorized,
          words: [],
          errorText: error.message || "观察暂时无法加载，请稍后重试。"
        });
      })
      .finally(() => {
        if (this.insightsRequestId === requestId && this.isCurrentAuthorization(requestUserId, requestConsentToken)) {
          this.setData({ isLoading: false });
        }
      });
  }
});
