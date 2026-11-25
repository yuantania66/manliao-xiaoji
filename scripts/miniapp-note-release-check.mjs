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
const originalWx = global.wx;
const searchRequests = [];
const searchNavigations = [];
const searchToasts = [];
global.wx = {
  ...originalWx,
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
  getSystemInfoSync: () => ({ windowWidth: 375, screenHeight: 812 }),
  getMenuButtonBoundingClientRect: () => ({ top: 28, bottom: 60, left: 280 }),
  request(options) {
    assert.match(options.url, /^http:\/\/127\.0\.0\.1:3002\/api\/notes/);
    searchRequests.push(options);
  },
  navigateTo: ({ url }) => searchNavigations.push(url),
  showToast: ({ title }) => searchToasts.push(title)
};
storage.set("xinqing_api_env", "local");
let searchPageDefinition;
global.Page = (page) => { searchPageDefinition = page; };
require("../miniprogram-project/pages/note-search/note-search.js");
const searchPage = {
  ...searchPageDefinition,
  data: { ...searchPageDefinition.data },
  setData(values) { Object.assign(this.data, values); }
};
const signInForSearch = (id, token = id) => auth.saveAuth({ token, user: { id }, expiresAt: "2999-01-01T00:00:00.000Z" });
const inputSearch = (value) => searchPage.onInput({ detail: { value } });
const searchHit = { id: "fixture-note", content: "合成小记", recordDate: "2026-11-25" };
const respondToSearch = (pending, items = [searchHit], total = items.length) => pending.success({ statusCode: 200, data: { data: { items, total } } });
const settleSearch = () => new Promise((resolve) => setImmediate(resolve));
const tapSearchResult = (generation) => searchPage.openResult({ currentTarget: { dataset: { id: searchHit.id, generation } } });

signInForSearch("search-a");
searchPage.onLoad();
searchPage.onShow?.();
inputSearch("合成小记");
const searchBeforeExpiry = searchRequests.shift();
const expiredSearchSession = requestModule.request({ url: "/api/notes" });
searchRequests.shift().success({ statusCode: 401, data: {} });
await assert.rejects(expiredSearchSession, { statusCode: 401 });
respondToSearch(searchBeforeExpiry);
await settleSearch();
assert.equal(auth.getAuth(), null);
assert.deepEqual(searchPage.data.results, [], "A late search must not reveal old notes after another request logs the user out");
assert.match(searchPage.data.statusText, /请先登录/);

signInForSearch("search-a");
searchPage.onShow();
inputSearch("合成小记");
assert.equal(searchPage.data.isSearching, true);
const firstSearchPage = searchRequests.shift();
assert.match(firstSearchPage.url, /page=1&pageSize=100/);
const fullSearchPage = Array.from({ length: 100 }, (_, i) => ({ ...searchHit, id: `earlier-${i}`, content: "其他小记" }));
respondToSearch(firstSearchPage, fullSearchPage, 101);
await settleSearch();
const secondSearchPage = searchRequests.shift();
assert.match(secondSearchPage.url, /page=2&pageSize=100/);
respondToSearch(secondSearchPage, [searchHit], 101);
await settleSearch();
assert.equal(searchPage.data.isSearching, false);
assert.equal(searchPage.data.results[0].id, searchHit.id);
const initialRender = searchPage.data.resultGeneration;
tapSearchResult(initialRender);
assert.deepEqual(searchNavigations, ["/pages/note-detail/note-detail?id=fixture-note&date=2026-11-25"]);

inputSearch("离开前的搜索");
const delayedHiddenSearch = searchRequests.shift();
searchPage.onHide();
assert.deepEqual(searchPage.data.results, []);
searchPage.onShow();
assert.equal(searchPage.data.query, "离开前的搜索");
const delayedAccountSearch = searchRequests.shift();
signInForSearch("search-a", "new-session-same-user");
respondToSearch(delayedAccountSearch);
await settleSearch();
assert.deepEqual(searchPage.data.results, [], "Signing in again as the same account invalidates its older request");

inputSearch("合成小记");
const beforeSwitch = searchRequests.shift();
const secondExpiry = requestModule.request({ url: "/api/notes" });
searchRequests.shift().success({ statusCode: 401, data: {} });
await assert.rejects(secondExpiry, { statusCode: 401 });
signInForSearch("search-b");
searchPage.onShow();
inputSearch("合成小记");
respondToSearch(searchRequests.shift());
await settleSearch();
assert.equal(searchPage.data.results[0].id, searchHit.id);
respondToSearch(delayedHiddenSearch);
respondToSearch(beforeSwitch, fullSearchPage, 101);
await settleSearch();
assert.equal(searchRequests.length, 0, "An older full page must not dispatch the next page under the new account");
assert.equal(auth.getAuth().user.id, "search-b");
assert.equal(searchPage.data.results.length, 1, "Older responses must not clear a fresh search on another account");
tapSearchResult(initialRender);
assert.equal(searchNavigations.length, 1, "An old tap cannot be retargeted to an identical ID in a new render");

