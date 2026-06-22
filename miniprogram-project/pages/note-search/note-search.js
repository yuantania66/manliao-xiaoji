const { readNotes } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { listNotes } = require("../../api/notes");

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
      listNotes("?pageSize=50")
        .then((data) => {
          const results = (data.items || [])
            .filter((note) => note.content.includes(query) || `${note.moodName || ""}${note.moodIcon || ""}`.includes(query))
            .map((note) => ({
              id: note.id,
              content: note.content,
              dateLabel: note.recordDate || note.createdAt
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
      ? readNotes().filter((note) => note.content.includes(query) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(query)))
      : [];
    this.setData({
      query,
      results,
      showEmpty: Boolean(query) && results.length === 0,
      statusText: "游客模式，只搜索本机小记。"
    });
  }
});
