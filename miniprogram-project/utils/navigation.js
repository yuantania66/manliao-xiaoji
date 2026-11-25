// Close a secondary page without adding another copy of its destination.
const returnToPage = (url, { reset = false } = {}) => {
  const route = url.replace(/^\//, "").split("?")[0];
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  if (pages.length && pages[pages.length - 1].route === route) return;
  const fallback = () => {
    if (reset) {
      wx.reLaunch({ url });
    } else {
      wx.redirectTo({ url, fail: () => wx.reLaunch({ url }) });
    }
  };
  for (let index = pages.length - 2; index >= 0; index -= 1) {
    if (pages[index].route === route) {
      wx.navigateBack({ delta: pages.length - 1 - index, fail: fallback });
      return;
    }
  }
  fallback();
};

module.exports = { returnToPage };
