const { getCurrentUser } = require("./api/auth");
const { clearAuth, getToken, getUser } = require("./utils/token");

App({
  globalData: {
    loggedIn: false,
    token: "",
    user: null
  },

  onLaunch() {
    const token = getToken();
    const user = getUser();
    this.globalData.token = token;
    this.globalData.user = user;
    this.globalData.loggedIn = !!token;

    if (token) {
      getCurrentUser()
        .then((currentUser) => {
          this.globalData.user = currentUser;
          this.globalData.loggedIn = true;
        })
        .catch(() => {
          this.clearAuth();
        });
    }
  },

  setAuth({ token = "", user = null } = {}) {
    this.globalData.token = token;
    this.globalData.user = user;
    this.globalData.loggedIn = !!token;
  },

  clearAuth() {
    clearAuth();
  }
});
