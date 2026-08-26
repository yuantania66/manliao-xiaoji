const { readNotes } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { listAllNotes } = require("../../api/notes");

Page({
  data: {
    pageTop: 92,
    closeTop: 98,
    closeRight: 132,
    query: "",
    results: [],
    showEmpty: false,
    statusText: "",
    isSearching: false
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
    const generation = (this.searchGeneration || 0) + 1;
    this.searchGeneration = generation;
    this.setData({ query });
    const dataMode = getDataMode();
    if (!query) {
      this.setData({ query, results: [], showEmpty: false, statusText: "", isSearching: false });
      return;
    }

    if (dataMode === "authenticated") {
      this.setData({ isSearching: true, statusText: "正在搜索…" });
      listAllNotes()
        .then((items) => {
          if (generation !== this.searchGeneration || query !== this.data.query.trim()) return;
          const results = items
            .filter((note) => note.content.includes(query) || `${note.moodName || ""}${note.moodIcon || ""}`.includes(query))
            .map((note) => ({
              id: note.id,
              content: note.content,
              dateKey: note.recordDate || "",
              dateLabel: note.recordDate || note.createdAt
            }));
          this.setData({ query, results, showEmpty: results.length === 0, statusText: "", isSearching: false });
        })
        .catch((error) => {
          if (generation !== this.searchGeneration) return;
          const message = error.message || "搜索失败，请稍后再试";
          this.setData({ query, results: [], showEmpty: false, statusText: message, isSearching: false });
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
      isSearching: false,
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
      isSearching: false,
      statusText: "游客模式，只搜索本机小记。"
    });
  }
});
