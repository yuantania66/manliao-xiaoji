const { formatDateLabel, createNote: createLocalNote } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { createNote: createRemoteNote } = require("../../api/notes");

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
const TEST_IMAGE_URL = "/assets/test-note-photo.svg";

const pick = (items) => items[Math.floor(Math.random() * items.length)];

const pickSlipStyle = (currentStyle = "") => {
  const options = slipStyles.filter((style) => style !== currentStyle);
  return pick(options.length ? options : slipStyles);
};

const getRegenerateText = (remaining) => {
  return `换一张小笺 · 剩余 ${remaining} 次`;
};

const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 652;

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
    drawTextBlock(ctx, "新晴 · 慢慢回看", 72, 584, 220, 26, 1, 18, "#71877b", "700");
    return;
  }

  if (style === "slip-style-letter") {
    drawTextBlock(ctx, quote, 70, 84, 340, 54, 3, 38, "#2d2926", "700");
    drawTextBlock(ctx, caption, 70, 278, 350, 34, 3, 22, "#6d665f");
    drawLeaf(ctx, 338, 408, 1);
    drawQr(ctx, 68, 540, 64, "#71877b");
    drawTextBlock(ctx, "新晴 · 慢慢回看", 150, 554, 230, 26, 1, 18, "#71877b", "700");
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
    drawTextBlock(ctx, "新晴 · 慢慢回看", 158, 542, 220, 26, 1, 18, "#71877b", "700");
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
    drawTextBlock(ctx, "新晴 · 慢慢回看", 150, 554, 220, 26, 1, 18, "#71877b", "700");
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
    drawTextBlock(ctx, "新晴 · 慢慢回看", 166, 546, 240, 36, 1, 24, "#71877b", "700");
    return;
  }

  drawTextBlock(ctx, date, 62, 56, 420, 44, 1, 30, "#71877b", "700");
  drawTextBlock(ctx, quote, 62, 190, 432, 60, 2, 42, "#2d2926", "700");
  drawDashes(ctx, 62, 326, 416, "#d7cfc8");
  drawTextBlock(ctx, caption, 62, 440, 432, 40, 2, 26, "#6d665f");
  drawQr(ctx, 62, 530, 80, "#71877b");
  drawTextBlock(ctx, "新晴 · 慢慢回看", 166, 546, 240, 36, 1, 24, "#71877b", "700");
};

const isDevelopRuntime = () => {
  try {
    const account = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return !account || !account.miniProgram || account.miniProgram.envVersion !== "release";
  } catch (error) {
    return true;
  }
};

