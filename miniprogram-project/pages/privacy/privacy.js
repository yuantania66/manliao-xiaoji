const { getSafeLayout } = require("../../utils/layout");
const { getAuthSession, isCurrentAuthSession } = require("../../utils/auth");
const { request } = require("../../utils/request");

const consentPath = "/api/settings/training-consent";
const noticeVersion = "chat_reply_training_candidates_v1";

const emptyConsent = {
  trainingStatus: "loading",
  trainingEnabled: false,
  trainingNoticeCurrent: false,
  trainingMessage: ""
};

Page({
  data: {
    backTop: 54,
    ...emptyConsent
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  onShow() {
    this.visible = true;
    return this.loadTrainingConsent();
  },

  onHide() {
    this.clearTrainingSession();
    this.setData(emptyConsent);
  },

  onUnload() {
    this.clearTrainingSession();
  },

  clearTrainingSession() {
    this.visible = false;
    this.activeConsentRequest = null;
    this.consentSession = null;
  },

  loadTrainingConsent() {
    return this.requestTrainingConsent();
  },

  toggleTrainingConsent() {
    if (!this.visible || this.data.trainingStatus !== "ready") return;
    if (!this.consentSession || !isCurrentAuthSession(this.consentSession)) return this.loadTrainingConsent();
    if (!this.data.trainingEnabled && !this.data.trainingNoticeCurrent) return;
    return this.requestTrainingConsent(!this.data.trainingEnabled);
  },

  async requestTrainingConsent(enabled) {
    if (!this.visible || this.activeConsentRequest) return;
    const session = getAuthSession();
    this.consentSession = session;
    if (!session.token || !session.userId) {
      this.setData({ ...emptyConsent, trainingStatus: "guest" });
      return;
    }

    const attempt = {};
    this.activeConsentRequest = attempt;
    this.setData({ ...emptyConsent, trainingStatus: enabled === undefined ? "loading" : "saving" });
    const canApply = () => {
      if (!this.visible || this.activeConsentRequest !== attempt) return false;
      if (isCurrentAuthSession(session)) return true;
      this.activeConsentRequest = null;
      void this.loadTrainingConsent();
      return false;
    };
    try {
      const consent = await request({
        url: consentPath,
        ...(enabled === undefined ? {} : { method: "PUT", data: { enabled, noticeVersion } })
      });
      if (!canApply()) return;
      if (!consent || typeof consent.enabled !== "boolean" || typeof consent.noticeVersion !== "string" ||
        (enabled !== undefined && consent.enabled !== enabled) ||
        (enabled === true && consent.noticeVersion !== noticeVersion)) throw new Error("Invalid training consent response");
      this.setData({
        trainingStatus: "ready",
        trainingEnabled: consent.enabled,
        trainingNoticeCurrent: consent.noticeVersion === noticeVersion,
        trainingMessage: enabled === undefined ? "" : enabled ? "已开启授权。" : "已撤回授权，关联候选已清除。"
      });
    } catch {
      if (canApply()) this.setData({ ...emptyConsent, trainingStatus: "error" });
    } finally {
      if (this.activeConsentRequest === attempt) this.activeConsentRequest = null;
    }
  }
});
