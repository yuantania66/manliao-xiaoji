const LEGACY_CHAT_KEY = "xinqingMiniChatMessages";
const LEGACY_NOTE_KEY = "xinqingMiniNotes";
const GUEST_CHAT_KEY = "xinqingMiniGuestChatMessages";
const GUEST_NOTE_KEY = "xinqingMiniGuestNotes";
const LEGACY_NOTE_DRAFT_KEY = "xinqingMiniNoteDraft:v1";
const LEGACY_NOTE_DRAFT_OWNER_KEY = "xinqingMiniNoteDraft:v1:owner";
const NOTE_DRAFT_KEY_PREFIX = "xinqingMiniNoteDraft:v2:";
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
const safeGetResult = (key) => {
  try { return { ok: true, value: wx.getStorageSync(key) }; } catch (error) { return { ok: false, value: null }; }
};
const safeSet = (key, value) => {
  try { wx.setStorageSync(key, value); return true; } catch (error) { return false; }
};
const safeRemove = (key) => {
  try { wx.removeStorageSync(key); return true; } catch (error) { return false; }
};

const getActiveOwner = () => require("./auth").getDataOwner();
const resolveOwner = (owner) => typeof owner === "string" && owner ? owner : getActiveOwner();
const isCurrentOwner = (owner) => resolveOwner(owner) === getActiveOwner();
const getNoteDraftKey = (owner) => `${NOTE_DRAFT_KEY_PREFIX}${encodeURIComponent(resolveOwner(owner))}`;

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

const isGuestOwnerActive = () => getActiveOwner() === "guest";

const readChatMessages = () => isGuestOwnerActive() ? readWithGuestMigration(GUEST_CHAT_KEY, LEGACY_CHAT_KEY) : [];

const writeChatMessages = (messages) => isGuestOwnerActive() && safeSet(GUEST_CHAT_KEY, messages);

const readNotes = () => {
  if (!isGuestOwnerActive()) return [];
  const value = readWithGuestMigration(GUEST_NOTE_KEY, LEGACY_NOTE_KEY);
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && typeof item.id === "string") : [];
};

const writeNotes = (notes) => isGuestOwnerActive() && safeSet(GUEST_NOTE_KEY, Array.isArray(notes) ? notes : []);

