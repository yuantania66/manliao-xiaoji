// One unresolved authenticated send only. Never persist credentials or auto-replay it.
// Identity writes/logout/cancellation clear both legacy v1 and v2 in utils/auth.js.
// Page callbacks additionally require the current auth, page, and session epochs.
const { getAuth, claimPendingChatTurn } = require("./auth");
const CHAT_PENDING_TURN_KEY = "xinqingMiniChatPendingTurn:v2";

const isAuthenticatedOwner = (owner) =>
  typeof owner === "string" && owner.startsWith("authenticated:") && owner.length > 14;

const normalizePendingTurn = (value) => {
  if (!value || Array.isArray(value) || value.version !== 2) return null;
  if (!isAuthenticatedOwner(value.owner)) return null;
  if (typeof value.sessionId !== "string" || !value.sessionId) return null;
  if (typeof value.turnId !== "string" || !/^[a-zA-Z0-9:_-]{8,160}$/.test(value.turnId)) return null;
  if (typeof value.content !== "string" || !value.content.trim() || value.content.length > 500) return null;
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  return {
    version: 2,
    owner: value.owner,
    sessionId: value.sessionId,
    turnId: value.turnId,
    content: value.content,
    createdAt: value.createdAt
  };
};

const readPendingChatTurn = (owner) => {
  if (!isAuthenticatedOwner(owner)) return null;
  try {
    const pending = normalizePendingTurn(wx.getStorageSync(CHAT_PENDING_TURN_KEY));
    const auth = getAuth();
    // Absent claim is the pre-upgrade auth contract. Every new login writes an
    // explicit null, so retained files cannot be adopted by a later identity.
    return pending && pending.owner === owner && auth && owner === `authenticated:${auth.user.id}` &&
      (auth.pendingChatTurnId === pending.turnId ||
        !Object.prototype.hasOwnProperty.call(auth, "pendingChatTurnId")) ? pending : null;
  } catch (error) {
    return null;
  }
};

const writePendingChatTurn = ({ owner, sessionId, turnId, content, createdAt }) => {
  const pending = normalizePendingTurn({
    version: 2,
    owner,
    sessionId,
    turnId,
    content,
    createdAt
  });
  if (!pending) throw new Error("待确认消息身份无效");
  // Claim first: if auth persistence fails, do not replace an older pending file.
  claimPendingChatTurn(owner, turnId);
  wx.setStorageSync(CHAT_PENDING_TURN_KEY, pending);
  const stored = normalizePendingTurn(wx.getStorageSync(CHAT_PENDING_TURN_KEY));
  if (!stored || stored.owner !== owner || stored.sessionId !== sessionId || stored.turnId !== turnId) {
    throw new Error("待确认消息暂时无法保存");
  }
  if (!readPendingChatTurn(owner)) throw new Error("待确认消息归属暂时无法保存");
  return stored;
};

const clearPendingChatTurn = ({ owner, sessionId, turnId }) => {
  const current = readPendingChatTurn(owner);
  if (!current || current.sessionId !== sessionId || current.turnId !== turnId) return false;
  wx.removeStorageSync(CHAT_PENDING_TURN_KEY);
  if (readPendingChatTurn(owner)) throw new Error("待确认消息暂时无法清理");
  return true;
};

module.exports = {
  CHAT_PENDING_TURN_KEY,
  readPendingChatTurn,
  writePendingChatTurn,
  clearPendingChatTurn
};
