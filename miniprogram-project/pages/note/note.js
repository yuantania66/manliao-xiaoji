const { createNote } = require("../../api/notes");

Page({
  data: {
    dateLabel: "",
    prompt: {
      title: "今天想记下什么？",
      lead: "开心的、不开心的，或者只是一件小事，\n都可以放在这里。"
    },
    note: "",
    count: 0,
    mood: "选择心情",
    slipOpen: false,
    shareQuote: "先放在这里。",
    shareNote: "从小记里，收下一句话。",
    shareClass: "share-ticket",
    saving: false
  },

  onLoad() {
    const prompts = [
      {
        title: "今天想记下什么？",
        lead: "开心的、不开心的，或者只是一件小事，\n都可以放在这里。"
      },
      {
        title: "给今天留一句话。",
        lead: "轻轻写下来就好。\n它不需要被解释得很清楚。"
      }
    ];
    this.setData({
      dateLabel: this.formatDate(new Date()),
      prompt: prompts[Math.floor(Math.random() * prompts.length)]
    });
  },

  onShow() {
    if (!getApp().globalData.loggedIn) {
      wx.showToast({ title: "请先登录后再写小记", icon: "none" });
    }
  },

  formatDate(date) {
    const week = ["日", "一", "二", "三", "四", "五", "六"];
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${week[date.getDay()]}`;
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goHistory() {
    wx.navigateTo({ url: "/pages/note-history/note-history" });
  },

  updateNote(event) {
    const note = event.detail.value;
    this.setData({ note, count: note.length });
  },

  withMoodCaption(caption, mood) {
    if (!mood || mood === "选择心情") return caption;
    return `${caption} 你选的“${mood}”，也一起被收好了。`;
  },

  getShareQuote(note, mood) {
    const rules = [
      { keys: ["累", "困", "撑", "疲", "忙", "烦", "倦"], quote: "你不必一直撑着。", caption: "今天已经够努力了，先把自己放回柔软处。" },
      { keys: ["难过", "哭", "委屈", "崩溃", "伤心", "不开心", "低落"], quote: "难过不是退步。", caption: "它只是提醒你，有些地方需要被轻轻照顾。" },
      { keys: ["急", "慌", "焦虑", "害怕", "担心", "紧张", "怕"], quote: "先慢下来，再往前。", caption: "不急着解决全部，先让呼吸回到身体里。" },
      { keys: ["孤独", "一个人", "没人", "夜", "睡不着", "想家"], quote: "一个人也有回声。", caption: "此刻被写下，就不算完全独自经过。" },
      { keys: ["开心", "快乐", "高兴", "顺利", "喜欢", "好"], quote: "把这点亮光留住。", caption: "好的时刻也值得被认真收藏。" },
      { keys: ["想你", "想念", "朋友", "爱", "见面", "远方"], quote: "想念也有重量。", caption: "它说明有些关系，正在心里好好地存在着。" },
      { keys: ["饿", "饭", "吃", "喝", "冷", "热"], quote: "先照顾好身体。", caption: "心事很多时，也别忘了给自己一点热气。" },
      { keys: ["工作", "学习", "考试", "上班", "努力", "坚持"], quote: "你已经在路上了。", caption: "做得慢一点，也仍然算数。" }
    ];
    const moodQuotes = {
      "晴朗": { quote: "这份轻松，值得被记住。", caption: "晴朗的一刻，也可以成为以后回看的光。" },
      "小雨 · 委屈": { quote: "委屈可以先被接住。", caption: "小雨一样的心情，不需要马上放晴。" },
      "多云": { quote: "不确定，也可以安放。", caption: "多云的时候，给自己留一点慢慢看清的时间。" },
      "雾": { quote: "看不清时，先停一停。", caption: "雾里不用急着选方向，站稳也是一种前进。" }
    };
    const matched = rules.find((rule) => rule.keys.some((key) => note.includes(key)));
    if (matched) {
      return {
        quote: matched.quote,
        caption: this.withMoodCaption(matched.caption, mood)
      };
    }
    if (moodQuotes[mood]) return moodQuotes[mood];
    return {
      quote: "这一刻已经被收下。",
      caption: "不用写得很完整，能留下来就很好。"
    };
  },

  pickShareClass(quote) {
    const classes = [
      { name: "share-ticket", max: 30 },
      { name: "share-polaroid", max: 10 },
      { name: "share-postcard", max: 22 },
      { name: "share-envelope", max: 18 },
      { name: "share-film", max: 6 },
      { name: "share-receipt", max: 18 }
    ];
    const length = Array.from(quote.trim()).length;
    const suitable = classes.filter((item) => length <= item.max);
    const pool = suitable.length > 0 ? suitable : classes.filter((item) => item.name === "share-ticket");
    return pool[Math.floor(Math.random() * pool.length)].name;
  },

  chooseMedia() {
    wx.chooseMedia({
      count: 9,
      mediaType: ["image", "video"],
      sourceType: ["album"],
      success: () => {}
    });
  },

  chooseMood() {
    const moods = ["晴朗", "小雨 · 委屈", "多云", "雾"];
    wx.showActionSheet({
      itemList: moods,
      success: (res) => {
        this.setData({ mood: moods[res.tapIndex] });
      }
    });
  },

  openSlip() {
    const content = this.data.note.trim();
    if (!content) {
      wx.showToast({ title: "先写一点内容吧", icon: "none" });
      return;
    }
    if (content.length > 500) {
      wx.showToast({ title: "小记不能超过 500 字", icon: "none" });
      return;
    }
    if (this.data.saving) return;
    if (!getApp().globalData.loggedIn) {
      wx.showToast({ title: "请先登录后再保存", icon: "none" });
      return;
    }
    const next = this.getShareQuote(this.data.note, this.data.mood);
    this.setData({ saving: true });
    createNote({
      content,
      moodName: this.data.mood === "选择心情" ? undefined : this.data.mood,
      recordDate: this.toDateOnly(new Date()),
      mediaUrls: []
    })
      .then(() => {
        this.setData({
          slipOpen: true,
          shareQuote: next.quote,
          shareNote: next.caption,
          shareClass: this.pickShareClass(next.quote)
        });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  toDateOnly(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  closeSlip() {
    this.setData({ slipOpen: false });
  },

  saveSlip() {
    wx.showToast({ title: "图片已生成", icon: "success" });
  },

  shareSlip() {
    wx.showToast({ title: "可转发给朋友", icon: "none" });
  }
});
