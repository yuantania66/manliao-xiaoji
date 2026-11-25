const { readNotes } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getAuthSession, getDataMode, isCurrentAuthSession } = require("../../utils/auth");
const { listAllNotes } = require("../../api/notes");

const signInText = "请先登录，或在首页选择游客模式。";

Page({
  data: {
    pageTop: 92,
    closeTop: 98,
    closeRight: 132,
    query: "",
    results: [],
    resultGeneration: 0,
    showEmpty: false,
    statusText: "",
    isSearching: false
  },

  onLoad() {
    this.updateSafeLayout();
  },

  onShow() {
    this.searchVisible = true;
    const query = this.hiddenQuery;
    this.hiddenQuery = "";
    if (this.syncSearchSession() && query) this.search(query);
  },

  onHide() {
    this.searchVisible = false;
    this.hiddenQuery = this.data.query;
    this.resetSearch();
  },

  onUnload() {
    this.searchVisible = false;
    this.hiddenQuery = "";
    this.searchSession = null;
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
    if (!this.searchVisible || !this.syncSearchSession()) return;
    this.search(event.detail.value.trim());
  },

  resetSearch(statusText = "") {
    this.searchGeneration = (this.searchGeneration || 0) + 1;
    this.setData({ query: "", results: [], showEmpty: false, statusText, isSearching: false });
  },

  syncSearchSession() {
    if (this.searchSession && isCurrentAuthSession(this.searchSession)) return true;
    this.searchSession = getAuthSession();
    this.resetSearch(getDataMode() === "none" ? signInText : "");
    return false;
  },

  search(query) {
    const generation = (this.searchGeneration || 0) + 1;
    this.searchGeneration = generation;
    const dataMode = getDataMode();
    this.setData({ query, results: [], resultGeneration: generation, showEmpty: false, statusText: dataMode === "none" ? signInText : "", isSearching: false });
    if (!query) return;

    if (dataMode === "authenticated") {
      this.setData({ isSearching: true, statusText: "正在搜索…" });
      const isSearchCurrent = () => this.searchVisible && generation === this.searchGeneration && this.syncSearchSession();
      listAllNotes({}, isSearchCurrent)
        .then((items) => {
          if (!isSearchCurrent()) return;
          const results = items
            .filter((note) => note.content.includes(query) || `${note.moodName || ""}${note.moodIcon || ""}`.includes(query))
            .map((note) => ({
              id: note.id,
              content: note.content,
              dateKey: note.recordDate || "",
              dateLabel: note.recordDate || note.createdAt
            }));
          this.setData({ results, showEmpty: results.length === 0, statusText: "", isSearching: false });
        })
        .catch((error) => {
          if (!isSearchCurrent()) return;
          const message = error.message || "搜索失败，请稍后再试";
          this.setData({ statusText: message, isSearching: false });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") this.searchLocal(query);
  },

  searchLocal(query) {
    const results = readNotes().filter((note) => note.content.includes(query) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(query)));
    this.setData({
      results,
      showEmpty: results.length === 0,
      statusText: "游客模式，只搜索本机小记。"
    });
  },

  openResult(event) {
    if (!this.searchVisible || !this.syncSearchSession()) return;
    const { id, generation } = event.currentTarget.dataset;
    if (Number(generation) !== this.searchGeneration) return;
    const note = this.data.results.find((item) => item.id === id);
    if (!note) return;
    const date = encodeURIComponent(note.dateKey || "");
    wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(note.id)}&date=${date}` });
  }
});
