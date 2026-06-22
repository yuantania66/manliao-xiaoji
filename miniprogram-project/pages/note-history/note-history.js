const { readNotes, writeNotes, dateKey, formatDateLabel } = require("../../utils/local-data");
const { getDataMode } = require("../../utils/auth");
const { listNotes } = require("../../api/notes");
const { getSafeLayout } = require("../../utils/layout");

const MEDIA_SEED_KEY = "xinqingDevMediaNoteSeeded";
const TEST_IMAGE_URL = "/assets/test-note-photo.svg";

const titleOf = (content, note = {}) => {
  const trimmed = content.trim();
  if (!trimmed && note.displayTitle) return note.displayTitle;
  if (!trimmed && note.images) return "图片小记";
  return trimmed.length > 18 ? `${trimmed.slice(0, 17)}...` : trimmed || "这一刻已经被收下。";
};

const isDevelopRuntime = () => {
  try {
    const account = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return !account || !account.miniProgram || account.miniProgram.envVersion !== "release";
  } catch (error) {
    return true;
  }
};

const labelFromDateKey = (value) => {
  if (!value) return formatDateLabel();
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return formatDateLabel();
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return formatDateLabel(date);
};

const seedMediaNotesIfNeeded = (targetDateKey = "") => {
  if (!isDevelopRuntime()) return false;

  const createdAt = new Date().toISOString();
  const targetKey = targetDateKey || dateKey();
  const seededDates = wx.getStorageSync(MEDIA_SEED_KEY) || [];
  if (Array.isArray(seededDates) && seededDates.includes(targetKey)) return false;
  if (!Array.isArray(seededDates) && seededDates === targetKey) return false;

  const dateLabel = labelFromDateKey(targetKey);
  const base = {
    dateKey: targetKey,
    dateLabel,
    createdAt,
    mood: { name: "晴晴", desc: "轻松", icon: "sunny" }
  };
  const testNotes = [
    {
      ...base,
      id: `dev_media_text_${Date.now()}`,
      content: "媒体测试 1：只发文字的小记。"
    },
    {
      ...base,
      id: `dev_media_image_${Date.now()}`,
      content: "",
      displayTitle: "媒体测试 2：只发图片的小记。",
      images: [{ url: TEST_IMAGE_URL }]
    },
    {
      ...base,
      id: `dev_media_image_only_${Date.now()}`,
      content: "",
      displayTitle: "媒体测试 3：只放图片的小记。",
      images: [{ url: TEST_IMAGE_URL }]
    },
    {
      ...base,
      id: `dev_media_text_image_${Date.now()}`,
      content: "媒体测试 4：文字和图片放在一起。",
      images: [{ url: TEST_IMAGE_URL }]
    },
    {
      ...base,
      id: `dev_media_text_more_image_${Date.now()}`,
      content: "媒体测试 5：文字和图片放在一起。",
      images: [{ url: TEST_IMAGE_URL }]
    },
    {
      ...base,
      id: `dev_media_text_multi_image_${Date.now()}`,
      content: "媒体测试 6：文字和多张图片放在一起。",
      images: [{ url: TEST_IMAGE_URL }, { url: TEST_IMAGE_URL }, { url: TEST_IMAGE_URL }]
    },
    {
      ...base,
      id: `dev_media_multi_image_${Date.now()}`,
      content: "",
      displayTitle: "媒体测试 7：多张图片的小记。",
      images: [{ url: TEST_IMAGE_URL }, { url: TEST_IMAGE_URL }, { url: TEST_IMAGE_URL }]
    }
  ];

  writeNotes([...testNotes, ...readNotes()]);
  wx.setStorageSync(MEDIA_SEED_KEY, Array.isArray(seededDates) ? [...seededDates, targetKey] : [targetKey]);
  return true;
};

const normalizeRemoteNote = (note) => ({
  id: note.id,
  content: note.content,
  dateKey: note.recordDate,
  dateLabel: note.recordDate || note.createdAt,
  mood: note.moodName ? { name: note.moodName, desc: note.moodIcon || "" } : null,
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
    const seeded = seedMediaNotesIfNeeded(this.data.date);
    const keyword = this.data.query.trim();
    const notes = readNotes()
      .filter((note) => !this.data.date || note.dateKey === this.data.date)
      .filter((note) => !keyword || note.content.includes(keyword) || (note.mood && `${note.mood.name}${note.mood.desc}`.includes(keyword)))
      .map((note) => ({ ...note, title: titleOf(note.content, note) }));
    this.setData({
      notes,
      isEmpty: notes.length === 0,
      statusText: seeded ? "已生成 7 条媒体测试小记。" : "游客模式，只显示本机小记。"
    });
  }
});
