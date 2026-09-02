import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const storage = new Map();
const removedFiles = [];
global.wx = {
  env: { USER_DATA_PATH: "/user-data" },
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  showToast: () => undefined,
  getFileSystemManager: () => ({
    saveFile: ({ tempFilePath, success }) => success({ savedFilePath: `/user-data/${tempFilePath.split("/").pop()}` }),
    unlink: ({ filePath }) => removedFiles.push(filePath)
  })
};
global.getApp = () => ({ globalData: {} });

const local = require("../miniprogram-project/utils/local-data.js");
const auth = require("../miniprogram-project/utils/auth.js");
const withOwner = (draft, owner) => ({ ...draft, owner });
assert.equal(auth.getDataOwner(), "none");
assert.equal(local.readNoteDraft("none"), null);
const draft = { content: "未完成", mediaItems: [], selectedMood: null, clientRequestId: "request-1" };

storage.set("xinqingMiniNoteDraft:v1", draft);
assert.equal(local.readNoteDraft("none"), null, "an unowned legacy draft must not migrate without an identity");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft);
auth.enterGuest();
assert.deepEqual(local.readNoteDraft("guest"), withOwner(draft, "guest"));
assert.equal(storage.has("xinqingMiniNoteDraft:v1"), false);

storage.clear();
auth.saveAuth({ token: "migration-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "migration-user" } });
storage.set("xinqingMiniNoteDraft:v1", draft);
assert.deepEqual(local.readNoteDraft("authenticated:migration-user"), withOwner(draft, "authenticated:migration-user"));
assert.equal(storage.has("xinqingMiniNoteDraft:v1"), false);

storage.clear();
auth.enterGuest();
const existingDraft = { ...draft, content: "已有新版", clientRequestId: "existing-v2" };
storage.set("xinqingMiniNoteDraft:v1", draft);
assert.equal(local.writeNoteDraft(existingDraft, "guest"), true);
assert.deepEqual(local.readNoteDraft("guest"), withOwner(existingDraft, "guest"), "an existing v2 draft must win");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft, "an existing v2 draft must not consume legacy data");

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", draft);
const migrationSetStorageSync = wx.setStorageSync;
wx.setStorageSync = (key, value) => {
  if (key === "xinqingMiniNoteDraft:v2:guest") throw new Error("v2 unavailable");
  return migrationSetStorageSync(key, value);
};
assert.equal(local.readNoteDraft("guest"), null);
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft, "failed v2 write must preserve v1");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "guest", "failed migration must retain its owner claim");
wx.setStorageSync = migrationSetStorageSync;
auth.saveAuth({ token: "other-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "other-user" } });
assert.equal(local.readNoteDraft("authenticated:other-user"), null, "a failed guest migration must not expose v1 to another owner");
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft);

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", draft);
const migrationRemoveStorageSync = wx.removeStorageSync;
wx.removeStorageSync = (key) => {
  if (key === "xinqingMiniNoteDraft:v1") throw new Error("legacy cleanup unavailable");
  return migrationRemoveStorageSync(key);
};
assert.deepEqual(local.readNoteDraft("guest"), withOwner(draft, "guest"));
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft, "failed legacy cleanup must preserve v1");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "guest");
wx.removeStorageSync = migrationRemoveStorageSync;
auth.saveAuth({ token: "other-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "other-user" } });
assert.equal(local.readNoteDraft("authenticated:other-user"), null, "a retained v1 must stay bound to its claimed owner");

storage.clear();
auth.enterGuest();
storage.set("xinqingMiniNoteDraft:v1", draft);
wx.removeStorageSync = (key) => key === "xinqingMiniNoteDraft:v1" ? undefined : migrationRemoveStorageSync(key);
assert.deepEqual(local.readNoteDraft("guest"), withOwner(draft, "guest"));
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), draft, "a silent legacy cleanup failure must leave v1 intact");
assert.equal(storage.get("xinqingMiniNoteDraft:v1:owner"), "guest", "a silent cleanup failure must retain the owner claim");
wx.removeStorageSync = migrationRemoveStorageSync;
auth.saveAuth({ token: "silent-other-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "silent-other-user" } });
assert.equal(local.readNoteDraft("authenticated:silent-other-user"), null, "silently retained v1 must not be claimable by B");

storage.clear();
auth.enterGuest();
const corruptLegacy = { content: 1, mediaItems: "bad" };
storage.set("xinqingMiniNoteDraft:v1", corruptLegacy);
assert.equal(local.readNoteDraft("guest"), null);
assert.deepEqual(storage.get("xinqingMiniNoteDraft:v1"), corruptLegacy);
assert.equal(storage.has("xinqingMiniNoteDraft:v2:guest"), false);

storage.clear();
assert.equal(local.writeNoteDraft(draft, "none"), true);
assert.deepEqual(local.readNoteDraft("none"), withOwner(draft, "none"));
local.clearNoteDraft("none");
assert.equal(local.readNoteDraft("none"), null);
storage.set("xinqingMiniNoteDraft:v2:none", { content: 1, mediaItems: "bad", owner: "none" });
assert.equal(local.readNoteDraft("none"), null);
storage.set("xinqingMiniNoteDraft:v2:none", { content: "伪造路径", mediaItems: [{ type: "image", url: "/user-data/private.txt", thumbUrl: "/different" }], clientRequestId: "bad-media", owner: "none" });
assert.equal(local.readNoteDraft("none"), null);
storage.set("xinqingMiniNoteDraft:v2:none", withOwner(draft, "guest"));
assert.equal(local.readNoteDraft("none"), null, "a forged owner must fail closed");
const workingSetStorageSync = wx.setStorageSync;
wx.setStorageSync = () => { throw new Error("storage unavailable"); };
assert.equal(local.writeNoteDraft(draft, "none"), false);
assert.equal(local.createNote({ content: "must fail closed" }), null);
assert.equal(local.updateNote("note-1", "must fail closed"), null);
wx.setStorageSync = workingSetStorageSync;

const [nonePath] = await local.persistNoteDraftImages(["/tmp/none.jpg"], "none");
assert.equal(nonePath, "/user-data/none.jpg");
auth.enterGuest();
storage.set("xinqingMiniGuestNotes", [{ id: "note-1", content: "a" }, null, { content: "bad" }]);
assert.deepEqual(local.readNotes().map((item) => item.id), ["note-1"]);
assert.equal(local.updateNote("note-1", "b").content, "b");
const [guestPath] = await local.persistNoteDraftImages(["/tmp/guest.jpg"], "guest");
assert.equal(guestPath, "/user-data/guest.jpg");
const restartDraft = { content: "重启后仍在", mediaItems: [{ type: "image", url: "/user-data/authenticated.jpg", thumbUrl: "/user-data/authenticated.jpg", duration: 0 }], selectedMood: null, clientRequestId: "stable-request" };
assert.equal(local.writeNoteDraft(restartDraft, "guest"), true);
assert.deepEqual(local.readNoteDraft("guest"), withOwner(restartDraft, "guest"));

const requestModule = require("../miniprogram-project/utils/request.js");
const uploads = require("../miniprogram-project/api/uploads.js");
const cleanupUrls = ["https://manliaoxiaoji.com/api/uploads/notes/orphan-1"];
requestModule.request = async () => { throw new Error("401"); };
await assert.rejects(uploads.cleanupOrQueueNoteUploads(cleanupUrls));
assert.deepEqual(local.readPendingUploadCleanup(), cleanupUrls);
auth.clearAuth();
auth.enterGuest();
assert.deepEqual(local.readNoteDraft("guest"), withOwner(restartDraft, "guest"));
auth.saveAuth({ token: "real-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "user-1" } });
assert.equal(auth.getDataOwner(), "authenticated:user-1");
assert.deepEqual(local.readNotes(), [], "account must not read guest notes through local storage helpers");
assert.equal(local.readNoteDraft("authenticated:user-1"), null, "account must not see guest draft");
assert.equal(local.readNoteDraft("guest"), null, "inactive guest owner must fail closed");
const accountDraft = { content: "账号草稿", mediaItems: [], selectedMood: null, clientRequestId: "account-request" };
assert.equal(local.writeNoteDraft(accountDraft, "authenticated:user-1"), true);
auth.saveAuth({ token: "refreshed-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "user-1" } });
assert.deepEqual(local.readNoteDraft("authenticated:user-1"), withOwner(accountDraft, "authenticated:user-1"));
auth.clearAuth();
auth.enterGuest();
assert.deepEqual(local.readNoteDraft("guest"), withOwner(restartDraft, "guest"), "returning guest must recover its own draft");
auth.saveAuth({ token: "cleanup-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "user-1" } });
requestModule.request = async () => ({});
assert.equal(await uploads.retryPendingNoteUploadCleanup(), true);
assert.deepEqual(local.readPendingUploadCleanup(), []);
assert.equal(await uploads.retryPendingNoteUploadCleanup(), false);
local.addPendingUploadCleanup([...cleanupUrls, ...cleanupUrls]);
assert.deepEqual(local.readPendingUploadCleanup(), cleanupUrls);
requestModule.request = async () => { throw new Error("network"); };
await assert.rejects(uploads.retryPendingNoteUploadCleanup());
assert.deepEqual(local.readPendingUploadCleanup(), cleanupUrls);
local.removePersistedNoteImage("/tmp/not-owned.jpg");
local.removePersistedNoteImage("/user-data/no-longer-referenced.jpg");
assert.deepEqual(removedFiles, ["/user-data/no-longer-referenced.jpg"]);
local.removePendingUploadCleanup(cleanupUrls);
const manyUrls = Array.from({ length: 108 }, (_, index) => `https://manliaoxiaoji.com/api/uploads/notes/00000000-0000-0000-0000-${String(index).padStart(12, "0")}?token=opaque`);
local.addPendingUploadCleanup([...manyUrls, ...manyUrls]);
assert.deepEqual(local.readPendingUploadCleanup(), manyUrls);
requestModule.request = async () => { throw new Error("network"); };
await assert.rejects(uploads.retryPendingNoteUploadCleanup());
assert.deepEqual(local.readPendingUploadCleanup(), manyUrls);
const cleanupBatchSizes = [];
const cleanedUrls = [];
requestModule.request = async ({ data }) => { cleanupBatchSizes.push(data.urls.length); cleanedUrls.push(...data.urls); return {}; };
assert.equal(await uploads.retryPendingNoteUploadCleanup(), true);
assert.deepEqual(cleanupBatchSizes, Array(12).fill(9));
assert.deepEqual(cleanedUrls, manyUrls);
assert.equal(new Set(cleanedUrls).size, 108);
assert.deepEqual(local.readPendingUploadCleanup(), []);

const note = readFileSync("miniprogram-project/pages/note/note.js", "utf8");
const detail = readFileSync("miniprogram-project/pages/note-detail/note-detail.js", "utf8");
const history = readFileSync("miniprogram-project/pages/note-history/note-history.js", "utf8");
const search = readFileSync("miniprogram-project/pages/note-search/note-search.js", "utf8");
const notesApi = readFileSync("miniprogram-project/api/notes.js", "utf8");
const uploadsApi = readFileSync("miniprogram-project/api/uploads.js", "utf8");
assert.match(note, /readNoteDraft\(owner\)/);
assert.match(note, /writeNoteDraft\(/);
assert.match(note, /if \(this\.draftCommitted\) return/);
assert.match(note, /this\.draftCommitted = true;\s*clearNoteDraft\(owner\)/);
assert.match(note, /clientRequestId:\s*this\.data\.clientRequestId/);
assert.match(note, /clientRequestId:\s*draft \? draft\.clientRequestId : createRequestId\(\)/);
assert.match(note, /clientRequestId:\s*createRequestId\(\)/);
assert.match(note, /persistNoteDraftImages\(selected\.map/);
assert.match(note, /cleanupOrQueueNoteUploads\(cleanupUrls\)/);
assert.match(note, /retryPendingNoteUploadCleanup\(\)/);
assert.match(note, /草稿已保存在本机，请重新登录/);
assert.match(note, /小记无法保存在本机/);
assert.match(detail, /updateNote\(this\.data\.note\.id, content\)/);
assert.match(detail, /isUpdating/);
assert.match(history, /generation !== this\.refreshGeneration/);
assert.match(search, /generation !== this\.searchGeneration/);
assert.match(search, /dateKey:\s*note\.recordDate/);
assert.match(notesApi, /listAllNotes/);
assert.match(notesApi, /pageSize = 100/);
assert.match(uploadsApi, /method:\s*"DELETE"/);
assert.match(uploadsApi, /error\.uploadedUrls/);
assert.match(uploadsApi, /addPendingUploadCleanup\(urls\)/);

const layout = require("../miniprogram-project/utils/layout.js");
layout.getSafeLayout = () => ({
  pageTop: 0,
  backTop: 0,
  actionTop: 0,
  actionRight: 0,
  panelTop: 0
});
let notePageDefinition;
global.Page = (value) => { notePageDefinition = value; };
const notePagePath = require.resolve("../miniprogram-project/pages/note/note.js");
delete require.cache[notePagePath];
require(notePagePath);
const createNotePage = () => {
  const page = { ...notePageDefinition, data: { ...notePageDefinition.data } };
  page.setData = (next) => Object.assign(page.data, next);
  return page;
};
auth.clearAuth();
auth.enterGuest();
local.clearNoteDraft("guest");
const firstNewPage = createNotePage();
firstNewPage.onLoad();
const secondNewPage = createNotePage();
secondNewPage.onLoad();
assert.notEqual(firstNewPage.data.clientRequestId, secondNewPage.data.clientRequestId);
assert.match(firstNewPage.data.clientRequestId, /^mini-note-/);
const stableDraft = { content: "继续写", mediaItems: [], selectedMood: null, clientRequestId: "stable-retry-id" };
assert.equal(local.writeNoteDraft(stableDraft, "guest"), true);
const resumedPage = createNotePage();
resumedPage.onLoad();
assert.equal(resumedPage.data.clientRequestId, "stable-retry-id");

let chooseMediaSuccess;
let delayedSaveSuccess;
const immediateFileSystemManager = wx.getFileSystemManager;
wx.chooseMedia = ({ success }) => { chooseMediaSuccess = success; };
wx.getFileSystemManager = () => ({
  saveFile: ({ success }) => { delayedSaveSuccess = success; },
  unlink: ({ filePath }) => removedFiles.push(filePath)
});
const delayedImagePage = createNotePage();
delayedImagePage.onLoad();
delayedImagePage.chooseMedia();
chooseMediaSuccess({ tempFiles: [{ tempFilePath: "/tmp/late-a.jpg" }] });
assert.equal(typeof delayedSaveSuccess, "function");
auth.saveAuth({ token: "user-b-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "user-b" } });
delayedImagePage.onShow();
assert.equal(delayedImagePage.data.content, "", "user B must not see user A draft text");
delayedSaveSuccess({ savedFilePath: "/user-data/late-a.jpg" });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(delayedImagePage.data.mediaItems.length, 0, "late user A image must not enter user B draft");
assert.ok(removedFiles.includes("/user-data/late-a.jpg"), "late persisted image must be deleted");
assert.equal(local.readNoteDraft("authenticated:user-b"), null);
auth.clearAuth();
auth.enterGuest();
assert.deepEqual(local.readNoteDraft("guest"), withOwner(stableDraft, "guest"), "guest draft must survive A to B and return");
wx.getFileSystemManager = immediateFileSystemManager;

const { createNoteSlip } = require("../miniprogram-project/utils/note-slip.js");
const derived = createNoteSlip("我不知道为什么不想继续这样", 0);
assert.equal(derived.quote, "先不用急着找到答案。");
assert.equal(derived.quote.includes("我不知道"), false);
assert.match(createNoteSlip("", 2).quote, /细节/);

console.log("Miniapp note release check passed.");
