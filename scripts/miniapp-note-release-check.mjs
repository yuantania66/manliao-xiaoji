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
  getFileSystemManager: () => ({
    saveFile: ({ tempFilePath, success }) => success({ savedFilePath: `/user-data/${tempFilePath.split("/").pop()}` }),
    unlink: ({ filePath }) => removedFiles.push(filePath)
  })
};
global.getApp = () => ({ globalData: {} });

const local = require("../miniprogram-project/utils/local-data.js");
assert.equal(local.readNoteDraft(), null);
const draft = { content: "未完成", mediaItems: [], selectedMood: null, clientRequestId: "request-1" };
assert.equal(local.writeNoteDraft(draft), true);
assert.deepEqual(local.readNoteDraft(), draft);
local.clearNoteDraft();
assert.equal(local.readNoteDraft(), null);
storage.set("xinqingMiniNoteDraft:v1", { content: 1, mediaItems: "bad" });
assert.equal(local.readNoteDraft(), null);
storage.set("xinqingMiniNoteDraft:v1", { content: "伪造路径", mediaItems: [{ type: "image", url: "/user-data/private.txt", thumbUrl: "/different" }], clientRequestId: "bad-media" });
assert.equal(local.readNoteDraft(), null);
storage.set("xinqingMiniGuestNotes", [{ id: "note-1", content: "a" }, null, { content: "bad" }]);
assert.deepEqual(local.readNotes().map((item) => item.id), ["note-1"]);
assert.equal(local.updateNote("note-1", "b").content, "b");
const workingSetStorageSync = wx.setStorageSync;
wx.setStorageSync = () => { throw new Error("storage unavailable"); };
assert.equal(local.writeNoteDraft(draft), false);
assert.equal(local.createNote({ content: "must fail closed" }), null);
assert.equal(local.updateNote("note-1", "must fail closed"), null);
wx.setStorageSync = workingSetStorageSync;

for (const mode of ["none", "guest", "authenticated"]) {
  const [savedPath] = await local.persistNoteDraftImages([`/tmp/${mode}.jpg`]);
  assert.equal(savedPath, `/user-data/${mode}.jpg`);
}
const restartDraft = { content: "重启后仍在", mediaItems: [{ type: "image", url: "/user-data/authenticated.jpg", thumbUrl: "/user-data/authenticated.jpg", duration: 0 }], selectedMood: null, clientRequestId: "stable-request" };
assert.equal(local.writeNoteDraft(restartDraft), true);
assert.deepEqual(local.readNoteDraft(), restartDraft);

const auth = require("../miniprogram-project/utils/auth.js");
const requestModule = require("../miniprogram-project/utils/request.js");
const uploads = require("../miniprogram-project/api/uploads.js");
const cleanupUrls = ["https://manliaoxiaoji.com/api/uploads/notes/orphan-1"];
requestModule.request = async () => { throw new Error("401"); };
await assert.rejects(uploads.cleanupOrQueueNoteUploads(cleanupUrls));
assert.deepEqual(local.readPendingUploadCleanup(), cleanupUrls);
auth.clearAuth();
assert.deepEqual(local.readNoteDraft(), restartDraft);
auth.saveAuth({ token: "real-token", expiresAt: "2999-01-01T00:00:00.000Z", user: { id: "user-1" } });
assert.deepEqual(local.readNoteDraft(), restartDraft);
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
assert.match(note, /readNoteDraft\(\)/);
assert.match(note, /writeNoteDraft\(/);
assert.match(note, /if \(this\.draftCommitted\) return/);
assert.match(note, /this\.draftCommitted = true;\s*clearNoteDraft\(\)/);
assert.match(note, /clientRequestId:\s*this\.data\.clientRequestId/);
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

console.log("Miniapp note release check passed.");
