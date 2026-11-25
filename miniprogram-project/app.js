const { getAuth } = require("./utils/auth");
const { recordVisit } = require("./utils/visit-growth");

App({
  globalData: {
    user: null,
    token: ""
  },

  onLaunch() {
    const auth = getAuth();
    if (auth && auth.token) {
      this.globalData.user = auth.user || null;
      this.globalData.token = auth.token;
    }
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(({ isConnected }) => {
      if (isConnected && this.growthVisible) this.recordGrowth();
    });
  },

  onShow() {
    this.growthVisible = true;
    this.recordGrowth();
  },

  onHide() { this.growthVisible = false; },

  recordGrowth() {
    // Failure never blocks login or creates a client-side/backdated visit.
    return recordVisit().catch(() => null);
  }
});
