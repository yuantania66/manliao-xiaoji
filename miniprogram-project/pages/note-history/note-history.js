const { readNotes } = require("../../utils/local-data");
const { getDataMode } = require("../../utils/auth");
const { listNotes } = require("../../api/notes");
const { getSafeLayout } = require("../../utils/layout");

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
    backTop: 54,
    statusText: ""
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
    this.setData({ backTop: layout.backTop });
  },

  onShow() {
    this.refresh();
  },

  onInput(event) {
    this.setData({ query: event.detail.value }, () => this.refresh());
  },

  refresh() {
    const dataMode = getDataMode();
    if (dataMode === "authenticated") {
      const params = this.data.date ? `?date=${this.data.date}&pageSize=50` : "?pageSize=50";
      listNotes(params)
        .then((data) => {
          const keyword = this.data.query.trim();
          const notes = (data.items || [])
            .map(normalizeRemoteNote)
            .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)));
          this.setData({ notes, isEmpty: notes.length === 0, statusText: "" });
        })
        .catch((error) => {
          const message = error.message || "小记加载失败，请稍后再试";
          this.setData({ notes: [], isEmpty: true, statusText: message });
          wx.showToast({ title: message, icon: "none" });
        })
      return;
    }

    if (dataMode === "guest") {
      this.refreshLocal();
      return;
    }

    this.setData({
      notes: [],
      isEmpty: true,
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  refreshLocal() {
    const keyword = this.data.query.trim();
    const notes = readNotes()
      .filter((note) => !this.data.date || note.dateKey === this.data.date)
      .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)))
      .map((note) => ({ ...note, title: titleOf(note.content, note) }));
    this.setData({
      notes,
      isEmpty: notes.length === 0,
      statusText: "游客模式，只显示本机小记。"
    });
  }
});
