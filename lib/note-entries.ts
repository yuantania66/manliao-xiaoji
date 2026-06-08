export type NoteEntry = {
  date: string;
  dateKey: string;
  month: string;
  title: string;
  body: string;
  media: "images" | "video" | "none";
  mood?: string;
  weather?: string;
};

export const noteEntries: NoteEntry[] = [
  {
    date: "6 月 2 日 · 星期二",
    dateKey: "2026-06-02",
    month: "2026 年 6 月",
    title: "先放在这里。今晚不用一直握着它。",
    body: "今天有点累，不太想解释。",
    media: "images",
    mood: "小雨 · 委屈",
    weather: "多云",
  },
  {
    date: "6 月 4 日 · 星期四",
    dateKey: "2026-06-04",
    month: "2026 年 6 月",
    title: "这份轻松，值得被记住。",
    body: "晴朗的一刻，也可以成为以后回看的光。",
    media: "none",
    mood: "晴朗 · 轻松",
    weather: "晴朗",
  },
  {
    date: "6 月 8 日 · 星期一",
    dateKey: "2026-06-08",
    month: "2026 年 6 月",
    title: "委屈可以先被接住。",
    body: "小雨一样的心情，不需要马上放晴。",
    media: "none",
    mood: "小雨 · 委屈",
    weather: "小雨",
  },
  {
    date: "6 月 11 日 · 星期四",
    dateKey: "2026-06-11",
    month: "2026 年 6 月",
    title: "看不清时，先停一停。",
    body: "雾里不用急着选方向，站稳也是一种前进。",
    media: "none",
    mood: "雾 · 迷茫",
    weather: "雾",
  },
  {
    date: "6 月 1 日 · 星期一",
    dateKey: "2026-06-01",
    month: "2026 年 6 月",
    title: "晚风吹过来的时候，我轻了一点。",
    body: "回家路上的风",
    media: "video",
    mood: "多云 · 平静",
    weather: "多云",
  },
  {
    date: "6 月 16 日 · 星期二",
    dateKey: "2026-06-16",
    month: "2026 年 6 月",
    title: "阴影里也有出口。",
    body: "压着的东西先被看见，已经是一点松动。",
    media: "none",
    mood: "阴天 · 压抑",
    weather: "阴天",
  },
  {
    date: "6 月 18 日 · 星期四",
    dateKey: "2026-06-18",
    month: "2026 年 6 月",
    title: "你正在慢慢松开。",
    body: "释然不是突然发生的，是一点点回到自己。",
    media: "none",
    mood: "彩虹 · 释然",
    weather: "彩虹",
  },
  {
    date: "6 月 23 日 · 星期二",
    dateKey: "2026-06-23",
    month: "2026 年 6 月",
    title: "雨很大的时候，先停靠一下。",
    body: "崩溃也不是失败，只是提醒你需要被照顾。",
    media: "none",
    mood: "暴雨 · 崩溃",
    weather: "暴雨",
  },
  {
    date: "6 月 27 日 · 星期六",
    dateKey: "2026-06-27",
    month: "2026 年 6 月",
    title: "有点累，也还在发亮。",
    body: "晴转多云的心情，不必急着解释清楚。",
    media: "none",
    mood: "晴转多云 · 有点累",
    weather: "晴转多云",
  },
  {
    date: "6 月 30 日 · 星期二",
    dateKey: "2026-06-30",
    month: "2026 年 6 月",
    title: "这一刻已经被收下。",
    body: "不用写得很完整，能留下来就很好。",
    media: "none",
    mood: "多云 · 平静",
    weather: "多云",
  },
  {
    date: "5 月 29 日 · 星期五",
    dateKey: "2026-05-29",
    month: "2026 年 5 月",
    title: "风经过的时候，也把我轻轻放松了一点。",
    body: "那天心里安静了一些。",
    media: "none",
    mood: "晴朗 · 轻松",
    weather: "晴朗",
  },
];

export const getNoteEntryByDate = (dateKey: string | null) =>
  noteEntries.find((entry) => entry.dateKey === dateKey) ?? noteEntries[0];