const isPersistedNoteImage = (item) => {
  const root = wx.env && wx.env.USER_DATA_PATH;
  return Boolean(root && item && typeof item === "object" && item.type === "image" &&
    typeof item.url === "string" && item.url.startsWith(`${root}/`) && item.thumbUrl === item.url);
};
const isValidNoteDraft = (draft, owner) => {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  if (typeof draft.content !== "string" || !Array.isArray(draft.mediaItems) || draft.mediaItems.length > 9 ||
      !draft.mediaItems.every(isPersistedNoteImage) || typeof draft.clientRequestId !== "string" || !draft.clientRequestId) return false;
  return owner === undefined ? draft.owner === undefined : draft.owner === owner;
};
const isEmptyStoredValue = (value) => value === undefined || value === null || value === "";
const LEGACY_NOTE_DRAFT_SEALED_OWNER = "sealed:invalid-auth";
const writeLegacyNoteDraftOwner = (owner) => {
  if (!safeSet(LEGACY_NOTE_DRAFT_OWNER_KEY, owner)) throw new Error("草稿归属暂时无法确认");
  const verified = safeGetResult(LEGACY_NOTE_DRAFT_OWNER_KEY);
  if (!verified.ok || verified.value !== owner) throw new Error("草稿归属暂时无法确认");
  return true;
};
const claimLegacyNoteDraft = (owner) => {
  if (owner === "none" || (owner !== "guest" && !String(owner).startsWith("authenticated:"))) return true;
  const legacy = safeGetResult(LEGACY_NOTE_DRAFT_KEY);
  if (!legacy.ok) throw new Error("草稿归属暂时无法确认");
  if (isEmptyStoredValue(legacy.value) || !isValidNoteDraft(legacy.value, undefined)) return true;
  const claim = safeGetResult(LEGACY_NOTE_DRAFT_OWNER_KEY);
  if (!claim.ok) throw new Error("草稿归属暂时无法确认");
  if (!isEmptyStoredValue(claim.value)) return true;
  return writeLegacyNoteDraftOwner(owner);
};
// Malformed auth residues must not mint an owner claim, but also must not leave
// an unowned v1 open to the next real login's first-claimer path.
const sealUnownedLegacyNoteDraft = () => {
  const legacy = safeGetResult(LEGACY_NOTE_DRAFT_KEY);
  if (!legacy.ok) throw new Error("草稿归属暂时无法确认");
  if (isEmptyStoredValue(legacy.value) || !isValidNoteDraft(legacy.value, undefined)) return true;
  const claim = safeGetResult(LEGACY_NOTE_DRAFT_OWNER_KEY);
  if (!claim.ok) throw new Error("草稿归属暂时无法确认");
  if (!isEmptyStoredValue(claim.value)) return true;
  return writeLegacyNoteDraftOwner(LEGACY_NOTE_DRAFT_SEALED_OWNER);
};
const readNoteDraft = (owner) => {
  const expectedOwner = resolveOwner(owner);
  if (!isCurrentOwner(expectedOwner)) return null;
  const key = getNoteDraftKey(expectedOwner);
  const scoped = safeGetResult(key);
  if (!scoped.ok) return null;
  if (!isEmptyStoredValue(scoped.value)) {
    return isValidNoteDraft(scoped.value, expectedOwner) ? scoped.value : null;
  }
  if (expectedOwner === "none") return null;

  const legacy = safeGetResult(LEGACY_NOTE_DRAFT_KEY);
  if (!legacy.ok || !isValidNoteDraft(legacy.value, undefined)) return null;
  const claim = safeGetResult(LEGACY_NOTE_DRAFT_OWNER_KEY);
  if (!claim.ok || (claim.value && claim.value !== expectedOwner)) return null;
  if (!claim.value) {
    if (!safeSet(LEGACY_NOTE_DRAFT_OWNER_KEY, expectedOwner)) return null;
    const verifiedClaim = safeGetResult(LEGACY_NOTE_DRAFT_OWNER_KEY);
    if (!verifiedClaim.ok || verifiedClaim.value !== expectedOwner) return null;
  }

  if (!writeNoteDraft(legacy.value, expectedOwner)) return null;
  const verified = safeGetResult(key);
  if (!verified.ok || !isValidNoteDraft(verified.value, expectedOwner)) return null;
  if (safeRemove(LEGACY_NOTE_DRAFT_KEY)) {
    const removed = safeGetResult(LEGACY_NOTE_DRAFT_KEY);
    if (removed.ok && isEmptyStoredValue(removed.value)) safeRemove(LEGACY_NOTE_DRAFT_OWNER_KEY);
  }
  return verified.value;
};
const writeNoteDraft = (draft, owner) => {
  const expectedOwner = resolveOwner(owner);
  if (!isCurrentOwner(expectedOwner)) return false;
  return safeSet(getNoteDraftKey(expectedOwner), { ...draft, owner: expectedOwner }) && isCurrentOwner(expectedOwner);
};
const clearNoteDraft = (owner) => {
  const expectedOwner = resolveOwner(owner);
  return isCurrentOwner(expectedOwner) && safeRemove(getNoteDraftKey(expectedOwner));
};
const removePersistedNoteImage = (filePath) => {
  const root = wx.env && wx.env.USER_DATA_PATH;
  if (!root || typeof filePath !== "string" || !filePath.startsWith(`${root}/`)) return;
  wx.getFileSystemManager().unlink({ filePath, fail: () => undefined });
};
const persistNoteDraftImages = async (filePaths, owner) => {
  const expectedOwner = resolveOwner(owner);
  const saved = [];
  try {
    for (const tempFilePath of filePaths) {
      if (!isCurrentOwner(expectedOwner)) throw new Error("身份已变化，请重新选择图片");
      const savedFilePath = await new Promise((resolve, reject) => {
        if (!wx.getFileSystemManager) { reject(new Error("当前微信版本无法保存图片")); return; }
        wx.getFileSystemManager().saveFile({ tempFilePath, success: (result) => resolve(result.savedFilePath), fail: () => reject(new Error("图片保存失败")) });
      });
      saved.push(savedFilePath);
      if (!isCurrentOwner(expectedOwner)) throw new Error("身份已变化，请重新选择图片");
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

const createNote = ({ content, mood, images = [], videos = [] }, owner = "guest") => {
  if (owner !== "guest" || !isCurrentOwner(owner)) return null;
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
  claimLegacyNoteDraft,
  sealUnownedLegacyNoteDraft,
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
