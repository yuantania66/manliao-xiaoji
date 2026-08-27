const { request } = require("../utils/request");

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

const sendMessage = (sessionId, content) =>
  request({
    url: `/api/chat/sessions/${sessionId}/messages`,
    method: "POST",
    data: { content }
  });

const sendGuestMessage = ({ content, turnId, recentMessages }) =>
  request({
    url: "/api/chat/guest",
    method: "POST",
    auth: false,
    data: { content, turnId, recentMessages }
  });

const getGuestGreeting = ({ kind = "initial", recentMessages = [], recentGreetings = [] } = {}) =>
  request({
    url: "/api/chat/guest/greeting",
    method: "POST",
    auth: false,
    data: { kind, recentMessages, recentGreetings }
  });

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
