const { readNotes } = require("../../utils/local-data");
const { captureAuthAuthority, isCurrentAuthAuthority, isCurrentAuthFailure, getDataMode } = require("../../utils/auth");
const { listAllNotes } = require("../../api/notes");
const { getSafeLayout } = require("../../utils/layout");

const { downloadNoteMedia, discardTempMedia } = require("../../utils/note-media");
const { isOwnerPreview } = require("../../utils/owner-preview");

const titleOf = (content, note = {}) => {
  const trimmed = (content || "").trim();
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
    loadError: false,
    notes: [],
    backTop: 54,
    pageTop: 92,
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
      pageTop: layout.pageTop
    });
  },

  onHide() {
    this.refreshGeneration = (this.refreshGeneration || 0) + 1;
    this.releaseMedia();
    this.setData({ notes: [] });
  },

  onUnload() { this.onHide(); },

  releaseMedia() {
    (this.mediaPaths || []).forEach(discardTempMedia);
    this.mediaPaths = [];
  },

  clearDate() {
    this.setData({ date: "", introText: "按时间回看文字和图片，不用一次看完。" });
    this.refresh();
  },

  onThumbError(event) {
    this.setData({ notes: this.data.notes.map(note => note.id === event.currentTarget.dataset.id ? { ...note, thumbUrl: "" } : note) });
  },

  prepareThumbnails(notes, authority, generation) {
    notes.forEach((note, index) => {
      if (!note.images.length) return;
      downloadNoteMedia(note.images[0].url, authority).then(path => {
        if (generation !== this.refreshGeneration || !isCurrentAuthAuthority(authority)) {
          if (isOwnerPreview()) discardTempMedia(path);
          return;
        }
        if (isOwnerPreview()) this.mediaPaths.push(path);
        this.setData({ [`notes[${index}].thumbUrl`]: path });
      }).catch(() => undefined);
    });
  },

  onShow() {
    this.refresh();
  },

  openComposer() {
    const pages = getCurrentPages();
    for (let index = pages.length - 2; index >= 0; index -= 1) {
      if (pages[index].route === "pages/note/note") {
        wx.navigateBack({ delta: pages.length - 1 - index });
        return;
      }
    }
    wx.navigateTo({ url: "/pages/note/note" });
  },

  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: "/pages/note/note" });
  },

  onInput(event) {
    this.setData({ query: event.detail.value }, () => this.refresh());
  },

  refresh() {
    const generation = (this.refreshGeneration || 0) + 1;
    this.refreshGeneration = generation;
    this.releaseMedia();
    const dataMode = getDataMode();
    const authority = captureAuthAuthority();
    const current = () => generation === this.refreshGeneration && isCurrentAuthAuthority(authority);
    if (dataMode === "authenticated") {
      this.setData({ notes: [], isEmpty: false, loadError: false, isLoading: true, statusText: "正在加载小记…" });
      listAllNotes(this.data.date ? { date: this.data.date } : {})
        .then((items) => {
          if (!current()) return;
          const keyword = this.data.query.trim();
          const notes = items
            .map(normalizeRemoteNote)
            .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)));
          this.setData({ notes, isEmpty: notes.length === 0, loadError: false, statusText: "", isLoading: false });
          this.prepareThumbnails(notes, authority, generation);
        })
        .catch((error) => {
          if (generation !== this.refreshGeneration ||
              !(isCurrentAuthAuthority(authority) || isCurrentAuthFailure(authority, error))) return;
          const message = error.message || "小记加载失败，请稍后再试";
          this.setData({ notes: [], isEmpty: false, loadError: true, statusText: message, isLoading: false });
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
      isLoading: false,
      loadError: true,
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  refreshLocal() {
    this.refreshGeneration = (this.refreshGeneration || 0) + 1;
    const keyword = this.data.query.trim();
    const notes = readNotes()
      .filter((note) => !this.data.date || note.dateKey === this.data.date)
      .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)))
      .map((note) => ({ ...note, images: note.images || [], thumbUrl: note.images?.[0]?.url || "", title: titleOf(note.content, note) }));
    this.setData({
      notes,
      loadError: false,
      isEmpty: notes.length === 0,
      isLoading: false,
      statusText: "游客模式，只显示本机小记。"
    });
  }
});
