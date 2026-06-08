Page({
  data: {
    dateLabel: "",
    prompt: {
      title: "今天过得怎么样？",
      lead: "不用急着说清楚。\n先选一个此刻更需要的方式。",
      chat: "开心也好，难过也好，都可以说说。",
      note: "留下一点今天的痕迹。"
    }
  },

  onLoad() {
    const prompts = [
      {
        title: "今天过得怎么样？",
        lead: "不用急着说清楚。\n先选一个此刻更需要的方式。",
        chat: "开心也好，难过也好，都可以说说。",
        note: "留下一点今天的痕迹。"
      },
      {
        title: "此刻的心在哪里？",
        lead: "不用立刻回答。\n先靠近自己一点点。",
        chat: "想到哪儿，都可以慢慢说。",
        note: "把今天轻轻放下来。"
      }
    ];
    this.setData({
      dateLabel: this.formatDate(new Date()),
      prompt: prompts[Math.floor(Math.random() * prompts.length)]
    });
  },

  formatDate(date) {
    const week = ["日", "一", "二", "三", "四", "五", "六"];
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${week[date.getDay()]}`;
  },

  goChat() {
    wx.navigateTo({ url: "/pages/chat/chat" });
  },

  goNote() {
    wx.navigateTo({ url: "/pages/note/note" });
  },

  goMe() {
    wx.navigateTo({ url: "/pages/me/me" });
  }
});
