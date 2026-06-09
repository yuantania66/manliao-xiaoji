const { request } = require("../utils/request");

const listNotes = (params = {}) => {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return request({
    url: `/api/notes${query ? `?${query}` : ""}`,
    method: "GET"
  });
};

const createNote = (data) =>
  request({
    url: "/api/notes",
    method: "POST",
    data
  });

const getNote = (noteId) =>
  request({
    url: `/api/notes/${noteId}`,
    method: "GET"
  });

const updateNote = (noteId, data) =>
  request({
    url: `/api/notes/${noteId}`,
    method: "PATCH",
    data
  });

const deleteNote = (noteId) =>
  request({
    url: `/api/notes/${noteId}`,
    method: "DELETE"
  });

module.exports = {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote
};
