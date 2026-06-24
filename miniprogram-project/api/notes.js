const { request } = require("../utils/request");

const listNotes = (params = "") =>
  request({
    url: `/api/notes${params}`
  });

const createNote = ({ content, mood, mediaUrls = [] }) =>
  request({
    url: "/api/notes",
    method: "POST",
    data: {
      content,
      moodName: mood ? mood.name : undefined,
      moodIcon: mood ? mood.icon : undefined,
      mediaUrls
    }
  });

const getNote = (noteId) =>
  request({
    url: `/api/notes/${noteId}`
  });

const updateNote = (noteId, content) =>
  request({
    url: `/api/notes/${noteId}`,
    method: "PATCH",
    data: { content }
  });

const deleteNote = (noteId) =>
  request({
    url: `/api/notes/${noteId}`,
    method: "DELETE"
  });

module.exports = {
  listNotes,
  createNote,
  getNote,
  updateNote,
  deleteNote
};