const currentRender = searchPage.data.resultGeneration;
signInForSearch("search-c");
tapSearchResult(currentRender);
assert.deepEqual(searchPage.data.results, [], "Tapping after the account changes must clear the old rows");
assert.equal(searchNavigations.length, 1);
inputSearch("找不到");
respondToSearch(searchRequests.shift(), []);
await settleSearch();
assert.equal(searchPage.data.showEmpty, true);
inputSearch("网络失败");
searchRequests.shift().fail();
await settleSearch();
assert.match(searchPage.data.statusText, /网络/);
assert.equal(searchToasts.length, 1);

auth.clearAuth();
auth.enterGuest();
const previousGuestNotes = local.readNotes();
const guestSearchFixture = local.createNote({ content: "仅本机的合成小记" });
assert(guestSearchFixture);
searchPage.onShow();
inputSearch("仅本机");
assert.equal(searchPage.data.results[0].id, guestSearchFixture.id);
assert.equal(searchRequests.length, 0, "Guest search stays on the device");

let historyPageDefinition;
global.Page = (page) => { historyPageDefinition = page; };
require("../miniprogram-project/pages/note-history/note-history.js");
const createHistoryPage = (date) => {
  const page = {
    ...historyPageDefinition,
    data: { ...historyPageDefinition.data },
    setData(values, done) { Object.assign(this.data, values); done?.(); }
  };
  page.onLoad({ date });
  page.onShow();
  return page;
};
const takeHistoryRequest = (pageNumber) => {
  const pending = searchRequests.shift();
  const params = new URL(pending.url).searchParams;
  assert.equal(params.get("date"), searchHit.recordDate);
  assert.equal(params.get("page"), String(pageNumber));
  return pending;
};
const tapHistoryResult = (page, generation) => page.openNote({ currentTarget: { dataset: { id: searchHit.id, generation } } });

signInForSearch("history-a");
const historyPage = createHistoryPage(searchHit.recordDate);
const historyBeforeExpiry = takeHistoryRequest(1);
const expiredHistorySession = requestModule.request({ url: "/api/notes" });
searchRequests.shift().success({ statusCode: 401, data: {} });
await assert.rejects(expiredHistorySession, { statusCode: 401 });
respondToSearch(historyBeforeExpiry);
await settleSearch();
assert.equal(auth.getAuth(), null);
assert.deepEqual(historyPage.data.notes, [], "An expired account's late history result must stay hidden");
assert.match(historyPage.data.statusText, /请先登录/);

signInForSearch("history-a");
historyPage.onShow();
respondToSearch(takeHistoryRequest(1));
await settleSearch();
assert.deepEqual(historyPage.data.notes.map(({ id }) => id), [searchHit.id]);
const initialHistoryRender = historyPage.data.resultGeneration;
const initialHistoryNavigationCount = searchNavigations.length;
tapHistoryResult(historyPage, initialHistoryRender);
assert.equal(searchNavigations.at(-1), "/pages/note-detail/note-detail?id=fixture-note&date=2026-11-25");
historyPage.onInput({ detail: { value: "仅 A 的筛选" } });
const fullHistoryBeforeSwitch = takeHistoryRequest(1);

signInForSearch("history-b");
historyPage.onShow();
assert.equal(historyPage.data.query, "");
assert.deepEqual(historyPage.data.notes, [], "The new account must start loading without the old account's rows");
assert.equal(historyPage.data.isLoading, true);
respondToSearch(takeHistoryRequest(1), fullSearchPage, 101);
await settleSearch();
respondToSearch(takeHistoryRequest(2), [searchHit], 101);
await settleSearch();
assert.equal(historyPage.data.notes.length, 101, "The current account retains full, date-filtered pagination");
respondToSearch(fullHistoryBeforeSwitch, fullSearchPage, 101);
await settleSearch();
assert.equal(searchRequests.length, 0, "An outdated history page must not fetch its next page as the new account");
assert.equal(auth.getAuth().user.id, "history-b");
assert.equal(historyPage.data.notes.length, 101);
tapHistoryResult(historyPage, initialHistoryRender);
assert.equal(searchNavigations.length, initialHistoryNavigationCount + 1, "A queued tap must not retarget to the same ID rendered by the new account");
tapHistoryResult(historyPage, historyPage.data.resultGeneration);
assert.equal(searchNavigations.length, initialHistoryNavigationCount + 2);

historyPage.onInput({ detail: { value: "返回后继续筛选" } });
const historyBeforeHide = takeHistoryRequest(1);
historyPage.onHide();
respondToSearch(historyBeforeHide, fullSearchPage, 101);
await settleSearch();
assert.deepEqual(historyPage.data.notes, []);
assert.equal(searchRequests.length, 0);
historyPage.onShow();
assert.equal(historyPage.data.query, "返回后继续筛选");
takeHistoryRequest(1).fail();
await settleSearch();
assert.match(historyPage.data.statusText, /网络/);
assert.equal(historyPage.data.isLoading, false);

auth.clearAuth();
auth.enterGuest();
const guestHistoryPage = createHistoryPage(guestSearchFixture.dateKey);
assert(guestHistoryPage.data.notes.some(({ id }) => id === guestSearchFixture.id));
assert.match(guestHistoryPage.data.statusText, /游客/);
assert.equal(searchRequests.length, 0, "Guest history stays on the device");

assert(local.writeNotes(previousGuestNotes));
global.wx = originalWx;
storage.delete("xinqing_api_env");

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
