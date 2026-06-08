Page({
  data: {
    input: "",
    messages: [],
    menuOpen: false
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  toggleMenu() {
    this.setData({ menuOpen: !this.data.menuOpen });
  },

  closeMenu() {
    this.setData({ menuOpen: false });
  },

  updateInput(event) {
    this.setData({ input: event.detail.value });
  },

  sendMessage() {
    const text = this.data.input.trim();
    if (!text) return;
    const messages = this.data.messages.concat({
      role: "user",
      text
    });
    this.setData({ messages, input: "" });
    setTimeout(() => {
      this.setData({
        messages: this.data.messages.concat({
          role: "ai",
          text: "嗯，我在。你可以继续慢慢说。"
        })
      });
    }, 450);
  }
});
