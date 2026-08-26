const LEGACY_CHAT_KEY = "xinqingMiniChatMessages";
const LEGACY_NOTE_KEY = "xinqingMiniNotes";
const GUEST_CHAT_KEY = "xinqingMiniGuestChatMessages";
const GUEST_NOTE_KEY = "xinqingMiniGuestNotes";
const NOTE_DRAFT_KEY = "xinqingMiniNoteDraft:v1";
const PENDING_UPLOAD_CLEANUP_KEY = "xinqingMiniPendingUploadCleanup:v1";

const nowIso = () => new Date().toISOString();

const pad = (value) => String(value).padStart(2, "0");

const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatDateLabel = (date = new Date()) => {
  const weeks = ["日", "一", "二", "三", "四", "五", "六"];
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${weeks[date.getDay()]}`;
};

const safeGet = (key) => {
  try { return wx.getStorageSync(key); } catch (error) { return null; }
};
const safeSet = (key, value) => {
  try { wx.setStorageSync(key, value); return true; } catch (error) { return false; }
};
const safeRemove = (key) => {
  try { wx.removeStorageSync(key); } catch (error) {}
};

const readWithGuestMigration = (guestKey, legacyKey) => {
  const guestData = safeGet(guestKey);
  if (guestData) return guestData;

  const legacyData = safeGet(legacyKey);
  if (legacyData) {
    safeSet(guestKey, legacyData);
    safeRemove(legacyKey);
    return legacyData;
  }

  return [];
};

const readChatMessages = () => readWithGuestMigration(GUEST_CHAT_KEY, LEGACY_CHAT_KEY);

const writeChatMessages = (messages) => wx.setStorageSync(GUEST_CHAT_KEY, messages);

const readNotes = () => {
  const value = readWithGuestMigration(GUEST_NOTE_KEY, LEGACY_NOTE_KEY);
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && typeof item.id === "string") : [];
};

const writeNotes = (notes) => safeSet(GUEST_NOTE_KEY, Array.isArray(notes) ? notes : []);

const isPersistedNoteImage = (item) => {
  const root = wx.env && wx.env.USER_DATA_PATH;
  return Boolean(root && item && typeof item === "object" && item.type === "image" &&
    typeof item.url === "string" && item.url.startsWith(`${root}/`) && item.thumbUrl === item.url);
};
const readNoteDraft = () => {
  const draft = safeGet(NOTE_DRAFT_KEY);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  if (typeof draft.content !== "string" || !Array.isArray(draft.mediaItems) || draft.mediaItems.length > 9 ||
      !draft.mediaItems.every(isPersistedNoteImage) || typeof draft.clientRequestId !== "string" || !draft.clientRequestId) return null;
  return draft;
};
const writeNoteDraft = (draft) => safeSet(NOTE_DRAFT_KEY, draft);
const clearNoteDraft = () => safeRemove(NOTE_DRAFT_KEY);
const removePersistedNoteImage = (filePath) => {
  const root = wx.env && wx.env.USER_DATA_PATH;
  if (!root || typeof filePath !== "string" || !filePath.startsWith(`${root}/`)) return;
  wx.getFileSystemManager().unlink({ filePath, fail: () => undefined });
};
const persistNoteDraftImages = async (filePaths) => {
  const saved = [];
  try {
    for (const tempFilePath of filePaths) {
      const savedFilePath = await new Promise((resolve, reject) => {
        if (!wx.getFileSystemManager) { reject(new Error("当前微信版本无法保存图片")); return; }
        wx.getFileSystemManager().saveFile({ tempFilePath, success: (result) => resolve(result.savedFilePath), fail: () => reject(new Error("图片保存失败")) });
      });
      saved.push(savedFilePath);
    }
    return saved;
  } catch (error) {
    saved.forEach(removePersistedNoteImage);
    throw error;
  }
};
const readPendingUploadCleanup = () => {
  const value = safeGet(PENDING_UPLOAD_CLEANUP_KEY);
  return Array.isArray(value) ? [...new Set(value.filter((url) => typeof url === "string" && url.length > 0))] : [];
};
const addPendingUploadCleanup = (urls) =>
  safeSet(PENDING_UPLOAD_CLEANUP_KEY, [...new Set([...readPendingUploadCleanup(), ...urls])]);
const removePendingUploadCleanup = (urls) => {
  const removed = new Set(urls);
  const remaining = readPendingUploadCleanup().filter((url) => !removed.has(url));
  return remaining.length ? safeSet(PENDING_UPLOAD_CLEANUP_KEY, remaining) : (safeRemove(PENDING_UPLOAD_CLEANUP_KEY), true);
};

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
  return writeNotes(notes) ? note : null;
};

const updateNote = (noteId, content) => {
  const notes = readNotes();
  const index = notes.findIndex((item) => item.id === noteId);
  if (index < 0) return null;
  notes[index] = { ...notes[index], content, updatedAt: nowIso() };
  return writeNotes(notes) ? notes[index] : null;
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
  readNoteDraft,
  writeNoteDraft,
  clearNoteDraft,
  persistNoteDraftImages,
  removePersistedNoteImage,
  readPendingUploadCleanup,
  addPendingUploadCleanup,
  removePendingUploadCleanup,
  clearLocalGuestData,
  createNote,
  updateNote,
  createReply
};
