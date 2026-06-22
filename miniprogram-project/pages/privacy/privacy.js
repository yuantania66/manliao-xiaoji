const { getSafeLayout } = require("../../utils/layout");

Page({
  data: {
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  }
});
