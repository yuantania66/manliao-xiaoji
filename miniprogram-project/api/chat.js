const { request } = require("../utils/request");
const { guestRequest, createGuestTurnId } = require("../utils/guest-session");

const listSessions = () => request({ url: "/api/chat/sessions?pageSize=20" });

const createSession = () =>
  request({
    url: "/api/chat/sessions",
    method: "POST",
    data: { title: "慢慢说" }
  });

const listMessages = (sessionId) =>
  request({
    url: `/api/chat/sessions/${sessionId}/messages?pageSize=50`
  });

const sendMessage = (sessionId, content, turnId) =>
  request({
    url: `/api/chat/sessions/${sessionId}/messages`,
    method: "POST",
    data: { content, turnId }
  });

const sendGuestMessage = ({ content, turnId, recentMessages, retryOfAttempt, authority, isCurrent }) =>
  guestRequest("/api/chat/guest", { content, turnId, recentMessages, retryOfAttempt }, authority, isCurrent);

const getGuestGreeting = ({ kind = "initial", recentMessages = [], recentGreetings = [],
  turnId = createGuestTurnId(), retryOfAttempt, authority, isCurrent } = {}) =>
  guestRequest("/api/chat/guest/greeting", { kind, recentMessages, recentGreetings, turnId, retryOfAttempt }, authority, isCurrent);

const searchMessages = (query) =>
  request({
    url: `/api/chat/search?q=${encodeURIComponent(query)}`
  });

module.exports = {
  listSessions,
  createSession,
  listMessages,
  sendMessage,
  sendGuestMessage,
  getGuestGreeting,
  searchMessages
};
