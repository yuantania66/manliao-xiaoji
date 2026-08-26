const { readNotes, writeNotes, updateNote: updateLocalNote } = require("../../utils/local-data");
const { getDataMode } = require("../../utils/auth");
const { getNote, updateNote, deleteNote } = require("../../api/notes");
const { getSafeLayout } = require("../../utils/layout");

const asMediaItems = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return { url: item };
      if (!item || typeof item !== "object") return null;
      const url = item.url || item.src || item.path || item.fileUrl;
      return url ? { ...item, url } : null;
    })
    .filter(Boolean);
};

const mediaFrom = (note, keys) => {
  for (const key of keys) {
    const media = asMediaItems(note[key]);
    if (media.length) return media.slice(0, 9);
  }
  return [];
};

const imageGridClass = (count) => {
  if (count <= 1) return "media-grid-one";
  if (count === 2) return "media-grid-two";
  if (count === 4) return "media-grid-four";
  return "media-grid-nine";
};

const normalizeRemoteNote = (note) => ({
  id: note.id,
  content: note.content || "",
  dateKey: note.dateKey || (/^\d{4}-\d{2}-\d{2}$/.test(note.recordDate || "") ? note.recordDate : ""),
  dateLabel: note.dateLabel || note.recordDate || note.createdAt,
  mood: note.moodName ? { name: note.moodName, desc: note.moodIcon || "" } : note.mood || null,
  images: mediaFrom(note, ["mediaUrls", "images", "imageUrls", "photos", "mediaImages"]),
  videos: []
});

const normalizeLocalNote = (note) => ({
  ...note,
  content: note.content || "",
  images: mediaFrom(note, ["images", "imageUrls", "photos", "mediaImages"]),
  videos: []
});

const withViewFlags = (note) => ({
  ...note,
  imageCount: note.images ? note.images.length : 0,
  imageGridClass: imageGridClass(note.images ? note.images.length : 0),
  hasText: Boolean((note.content || "").trim()),
  hasImages: Boolean(note.images && note.images.length),
  hasVideos: false,
  hasMood: Boolean(note.mood && note.mood.name)
});

Page({
  data: {
    note: null,
    backTop: 54,
    isMenuOpen: false,
    isDeleting: false,
    isEditing: false,
    isUpdating: false,
    editContent: "",
    statusText: ""
  },

  onLoad(options) {
    this.noteId = options.id || "";
    this.returnDate = options.date || "";
    this.updateSafeLayout();
    this.loadNote();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({ backTop: layout.backTop });
  },

  loadNote() {
    const dataMode = getDataMode();
    if (!this.noteId) {
      this.setData({ note: null, statusText: "这条小记暂时找不到。" });
      return;
    }

    if (dataMode === "authenticated") {
      getNote(this.noteId)
        .then((remoteNote) => {
          const note = withViewFlags(normalizeRemoteNote(remoteNote));
          this.setData({ note, statusText: "" });
        })
        .catch((error) => {
          const message = error.message || "小记加载失败，请稍后再试";
          this.setData({ note: null, statusText: message });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") {
      this.loadLocal(this.noteId);
      return;
    }

    this.setData({
      note: null,
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  loadLocal(id) {
    const notes = readNotes();
    const rawNote = notes.find((item) => item.id === id) || null;
    const note = rawNote ? withViewFlags(normalizeLocalNote(rawNote)) : null;
    this.setData({
      note,
      statusText: note ? "" : "这条小记暂时找不到。"
    });
  },

  getHistoryUrl() {
    const date = this.returnDate || (this.data.note && this.data.note.dateKey) || "";
    return date ? `/pages/note-history/note-history?date=${date}` : "/pages/note-history/note-history";
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: this.getHistoryUrl() });
  },

  goHistory() {
    wx.redirectTo({ url: this.getHistoryUrl() });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = ((this.data.note && this.data.note.images) || [])
      .map((item) => item.url)
      .filter(Boolean);
    if (!current || urls.length === 0) return;
    wx.previewImage({
      current,
      urls
    });
  },

  toggleMenu() {
    this.setData({ isMenuOpen: !this.data.isMenuOpen });
  },

  closeMenu() {
    this.setData({ isMenuOpen: false });
  },

  startEditing() {
    if (!this.data.note || this.data.isUpdating) return;
    this.setData({ isMenuOpen: false, isEditing: true, editContent: this.data.note.content || "", statusText: "" });
  },

  cancelEditing() { if (!this.data.isUpdating) this.setData({ isEditing: false, editContent: "" }); },

  onEditInput(event) { this.setData({ editContent: event.detail.value }); },

  saveEdit() {
    if (!this.data.note || this.data.isUpdating) return;
    const content = this.data.editContent.trim();
    if (!content && !this.data.note.hasImages) { this.setData({ statusText: "小记内容不能为空。" }); return; }
    if (content === (this.data.note.content || "")) { this.setData({ isEditing: false, editContent: "" }); return; }
    const dataMode = getDataMode();
    if (dataMode === "none") { this.setData({ statusText: "登录状态已失效，请重新登录后再保存。" }); return; }
    this.setData({ isUpdating: true, statusText: "" });
    const update = dataMode === "authenticated" ? updateNote(this.data.note.id, content) : Promise.resolve(updateLocalNote(this.data.note.id, content));
    update.then((saved) => {
      if (!saved) throw new Error("小记不存在");
      const note = withViewFlags(dataMode === "authenticated" ? normalizeRemoteNote(saved) : normalizeLocalNote(saved));
      this.setData({ note, isEditing: false, editContent: "", statusText: "" });
    }).catch((error) => {
      this.setData({ statusText: error.message || "修改失败，请稍后再试" });
    }).finally(() => this.setData({ isUpdating: false }));
  },

  deleteCurrentNote() {
    if (!this.data.note || this.data.isDeleting) return;

    wx.showModal({
      title: "删除小记",
      content: "删除后无法恢复，确定要删除这条小记吗？",
      confirmText: "删除",
      confirmColor: "#b2776c",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) return;
        this.performDelete();
      }
    });
  },

  performDelete() {
    const dataMode = getDataMode();
    const noteId = this.data.note.id;
    const remove = dataMode === "authenticated"
      ? deleteNote(noteId)
      : Promise.resolve().then(() => {
        writeNotes(readNotes().filter((item) => item.id !== noteId));
      });

    this.setData({ isDeleting: true, isMenuOpen: false });
    remove
      .then(() => {
        wx.showToast({ title: "已删除", icon: "none" });
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) {
            wx.navigateBack();
          } else {
            wx.redirectTo({ url: this.getHistoryUrl() });
          }
        }, 350);
      })
      .catch((error) => {
        const message = error.message || "删除失败，请稍后再试";
        wx.showToast({ title: message, icon: "none" });
        this.setData({ statusText: message });
      })
      .finally(() => {
        this.setData({ isDeleting: false });
      });
  }
});
