Page({
  data: {
    searchQuery: "",
    showFirst: true,
    showSecond: true
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goNote() {
    wx.navigateTo({ url: "/pages/note/note" });
  },

  updateSearch(event) {
    const searchQuery = event.detail.value;
    const keyword = searchQuery.trim();
    const firstText = "2026 年 6 月 6 月 2 日 星期二 先放在这里。今晚不用一直握着它。今天有点累，不太想解释。";
    const secondText = "2026 年 6 月 6 月 1 日 星期一 晚风吹过来的时候，我轻了一点。回家路上的风 视频";
    this.setData({
      searchQuery,
      showFirst: !keyword || firstText.includes(keyword),
      showSecond: !keyword || secondText.includes(keyword)
    });
  }
});
