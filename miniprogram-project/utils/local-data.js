const LEGACY_CHAT_KEY = "xinqingMiniChatMessages";
const LEGACY_NOTE_KEY = "xinqingMiniNotes";
const GUEST_CHAT_KEY = "xinqingMiniGuestChatMessages";
const GUEST_NOTE_KEY = "xinqingMiniGuestNotes";

const nowIso = () => new Date().toISOString();

const pad = (value) => String(value).padStart(2, "0");

const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatDateLabel = (date = new Date()) => {
  const weeks = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${weeks[date.getDay()]}`;
};

const readWithGuestMigration = (guestKey, legacyKey) => {
  const guestData = wx.getStorageSync(guestKey);
  if (guestData) return guestData;

  const legacyData = wx.getStorageSync(legacyKey);
  if (legacyData) {
    wx.setStorageSync(guestKey, legacyData);
    wx.removeStorageSync(legacyKey);
    return legacyData;
  }

  return [];
};

const readChatMessages = () => readWithGuestMigration(GUEST_CHAT_KEY, LEGACY_CHAT_KEY);

const writeChatMessages = (messages) => wx.setStorageSync(GUEST_CHAT_KEY, messages);

const readNotes = () => readWithGuestMigration(GUEST_NOTE_KEY, LEGACY_NOTE_KEY);

const writeNotes = (notes) => wx.setStorageSync(GUEST_NOTE_KEY, notes);

const clearLocalGuestData = () => {
  wx.removeStorageSync(GUEST_CHAT_KEY);
  wx.removeStorageSync(GUEST_NOTE_KEY);
};

const createNote = ({ content, mood, images = [], videos = [] }) => {
  const note = {
    id: `note_${Date.now()}`,
    content,
    images,
    videos,
    mood: mood || null,
    createdAt: nowIso(),
    dateKey: dateKey(),
    dateLabel: formatDateLabel()
  };
  const notes = [note, ...readNotes()];
  writeNotes(notes);
  return note;
};

const createReply = (text) => {
  if (text.length <= 8) return "我在。你可以慢慢说，不用一次讲清楚。";
  return "听起来这件事在你心里停了一会儿。我们可以先从最靠近你的那一点开始。";
};

module.exports = {
  nowIso,
  dateKey,
  formatDateLabel,
  readChatMessages,
  writeChatMessages,
  readNotes,
  writeNotes,
  clearLocalGuestData,
  createNote,
  createReply
};
