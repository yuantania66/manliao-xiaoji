const { getSafeLayout } = require("../../utils/layout");

const ranges = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "90d", label: "最近90天" }
];

const wordsByRange = {
  "7d": [
    { word: "工作", count: "3 次", sentiment: "positive" },
    { word: "松弛", count: "2 次", sentiment: "positive" },
    { word: "加班", count: "2 次", sentiment: "negative" },
    { word: "想念", count: "1 次", sentiment: "neutral" }
  ],
  "30d": [
    { word: "工作", count: "6 次", sentiment: "neutral" },
    { word: "疲惫", count: "5 次", sentiment: "negative" },
    { word: "期待", count: "3 次", sentiment: "positive" },
    { word: "关系", count: "2 次", sentiment: "neutral" },
    { word: "成长", count: "2 次", sentiment: "positive" },
    { word: "焦虑", count: "2 次", sentiment: "negative" }
  ],
  "90d": [
    { word: "调整", count: "11 次", sentiment: "positive" },
    { word: "工作", count: "9 次", sentiment: "negative" },
    { word: "家人", count: "7 次", sentiment: "neutral" },
    { word: "计划", count: "6 次", sentiment: "positive" }
  ]
};

Page({
  data: {
    authorized: false,
    ranges,
    range: "30d",
    words: wordsByRange["30d"],
    backTop: 54
  },

  onLoad() {
    const layout = getSafeLayout();
    this.setData({
      authorized: wx.getStorageSync("xinqingInsightsAnalysisAuthorized") === true,
      backTop: layout.backTop
    });
  },

  authorize() {
    wx.setStorageSync("xinqingInsightsAnalysisAuthorized", true);
    this.setData({ authorized: true });
  },

  changeRange(event) {
    const range = event.currentTarget.dataset.key;
    this.setData({ range, words: wordsByRange[range] });
  }
});
