const { readNotes } = require("../../utils/local-data");
const { getAuthSession, getDataMode, isCurrentAuthSession } = require("../../utils/auth");
const { listAllNotes } = require("../../api/notes");
const { getSafeLayout } = require("../../utils/layout");

const signInText = "请先登录，或在首页选择游客模式。";

const titleOf = (content, note = {}) => {
  const trimmed = content.trim();
  if (!trimmed && note.displayTitle) return note.displayTitle;
  if (!trimmed && ((note.images && note.images.length) || (note.mediaUrls && note.mediaUrls.length))) {
    return "图片小记";
  }
  return trimmed.length > 18 ? `${trimmed.slice(0, 17)}...` : trimmed || "这一刻已经被收下。";
};

const normalizeRemoteNote = (note) => ({
  id: note.id,
  content: note.content,
  dateKey: note.recordDate,
  dateLabel: note.recordDate || note.createdAt,
  mood: note.moodName ? { name: note.moodName, desc: note.moodIcon || "" } : null,
  images: Array.isArray(note.mediaUrls) ? note.mediaUrls.map((url) => ({ url })).slice(0, 9) : [],
  title: titleOf(note.content, note)
});

Page({
  data: {
    query: "",
    date: "",
    introText: "按时间回看文字和图片，不用一次看完。",
    isEmpty: true,
    notes: [],
    resultGeneration: 0,
    backTop: 54,
    actionTop: 98,
    actionRight: 132,
    statusText: "",
    isLoading: false
  },

  onLoad(options) {
    this.updateSafeLayout();
    const date = options.date || "";
    this.setData({
      date,
      introText: date ? "这一天写下的小记，都放在这里。" : "按时间回看文字和图片，不用一次看完。"
    });
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      backTop: layout.backTop,
      actionTop: layout.actionTop,
      actionRight: layout.actionRight
    });
  },

  onShow() {
    this.historyVisible = true;
    this.refresh();
  },

  onHide() {
    this.historyVisible = false;
    this.resetHistory(this.data.query);
  },

  onUnload() {
    this.historyVisible = false;
    this.historySession = null;
  },

  onInput(event) {
    if (!this.historyVisible || !this.syncHistorySession()) return;
    this.setData({ query: event.detail.value });
    this.refresh();
  },

  resetHistory(query, statusText = "") {
    this.refreshGeneration = (this.refreshGeneration || 0) + 1;
    this.setData({ query, notes: [], isEmpty: true, isLoading: false, statusText });
  },

  syncHistorySession() {
    if (this.historySession && isCurrentAuthSession(this.historySession)) return true;
    this.historySession = getAuthSession();
    this.resetHistory("", getDataMode() === "none" ? signInText : "");
    return false;
  },

  refresh() {
    if (!this.historyVisible) return;
    this.syncHistorySession();
    const generation = (this.refreshGeneration || 0) + 1;
    this.refreshGeneration = generation;
    const dataMode = getDataMode();
    if (dataMode === "authenticated") {
      this.setData({ isLoading: true, statusText: "正在加载小记…" });
      const isLoadCurrent = () => this.historyVisible && generation === this.refreshGeneration && this.syncHistorySession();
      listAllNotes(this.data.date ? { date: this.data.date } : {}, isLoadCurrent)
        .then((items) => {
          if (!isLoadCurrent()) return;
          const keyword = this.data.query.trim();
          const notes = items
            .map(normalizeRemoteNote)
            .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)));
          this.setData({ notes, resultGeneration: generation, isEmpty: notes.length === 0, statusText: "", isLoading: false });
        })
        .catch((error) => {
          if (!isLoadCurrent()) return;
          const message = error.message || "小记加载失败，请稍后再试";
          this.setData({ notes: [], isEmpty: true, statusText: message, isLoading: false });
          wx.showToast({ title: message, icon: "none" });
        })
      return;
    }

    if (dataMode === "guest") {
      this.refreshLocal(generation);
      return;
    }

    this.setData({
      notes: [],
      isEmpty: true,
      isLoading: false,
      statusText: signInText
    });
  },

  refreshLocal(generation) {
    const keyword = this.data.query.trim();
    const notes = readNotes()
      .filter((note) => !this.data.date || note.dateKey === this.data.date)
      .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)))
      .map((note) => ({ ...note, title: titleOf(note.content, note) }));
    this.setData({
      notes,
      resultGeneration: generation,
      isEmpty: notes.length === 0,
      isLoading: false,
      statusText: "游客模式，只显示本机小记。"
    });
  },

  openNote(event) {
    if (!this.historyVisible || !this.syncHistorySession()) return;
    const { id, generation } = event.currentTarget.dataset;
    if (Number(generation) !== this.refreshGeneration) return;
    const note = this.data.notes.find((item) => item.id === id);
    if (!note) return;
    const date = encodeURIComponent(note.dateKey || "");
    wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${encodeURIComponent(note.id)}&date=${date}` });
  }
});
