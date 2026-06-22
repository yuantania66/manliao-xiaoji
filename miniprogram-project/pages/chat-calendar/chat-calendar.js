const { readChatMessages, dateKey } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { getCalendar } = require("../../api/calendar");

const weeks = ["一", "二", "三", "四", "五", "六", "日"];

const pad = (value) => String(value).padStart(2, "0");

Page({
  data: {
    pageTop: 92,
    closeTop: 98,
    closeRight: 132,
    weeks,
    year: 0,
    month: 0,
    monthTitle: "",
    cells: [],
    statusText: ""
  },

  onShow() {
    this.updateSafeLayout();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    this.setData({ year, month });
    this.loadCalendar(year, month);
  },

  loadCalendar(year, month) {
    const monthValue = `${year}-${pad(month + 1)}`;
    const dataMode = getDataMode();
    this.setData({ statusText: "" });

    if (dataMode === "authenticated") {
      getCalendar(monthValue)
        .then((data) => {
          const activeDates = new Map(
            (data.days || [])
              .filter((day) => day.chatMessageCount > 0)
              .map((day) => [day.date, (day.chatSessionIds || [])[0] || ""])
          );
          this.buildCalendar(year, month, activeDates);
        })
        .catch((error) => {
          const message = error.message || "聊天日历加载失败，请稍后再试";
          this.buildCalendar(year, month, new Map());
          this.setData({ statusText: message });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") {
      this.buildLocalCalendar(year, month);
      this.setData({ statusText: "游客模式，本地聊天日历不会同步。" });
      return;
    }

    this.buildCalendar(year, month, new Map());
    this.setData({ statusText: "请先登录，或在首页选择游客模式。" });
  },

  prevMonth() {
    const current = new Date(this.data.year, this.data.month - 1, 1);
    const year = current.getFullYear();
    const month = current.getMonth();
    this.setData({ year, month });
    this.loadCalendar(year, month);
  },

  nextMonth() {
    const current = new Date(this.data.year, this.data.month + 1, 1);
    const year = current.getFullYear();
    const month = current.getMonth();
    this.setData({ year, month });
    this.loadCalendar(year, month);
  },

  buildLocalCalendar(year, month) {
    const activeDates = new Map(readChatMessages().map((message) => [dateKey(new Date(message.createdAt)), ""]));
    this.buildCalendar(year, month, activeDates);
  },

  buildCalendar(year, month, activeDates) {
    const days = new Date(year, month + 1, 0).getDate();
    const first = new Date(year, month, 1).getDay();
    const blanks = first === 0 ? 6 : first - 1;
    const cells = [];
    for (let index = 0; index < blanks; index += 1) {
      cells.push({ key: `blank-${index}` });
    }
    for (let day = 1; day <= days; day += 1) {
      const date = `${year}-${pad(month + 1)}-${pad(day)}`;
      cells.push({
        key: date,
        day,
        date,
        sessionId: activeDates.get(date) || "",
        active: activeDates.has(date)
      });
    }
    this.setData({
      monthTitle: `${year} 年 ${month + 1} 月`,
      cells
    });
  },

  updateSafeLayout() {
    const layout = getSafeLayout();
    this.setData({
      pageTop: layout.pageTop,
      closeTop: layout.closeTop,
      closeRight: layout.closeRight
    });
  }
});
