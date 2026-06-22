const { getAuth } = require("./utils/auth");

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
  }
});
