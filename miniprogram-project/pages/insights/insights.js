const { getSafeLayout } = require("../../utils/layout");
const { captureIdentityAuthority, isCurrentIdentityAuthority } = require("../../utils/auth");
const { authorizeInsights, getInsights } = require("../../api/insights");

const ranges = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "90d", label: "最近90天" }
];
const emptyCounts = () => ({ notes: 0, userMessages: 0 });
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const loadError = "观察暂时无法加载，请稍后重试。";

Page({
  data: {
    authorized: false,
    isAuthenticated: false,
    isAuthorizing: false,
    ranges,
    range: "30d",
    words: [],
    sourceCounts: emptyCounts(),
    isLoading: false,
    errorText: "",
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  onShow() {
    this.visible = true;
    this.syncSession();
  },

  onHide() {
    this.visible = false;
    this.withdraw();
  },

  onUnload() {
    this.onHide();
    this.session = null;
  },

  syncSession() {
    if (isCurrentIdentityAuthority(this.session)) return true;
    this.session = captureIdentityAuthority();
    this.withdraw();
    this.setData({ isAuthenticated: Boolean(this.session?.auth) });
    return false;
  },

  authorize() {
    if (!this.visible || !this.syncSession() || this.data.authorized || this.authorizationAttempt) return;
    if (!this.data.isAuthenticated) {
      this.setData({ errorText: "请先登录，再查看基于云端记录生成的观察。" });
      return;
    }
    const attempt = {};
    this.authorizationAttempt = attempt;
    this.setData({ isAuthorizing: true, errorText: "" });
    const canApply = () => this.visible && this.syncSession() && this.authorizationAttempt === attempt;
    return authorizeInsights()
      .then((result) => {
        if (!canApply()) return;
        if (typeof result?.consentToken !== "string" || !result.consentToken.trim() ||
            typeof result.expiresAt !== "string" || !(Date.parse(result.expiresAt) > Date.now())) {
          throw new Error("观察授权暂时无法完成，请稍后重试。");
        }
        this.consentToken = result.consentToken;
        this.setData({ authorized: true });
        return this.loadInsights(this.data.range);
      })
      .catch((error) => {
        if (canApply()) this.setData({ errorText: error.message || "观察授权暂时无法完成，请稍后重试。" });
      })
      .finally(() => {
        if (canApply()) {
          this.authorizationAttempt = null;
          this.setData({ isAuthorizing: false });
        }
      });
  },

  withdraw() {
    this.authorizationAttempt = null;
    this.insightAttempt = null;
    this.consentToken = null;
    this.setData({
      authorized: false,
      isAuthorizing: false,
      range: "30d",
      words: [],
      sourceCounts: emptyCounts(),
      isLoading: false,
      errorText: ""
    });
  },

  changeRange(event) {
    const range = event.currentTarget.dataset.key;
    if (!ranges.some(({ key }) => key === range)) return;
    if (range === this.data.range && this.data.isLoading) return;
    return this.loadInsights(range);
  },

  loadInsights(range) {
    if (!this.visible || !this.syncSession() || !this.consentToken) return;
    const attempt = {};
    this.insightAttempt = attempt;
    this.setData({ range, isLoading: true, errorText: "", words: [], sourceCounts: emptyCounts() });
    const rangeDays = Number(range.replace("d", ""));
    const canApply = () => this.visible && this.syncSession() && this.insightAttempt === attempt;
    return getInsights(rangeDays, this.consentToken)
      .then((result) => {
        if (!canApply()) return;
        if (result?.rangeDays !== rangeDays || !Array.isArray(result.words) ||
            result.words.some((item) => typeof item?.word !== "string" || !item.word.trim() || !isCount(item.count) || item.count === 0) ||
            !isCount(result.sourceCounts?.notes) || !isCount(result.sourceCounts?.userMessages)) {
          throw new Error(loadError);
        }
        const { notes, userMessages } = result.sourceCounts;
        this.setData({
          words: result.words.map(({ word, count }) => ({ word, countText: count + " 次" })),
          sourceCounts: { notes, userMessages }
        });
      })
      .catch((error) => {
        if (!canApply()) return;
        if (error.statusCode === 403) this.withdraw();
        this.setData({ errorText: error.message || loadError });
      })
      .finally(() => {
        if (canApply()) {
          this.insightAttempt = null;
          this.setData({ isLoading: false });
        }
      });
  }
});
