const { formatDateLabel, createNote: createLocalNote, readNoteDraft, writeNoteDraft, clearNoteDraft, persistNoteDraftImages, removePersistedNoteImage } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode, getDataOwner, captureAuthAuthority, isCurrentAuthAuthority, isCurrentAuthFailure } = require("../../utils/auth");
const { createNote: createRemoteNote } = require("../../api/notes");
const { uploadNoteImagesWithCleanup, cleanupOrQueueNoteUploads, retryPendingNoteUploadCleanup } = require("../../api/uploads");

const prompts = [
  { title: "今天想记下什么？", lead: "开心的、不开心的，或者只是一件小事，\n都可以放在这里。" },
  { title: "此刻有什么经过你？", lead: "不用写得完整。\n有一点点痕迹，也已经很好。" },
  { title: "给今天留一句话。", lead: "轻轻写下来就好。\n它不需要被解释得很清楚。" },
  { title: "今天的心放在哪里？", lead: "可以是一阵天气，也可以是一件小事。\n慢慢放进这里。" }
];

const moods = [
  { name: "晴朗", desc: "轻松", icon: "sunny" },
  { name: "晴转多云", desc: "有点累", icon: "partly-cloudy" },
  { name: "多云", desc: "平静", icon: "cloudy" },
  { name: "阴天", desc: "压抑", icon: "overcast" },
  { name: "小雨", desc: "委屈", icon: "rain" },
  { name: "暴雨", desc: "崩溃", icon: "storm" },
  { name: "雾", desc: "迷茫", icon: "fog" },
  { name: "彩虹", desc: "释然", icon: "rainbow" },
  { name: "月夜", desc: "孤独", icon: "moon" }
];

