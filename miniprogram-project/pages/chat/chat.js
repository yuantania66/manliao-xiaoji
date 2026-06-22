const { readChatMessages, writeChatMessages, createReply, nowIso, dateKey } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { listSessions, createSession, listMessages, sendMessage: postMessage } = require("../../api/chat");

const TIME_DIVIDER_GAP = 3 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const padTime = (value) => String(value).padStart(2, "0");

const formatClock = (date) => `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

const formatTimeDivider = (value) => {
  const date = new Date(value);
  if (!isValidDate(date)) return "";

  const now = new Date();
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  const clock = formatClock(date);

  if (dayDiff === 0) return clock;
  if (dayDiff === 1) return `昨天 ${clock}`;
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAYS[date.getDay()]} ${clock}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
};

const withTimeLabel = (message) => ({
  ...message,
  timeLabel: ""
});

const shouldShowTimeDivider = (message, previousMessage) => {
  const current = new Date(message.createdAt);
  if (!isValidDate(current)) return false;
  if (!previousMessage) return true;

  const previous = new Date(previousMessage.createdAt);
  if (!isValidDate(previous)) return true;
  if (!isSameDay(current, previous)) return true;
  return current.getTime() - previous.getTime() >= TIME_DIVIDER_GAP;
};

const applyTimeDividers = (messages) =>
  messages.map((message, index) => ({
    ...message,
    timeLabel: shouldShowTimeDivider(message, messages[index - 1])
      ? formatTimeDivider(message.createdAt)
      : ""
  }));

const splitTextByQuery = (text, query) => {
  if (!query) return [{ text, highlight: false }];

  const parts = [];
  let start = 0;
  let index = text.indexOf(query, start);
  while (index >= 0) {
    if (index > start) {
      parts.push({ text: text.slice(start, index), highlight: false });
    }
    parts.push({ text: text.slice(index, index + query.length), highlight: true });
    start = index + query.length;
    index = text.indexOf(query, start);
  }
  if (start < text.length) {
    parts.push({ text: text.slice(start), highlight: false });
  }
  return parts.length ? parts : [{ text, highlight: false }];
};

const sortByTime = (messages) =>
  messages.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

const safeDecode = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

const splitTypingChunks = (text = "") => {
  const chunks = [];
  let index = 0;
  const sizes = [3, 2, 4, 3];

  while (index < text.length) {
    let size = sizes[chunks.length % sizes.length];
    let next = Math.min(text.length, index + size);
    while (next < text.length && "，。！？、；：,.!?;:".includes(text[next])) {
      next += 1;
    }
    chunks.push(text.slice(index, next));
    index = next;
  }

  return chunks;
};

Page({
  data: {
    pageTop: 92,
    backTop: 54,
    titleOffset: 36,
    actionTop: 98,
    actionRight: 132,
    panelTop: 154,
    messagesTop: 180,
    messagesBottom: 138,
    inputBottom: 46,
    input: "",
    inputFocus: false,
    messages: [],
    isEmpty: true,
    canSend: false,
    isSending: false,
    isTyping: false,
    scrollTarget: "chat-bottom",
    scrollTop: 0,
    currentScrollTop: 0,
    isMenuOpen: false,
    sessionId: "",
    dataMode: "none",
    statusText: "",
    targetSessionId: "",
    targetMessageId: "",
    targetDate: "",
    searchQuery: ""
  },

  typingTimers: [],

  onLoad(options = {}) {
    this.setData({
      targetSessionId: options.sessionId || "",
      targetMessageId: options.messageId || "",
      targetDate: options.date || "",
      searchQuery: options.query ? safeDecode(options.query) : ""
    });
  },

  onShow() {
    this.updateSafeLayout();
    this.loadMessages();
  },

  onUnload() {
    this.clearAssistantTypingTimers();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      backTop: layout.backTop,
      titleOffset: Math.max(28, layout.titleTop - layout.pageTop),
      actionTop: layout.actionTop,
      actionRight: layout.actionRight,
      panelTop: layout.panelTop,
      messagesTop: layout.titleTop + 68,
      messagesBottom: layout.bottomSafe + 66,
      inputBottom: layout.bottomSafe
    });
  },

  loadMessages() {
    const dataMode = getDataMode();
    this.setData({ dataMode, statusText: "", messages: [], isEmpty: true, scrollTarget: "", scrollTop: 0 });

    if (dataMode === "authenticated") {
      const loadSession = this.data.targetSessionId
        ? Promise.resolve({ id: this.data.targetSessionId })
        : listSessions().then((data) => {
          const first = (data.items || [])[0];
          if (!first) {
            this.setData({ messages: [], isEmpty: true, sessionId: "" });
            return null;
          }
          return first;
        });

      loadSession
        .then((session) => {
          if (!session) return null;
          this.setData({ sessionId: session.id });
          return listMessages(session.id);
        })
        .then((data) => {
          if (!data) return;
          const messages = sortByTime(
            (data.items || []).map((item) =>
              withTimeLabel({
                id: item.id,
                role: item.role === "assistant" ? "assistant" : "user",
                text: item.content,
                createdAt: item.createdAt
              })
            )
          );
          const scrollTarget = this.getInitialScrollTarget(messages);
          this.setData({
            messages: this.prepareMessagesForView(messages),
            isEmpty: messages.length === 0,
            scrollTarget: ""
          }, () => {
            this.scrollToInitialTarget(scrollTarget);
          });
        })
        .catch((error) => {
          const message = error.message || "聊天加载失败，请稍后再试";
          this.setData({ messages: [], isEmpty: true, statusText: message });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") {
      this.loadLocalMessages();
      return;
    }

    this.setData({
      messages: [],
      isEmpty: true,
      sessionId: "",
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  loadLocalMessages() {
    const messages = sortByTime(readChatMessages().map(withTimeLabel));
    const scrollTarget = this.getInitialScrollTarget(messages);
    this.setData({
      messages: this.prepareMessagesForView(messages),
      isEmpty: messages.length === 0,
      scrollTarget: "",
      statusText: "游客模式，本地聊天不会同步。"
    }, () => {
      this.scrollToInitialTarget(scrollTarget);
    });
  },

  scrollToInitialTarget(target) {
    if ((this.data.targetDate || this.data.targetMessageId) && target !== "chat-bottom") {
      this.scrollTargetToPosition(target);
      return;
    }
    this.scrollTo(target);
  },

  prepareMessagesForView(messages) {
    const targetMessageId = this.data.targetMessageId;
    const query = this.data.searchQuery;
    return applyTimeDividers(messages).map((message) => ({
      ...message,
      isSelectedTarget: Boolean(targetMessageId) && message.id === targetMessageId,
      parts: targetMessageId && message.id === targetMessageId
        ? splitTextByQuery(message.text, query)
        : [{ text: message.text, highlight: false }]
    }));
  },

  clearAssistantTypingTimers() {
    (this.typingTimers || []).forEach((timer) => clearTimeout(timer));
    this.typingTimers = [];
  },

  pushAssistantTypingFrame(message, text, done = false) {
    const nextMessages = this.data.messages.map((item) => {
      if (item.id !== message.id) return item;
      return withTimeLabel({
        ...message,
        text
      });
    });

    this.setData({
      messages: this.prepareMessagesForView(nextMessages),
      isTyping: !done && !text,
      isSending: !done,
      scrollTarget: ""
    }, () => {
      this.scrollTo("chat-bottom");
    });
  },

  animateAssistantMessage(message, onComplete) {
    this.clearAssistantTypingTimers();
    const chunks = splitTypingChunks(message.text);
    let text = "";

    if (!chunks.length) {
      this.pushAssistantTypingFrame(message, "", true);
      if (onComplete) onComplete();
      return;
    }

    chunks.forEach((chunk, index) => {
      const timer = setTimeout(() => {
        text += chunk;
        const done = index === chunks.length - 1;
        this.pushAssistantTypingFrame(message, text, done);
        if (done && onComplete) onComplete();
      }, 360 + index * 115);
      this.typingTimers.push(timer);
    });
  },

  getInitialScrollTarget(messages) {
    const targetMessageId = this.data.targetMessageId;
    if (targetMessageId && messages.some((message) => message.id === targetMessageId)) {
      return `msg-${targetMessageId}`;
    }

    const targetDate = this.data.targetDate;
    if (targetDate) {
      const firstMessageOfDay = messages.find((message) => dateKey(new Date(message.createdAt)) === targetDate);
      if (firstMessageOfDay) return `msg-${firstMessageOfDay.id}`;
    }

    return "chat-bottom";
  },

  onMessagesScroll(event) {
    this.setData({ currentScrollTop: event.detail.scrollTop || 0 });
  },

  scrollTo(target) {
    if (target === "chat-bottom") {
      [80, 260, 650, 1100].forEach((delay, index) => {
        setTimeout(() => {
          this.setData({
            scrollTarget: "",
            scrollTop: 1000000 + index
          });
        }, delay);
      });
      return;
    }

    wx.nextTick(() => {
      setTimeout(() => {
        this.setData({
          scrollTop: 0,
          scrollTarget: target
        });
      }, 80);
      setTimeout(() => {
        this.setData({
          scrollTop: 0,
          scrollTarget: ""
        }, () => {
          this.setData({ scrollTarget: target });
        });
      }, 260);
      setTimeout(() => {
        this.setData({
          scrollTop: 0,
          scrollTarget: ""
        }, () => {
          this.setData({ scrollTarget: target });
        });
      }, 650);
    });
  },

  scrollTargetToPosition(target) {
    wx.nextTick(() => {
      setTimeout(() => {
        this.setData({ scrollTarget: "", scrollTop: 0 });
      }, 80);

      [260, 560, 980].forEach((delay) => {
        setTimeout(() => {
          const query = wx.createSelectorQuery().in(this);
          query.select(".messages").boundingClientRect();
          query.select(".messages-content").boundingClientRect();
          query.select(`#${target}`).boundingClientRect();
          query.exec((rects) => {
            const containerRect = rects && rects[0];
            const contentRect = rects && rects[1];
            const messageRect = rects && rects[2];
            if (!containerRect || !contentRect || !messageRect) {
              return;
            }

            const targetTop = Math.max(
              0,
              this.data.currentScrollTop + messageRect.top - containerRect.top
            );
            const maxTop = Math.max(0, contentRect.height - containerRect.height);
            const nextTop = Math.min(targetTop, maxTop);
            this.setData({
              scrollTarget: "",
              scrollTop: nextTop
            });
          });
        }, delay);
      });
    });
  },

  toggleMenu() {
    this.setData({ isMenuOpen: !this.data.isMenuOpen });
  },

  goCalendar() {
    this.setData({ isMenuOpen: false });
    this.openMenuPage("/pages/chat-calendar/chat-calendar");
  },

  goSearch() {
    this.setData({ isMenuOpen: false });
    this.openMenuPage("/pages/chat-search/chat-search");
  },

  openMenuPage(url) {
    wx.navigateTo({
      url,
      fail: () => {
        wx.redirectTo({ url });
      }
    });
  },

  onInput(event) {
    const input = event.detail.value;
    this.setData({ input, canSend: input.trim().length > 0 });
  },

  refocusInput() {
    this.setData({ inputFocus: false }, () => {
      setTimeout(() => {
        this.setData({ inputFocus: true });
      }, 40);
    });
  },

  sendMessage(event = {}) {
    const text = (this.data.input || event.detail && event.detail.value || "").trim();
    if (!text || this.data.isSending) return;
    if (text.length > 500) {
      wx.showToast({ title: "内容太长了", icon: "none" });
      return;
    }

    if (this.data.dataMode === "authenticated") {
      this.sendRemoteMessage(text);
      return;
    }

    if (this.data.dataMode === "guest") {
      this.sendLocalMessage(text);
      return;
    }

    wx.showToast({ title: "请先登录或使用游客模式", icon: "none" });
  },

  sendRemoteMessage(text) {
    if (this.data.isSending) return;
    const ensureSession = this.data.sessionId
      ? Promise.resolve({ id: this.data.sessionId })
      : createSession().then((session) => {
          this.setData({ sessionId: session.id });
          return session;
        });

    this.setData({ input: "", canSend: false, isSending: true, isTyping: true });
    this.refocusInput();
    ensureSession
      .then((session) => postMessage(session.id, text))
      .then((data) => {
        const current = this.data.messages;
        const userMessage = withTimeLabel({
          id: data.userMessage.id,
          role: "user",
          text: data.userMessage.content,
          createdAt: data.userMessage.createdAt
        });
        const assistantMessage = {
          id: data.assistantMessage.id,
          role: "assistant",
          text: data.assistantMessage.content,
          createdAt: data.assistantMessage.createdAt || nowIso()
        };
        const assistantPlaceholder = withTimeLabel({
          ...assistantMessage,
          text: ""
        });
        const nextMessages = current.concat([userMessage, assistantPlaceholder]);
        this.setData({
          messages: this.prepareMessagesForView(nextMessages),
          isEmpty: false,
          scrollTarget: ""
        }, () => {
          this.scrollTo("chat-bottom");
          this.animateAssistantMessage(assistantMessage);
        });
      })
      .catch((error) => {
        const message = error.message || "发送失败，请稍后再试";
        this.setData({ input: text, canSend: true, isSending: false, isTyping: false, statusText: message });
        this.refocusInput();
        wx.showToast({ title: message, icon: "none" });
      })
  },

  sendLocalMessage(text) {
    const userMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      text,
      createdAt: nowIso()
    };
    const nextMessages = sortByTime([...readChatMessages(), userMessage]);
    writeChatMessages(nextMessages);
    this.setData({
      input: "",
      canSend: false,
      isSending: true,
      isTyping: true,
      messages: this.prepareMessagesForView(nextMessages.map(withTimeLabel)),
      isEmpty: false,
      scrollTarget: ""
    }, () => {
      this.scrollTo("chat-bottom");
      this.refocusInput();
    });

    setTimeout(() => {
      const reply = {
        id: `a_${Date.now()}`,
        role: "assistant",
        text: createReply(text),
        createdAt: nowIso()
      };
      const finalMessages = sortByTime([...readChatMessages(), reply]);
      writeChatMessages(finalMessages);
      const assistantPlaceholder = withTimeLabel({
        ...reply,
        text: ""
      });
      const visibleMessages = sortByTime([...readChatMessages().filter((message) => message.id !== reply.id), assistantPlaceholder]);
      this.setData({
        messages: this.prepareMessagesForView(visibleMessages.map(withTimeLabel)),
        isEmpty: false,
        scrollTarget: ""
      }, () => {
        this.scrollTo("chat-bottom");
        this.animateAssistantMessage(reply);
      });
    }, 900);
  }
});
