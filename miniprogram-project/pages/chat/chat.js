const { readChatMessages, writeChatMessages, nowIso, dateKey } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode, captureAuthAuthority, isCurrentAuthAuthority } = require("../../utils/auth");
const { captureGuestAuthority, isCurrentGuestAuthority, createGuestTurnId } = require("../../utils/guest-session");
const {
  listSessions,
  createSession,
  listMessages,
  sendMessage: postMessage,
  sendGuestMessage: postGuestMessage,
  getGuestGreeting
} = require("../../api/chat");

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

const createClientTurnId = () =>
  `mini-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const safeReplyFailureText = (data) => {
  const message = data && data.systemStatus && data.systemStatus.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "这次回复没能生成，请稍后再试。";
};

const staleChatAuthority = () => new Error("聊天身份或会话已变化");

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
    replyStatusText: "",
    isGreetingLoading: false,
    targetSessionId: "",
    targetMessageId: "",
    targetDate: "",
    searchQuery: ""
  },

  typingTimers: [],
  bottomSafe: 23,
  guestGreetingPending: false,
  guestGreetingRequestId: 0,
  guestPageEpoch: 0,
  authPageEpoch: 0,
  authSessionEpoch: 0,
  authSessionIdentity: null,
  authSessionTarget: "",
  sessionBootstrapPromise: null,
  sessionBootstrapAuthority: null,

  onLoad(options = {}) {
    this.setData({
      targetSessionId: options.sessionId || "",
      targetMessageId: options.messageId || "",
      targetDate: options.date || "",
      searchQuery: options.query ? safeDecode(options.query) : ""
    });
  },

  onShow() {
    this.authPageEpoch += 1;
    this.sessionBootstrapPromise = null;
    this.sessionBootstrapAuthority = null;
    this.guestPageEpoch += 1;
    this.guestGreetingRequestId += 1;
    this.guestGreetingPending = false;
    this.clearAssistantTypingTimers();
    this.setData({ isSending: false, isTyping: false });
    this.updateSafeLayout();
    this.loadMessages();
  },

  onUnload() {
    this.authPageEpoch += 1;
    this.sessionBootstrapPromise = null;
    this.sessionBootstrapAuthority = null;
    this.guestPageEpoch += 1;
    this.clearAssistantTypingTimers();
    this.guestGreetingRequestId += 1;
    this.guestGreetingPending = false;
  },

  captureGuestPageAuthority() {
    return { pageEpoch: this.guestPageEpoch, session: captureGuestAuthority() };
  },

  isCurrentGuestPageAuthority(authority) {
    return authority.pageEpoch === this.guestPageEpoch && getDataMode() === "guest" &&
      isCurrentGuestAuthority(authority.session);
  },

  captureViewGuard() {
    if (getDataMode() === "authenticated") {
      const authority = this.captureAuthenticatedPageAuthority();
      return () => this.isCurrentAuthenticatedPageAuthority(authority);
    }
    const authority = this.captureGuestPageAuthority();
    return getDataMode() === "guest" ? () => this.isCurrentGuestPageAuthority(authority) : () => true;
  },

  captureAuthenticatedPageAuthority() {
    const identity = captureAuthAuthority();
    if (!identity) return null;
    if (this.authSessionIdentity && !isCurrentAuthAuthority(this.authSessionIdentity)) {
      this.authSessionEpoch += 1;
      this.sessionBootstrapPromise = null;
      this.sessionBootstrapAuthority = null;
      this.setData({ sessionId: "", targetSessionId: "" });
    }
    this.authSessionIdentity = identity;
    return { identity, pageEpoch: this.authPageEpoch, sessionEpoch: this.authSessionEpoch, sessionId: this.data.sessionId };
  },

  isCurrentAuthenticatedPageAuthority(authority, sessionId = authority && authority.sessionId) {
    return Boolean(authority && authority.pageEpoch === this.authPageEpoch &&
      authority.sessionEpoch === this.authSessionEpoch && isCurrentAuthAuthority(authority.identity) &&
      sessionId === this.data.sessionId);
  },

  bindAuthenticatedSession(authority, session) {
    if (!session || !session.id || (!this.isCurrentAuthenticatedPageAuthority(authority) &&
      !this.isCurrentAuthenticatedPageAuthority(authority, session.id))) throw staleChatAuthority();
    // Concurrent consumers of the same bootstrap adopt its result in one authority round.
    authority.sessionId = session.id;
    if (this.data.sessionId !== session.id) this.setData({ sessionId: session.id });
    return session;
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.bottomSafe = layout.bottomSafe;
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

  ensureAuthenticatedSession(authority = this.captureAuthenticatedPageAuthority()) {
    if (!this.isCurrentAuthenticatedPageAuthority(authority)) return Promise.reject(staleChatAuthority());
    if (this.data.sessionId) return Promise.resolve({ id: this.data.sessionId });
    if (this.sessionBootstrapPromise && !this.isCurrentAuthenticatedPageAuthority(this.sessionBootstrapAuthority)) {
      this.sessionBootstrapPromise = null;
      this.sessionBootstrapAuthority = null;
    }
    if (!this.sessionBootstrapPromise) {
      const flight = listSessions()
        .then((data) => {
          if (!this.isCurrentAuthenticatedPageAuthority(authority)) throw staleChatAuthority();
          return (data.items || [])[0] || createSession();
        })
        .then((session) => this.bindAuthenticatedSession(authority, session))
        .finally(() => {
          if (this.sessionBootstrapPromise === flight) {
            this.sessionBootstrapPromise = null;
            this.sessionBootstrapAuthority = null;
          }
        });
      this.sessionBootstrapAuthority = authority;
      this.sessionBootstrapPromise = flight;
    }
    return this.sessionBootstrapPromise.then((session) => this.bindAuthenticatedSession(authority, session));
  },

  onKeyboardHeightChange(event) {
    const isCurrent = this.captureViewGuard();
    const height = Math.max(0, Number(event.detail && event.detail.height) || 0);
    const inputBottom = height > 0 ? height + 8 : this.bottomSafe;
    this.setData({
      inputBottom,
      messagesBottom: inputBottom + 66
    }, () => {
      if (isCurrent()) this.scrollTo("chat-bottom");
    });
  },

  loadMessages() {
    const dataMode = getDataMode();
    let authority = dataMode === "authenticated" ? this.captureAuthenticatedPageAuthority() : null;
    if (authority && this.authSessionTarget !== this.data.targetSessionId) {
      this.authSessionTarget = this.data.targetSessionId;
      this.authSessionEpoch += 1;
      this.sessionBootstrapPromise = null;
      this.sessionBootstrapAuthority = null;
      this.setData({ sessionId: "" });
      authority = this.captureAuthenticatedPageAuthority();
    }
    const isCurrent = () => this.isCurrentAuthenticatedPageAuthority(authority);
    this.setData({
      dataMode,
      statusText: "",
      replyStatusText: "",
      messages: [],
      isEmpty: true,
      isGreetingLoading: dataMode === "authenticated",
      scrollTarget: "",
      scrollTop: 0
    });

    if (dataMode === "authenticated") {
      const loadSession = this.data.targetSessionId
        ? Promise.resolve({ id: this.data.targetSessionId })
        : this.ensureAuthenticatedSession(authority);

      loadSession
        .then((session) => {
          this.bindAuthenticatedSession(authority, session);
          return listMessages(session.id);
        })
        .then((data) => {
          if (!data || !isCurrent()) return;
          const messages = sortByTime(
            (data.items || []).map((item) =>
              withTimeLabel({
                id: item.id,
                role: item.role === "assistant"
                  ? "assistant"
                  : item.role === "system"
                    ? "system"
                    : "user",
                text: item.content,
                createdAt: item.createdAt
              })
            )
          );
          const scrollTarget = this.getInitialScrollTarget(messages);
          this.setData({
            messages: this.prepareMessagesForView(messages),
            isEmpty: messages.length === 0,
            isGreetingLoading: false,
            scrollTarget: ""
          }, () => {
            if (isCurrent()) this.scrollToInitialTarget(scrollTarget);
          });
        })
        .catch(() => {
          if (!isCurrent()) return;
          this.setData({
            messages: [],
            isEmpty: true,
            isGreetingLoading: false,
            replyStatusText: "聊天暂时无法加载，请稍后重试。"
          });
          wx.showToast({ title: "聊天暂时无法加载，请稍后重试。", icon: "none" });
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
      isGreetingLoading: false,
      sessionId: "",
      statusText: "请先登录，或在首页选择游客模式。"
    });
  },

  loadLocalMessages() {
    const isCurrent = this.captureViewGuard();
    const messages = sortByTime(readChatMessages().map(withTimeLabel));
    const scrollTarget = this.getInitialScrollTarget(messages);
    this.setData({
      messages: this.prepareMessagesForView(messages),
      isEmpty: messages.length === 0,
      isGreetingLoading: messages.length === 0,
      scrollTarget: "",
      statusText: "游客模式，本地聊天不会同步。"
    }, () => {
      if (isCurrent()) this.scrollToInitialTarget(scrollTarget);
    });
    if (messages.length === 0) this.loadInitialGuestGreeting();
  },

  loadInitialGuestGreeting() {
    if (this.guestGreetingPending || readChatMessages().length > 0) return;
    const authority = this.captureGuestPageAuthority();
    const isCurrent = () => this.isCurrentGuestPageAuthority(authority);
    const requestId = this.guestGreetingRequestId + 1;
    this.guestGreetingRequestId = requestId;
    this.guestGreetingPending = true;
    getGuestGreeting({
      kind: "initial",
      recentMessages: [],
      recentGreetings: [],
      authority: authority.session,
      isCurrent
    })
      .then((data) => {
        if (
          requestId !== this.guestGreetingRequestId ||
          !isCurrent() ||
          readChatMessages().length > 0
        ) return;
        const assistant = data && data.assistantMessage;
        if (!assistant || !assistant.id || !assistant.content) {
          throw new Error("开场问候暂时没有生成");
        }
        const greeting = {
          id: assistant.id,
          role: "assistant",
          text: assistant.content,
          createdAt: assistant.createdAt || nowIso(),
          promptVersion: assistant.promptVersion || null,
          interactionMoveEnvelope: assistant.interactionMoveEnvelope || null
        };
        writeChatMessages([greeting]);
        this.setData({
          messages: this.prepareMessagesForView([withTimeLabel(greeting)]),
          isEmpty: false,
          isGreetingLoading: false,
          statusText: "游客模式，本地聊天不会同步。",
          scrollTarget: ""
        }, () => { if (isCurrent()) this.scrollToInitialTarget("chat-bottom"); });
      })
      .catch(() => {
        if (requestId !== this.guestGreetingRequestId || !isCurrent()) return;
        this.setData({
          isGreetingLoading: false,
          replyStatusText: "欢迎语暂时没能生成，你可以直接发消息。"
        });
      })
      .finally(() => {
        if (requestId === this.guestGreetingRequestId && isCurrent()) {
          this.guestGreetingPending = false;
        }
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

  pushAssistantTypingFrame(message, text, done = false, isCurrent = () => true) {
    if (!isCurrent()) return;
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
      if (isCurrent()) this.scrollTo("chat-bottom");
    });
  },

  animateAssistantMessage(message, onComplete, isCurrent = this.captureViewGuard()) {
    if (!isCurrent()) return;
    this.clearAssistantTypingTimers();
    const chunks = splitTypingChunks(message.text);
    let text = "";

    if (!chunks.length) {
      this.pushAssistantTypingFrame(message, "", true, isCurrent);
      if (onComplete) onComplete();
      return;
    }

    chunks.forEach((chunk, index) => {
      const timer = setTimeout(() => {
        if (!isCurrent()) return;
        text += chunk;
        const done = index === chunks.length - 1;
        this.pushAssistantTypingFrame(message, text, done, isCurrent);
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
    if (!target || this.data.messages.length === 0) return;
    const isCurrent = this.captureViewGuard();
    if (target === "chat-bottom") {
      [80, 260, 650, 1100].forEach((delay, index) => {
        setTimeout(() => {
          if (!isCurrent()) return;
          this.setData({
            scrollTarget: "",
            scrollTop: 1000000 + index
          });
        }, delay);
      });
      return;
    }

    wx.nextTick(() => {
      if (!isCurrent()) return;
      setTimeout(() => {
        if (!isCurrent()) return;
        this.setData({
          scrollTop: 0,
          scrollTarget: target
        });
      }, 80);
      setTimeout(() => {
        if (!isCurrent()) return;
        this.setData({
          scrollTop: 0,
          scrollTarget: ""
        }, () => {
          if (isCurrent()) this.setData({ scrollTarget: target });
        });
      }, 260);
      setTimeout(() => {
        if (!isCurrent()) return;
        this.setData({
          scrollTop: 0,
          scrollTarget: ""
        }, () => {
          if (isCurrent()) this.setData({ scrollTarget: target });
        });
      }, 650);
    });
  },

  scrollTargetToPosition(target) {
    const isCurrent = this.captureViewGuard();
    wx.nextTick(() => {
      if (!isCurrent()) return;
      setTimeout(() => {
        if (!isCurrent()) return;
        this.setData({ scrollTarget: "", scrollTop: 0 });
      }, 80);

      [260, 560, 980].forEach((delay) => {
        setTimeout(() => {
          if (!isCurrent()) return;
          const query = wx.createSelectorQuery().in(this);
          query.select(".messages").boundingClientRect();
          query.select(".messages-content").boundingClientRect();
          query.select(`#${target}`).boundingClientRect();
          query.exec((rects) => {
            if (!isCurrent()) return;
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
    const isCurrent = this.captureViewGuard();
    this.setData({ inputFocus: false }, () => {
      setTimeout(() => {
        if (isCurrent()) this.setData({ inputFocus: true });
      }, 40);
    });
  },

  sendMessage(event = {}) {
    const text = (this.data.input || event.detail && event.detail.value || "").trim();
    if (!text || this.data.isSending) return;
    if (this.data.isGreetingLoading) {
      wx.showToast({ title: "聊天正在准备，请稍等一下", icon: "none" });
      return;
    }
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
    if (this.data.isSending || getDataMode() !== "authenticated") return;
    const authority = this.captureAuthenticatedPageAuthority();
    const isCurrent = () => this.isCurrentAuthenticatedPageAuthority(authority);
    if (!isCurrent()) return;
    const turnId = createClientTurnId();
    const optimisticId = `local-${turnId}`;
    const optimisticUserMessage = withTimeLabel({
      id: optimisticId,
      role: "user",
      text,
      createdAt: nowIso()
    });
    const ensureSession = this.ensureAuthenticatedSession(authority);

    this.setData({
      input: "",
      canSend: false,
      isSending: true,
      isTyping: true,
      replyStatusText: "",
      messages: this.prepareMessagesForView(this.data.messages.concat(optimisticUserMessage)),
      isEmpty: false,
      scrollTarget: ""
    }, () => { if (isCurrent()) this.scrollTo("chat-bottom"); });
    this.refocusInput();
    ensureSession
      .then((session) => {
        if (!isCurrent()) throw staleChatAuthority();
        return postMessage(session.id, text, turnId);
      })
      .then((data) => {
        if (!isCurrent()) return;
        if (!data || !data.userMessage) {
          throw new Error("invalid_chat_response");
        }
        const userMessage = withTimeLabel({
          id: data.userMessage.id,
          role: "user",
          text: data.userMessage.content,
          createdAt: data.userMessage.createdAt
        });
        const reconciled = this.data.messages.map((message) =>
          message.id === optimisticId ? userMessage : message
        );
        if (data.status === "failed") {
          const persistedStatus = data.systemMessage && data.systemMessage.id && data.systemMessage.content
            ? withTimeLabel({
                id: data.systemMessage.id,
                role: "system",
                text: data.systemMessage.content,
                createdAt: data.systemMessage.createdAt || nowIso()
              })
            : null;
          const durableMessages = persistedStatus
            ? reconciled.filter((message) => message.id !== persistedStatus.id).concat(persistedStatus)
            : reconciled;
          this.setData({
            messages: this.prepareMessagesForView(sortByTime(durableMessages)),
            isSending: false,
            isTyping: false,
            replyStatusText: persistedStatus ? "" : safeReplyFailureText(data),
            scrollTarget: ""
          }, () => { if (isCurrent()) this.scrollTo("chat-bottom"); });
          return;
        }
        if (data.status !== "committed" || !data.assistantMessage || !data.assistantMessage.id || !data.assistantMessage.content) {
          throw new Error("invalid_chat_response");
        }
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
        const nextMessages = reconciled.concat(assistantPlaceholder);
        this.setData({
          messages: this.prepareMessagesForView(nextMessages),
          isEmpty: false,
          replyStatusText: "",
          scrollTarget: ""
        }, () => {
          if (!isCurrent()) return;
          this.scrollTo("chat-bottom");
          this.animateAssistantMessage(assistantMessage, null, isCurrent);
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        const message = "发送状态暂时无法确认，请稍后重进页面查看。";
        this.setData({ isSending: false, isTyping: false, replyStatusText: message });
        this.refocusInput();
        wx.showToast({ title: message, icon: "none" });
      })
  },

  sendLocalMessage(text) {
    if (this.data.isSending || getDataMode() !== "guest") return;
    const authority = this.captureGuestPageAuthority();
    const isCurrent = () => this.isCurrentGuestPageAuthority(authority);
    const turnId = createGuestTurnId();
    const userMessage = {
      id: `u_${turnId}`,
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
      replyStatusText: "",
      messages: this.prepareMessagesForView(nextMessages.map(withTimeLabel)),
      isEmpty: false,
      scrollTarget: ""
    }, () => {
      if (!isCurrent()) return;
      this.scrollTo("chat-bottom");
      this.refocusInput();
    });

    postGuestMessage({
      content: text,
      turnId,
      authority: authority.session,
      isCurrent,
      recentMessages: nextMessages.slice(0, -1).slice(-24).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.text,
        createdAt: message.createdAt,
        promptVersion: message.promptVersion || null,
        interactionMoveEnvelope: message.interactionMoveEnvelope || null
      })).filter((message) => message.role !== "system")
    })
      .then((data) => {
        if (!isCurrent()) return;
        if (data.status === "failed") {
          const systemMessage = {
            id: `system-status:${userMessage.id}`,
            role: "system",
            text: safeReplyFailureText(data),
            createdAt: nowIso()
          };
          const failedMessages = sortByTime([
            ...readChatMessages().filter((message) => message.id !== systemMessage.id),
            systemMessage
          ]);
          writeChatMessages(failedMessages);
          this.setData({
            messages: this.prepareMessagesForView(failedMessages.map(withTimeLabel)),
            isEmpty: false,
            isSending: false,
            isTyping: false,
            replyStatusText: "",
            scrollTarget: ""
          }, () => { if (isCurrent()) this.scrollTo("chat-bottom"); });
          return;
        }
        if (!data.assistantMessage || !data.assistantMessage.content) {
          throw new Error("这次回复没能生成，请重试");
        }
        const reply = {
          id: data.assistantMessage.id,
          role: "assistant",
          text: data.assistantMessage.content,
          createdAt: data.assistantMessage.createdAt || nowIso(),
          promptVersion: data.assistantMessage.promptVersion || null,
          interactionMoveEnvelope: data.assistantMessage.interactionMoveEnvelope || null
        };
        const finalMessages = sortByTime([...readChatMessages(), reply]);
        writeChatMessages(finalMessages);
        const assistantPlaceholder = withTimeLabel({ ...reply, text: "" });
        const visibleMessages = sortByTime([
          ...finalMessages.filter((message) => message.id !== reply.id),
          assistantPlaceholder
        ]);
        this.setData({
          messages: this.prepareMessagesForView(visibleMessages.map(withTimeLabel)),
          isEmpty: false,
          statusText: "",
          replyStatusText: "",
          scrollTarget: ""
        }, () => {
          if (!isCurrent()) return;
          this.scrollTo("chat-bottom");
          this.animateAssistantMessage(reply, null, isCurrent);
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        const systemMessage = {
          id: `system-status:${userMessage.id}`,
          role: "system",
          text: "这次回复没能生成，请稍后再试。",
          createdAt: nowIso()
        };
        const failedMessages = sortByTime([
          ...readChatMessages().filter((message) => message.id !== systemMessage.id),
          systemMessage
        ]);
        writeChatMessages(failedMessages);
        this.setData({
          messages: this.prepareMessagesForView(failedMessages.map(withTimeLabel)),
          isEmpty: false,
          isSending: false,
          isTyping: false,
          replyStatusText: ""
        });
        wx.showToast({ title: "这次回复没能生成，请稍后再试。", icon: "none" });
      });
  }
});
