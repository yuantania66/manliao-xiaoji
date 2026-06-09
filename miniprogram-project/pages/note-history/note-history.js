const { listNotes } = require("../../api/notes");
const { getCalendar } = require("../../api/calendar");

Page({
  data: {
    searchQuery: "",
    loading: false,
    notes: [],
    filteredNotes: [],
    calendarDays: [],
    calendarSummary: "本月还没有记录"
  },

  onShow() {
    this.loadNotes();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goNote() {
    wx.navigateTo({ url: "/pages/note/note" });
  },

  updateSearch(event) {
    const searchQuery = event.detail.value;
    const keyword = searchQuery.trim();
    const filteredNotes = this.data.notes.filter((note) => {
      const text = `${note.dateLabel} ${note.content} ${note.moodName || ""}`;
      return !keyword || text.includes(keyword);
    });
    this.setData({
      searchQuery,
      filteredNotes
    });
  },

  loadNotes() {
    if (!getApp().globalData.loggedIn) {
      this.setData({
        notes: [],
        filteredNotes: [],
        calendarDays: [],
        calendarSummary: "本月还没有记录",
        loading: false
      });
      wx.showToast({ title: "请先登录后查看小记", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    Promise.all([
      listNotes({ pageSize: 50 }),
      getCalendar({ month: this.getCurrentMonth(), type: "all" })
    ])
      .then(([notesData, calendarData]) => {
        const notes = (notesData.items || []).map((note, index) => ({
          ...note,
          dateLabel: this.formatDate(note.recordDate),
          preview: note.content.length > 42 ? `${note.content.slice(0, 42)}...` : note.content,
          top: 402 + index * 154
        }));
        const calendarDays = (calendarData.days || []).map((day) => ({
          ...day,
          label: day.date.slice(5).replace("-", "/")
        }));
        this.setData({
          notes,
          filteredNotes: notes,
          calendarDays,
          calendarSummary: calendarDays.length
            ? `有记录：${calendarDays.slice(0, 3).map((day) => day.label).join("、")}`
            : "本月还没有记录"
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  formatDate(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    const week = ["日", "一", "二", "三", "四", "五", "六"];
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${week[date.getDay()]}`;
  },

  getCurrentMonth() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  },

  openNote(event) {
    wx.navigateTo({ url: `/pages/note-detail/note-detail?id=${event.currentTarget.dataset.id}` });
  }
});
