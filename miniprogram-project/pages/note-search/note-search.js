const { readNotes } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { captureIdentityAuthority, isCurrentIdentityAuthority, isCurrentAuthFailure } = require("../../utils/auth");
const { isOwnerPreview } = require("../../utils/owner-preview");
const { listAllNotes } = require("../../api/notes");

const signInText = () => isOwnerPreview() ? "请先登录。" : "请先登录，或在首页选择游客模式。";

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

  goBack() {
    const fallback = () => wx.redirectTo({ url: "/pages/note-history/note-history" });
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: fallback });
    else fallback();
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
    this.searchIdentity = null;
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
    if (isCurrentIdentityAuthority(this.searchIdentity)) return true;
    this.searchIdentity = captureIdentityAuthority();
    this.resetSearch(this.searchIdentity?.auth || this.searchIdentity?.guest ? "" : signInText());
    return false;
  },

  search(query) {
    const generation = (this.searchGeneration || 0) + 1;
    this.searchGeneration = generation;
    const { auth: authority, guest } = this.searchIdentity || {};
    this.setData({ query, results: [], resultGeneration: generation, showEmpty: false, statusText: authority || guest ? "" : signInText(), isSearching: false });
    if (!query) return;

    if (authority) {
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
          if (!this.searchVisible || generation !== this.searchGeneration) return;
          if (!this.syncSearchSession() && !isCurrentAuthFailure(authority, error)) return;
          const message = error.message || "搜索失败，请稍后再试";
          this.setData({ statusText: message, isSearching: false });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (guest) this.searchLocal(query);
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
