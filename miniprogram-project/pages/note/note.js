const { formatDateLabel, createNote: createLocalNote, readNoteDraft, writeNoteDraft, clearNoteDraft, persistNoteDraftImages, removePersistedNoteImage } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode, getDataOwner } = require("../../utils/auth");
const { createNote: createRemoteNote } = require("../../api/notes");
const { uploadNoteImagesWithCleanup, cleanupOrQueueNoteUploads, retryPendingNoteUploadCleanup } = require("../../api/uploads");
const { createNoteSlip } = require("../../utils/note-slip");

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

const slipStyles = [
  "slip-style-poster",
  "slip-style-letter",
  "slip-style-note",
  "slip-style-strip",
  "slip-style-mint",
  "slip-style-ticket"
];

const qrDots = [
  [0, 0], [0, 1], [0, 2], [1, 0], [2, 0], [2, 1], [2, 2],
  [5, 0], [6, 0], [6, 1], [5, 2], [6, 2], [3, 1],
  [0, 5], [0, 6], [1, 6], [2, 5], [2, 6], [4, 4], [5, 5],
  [1, 4], [6, 4], [4, 6], [3, 6]
];

const DAILY_REGENERATE_LIMIT = 3;
const SLIP_IMAGE_NAMESPACE = "MLXJ";
const createRequestId = () => `mini-note-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const pick = (items) => items[Math.floor(Math.random() * items.length)];

const pickSlipStyle = (currentStyle = "") => {
  const options = slipStyles.filter((style) => style !== currentStyle);
  return pick(options.length ? options : slipStyles);
};

const getRegenerateText = (remaining) => {
  return `换个版式 · 剩余 ${remaining} 次`;
};

const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 652;

const padTime = (value) => String(value).padStart(2, "0");

const getSlipImageFileName = () => {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    padTime(now.getMonth() + 1),
    padTime(now.getDate())
  ].join("");
  const timePart = [
    padTime(now.getHours()),
    padTime(now.getMinutes()),
    padTime(now.getSeconds())
  ].join("");
  return `${SLIP_IMAGE_NAMESPACE}_${datePart}${timePart}.png`;
};

const copyToNamespacedSlipImage = (tempFilePath) => {
  if (!wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) {
    return Promise.resolve(tempFilePath);
  }

  const fileSystem = wx.getFileSystemManager();
  if (!fileSystem.copyFile) {
    return Promise.resolve(tempFilePath);
  }

  const filePath = `${wx.env.USER_DATA_PATH}/${getSlipImageFileName()}`;
  return new Promise((resolve) => {
    fileSystem.copyFile({
      srcPath: tempFilePath,
      destPath: filePath,
      success: () => resolve(filePath),
      fail: () => resolve(tempFilePath)
    });
  });
};

const setFont = (ctx, size, color, weight = "normal") => {
  if (ctx.setFontSize) ctx.setFontSize(size);
  ctx.font = `${weight} ${size}px sans-serif`;
  ctx.setFillStyle(color);
  if (ctx.setTextBaseline) ctx.setTextBaseline("top");
};

const getTextWidth = (ctx, text, size) => {
  if (ctx.measureText) return ctx.measureText(text).width;
  return Array.from(text).length * size;
};

const drawRoundRect = (ctx, x, y, width, height, radius, color) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.setFillStyle(color);
  ctx.fill();
};

const drawTextBlock = (ctx, text, x, y, maxWidth, lineHeight, maxLines, size, color, weight = "normal") => {
  const chars = Array.from(String(text || ""));
  const lines = [];
  let line = "";
  setFont(ctx, size, color, weight);
  chars.forEach((char) => {
    const next = `${line}${char}`;
    if (line && getTextWidth(ctx, next, size) > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((item, index) => {
    const value = index === maxLines - 1 && lines.length > maxLines ? `${item.slice(0, Math.max(1, item.length - 1))}…` : item;
    ctx.fillText(value, x, y + index * lineHeight);
  });
};

const drawDashes = (ctx, x, y, width, color) => {
  ctx.setFillStyle(color);
  for (let offset = 0; offset < width; offset += 38) {
    drawRoundRect(ctx, x + offset, y, 16, 4, 2, color);
  }
};

const drawQr = (ctx, x, y, size, color) => {
  drawRoundRect(ctx, x, y, size, size, size * 0.2, "rgba(255,253,249,0.62)");
  const unit = size / 9;
  ctx.setFillStyle(color);
  qrDots.forEach(([dotX, dotY]) => {
    drawRoundRect(ctx, x + unit + dotX * unit, y + unit + dotY * unit, unit * 0.72, unit * 0.72, unit * 0.18, color);
  });
};

const drawLeaf = (ctx, x, y, scale = 1) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.arc(88, 82, 52, 0, Math.PI * 2);
  ctx.setFillStyle("#f2dfc4");
  ctx.fill();
  ctx.save();
  ctx.translate(58, 60);
  ctx.rotate(0.42);
  drawRoundRect(ctx, -4, -48, 8, 108, 4, "#71877b");
  ctx.restore();
  ctx.save();
  ctx.translate(38, 42);
  ctx.rotate(-0.5);
  drawRoundRect(ctx, -24, -46, 52, 92, 28, "#d8e8df");
  ctx.restore();
  ctx.save();
  ctx.translate(96, 40);
  ctx.rotate(0.5);
  drawRoundRect(ctx, -24, -46, 52, 92, 28, "#d8e8df");
  ctx.restore();
  ctx.restore();
};

const drawTapes = (ctx, x, y) => {
  const tapes = [
    { color: "#ebe3d7", rotate: -0.1 },
    { color: "#efd9d1", rotate: 0.06 },
    { color: "#e8eadf", rotate: -0.05 }
  ];
  tapes.forEach((tape, index) => {
    ctx.save();
    ctx.translate(x + index * 72, y);
    ctx.rotate(tape.rotate);
    drawRoundRect(ctx, 0, 0, 48, 72, 8, tape.color);
    ctx.restore();
  });
};

const drawSlipCanvas = (ctx, data) => {
  const style = data.slipStyle;
  const slip = data.slip || {};
  const date = data.todayLabel || formatDateLabel();
  const quote = slip.quote || "这一刻已经被收下。";
  const caption = slip.caption || "不用写得很完整，能留下来就很好。";

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawRoundRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 36, "#fffdf9");

  if (style === "slip-style-poster") {
    drawTapes(ctx, 90, 34);
    drawRoundRect(ctx, 72, 48, 396, 292, 18, "#e7f0f2");
    drawTextBlock(ctx, quote, 72, 388, 390, 42, 2, 30, "#2d2926", "700");
    drawTextBlock(ctx, caption, 72, 474, 360, 30, 2, 20, "#6d665f");
    drawQr(ctx, 404, 532, 66, "#71877b");
    drawTextBlock(ctx, "慢聊小记", 72, 584, 220, 26, 1, 18, "#71877b", "700");
    return;
  }

  if (style === "slip-style-letter") {
    drawTextBlock(ctx, quote, 70, 84, 340, 54, 3, 38, "#2d2926", "700");
    drawTextBlock(ctx, caption, 70, 278, 350, 34, 3, 22, "#6d665f");
    drawLeaf(ctx, 338, 408, 1);
    drawQr(ctx, 68, 540, 64, "#71877b");
    drawTextBlock(ctx, "慢聊小记", 150, 554, 230, 26, 1, 18, "#71877b", "700");
    return;
  }

  if (style === "slip-style-note") {
    drawRoundRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 26, "#fff8ee");
    drawTextBlock(ctx, quote, 116, 132, 280, 42, 2, 30, "#2d2926", "700");
    drawRoundRect(ctx, 84, 214, 362, 156, 22, "#f2dccb");
    drawTextBlock(ctx, caption, 120, 248, 290, 34, 2, 22, "#6d665f");
    drawRoundRect(ctx, 132, 338, 266, 78, 16, "#fffdf9");
    drawTextBlock(ctx, quote, 156, 360, 210, 28, 1, 18, "#6d665f");
    drawQr(ctx, 78, 528, 60, "#71877b");
    drawTextBlock(ctx, "慢聊小记", 158, 542, 220, 26, 1, 18, "#71877b", "700");
    return;
  }

  if (style === "slip-style-strip") {
    drawRoundRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 24, "#f2eee7");
    drawTextBlock(ctx, quote, 92, 78, 350, 46, 3, 32, "#2d2926", "700");
    drawRoundRect(ctx, 92, 250, 350, 124, 20, "#fffdf9");
    drawTextBlock(ctx, caption, 122, 278, 290, 34, 2, 22, "#6d665f");
    drawRoundRect(ctx, 112, 404, 306, 88, 18, "#e7f0ea");
    drawTextBlock(ctx, quote, 140, 428, 240, 28, 1, 20, "#6d665f", "700");
    drawLeaf(ctx, 350, 500, 0.82);
    drawQr(ctx, 70, 540, 64, "#71877b");
    drawTextBlock(ctx, "慢聊小记", 150, 554, 220, 26, 1, 18, "#71877b", "700");
    return;
  }

  if (style === "slip-style-mint") {
    drawRoundRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 44, "#e8f0ea");
    drawRoundRect(ctx, -24, 304, 48, 48, 24, "#fbf7f0");
    drawRoundRect(ctx, CANVAS_WIDTH - 24, 304, 48, 48, 24, "#fbf7f0");
    drawTextBlock(ctx, date, 62, 58, 420, 44, 1, 30, "#71877b", "700");
    drawTextBlock(ctx, quote, 62, 188, 410, 60, 2, 42, "#2d2926", "700");
    drawDashes(ctx, 62, 326, 416, "#c8cec5");
    drawTextBlock(ctx, caption, 62, 430, 390, 40, 2, 26, "#6d665f");
    drawQr(ctx, 62, 530, 80, "#71877b");
    drawTextBlock(ctx, "慢聊小记", 166, 546, 240, 36, 1, 24, "#71877b", "700");
    return;
  }

  drawTextBlock(ctx, date, 62, 56, 420, 44, 1, 30, "#71877b", "700");
  drawTextBlock(ctx, quote, 62, 190, 432, 60, 2, 42, "#2d2926", "700");
  drawDashes(ctx, 62, 326, 416, "#d7cfc8");
  drawTextBlock(ctx, caption, 62, 440, 432, 40, 2, 26, "#6d665f");
  drawQr(ctx, 62, 530, 80, "#71877b");
  drawTextBlock(ctx, "慢聊小记", 166, 546, 240, 36, 1, 24, "#71877b", "700");
};

Page({
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
    slipStyle: slipStyles[0],
    slipFeedback: "",
    regenerateRemaining: DAILY_REGENERATE_LIMIT,
    regenerateText: getRegenerateText(DAILY_REGENERATE_LIMIT),
    clientRequestId: "",
    qrDots
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
    return Boolean(owner) && owner === this.noteOwner && owner === getDataOwner();
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
    const assertOwner = () => {
      if (!this.isOwnerActive(owner)) throw new Error("身份已变化，请重新进入本页");
    };
    const save = dataMode === "authenticated"
      ? Promise.resolve().then(assertOwner).then(() => uploadNoteImagesWithCleanup(images.map((item) => item.url)))
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
        if (!this.isOwnerActive(owner)) return;
        if (dataMode === "authenticated") images.forEach((image) => removePersistedNoteImage(image.url));
        this.draftCommitted = true;
        clearNoteDraft(owner);
        const slip = createNoteSlip(content, images.length);
        this.setData({
          isSlipOpen: true,
          slip: {
            ...slip,
            shortCaption: slip.caption.length > 18 ? `${slip.caption.slice(0, 17)}...` : slip.caption
          },
          slipStyle: pickSlipStyle(this.data.slipStyle),
          slipFeedback: "",
          regenerateRemaining: DAILY_REGENERATE_LIMIT,
          regenerateText: getRegenerateText(DAILY_REGENERATE_LIMIT),
          clientRequestId: createRequestId(),
          statusText: dataMode === "guest" ? "游客模式，内容主要保存在本机。" : ""
        });
      })
      .catch((error) => {
        const cleanupUrls = committed ? [] : (uploadedUrls.length ? uploadedUrls : (error.uploadedUrls || []));
        if (cleanupUrls.length) cleanupOrQueueNoteUploads(cleanupUrls).catch(() => undefined);
        if (!this.isOwnerActive(owner)) return;
        const message = error.message || "小记保存失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ isSaving: false });
      });
  },

  closeSlip() {
    this.draftCommitted = false;
    this.setData({
      isSlipOpen: false,
      content: "",
      contentLength: 0,
      hasContent: false,
      mediaItems: [],
      mediaCount: 0,
      hasMedia: false,
      clientRequestId: createRequestId()
    });
  },

  regenerateSlip() {
    if (this.data.regenerateRemaining <= 0) {
      wx.showToast({ title: "今天的重新生成机会用完了", icon: "none" });
      return;
    }

    const regenerateRemaining = Math.max(0, this.data.regenerateRemaining - 1);
    this.setData({
      slipStyle: pickSlipStyle(this.data.slipStyle),
      regenerateRemaining,
      regenerateText: getRegenerateText(regenerateRemaining),
      slipFeedback: regenerateRemaining > 0 ? "" : "今天的重新生成机会用完了"
    });
  },

  createSlipImage() {
    return new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext("slipCanvas", this);
      drawSlipCanvas(ctx, this.data);
      ctx.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: "slipCanvas",
          x: 0,
          y: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          destWidth: CANVAS_WIDTH * 2,
          destHeight: CANVAS_HEIGHT * 2,
          fileType: "png",
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        }, this);
      });
    });
  },

  saveImage() {
    if (this.data.isSavingImage) return;
    this.setData({ isSavingImage: true, slipFeedback: "正在生成图片..." });
    this.createSlipImage()
      .then((filePath) => {
        if (!filePath) {
          throw new Error("图片生成失败");
        }
        return copyToNamespacedSlipImage(filePath);
      })
      .then((filePath) => {
        return new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath,
            success: resolve,
            fail: reject
          });
        });
      })
      .then(() => {
        this.setData({ slipFeedback: "已保存到相册" });
        wx.showToast({ title: "已保存到相册", icon: "success" });
      })
      .catch((error) => {
        const errMsg = (error && error.errMsg) || "";
        const isAuthError = errMsg.includes("auth") || errMsg.includes("authorize") || errMsg.includes("permission");
        this.setData({ slipFeedback: isAuthError ? "需要相册权限后才能保存" : "保存失败，请再试一次" });
        if (isAuthError) {
          wx.showModal({
            title: "需要相册权限",
            content: "请允许慢聊小记保存图片到相册。",
            confirmText: "去设置",
            success: (res) => {
              if (res.confirm && wx.openSetting) wx.openSetting();
            }
          });
          return;
        }
        wx.showToast({ title: "保存失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ isSavingImage: false });
      });
  }
});
