const { request } = require("../utils/request");

const listSessions = () =>
  request({
    url: "/api/chat/sessions?pageSize=20",
    method: "GET"
  });

const createSession = () =>
  request({
    url: "/api/chat/sessions",
    method: "POST",
    data: { title: "慢慢说" }
  });

const listMessages = (sessionId) =>
  request({
    url: `/api/chat/sessions/${sessionId}/messages?pageSize=50`,
    method: "GET"
  });

const sendMessage = (sessionId, content) =>
  request({
    url: `/api/chat/sessions/${sessionId}/messages`,
    method: "POST",
    data: { content }
  });

module.exports = {
  createSession,
  listMessages,
  listSessions,
  sendMessage
};
