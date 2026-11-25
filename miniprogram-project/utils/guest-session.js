const { API_TIMEOUT, getApiBaseUrl } = require("../config/api");

// Independent of Auth and chat history; these capabilities are issued by the server.
const SESSION_KEY = "xinqingMiniGuestSession:v1";
let epoch = 0;
let handle;
let bootstrapFlight = null;
let turnSequence = 0;
const requests = new Map();
const guestError = (message, reason, statusCode) => Object.assign(new Error(message), { statusCode, details: { reason } });
const staleError = () => guestError("游客会话已变化，请重新发送。", "GUEST_SESSION_STALE", 409);
const validHandle = (value) => Boolean(value && typeof value.ownerId === "string" && value.ownerId &&
  typeof value.conversationId === "string" && value.conversationId &&
  typeof value.credential === "string" && value.credential &&
  typeof value.expiresAt === "string" && Date.parse(value.expiresAt) > Date.now());
const readHandle = () => {
  if (handle === undefined) {
    try { handle = wx.getStorageSync(SESSION_KEY) || null; } catch (error) { handle = null; }
  }
  return validHandle(handle) ? handle : null;
};

const transport = (method, path, data, credential) => new Promise((resolve, reject) => {
  const base = getApiBaseUrl();
  if (!base) return reject(new Error("请先配置 API 地址"));
  wx.request({
    url: `${base}${path}`, method, data, timeout: API_TIMEOUT,
    header: { "content-type": "application/json", "x-guest-transport": "mini",
      ...(credential ? { "x-guest-credential": credential } : {}) },
    success(response) {
      const body = response.data || {};
      if (response.statusCode >= 400 || body.ok === false) {
        const failure = body.error || {};
        reject(Object.assign(new Error(failure.message || "游客服务暂时不可用"), {
          statusCode: response.statusCode, code: failure.code, details: failure.details
        }));
      } else resolve(body.data || body);
    },
    fail() { reject(guestError("发送状态暂时无法确认，请稍后再试。", "GUEST_EXECUTION_UNKNOWN")); }
  });
});
const revoke = (old, scope) => {
  if (!old || !old.credential) return;
  void transport("DELETE", "/api/chat/guest/session", {
    ownerId: old.ownerId, conversationId: old.conversationId, scope
  }, old.credential).catch(() => {});
};
const invalidateGuestSession = (scope = "owner") => {
  const old = readHandle();
  epoch += 1;
  handle = null;
  bootstrapFlight = null;
  requests.clear();
  try { wx.removeStorageSync(SESSION_KEY); } catch (error) {}
  revoke(old, scope);
};
const captureGuestAuthority = () => {
  const current = readHandle();
  // Expiry starts a new authority round even when the user remains in Guest mode.
  if (!current && handle) invalidateGuestSession();
  return { epoch, ownerId: current?.ownerId || null, conversationId: current?.conversationId || null,
    expiresAt: current?.expiresAt || null };
};
const isCurrentGuestAuthority = (authority) => {
  if (!authority || authority.epoch !== epoch) return false;
  if (!authority.conversationId) return true; // bootstrap not yet bound
  const current = readHandle();
  return Boolean(current && current.conversationId === authority.conversationId &&
    current.ownerId === authority.ownerId && Date.parse(authority.expiresAt) > Date.now());
};
const ensureGuestSession = async (authority = captureGuestAuthority()) => {
  if (!isCurrentGuestAuthority(authority)) throw staleError();
  let current = readHandle();
  if (!current) {
    if (!bootstrapFlight) {
      const startedEpoch = epoch;
      const flight = transport("POST", "/api/chat/guest/session", {}, null).then((issued) => {
        if (startedEpoch !== epoch) { revoke(issued, "owner"); throw staleError(); }
        if (!validHandle(issued)) throw new Error("游客会话响应无效");
        try { wx.setStorageSync(SESSION_KEY, issued); } catch (error) { revoke(issued, "owner"); throw error; }
        handle = issued;
        return issued;
      }).finally(() => { if (bootstrapFlight === flight) bootstrapFlight = null; });
      bootstrapFlight = flight;
    }
    current = await bootstrapFlight;
  }
  if (authority.epoch !== epoch) throw staleError();
  Object.assign(authority, { ownerId: current.ownerId, conversationId: current.conversationId, expiresAt: current.expiresAt });
  return current;
};
// A request marker only; never an identity or credential.
const createGuestTurnId = () => `mini-guest-${Date.now()}-${++turnSequence}-${Math.random().toString(16).slice(2)}`;
const guestRequest = async (path, input, authority = captureGuestAuthority(), isCurrent = () => true) => {
  if (!isCurrent()) throw staleError();
  const { retryOfAttempt, ...generationInput } = input;
  if (!generationInput.turnId) throw new Error("缺少请求标识");
  const key = `${path}:${generationInput.turnId}`;
  let record = requests.get(key);
  const encoded = JSON.stringify(generationInput);
  if (record && record.encoded !== encoded) throw guestError("同一请求内容已变化", "GUEST_REQUEST_CONFLICT", 409);
  if (retryOfAttempt !== undefined && (!Number.isInteger(retryOfAttempt) || retryOfAttempt < 1 || !record)) throw staleError();
  if (!record) {
    for (const [id, item] of requests) if (item.authority.expiresAt && Date.parse(item.authority.expiresAt) <= Date.now()) requests.delete(id);
    if (requests.size >= 64) throw guestError("游客会话请求已达本机上限", "GUEST_CAPACITY", 429);
    record = { encoded, payload: JSON.parse(encoded), authority, started: false };
    requests.set(key, record);
  } else if (!isCurrentGuestAuthority(record.authority)) throw staleError();
  if (retryOfAttempt !== undefined && record.attempt !== retryOfAttempt && record.retryOfAttempt !== retryOfAttempt) throw staleError();
  let current = await ensureGuestSession(record.authority);
  Object.assign(authority, record.authority);
  const execute = () => {
    if (!isCurrent() || !isCurrentGuestAuthority(record.authority)) throw staleError();
    return transport("POST", path, { ...record.payload, conversationId: current.conversationId,
      ...(retryOfAttempt === undefined ? {} : { retryOfAttempt }) }, current.credential);
  };
  const alreadyStarted = record.started;
  record.started = true;
  if (retryOfAttempt !== undefined) record.retryOfAttempt = retryOfAttempt;
  let result;
  try { result = await execute(); } catch (error) {
    if (!isCurrent() || !isCurrentGuestAuthority(record.authority)) throw staleError();
    if (alreadyStarted || retryOfAttempt !== undefined || error.statusCode !== 401 || error.details?.reason !== "GUEST_SESSION_INVALID") throw error;
    // Only a definite pre-model rejection may bootstrap once. Unknown failures never replay.
    invalidateGuestSession();
    record.authority = captureGuestAuthority();
    current = await ensureGuestSession(record.authority);
    Object.assign(authority, record.authority);
    requests.set(key, record);
    result = await execute();
  }
  if (!isCurrentGuestAuthority(record.authority)) throw staleError();
  if (Number.isInteger(result.guestAttempt)) record.attempt = result.guestAttempt;
  return result;
};
module.exports = { captureGuestAuthority, isCurrentGuestAuthority, ensureGuestSession,
  invalidateGuestSession, createGuestTurnId, guestRequest };
