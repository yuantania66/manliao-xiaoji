const { readChatMessages } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { searchMessages } = require("../../api/chat");

const formatTime = (value) => {
  const date = new Date(value);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

Page({
  data: {
    pageTop: 92,
    closeTop: 98,
    closeRight: 132,
    query: "",
    results: [],
    showEmpty: false,
    statusText: ""
  },

  onLoad() {
    this.updateSafeLayout();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      closeTop: layout.closeTop,
      closeRight: layout.closeRight
    });
  },

  onInput(event) {
    const query = event.detail.value.trim();
    const dataMode = getDataMode();
    if (!query) {
      this.setData({ query, results: [], showEmpty: false, statusText: "" });
      return;
    }

    if (dataMode === "authenticated") {
      searchMessages(query)
        .then((data) => {
          const results = (data.items || []).map((message) => ({
            id: message.id,
            sessionId: message.sessionId || "",
            text: message.content,
            timeLabel: formatTime(message.createdAt)
          }));
          this.setData({ query, results, showEmpty: results.length === 0, statusText: "" });
        })
        .catch((error) => {
          const message = error.message || "搜索失败，请稍后再试";
          this.setData({ query, results: [], showEmpty: false, statusText: message });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") {
      this.searchLocal(query);
      return;
    }

    this.setData({
      query,
      results: [],
      showEmpty: false,
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  searchLocal(query) {
    const results = query
      ? readChatMessages()
          .filter((message) => message.text.includes(query))
          .map((message) => ({ ...message, timeLabel: formatTime(message.createdAt) }))
      : [];
    this.setData({
      query,
      results,
      showEmpty: Boolean(query) && results.length === 0,
      statusText: "游客模式，只搜索本机聊天。"
    });
  },

  openResult(event) {
    const { id, sessionId } = event.currentTarget.dataset;
    const params = [
      sessionId ? `sessionId=${encodeURIComponent(sessionId)}` : "",
      id ? `messageId=${encodeURIComponent(id)}` : "",
      this.data.query ? `query=${encodeURIComponent(this.data.query)}` : ""
    ].filter(Boolean).join("&");
    const url = `/pages/chat/chat${params ? `?${params}` : ""}`;
    wx.navigateTo({
      url,
      fail: () => {
        wx.redirectTo({ url });
      }
    });
  }
});
