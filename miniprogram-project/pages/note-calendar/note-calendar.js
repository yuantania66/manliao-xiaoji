const { readNotes } = require("../../utils/local-data");
const { getSafeLayout } = require("../../utils/layout");
const { getDataMode } = require("../../utils/auth");
const { getCalendar } = require("../../api/calendar");

const weeks = ["一", "二", "三", "四", "五", "六", "日"];
const pad = (value) => String(value).padStart(2, "0");

// Match the note picker, including legacy Web icon names.
const moodNames = ["晴朗", "晴转多云", "多云", "阴天", "小雨", "暴雨", "雾", "彩虹", "月夜"];
const moodIndexes = { sunny: 0, sun: 0, "partly-cloudy": 1, sunCloud: 1,
  cloudy: 2, partly: 2, overcast: 3, cloud: 3, rain: 4, storm: 5, fog: 6, rainbow: 7, moon: 8 };
const hasMood = (mood) => Boolean(mood && (mood.name || mood.icon));
const getMoodIndex = (mood) => {
  if (!hasMood(mood)) return -1;
  if (Object.prototype.hasOwnProperty.call(moodIndexes, mood.icon)) return moodIndexes[mood.icon];
  return moodNames.indexOf(mood.name);
};

Page({
  data: {
    pageTop: 92,
    closeTop: 98,
    closeRight: 132,
    weeks,
    monthTitle: "",
    cells: [],
    statusText: ""
  },

  onShow() {
    this.updateSafeLayout();
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthValue = `${year}-${pad(month + 1)}`;
    const dataMode = getDataMode();
    this.setData({ statusText: "" });

    if (dataMode === "authenticated") {
      getCalendar(monthValue)
        .then((data) => {
          const noteDays = new Map((data.days || []).filter((day) => day.noteCount > 0).map((day) => {
            // The server orders moods by createdAt ascending, as the Web calendar expects.
            const moods = (day.moods || []).filter(hasMood);
            return [day.date, moods[moods.length - 1] || null];
          }));
          this.buildCalendar(year, month, noteDays);
        })
        .catch((error) => {
          const message = error.message || "心情日历加载失败，请稍后再试";
          this.buildCalendar(year, month, new Map());
          this.setData({ statusText: message });
          wx.showToast({ title: message, icon: "none" });
        });
      return;
    }

    if (dataMode === "guest") {
      this.buildLocalCalendar(year, month);
      this.setData({ statusText: "游客模式，本地小记日历不会同步。" });
      return;
    }

    this.buildCalendar(year, month, new Map());
    this.setData({ statusText: "请先登录，或在首页选择游客模式。" });
  },

  buildLocalCalendar(year, month) {
    const noteDays = new Map();
    // Local storage is newest-first. Reverse a copy, then order by creation time.
    // A later note without a mood does not erase the latest recorded mood (Web behavior).
    const notes = readNotes().slice().reverse().sort((a, b) =>
      (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    notes.forEach((note) => {
      if (!noteDays.has(note.dateKey)) noteDays.set(note.dateKey, null);
      if (hasMood(note.mood)) noteDays.set(note.dateKey, note.mood);
    });
    this.buildCalendar(year, month, noteDays);
  },

  buildCalendar(year, month, noteDays) {
    const days = new Date(year, month + 1, 0).getDate();
    const first = new Date(year, month, 1).getDay();
    const blanks = first === 0 ? 6 : first - 1;
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const cells = [];
    for (let index = 0; index < blanks; index += 1) cells.push({ key: `blank-${index}` });
    for (let day = 1; day <= days; day += 1) {
      const date = `${year}-${pad(month + 1)}-${pad(day)}`;
      const mood = noteDays.get(date) || null;
      cells.push({ key: date, day, date, isToday: date === today, active: noteDays.has(date), mood,
        moodIndex: getMoodIndex(mood), moodLabel: mood && mood.name ? mood.name : "小记" });
    }
    this.setData({ monthTitle: `${year} 年 ${month + 1} 月`, cells });
  },

  closeCalendar() {
    const fallback = () => wx.redirectTo({ url: "/pages/note-history/note-history" });
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: fallback });
    else fallback();
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
