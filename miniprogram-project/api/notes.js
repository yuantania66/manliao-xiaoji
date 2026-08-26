const { request } = require("../utils/request");

const listNotes = (params = "") =>
  request({
    url: `/api/notes${params}`
  });

const listAllNotes = async (params = {}) => {
  const pageSize = 100;
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = Object.entries({ ...params, page, pageSize })
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    const result = await listNotes(`?${query}`);
    items.push(...(Array.isArray(result.items) ? result.items : []));
    if (items.length >= Number(result.total || 0) || (result.items || []).length < pageSize) return items;
  }
  throw new Error("小记数量过多，请稍后重试");
};

const createNote = ({ content, mood, mediaUrls = [], clientRequestId }) =>
  request({
    url: "/api/notes",
    method: "POST",
    data: {
      content,
      moodName: mood ? mood.name : undefined,
      moodIcon: mood ? mood.icon : undefined,
      mediaUrls,
      clientRequestId
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
  listAllNotes,
  createNote,
  getNote,
  updateNote,
  deleteNote
};
