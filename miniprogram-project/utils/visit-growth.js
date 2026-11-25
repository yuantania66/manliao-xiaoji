const { getAuth, captureAuthAuthority, isCurrentAuthAuthority } = require("./auth");
const { request } = require("./request");

// Memory-only view cache. Dates and counters are authoritative only on the server.
let state = null, stateAuthority = null, pending = null, animationTicket = null;
const completedDays = new Map();
const getCareStorageKey = (userId) => `xinqingCareCompleted:v1:${encodeURIComponent(userId)}`;
const completedDay = (userId) => {
  try { return completedDays.get(userId) || wx.getStorageSync(getCareStorageKey(userId)); }
  catch (_) { return completedDays.get(userId); }
};
const listeners = new Set();
const eligible = (auth) => Boolean(auth);
const currentState = () => state && isCurrentAuthAuthority(stateAuthority) ? state : null;
const emit = () => listeners.forEach((listener) => listener(currentState()));
const validSummary = (value, auth) => {
  if (!value || value.userId !== auth.user.id || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
      !Number.isFinite(Date.parse(value.serverNow)) || !Number.isSafeInteger(value.totalDays) || value.totalDays < 0 ||
      value.leafCount !== Math.min(value.totalDays, 365) || !Array.isArray(value.flowers) || value.flowers.length > 12 ||
      typeof value.recordedToday !== "boolean" || typeof value.addedToday !== "boolean") return false;
  const serverDay = new Date(Date.parse(value.serverNow) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (value.day !== serverDay || (value.recordedToday && value.totalDays === 0) ||
      (value.addedToday && !value.recordedToday)) return false;
  return value.flowers.every((flower, index) => /^\d{4}-\d{2}$/.test(flower.month) &&
    flower.month <= value.day.slice(0, 7) && (!index || flower.month > value.flowers[index - 1].month) &&
    Number.isInteger(flower.daysInMonth) && flower.daysInMonth >= 28 && flower.daysInMonth <= 31 &&
    flower.daysInMonth === new Date(Date.UTC(Number(flower.month.slice(0,4)), Number(flower.month.slice(5,7)), 0)).getUTCDate() &&
    Number.isInteger(flower.visitDays) && flower.visitDays >= 1 && flower.visitDays <= flower.daysInMonth);
};

const recordVisit = () => {
  const auth = getAuth();
  if (!eligible(auth)) {
    state = stateAuthority = pending = null; animationTicket = null; emit();
    return Promise.resolve(null);
  }
  if (stateAuthority && !isCurrentAuthAuthority(stateAuthority)) {
    if (stateAuthority.userId !== auth.user.id) animationTicket = null;
    state = stateAuthority = null; emit();
  }
  if (pending && isCurrentAuthAuthority(pending.authority)) return pending.promise;
  const authority = captureAuthAuthority();
  const operation = { auth, authority };
  pending = operation;
  operation.promise = request({
    url: "/api/growth", method: "POST", auth: false,
    headers: { Authorization: `Bearer ${auth.token}` }
  }).then((result) => {
    if (pending !== operation || !isCurrentAuthAuthority(authority)) return null;
    if (!validSummary(result, auth)) throw new Error("成长记录暂时无法读取");
    // The server owns visit dates/counts. Playback completion is a separate local
    // receipt: a previously recorded day can still have an unseen animation.
    state = result; stateAuthority = authority; emit();
    return result;
  }).finally(() => { if (pending === operation) pending = null; });
  return operation.promise;
};

const consumeAnimation = () => {
  const value = currentState();
  if (!value?.recordedToday || completedDay(value.userId) === value.day) return false;
  if (animationTicket && isCurrentAuthAuthority(animationTicket.authority) && animationTicket.day === value.day) return false;
  animationTicket = { authority: stateAuthority, userId: value.userId, day: value.day };
  return animationTicket;
};
const cancelAnimation = (ticket) => { if (ticket && animationTicket === ticket) animationTicket = null; };
const finishAnimation = (ticket) => {
  if (!ticket || animationTicket !== ticket || !isCurrentAuthAuthority(ticket.authority)) return;
  completedDays.set(ticket.userId, ticket.day);
  try { wx.setStorageSync(getCareStorageKey(ticket.userId), ticket.day); }
  catch (_) { /* Optional receipt: retain runtime de-duplication if local storage fails. */ }
  animationTicket = null;
};
const clearAccount = (userId) => {
  completedDays.delete(userId);
  if (animationTicket && animationTicket.userId === userId) animationTicket = null;
  if (stateAuthority && stateAuthority.userId === userId) state = stateAuthority = null;
  if (pending && pending.authority.userId === userId) pending = null;
  emit();
};
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
module.exports = { recordVisit, currentState, consumeAnimation, cancelAnimation, finishAnimation, getCareStorageKey, clearAccount, subscribe };
