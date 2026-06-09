const { deleteNote, getNote, updateNote } = require("../../api/notes");

Page({
  data: {
    id: "",
    note: {
      recordDate: "",
      moodName: ""
    },
    content: "",
    count: 0,
    loading: false,
    saving: false
  },

  onLoad(options) {
    this.setData({ id: options.id || "" });
    this.loadNote();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  loadNote() {
    if (!this.data.id) return;
    if (!getApp().globalData.loggedIn) {
      this.clearNoteState();
      wx.showToast({ title: "请先登录后查看小记", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    getNote(this.data.id)
      .then((note) => {
        this.setData({
          note,
          content: note.content,
          count: note.content.length
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  clearNoteState() {
    this.setData({
      note: {
        recordDate: "",
        moodName: ""
      },
      content: "",
      count: 0,
      loading: false,
      saving: false
    });
  },

  updateContent(event) {
    const content = event.detail.value;
    this.setData({ content, count: content.length });
  },

  save() {
    const content = this.data.content.trim();
    if (!content) {
      wx.showToast({ title: "小记内容不能为空", icon: "none" });
      return;
    }
    if (content.length > 500) {
      wx.showToast({ title: "小记不能超过 500 字", icon: "none" });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });
    updateNote(this.data.id, { content })
      .then((note) => {
        this.setData({ note, content: note.content, count: note.content.length });
        wx.showToast({ title: "已保存", icon: "success" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  remove() {
    if (this.data.saving) return;
    wx.showModal({
      title: "删除小记",
      content: "删除后不可恢复，确认删除吗？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        deleteNote(this.data.id)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            wx.navigateBack({ delta: 1 });
          })
          .finally(() => {
            this.setData({ saving: false });
          });
      }
    });
  }
});