const getSlip = (content, mood) => {
  const text = content.trim();
  if (text.includes("累") || text.includes("忙")) {
    return pick([
      { quote: "你不必一直撑着。", caption: "今天已经够努力了，先把自己放回柔软处。" },
      { quote: "慢一点也可以。", caption: "不是所有事情，都需要在今天被完成。" },
      { quote: "先把自己放回来。", caption: "忙乱里也可以留一小块地方给自己。" }
    ]);
  }
  if (text.includes("难过") || text.includes("委屈") || text.includes("崩溃")) {
    return pick([
      { quote: "难过不是退步。", caption: "它只是提醒你，有些地方需要被轻轻照顾。" },
      { quote: "这不是你的错。", caption: "有些感受出现时，只是想被好好看见。" },
      { quote: "先靠岸一会儿。", caption: "风大的时候，不必急着继续往前。" }
    ]);
  }
  if (text.includes("开心") || text.includes("顺利") || text.includes("喜欢")) {
    return pick([
      { quote: "把这点亮光留住。", caption: "好的时刻也值得被认真收藏。" },
      { quote: "今天有一束光。", caption: "它不需要很大，也足够被记下来。" },
      { quote: "这份喜欢很珍贵。", caption: "愿它在以后某天，也能轻轻照亮你。" }
    ]);
  }
  if (mood && mood.name === "暴雨") {
    return pick([
      { quote: "崩溃也不是失败。", caption: "雨很大的时候，先找一处能停靠的地方。" },
      { quote: "先躲一会儿雨。", caption: "等呼吸回来，再决定下一步也不迟。" },
      { quote: "你已经很用力了。", caption: "撑不住的时候，停下来也是一种保护。" }
    ]);
  }
  return pick([
    { quote: "这一刻已经被收下。", caption: "不用写得很完整，能留下来就很好。" },
    { quote: "有些话先放这里。", caption: "不急着整理，它已经被温柔地留下。" },
    { quote: "这也是今天的一部分。", caption: "轻轻记下，就已经很好了。" }
  ]);
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
    isDevRuntime: false,
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
    qrDots
  },

  onLoad() {
    this.updateSafeLayout();
    this.setData({
      todayLabel: formatDateLabel(),
      prompt: pick(prompts),
      dataMode: getDataMode(),
      isDevRuntime: isDevelopRuntime()
    });
  },

  onShow() {
    const dataMode = getDataMode();
    this.setData({
      dataMode,
      statusText: dataMode === "guest" ? "游客模式，小记只会保存在本机。" : ""
    });
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
    const content = event.detail.value;
    this.setData({
      content,
      contentLength: Array.from(content.trim()).length,
      hasContent: content.trim().length > 0 || this.data.mediaItems.length > 0
    });
  },

  chooseMedia() {
    const remainingCount = 9 - this.data.mediaItems.length;
    if (remainingCount <= 0) {
      wx.showToast({ title: "图片最多 9 张", icon: "none" });
      return;
    }

    wx.chooseMedia({
      count: remainingCount,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const mediaItems = [
          ...this.data.mediaItems,
          ...(res.tempFiles || []).map((file) => ({
            type: "image",
            url: file.tempFilePath,
            thumbUrl: file.tempFilePath,
            duration: 0
          }))
        ].slice(0, 9);
        this.setData({
          mediaItems,
          mediaCount: mediaItems.length,
          hasMedia: mediaItems.length > 0,
          hasContent: this.data.content.trim().length > 0 || mediaItems.length > 0
        });
      },
      fail: (error) => {
        if (error && error.errMsg && error.errMsg.includes("cancel")) return;
        wx.showToast({ title: "图片选择失败", icon: "none" });
      }
    });
  },

  removeMedia(event) {
    const index = event.currentTarget.dataset.index;
    const mediaItems = this.data.mediaItems.filter((_, itemIndex) => itemIndex !== index);
    this.setData({
      mediaItems,
      mediaCount: mediaItems.length,
      hasMedia: mediaItems.length > 0,
      hasContent: this.data.content.trim().length > 0 || mediaItems.length > 0
    });
  },

  fillMediaLimitTest() {
    const mediaItems = Array.from({ length: 9 }, () => ({
      type: "image",
      url: TEST_IMAGE_URL,
      thumbUrl: TEST_IMAGE_URL,
      duration: 0
    }));

    this.setData({
      mediaItems,
      mediaCount: mediaItems.length,
      hasMedia: true,
      hasContent: true
    });
    wx.showToast({ title: "已生成 9 张图片测试", icon: "none" });
  },

  openMoodPicker() {
    this.setData({ isMoodPickerOpen: true });
  },

  closeMoodPicker() {
    this.setData({ isMoodPickerOpen: false });
  },

  chooseMood(event) {
    const selectedMood = moods[event.currentTarget.dataset.index];
    this.setData({ selectedMood, isMoodPickerOpen: false });
  },

  clearMood() {
    this.setData({ selectedMood: null });
  },

  saveNote() {
    const content = this.data.content.trim();
    if ((!content && this.data.mediaItems.length === 0) || this.data.isSaving) return;

    if (content.length > 500) {
      wx.showToast({ title: "内容太长了", icon: "none" });
      return;
    }

    const dataMode = getDataMode();
    if (dataMode === "none") {
      wx.showToast({ title: "请先登录或使用游客模式", icon: "none" });
      this.setData({ statusText: "请先登录，或在首页选择游客模式。" });
      return;
    }

    const images = this.data.mediaItems
      .filter((item) => item.type === "image")
      .map((item) => ({ url: item.url }));
    const payload = { content, mood: this.data.selectedMood, images, videos: [] };
    const save = dataMode === "authenticated"
      ? createRemoteNote(payload)
      : Promise.resolve(createLocalNote(payload));

    this.setData({ isSaving: true, dataMode, statusText: "" });
    save
      .then(() => {
        const slip = getSlip(content, this.data.selectedMood);
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
          statusText: dataMode === "guest" ? "游客模式，小记只会保存在本机。" : ""
        });
      })
      .catch((error) => {
        const message = error.message || "小记保存失败，请稍后再试";
        this.setData({ statusText: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ isSaving: false });
      });
  },

  closeSlip() {
    this.setData({
      isSlipOpen: false,
      content: "",
      contentLength: 0,
      hasContent: false,
      mediaItems: [],
      mediaCount: 0,
      hasMedia: false
    });
  },

  regenerateSlip() {
    if (this.data.regenerateRemaining <= 0) {
      wx.showToast({ title: "今天的重新生成机会用完了", icon: "none" });
      return;
    }

    const content = this.data.content.trim() || this.data.slip.quote || "这一刻";

    const current = this.data.slip || {};
    let slip = getSlip(content, this.data.selectedMood);
    for (let index = 0; index < 4 && slip.quote === current.quote && slip.caption === current.caption; index += 1) {
      slip = getSlip(content, this.data.selectedMood);
    }

    const regenerateRemaining = Math.max(0, this.data.regenerateRemaining - 1);
    this.setData({
      slip: {
        ...slip,
        shortCaption: slip.caption.length > 18 ? `${slip.caption.slice(0, 17)}...` : slip.caption
      },
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
    let generatedFilePath = "";
    this.createSlipImage()
      .then((filePath) => {
        generatedFilePath = filePath;
        if (!filePath) {
          throw new Error("图片生成失败");
        }
        return new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath,
            success: resolve,
            fail: reject
          });
        });
      })
      .then(() => {
        this.setData({ slipFeedback: "已保存到相册，已打开预览确认" });
        wx.showToast({ title: "已保存到相册", icon: "success" });
        if (generatedFilePath && wx.previewImage) {
          wx.previewImage({
            current: generatedFilePath,
            urls: [generatedFilePath]
          });
        }
      })
      .catch((error) => {
        const errMsg = (error && error.errMsg) || "";
        const isAuthError = errMsg.includes("auth") || errMsg.includes("authorize") || errMsg.includes("permission");
        this.setData({ slipFeedback: isAuthError ? "需要相册权限后才能保存" : "保存失败，请再试一次" });
        if (isAuthError) {
          wx.showModal({
            title: "需要相册权限",
            content: "请允许新晴保存图片到相册。",
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