const { cardData, cardMethods } = require("../../utils/note-card-presenter");
const { attachWallpaper } = require("../../utils/wallpaper-client");
const createRequestId = () => `mini-note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const pick = (items) => items[Math.floor(Math.random() * items.length)];

Page(attachWallpaper({
  data: {
    pageTop: 92,
    backTop: 54,
    actionTop: 98,
    actionRight: 132,
    panelTop: 154,
    todayLabel: "",
    prompt: prompts[0],
    content: "",
    contentLength: 0,
    hasContent: false,
    mediaItems: [],
    hasMedia: false,
    mediaCount: 0,
    moods,
    selectedMood: null,
    isMenuOpen: false,
    isMoodPickerOpen: false,
    isSlipOpen: false,
    isSaving: false,
    isSavingImage: false,
    dataMode: "none",
    statusText: "",
    slip: { quote: "", caption: "", shortCaption: "" },
    slipStyle: "",
    slipFeedback: "",
    regenerateRemaining: 0,
    regenerateText: "",
    clientRequestId: "",
    ...cardData
  },

  onLoad() {
    this.updateSafeLayout();
    this.setData({
      todayLabel: formatDateLabel(),
      prompt: pick(prompts)
    });
    this.loadOwnerDraft(getDataOwner());
  },

  onShow() {
    const owner = getDataOwner();
    if (owner !== this.noteOwner) this.loadOwnerDraft(owner);
    const dataMode = getDataMode();
    if (dataMode === "authenticated") retryPendingNoteUploadCleanup().catch(() => undefined);
    this.setData({
      dataMode,
      statusText: dataMode === "guest"
        ? "游客模式，内容主要保存在本机。"
        : dataMode === "none" && this.data.hasContent
          ? "草稿已保存在本机，请重新登录后继续保存。"
          : ""
    });
  },

  loadOwnerDraft(owner) {
    const draft = readNoteDraft(owner);
    const mediaItems = draft ? draft.mediaItems.slice(0, 9) : [];
    const content = draft ? draft.content : "";
    this.noteOwner = owner;
    this.draftCommitted = false;
    this.setData({
      content,
      contentLength: Array.from(content.trim()).length,
      mediaItems,
      mediaCount: mediaItems.length,
      hasMedia: mediaItems.length > 0,
      hasContent: Boolean(content.trim() || mediaItems.length),
      selectedMood: draft ? draft.selectedMood || null : null,
      clientRequestId: draft ? draft.clientRequestId : createRequestId(),
      isSaving: false
    });
  },

  isOwnerActive(owner = this.noteOwner) {
    return !this.unloaded && Boolean(owner) && owner === this.noteOwner && owner === getDataOwner();
  },

  goBack() {
    this.persistDraft();
    const fallback = () => wx.redirectTo({ url: "/pages/note-history/note-history" });
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: fallback });
    else fallback();
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      backTop: layout.backTop,
      actionTop: layout.actionTop,
      actionRight: layout.actionRight,
      panelTop: layout.panelTop
    });
  },

  toggleMenu() {
    this.setData({ isMenuOpen: !this.data.isMenuOpen });
  },

  onInput(event) {
    this.draftCommitted = false;
    const content = event.detail.value;
    this.setData({
      content,
      contentLength: Array.from(content.trim()).length,
      hasContent: content.trim().length > 0 || this.data.mediaItems.length > 0
    });
    this.persistDraft();
  },

  persistDraft() {
    if (this.draftCommitted) return;
    const owner = this.noteOwner;
    if (!this.isOwnerActive(owner)) return;
    if (!this.data.hasContent) { clearNoteDraft(owner); return; }
    const stored = writeNoteDraft({ content: this.data.content, mediaItems: this.data.mediaItems, selectedMood: this.data.selectedMood, clientRequestId: this.data.clientRequestId, updatedAt: new Date().toISOString() }, owner);
    if (!stored) this.setData({ statusText: "草稿暂时无法保存在本机，请先复制重要内容。" });
  },

  onHide() { this.persistDraft(); },

  onUnload() { this.persistDraft(); this.unloaded = true; },

  chooseMedia() {
    const owner = this.noteOwner;
    if (!this.isOwnerActive(owner)) return;
    const remainingCount = 9 - this.data.mediaItems.length;
    if (remainingCount <= 0) {
      wx.showToast({ title: "图片最多 9 张", icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remainingCount,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        try {
          if (!this.isOwnerActive(owner)) throw new Error("身份已变化，请重新选择图片");
          const selected = (res.tempFiles || []).slice(0, remainingCount);
          const paths = await persistNoteDraftImages(selected.map((file) => file.tempFilePath), owner);
          if (!this.isOwnerActive(owner)) {
            paths.forEach(removePersistedNoteImage);
            return;
          }
          const mediaItems = [
          ...this.data.mediaItems,
          ...paths.map((filePath) => ({
            type: "image",
            url: filePath,
            thumbUrl: filePath,
            duration: 0
          }))
        ].slice(0, 9);
        this.setData({
          mediaItems,
          mediaCount: mediaItems.length,
          hasMedia: mediaItems.length > 0,
          hasContent: this.data.content.trim().length > 0 || mediaItems.length > 0
        });
          this.persistDraft();
        } catch (error) {
          wx.showToast({ title: error.message || "图片保存失败", icon: "none" });
        }
      },
      fail: (error) => {
        if (error && error.errMsg && error.errMsg.includes("cancel")) return;
        if (this.isOwnerActive(owner)) wx.showToast({ title: "图片选择失败", icon: "none" });
      }
    });
  },

  removeMedia(event) {
    if (!this.isOwnerActive()) return;
    this.draftCommitted = false;
    const index = event.currentTarget.dataset.index;
    removePersistedNoteImage(this.data.mediaItems[index] && this.data.mediaItems[index].url);
    const mediaItems = this.data.mediaItems.filter((_, itemIndex) => itemIndex !== index);
    this.setData({
      mediaItems,
      mediaCount: mediaItems.length,
      hasMedia: mediaItems.length > 0,
      hasContent: this.data.content.trim().length > 0 || mediaItems.length > 0
    });
    this.persistDraft();
  },

  openMoodPicker() {
    this.setData({ isMoodPickerOpen: true });
  },

  closeMoodPicker() {
    this.setData({ isMoodPickerOpen: false });
  },

  chooseMood(event) {
    this.draftCommitted = false;
    const selectedMood = moods[event.currentTarget.dataset.index];
    this.setData({ selectedMood, isMoodPickerOpen: false });
    this.persistDraft();
  },

  clearMood() {
    this.draftCommitted = false;
    this.setData({ selectedMood: null });
    this.persistDraft();
  },

  saveNote() {
    const content = this.data.content.trim();
    if ((!content && this.data.mediaItems.length === 0) || this.data.isSaving) return;

    if (content.length > 500) {
      wx.showToast({ title: "内容太长了", icon: "none" });
      return;
    }

    const owner = this.noteOwner;
    const dataMode = getDataMode();
    const authority = dataMode === "authenticated" ? captureAuthAuthority() : null;
    const isSaveCurrent = () => this.isOwnerActive(owner) &&
      (dataMode !== "authenticated" || isCurrentAuthAuthority(authority));
    const canFinishSave = (error) => isSaveCurrent() ||
      (this.noteOwner === owner && isCurrentAuthFailure(authority, error));
    if (!this.isOwnerActive(owner)) {
      this.setData({ statusText: "身份已变化，请重新进入本页。" });
      return;
    }
    if (dataMode === "none") {
      wx.showToast({ title: "请先登录或使用游客模式", icon: "none" });
      this.setData({ statusText: "请先登录，或在首页选择游客模式。" });
      return;
    }

    const images = this.data.mediaItems
      .filter((item) => item.type === "image")
      .map((item) => ({ url: item.url }));
    const payload = { content, mood: this.data.selectedMood, images, videos: [] };
    let uploadedUrls = [];
    let committed = false;
    let failure = null;
    const assertOwner = () => {
      if (!isSaveCurrent()) throw new Error("身份已变化，请重新进入本页");
    };
    const save = dataMode === "authenticated"
      ? Promise.resolve().then(assertOwner).then(() => uploadNoteImagesWithCleanup(images.map((item) => item.url), authority))
          .then((items) => {
            uploadedUrls = items.map((item) => item.url);
            assertOwner();
            return createRemoteNote({
              content,
              mood: this.data.selectedMood,
              mediaUrls: uploadedUrls,
              clientRequestId: this.data.clientRequestId
            });
          })
          .then((saved) => { committed = true; assertOwner(); return saved; })
      : Promise.resolve().then(() => {
          assertOwner();
          const saved = createLocalNote(payload, owner);
          if (!saved) throw new Error("小记无法保存在本机，请先复制重要内容");
          committed = true;
          assertOwner();
          return saved;
        });

    this.setData({
      isSaving: true,
      dataMode,
      statusText: dataMode === "authenticated" && images.length ? "正在上传图片..." : ""
    });
    save
      .then(() => {
        if (!isSaveCurrent()) return;
        if (dataMode === "authenticated") images.forEach((image) => removePersistedNoteImage(image.url));
        this.draftCommitted = true;
        clearNoteDraft(owner);
        this.setData({
          isSlipOpen: false,
          content: "",
          contentLength: 0,
          hasContent: false,
          mediaItems: [],
          mediaCount: 0,
          hasMedia: false,
          selectedMood: null,
          clientRequestId: createRequestId(),
          statusText: dataMode === "guest" ? "游客模式，内容主要保存在本机。" : ""
        });
        this.openSavedHistory();
      })
      .catch((error) => {
        failure = error;
        const cleanupUrls = committed ? [] : (uploadedUrls.length ? uploadedUrls : (error.uploadedUrls || []));
        if (cleanupUrls.length) cleanupOrQueueNoteUploads(cleanupUrls, authority).catch(() => undefined);
        if (!canFinishSave(error)) return;
        const message = error.message || "小记保存失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        if (canFinishSave(failure)) this.setData({ isSaving: false });
      });
  },

  openSavedHistory() {
    const pages = getCurrentPages();
    // A late save must not replace a page the user opened while it was pending.
    if (pages[pages.length - 1] !== this) return;
    // Reuse the full history when it is already in the stack. A date-filtered
    // history may not contain today's new note, so replace the composer instead.
    let historyIndex = -1;
    for (let index = pages.length - 2; index >= 0; index -= 1) {
      const page = pages[index];
      if (page.route === "pages/note-history/note-history" && !(page.data && page.data.date)) {
        historyIndex = index;
        break;
      }
    }
    const fail = () => this.setData({ statusText: "已保存小记，暂时无法打开我的小记，请稍后重试。" });
    if (historyIndex >= 0) {
      pages[historyIndex].setData({ query: "" });
      wx.navigateBack({ delta: pages.length - 1 - historyIndex, fail });
    } else {
      wx.redirectTo({ url: "/pages/note-history/note-history", fail });
    }
  },

  ...cardMethods,
  closeSlip() { this.invalidateSlipShare(); this.setData({ isSlipOpen: false }); }
}));
