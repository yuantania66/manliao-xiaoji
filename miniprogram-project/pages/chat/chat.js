const { createSession, listMessages, listSessions, sendMessage: postMessage } = require("../../api/chat");

Page({
  data: {
    input: "",
    messages: [],
    menuOpen: false,
    sessionId: "",
    loading: false,
    sending: false
  },

  onLoad() {
    this.prepareSession();
  },

  onShow() {
    if (!getApp().globalData.loggedIn) {
      this.clearChatState();
      wx.showToast({ title: "请先登录后再聊天", icon: "none" });
      return;
    }
    if (!this.data.sessionId && !this.data.loading) {
      this.prepareSession();
    }
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

  prepareSession() {
    if (!getApp().globalData.loggedIn) return;
    if (this.data.loading) return;
    this.setData({ loading: true });
    listSessions()
      .then((data) => {
        const first = (data.items || [])[0];
        if (first) return first;
        return createSession();
      })
      .then((session) => {
        this.setData({ sessionId: session.id });
        return listMessages(session.id);
      })
      .then((data) => {
        this.setData({
          messages: (data.items || []).map((item) => ({
            id: item.id,
            role: item.role === "assistant" ? "ai" : item.role,
            text: item.content
          }))
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  clearChatState() {
    this.setData({
      input: "",
      messages: [],
      sessionId: "",
      loading: false,
      sending: false
    });
  },

  sendMessage() {
    const text = this.data.input.trim();
    if (!text) {
      wx.showToast({ title: "先说一点内容吧", icon: "none" });
      return;
    }
    if (text.length > 2000) {
      wx.showToast({ title: "单条消息不能超过 2000 字", icon: "none" });
      return;
    }
    if (this.data.sending) return;
    if (!getApp().globalData.loggedIn) {
      wx.showToast({ title: "请先登录后再聊天", icon: "none" });
      return;
    }

    const sendWithSession = (sessionId) => {
      this.setData({ sending: true, input: "" });
      return postMessage(sessionId, text)
        .then((data) => {
          const nextMessages = this.data.messages.concat([
            {
              id: data.userMessage.id,
              role: "user",
              text: data.userMessage.content
            },
            {
              id: data.assistantMessage.id,
              role: "ai",
              text: data.assistantMessage.content
            }
          ]);
          this.setData({ messages: nextMessages });
        })
        .finally(() => {
          this.setData({ sending: false });
        });
    };

    if (this.data.sessionId) {
      sendWithSession(this.data.sessionId);
      return;
    }

    createSession()
      .then((session) => {
        this.setData({ sessionId: session.id });
        return sendWithSession(session.id);
      });
  }
});
