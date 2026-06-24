"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChangeEvent, Suspense, useEffect, useRef, useState } from "react";
import { CalendarDays, Search } from "lucide-react";

type Mood = {
  name: string;
  desc: string;
  tone: string;
  icon: "sun" | "sunCloud" | "partly" | "cloud" | "rain" | "storm" | "fog" | "rainbow" | "moon";
};

type ShareVariant = {
  name: string;
  layout:
    | "ticket"
    | "polaroid"
    | "postcard"
    | "photoPostcard"
    | "envelope"
    | "film"
    | "minimalTicket"
    | "photoQuote"
    | "receipt";
  card: string;
  paper: string;
  accent: string;
  soft: string;
  ink: string;
  body: string;
  quote: string;
  note: string;
};

type SlipQuote = {
  quote: string;
  caption: string;
};

type WritableFileStreamLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type FileHandleLike = {
  createWritable: () => Promise<WritableFileStreamLike>;
};

type SaveFilePickerWindow = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileHandleLike>;
  };

const moods: Mood[] = [
  { name: "晴朗", desc: "轻松", tone: "#f4e4d3", icon: "sun" },
  { name: "晴转多云", desc: "有点累", tone: "#e8f0ea", icon: "sunCloud" },
  { name: "多云", desc: "平静", tone: "#e8f0ea", icon: "partly" },
  { name: "阴天", desc: "压抑", tone: "#eef0ee", icon: "cloud" },
  { name: "小雨", desc: "委屈", tone: "#e4ecf0", icon: "rain" },
  { name: "暴雨", desc: "崩溃", tone: "#e8e5e1", icon: "storm" },
  { name: "雾", desc: "迷茫", tone: "#eae6de", icon: "fog" },
  { name: "彩虹", desc: "释然", tone: "#e8f0ea", icon: "rainbow" },
  { name: "月夜", desc: "孤独", tone: "#f1e9e2", icon: "moon" },
];

const shareVariants: ShareVariant[] = [
  {
    name: "Share 01 / Ticket root",
    layout: "ticket",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#71877b",
    soft: "#e8f0ea",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "先放在这里。",
    note: "慢聊小记 · 小笺票根",
  },
  {
    name: "Share 02 / Polaroid moment",
    layout: "polaroid",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#71877b",
    soft: "#e4ecf0",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "今天允许自己慢一点。",
    note: "这张也送给正在撑着的你。",
  },
  {
    name: "Share 03 / Postcard calm",
    layout: "postcard",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#71877b",
    soft: "#e8f0ea",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "不用急。",
    note: "慢慢聊，轻轻记。",
  },
  {
    name: "Share 04 / Photo postcard",
    layout: "photoPostcard",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#b9826e",
    soft: "#f4e4d3",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "把今天轻轻夹住。",
    note: "给朋友看见一点点就够了。",
  },
  {
    name: "Share 05 / Soft envelope",
    layout: "envelope",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#71877b",
    soft: "#f4e4d3",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "这封小笺，先寄给自己。",
    note: "收好这一刻，不必立刻解释。",
  },
  {
    name: "Share 06 / Film strip full",
    layout: "film",
    card: "#fbf7f0",
    paper: "#2d2926",
    accent: "#e8f0ea",
    soft: "#fffdf9",
    ink: "#fffdf9",
    body: "#6d665f",
    quote: "这一格，也算被看见。",
    note: "慢聊小记替你留下一帧。",
  },
  {
    name: "Share 07 / Minimal ticket full",
    layout: "minimalTicket",
    card: "#fbf7f0",
    paper: "#e8f0ea",
    accent: "#71877b",
    soft: "#fffdf9",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "今天先不往前赶。",
    note: "慢一点，也在生活里。",
  },
  {
    name: "Share 08 / Photo quote full",
    layout: "photoQuote",
    card: "#fbf7f0",
    paper: "#e4ecf0",
    accent: "#71877b",
    soft: "#fffdf9",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "把风景留给心里那一小块。",
    note: "慢聊小记，收一张小笺。",
  },
  {
    name: "Share 09 / Receipt full",
    layout: "receipt",
    card: "#fbf7f0",
    paper: "#fffdf9",
    accent: "#d6b47b",
    soft: "#e8f0ea",
    ink: "#2d2926",
    body: "#6d665f",
    quote: "今天先不做更好的自己。",
    note: "允许今天慢一点。",
  },
];

const notePrompts = [
  {
    title: "今天想记下什么？",
    lead: "开心的、不开心的，或者只是一件小事，\n都可以放在这里。",
  },
  {
    title: "此刻有什么经过你？",
    lead: "不用写得完整。\n有一点点痕迹，也已经很好。",
  },
  {
    title: "给今天留一句话。",
    lead: "轻轻写下来就好。\n它不需要被解释得很清楚。",
  },
  {
    title: "今天的心放在哪里？",
    lead: "可以是一阵天气，也可以是一件小事。\n慢慢放进这里。",
  },
];

const slipQuoteRules: Array<{
  keywords: string[];
  quote: string;
  caption: string;
}> = [
  {
    keywords: ["累", "困", "撑", "疲", "忙", "烦", "倦"],
    quote: "你不必一直撑着。",
    caption: "今天已经够努力了，先把自己放回柔软处。",
  },
  {
    keywords: ["难过", "哭", "委屈", "崩溃", "伤心", "不开心", "低落"],
    quote: "难过不是退步。",
    caption: "它只是提醒你，有些地方需要被轻轻照顾。",
  },
  {
    keywords: ["急", "慌", "焦虑", "害怕", "担心", "紧张", "怕"],
    quote: "先慢下来，再往前。",
    caption: "不急着解决全部，先让呼吸回到身体里。",
  },
  {
    keywords: ["孤独", "一个人", "没人", "夜", "睡不着", "想家"],
    quote: "一个人也有回声。",
    caption: "此刻被写下，就不算完全独自经过。",
  },
  {
    keywords: ["开心", "快乐", "高兴", "顺利", "喜欢", "好"],
    quote: "把这点亮光留住。",
    caption: "好的时刻也值得被认真收藏。",
  },
  {
    keywords: ["想你", "想念", "朋友", "爱", "见面", "远方"],
    quote: "想念也有重量。",
    caption: "它说明有些关系，正在心里好好地存在着。",
  },
  {
    keywords: ["饿", "饭", "吃", "喝", "冷", "热"],
    quote: "先照顾好身体。",
    caption: "心事很多时，也别忘了给自己一点热气。",
  },
  {
    keywords: ["工作", "学习", "考试", "上班", "努力", "坚持"],
    quote: "你已经在路上了。",
    caption: "做得慢一点，也仍然算数。",
  },
];

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

const padDatePart = (value: number) => String(value).padStart(2, "0");

const formatLocalDate = (date: Date) =>
  `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${
    weekDays[date.getDay()]
  }`;

const getSlipImageFileName = () => {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
  ].join("");
  const timePart = [
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("");
  return `MLXJ_${datePart}${timePart}.png`;
};

const formatNoteDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日的小记`;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const splitTextLines = (value: string, maxLength: number, maxLines: number) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return ["今天有一点心事，被好好收下了。"];

  const lines: string[] = [];
  let current = "";
  for (const char of normalized) {
    if ((current + char).length > maxLength) {
      lines.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);

  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = `${trimmed[maxLines - 1].slice(0, Math.max(1, maxLength - 1))}…`;
    return trimmed;
  }

  if (lines.length > 1 && lines[lines.length - 1].length === 1) {
    const previous = lines[lines.length - 2];
    if (previous.length > 2) {
      lines[lines.length - 1] = `${previous.slice(-1)}${lines[lines.length - 1]}`;
      lines[lines.length - 2] = previous.slice(0, -1);
    }
  }

  return lines;
};

const textLength = (value: string) => Array.from(value.trim()).length;

const variantCapacity: Record<ShareVariant["layout"], number> = {
  ticket: 30,
  polaroid: 10,
  postcard: 22,
  photoPostcard: 10,
  envelope: 18,
  film: 6,
  minimalTicket: 30,
  photoQuote: 22,
  receipt: 18,
};

const pickShareVariant = (current: ShareVariant, quote: string) => {
  const length = textLength(quote);
  const suitable = shareVariants.filter((variant) => length <= variantCapacity[variant.layout]);
  const fallback = shareVariants.filter(
    (variant) => variant.layout === "ticket" || variant.layout === "minimalTicket"
  );
  const pool = suitable.length > 0 ? suitable : fallback;
  const withoutCurrent = pool.filter((variant) => variant !== current);
  const candidates = withoutCurrent.length > 0 ? withoutCurrent : pool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? shareVariants[0];
};

const moodSlipQuotes: Record<Mood["icon"], SlipQuote> = {
  sun: {
    quote: "这份轻松，值得被记住。",
    caption: "晴朗的一刻，也可以成为以后回看的光。",
  },
  sunCloud: {
    quote: "有点累，也还在发亮。",
    caption: "晴转多云的心情，不必急着解释清楚。",
  },
  partly: {
    quote: "不确定，也可以安放。",
    caption: "多云的时候，给自己留一点慢慢看清的时间。",
  },
  cloud: {
    quote: "阴影里也有出口。",
    caption: "压着的东西先被看见，已经是一点松动。",
  },
  rain: {
    quote: "委屈可以先被接住。",
    caption: "小雨一样的心情，不需要马上放晴。",
  },
  storm: {
    quote: "崩溃也不是失败。",
    caption: "雨很大的时候，先找一处能停靠的地方。",
  },
  fog: {
    quote: "看不清时，先停一停。",
    caption: "雾里不用急着选方向，站稳也是一种前进。",
  },
  rainbow: {
    quote: "你正在慢慢松开。",
    caption: "释然不是突然发生的，是一点点回到自己。",
  },
  moon: {
    quote: "夜色里，也有人在。",
    caption: "孤独被写下来时，就多了一点陪伴。",
  },
};

const withMoodCaption = (caption: string, mood: Mood | null) => {
  if (!mood) return caption;
  return `${caption} 你选的“${mood.name} · ${mood.desc}”，也一起被收好了。`;
};

const getSlipQuote = (value: string, mood: Mood | null): SlipQuote => {
  const normalized = value.trim().toLowerCase();
  const matched = slipQuoteRules.find((rule) =>
    rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
  );

  if (matched) {
    return {
      quote: matched.quote,
      caption: withMoodCaption(matched.caption, mood),
    };
  }

  if (mood) {
    return moodSlipQuotes[mood.icon];
  }

  return {
    quote: "这一刻已经被收下。",
    caption: "不用写得很完整，能留下来就很好。",
  };
};

const limitText = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

const qrDots = [
  [0, 0], [0, 1], [0, 2], [1, 0], [2, 0], [2, 1], [2, 2],
  [5, 0], [6, 0], [6, 1], [5, 2], [6, 2], [3, 1],
  [0, 5], [0, 6], [1, 6], [2, 5], [2, 6], [4, 4], [5, 5],
  [1, 4], [6, 4], [4, 6], [3, 6],
];

function WeatherIcon({ icon }: { icon: Mood["icon"] }) {
  if (icon === "sun") {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <circle cx="16" cy="16" r="5" fill="#d6b47b" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((degree) => (
          <line
            key={degree}
            x1="16"
            y1="4"
            x2="16"
            y2="8"
            stroke="#d6b47b"
            strokeWidth="2.2"
            strokeLinecap="round"
            transform={`rotate(${degree} 16 16)`}
          />
        ))}
      </svg>
    );
  }

  if (icon === "fog") {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <path d="M7 11H25M5 17H27M9 23H23" stroke="#8d9a95" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "rainbow") {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true" fill="none">
        <path d="M6 22a10 10 0 0 1 20 0" stroke="#d77b70" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M10 22a6 6 0 0 1 12 0" stroke="#d6b47b" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M14 22a2 2 0 0 1 4 0" stroke="#71877b" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "moon") {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <circle cx="15" cy="17" r="10" fill="#c89c86" />
        <circle cx="21" cy="14" r="10" fill="var(--card-warm)" />
      </svg>
    );
  }

  const cloud = icon === "storm" ? "#6e7780" : icon === "partly" ? "#71877b" : "#b9c8c6";
  const showSun = icon === "sunCloud" || icon === "partly";
  const showRain = icon === "rain" || icon === "storm";

  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
      {showSun ? <circle cx="11" cy="12" r="5" fill="#d6b47b" /> : null}
      <rect x="8" y="15" width="22" height="10" rx="5" fill={cloud} />
      <circle cx="17" cy="14" r="7" fill={cloud} />
      <circle cx="11" cy="18" r="5" fill={cloud} />
      {showRain
        ? [9, 16, 23].map((x) => (
            <line
              key={x}
              x1={x}
              y1="28"
              x2={x + 4}
              y2="24"
              stroke={icon === "storm" ? "#6e7780" : "#71877b"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))
        : null}
    </svg>
  );
}

function InlineMoodIcon({ mood }: { mood: Mood | null }) {
  if (!mood) {
    return <span className="text-sm font-semibold leading-5">☼</span>;
  }

  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
      <span className="scale-[0.62]">
        <WeatherIcon icon={mood.icon} />
      </span>
    </span>
  );
}

function QrMark({
  className = "",
  dark = "#71877b",
}: {
  className?: string;
  dark?: string;
}) {
  return (
    <div className={`absolute h-[46px] w-[46px] rounded-[12px] bg-[#fffdf9]/55 ${className}`}>
      {qrDots.map(([x, y]) => (
        <span
          key={`${x}-${y}`}
          className="absolute h-1 w-1 rounded-[1px] opacity-75"
          style={{ left: 6 + x * 5, top: 6 + y * 5, backgroundColor: dark }}
        />
      ))}
    </div>
  );
}

function ShareIllustration({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute ${className}`} aria-hidden="true">
      <span className="absolute left-[28px] top-0 h-16 w-7 -rotate-[28deg] rounded-full bg-[#d7e6dd]" />
      <span className="absolute left-[82px] top-0 h-14 w-6 rotate-[28deg] rounded-full bg-[#d7e6dd]" />
      <span className="absolute left-[106px] top-[12px] h-12 w-7 rotate-45 rounded-full bg-[#f1d4c8]" />
      <span className="absolute left-[68px] top-[18px] h-[92px] w-[3px] rotate-[31deg] rounded-full bg-[#71877b]" />
      <span className="absolute left-[74px] top-[42px] h-[3px] w-12 -rotate-6 rounded-full bg-[#71877b]" />
    </div>
  );
}

function PhotoTiles({ className = "" }: { className?: string }) {
  const tiles = [
    ["#f4e4d3", "-rotate-[16deg]", "left-0 top-4"],
    ["#e8f0ea", "rotate-[8deg]", "left-[52px] top-10"],
    ["#f1d4c8", "rotate-0", "left-[104px] top-4"],
    ["#eef3f0", "-rotate-[8deg]", "left-[148px] top-9"],
    ["#f4e4d3", "-rotate-[16deg]", "left-[194px] top-0"],
  ];

  return (
    <div className={`absolute ${className}`} aria-hidden="true">
      {tiles.map(([color, rotate, position]) => (
        <span
          key={`${color}-${position}`}
          className={`absolute h-[78px] w-[50px] rounded-[10px] opacity-60 ${rotate} ${position}`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function Perforation({
  className = "",
  dark = "#a49a91",
}: {
  className?: string;
  dark?: string;
}) {
  return (
    <div className={`absolute flex gap-3 ${className}`} aria-hidden="true">
      {Array.from({ length: 11 }).map((_, index) => (
        <span
          key={index}
          className="h-0.5 w-2 rounded-sm opacity-40"
          style={{ backgroundColor: dark }}
        />
      ))}
    </div>
  );
}

function SharePreview({
  variant,
  currentDateLabel,
  slipQuote,
}: {
  variant: ShareVariant;
  currentDateLabel: string;
  slipQuote: SlipQuote;
}) {
  const quoteShort = limitText(slipQuote.quote, 16);
  const quoteMedium = limitText(slipQuote.quote, 22);
  const quoteLines = splitTextLines(limitText(slipQuote.quote, 30), 12, 3);
  const captionShort = limitText(slipQuote.caption, 20);
  const captionMedium = limitText(slipQuote.caption, 28);

  if (variant.layout === "polaroid" || variant.layout === "photoPostcard") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px] p-0"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div
          className="absolute left-[30px] top-4 h-[366px] w-[254px] rounded-[18px]"
          style={{ backgroundColor: variant.paper }}
        />
        <div
          className="absolute left-[48px] top-[42px] h-[175px] w-[218px] rounded-[18px]"
          style={{ backgroundColor: variant.soft }}
        />
        <PhotoTiles className="left-[42px] top-[52px] h-[122px] w-[236px]" />
        <p className="absolute left-[64px] top-[234px] w-[194px] text-[20px] font-semibold leading-[30px] text-[var(--ink)]">
          {quoteShort}
        </p>
        <p className="absolute left-[64px] top-[294px] w-[190px] text-xs leading-[18px] text-[var(--body)]">
          {captionShort}
        </p>
        <QrMark className="left-[220px] top-[314px]" />
      </div>
    );
  }

  if (variant.layout === "postcard") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div
          className="absolute left-[26px] top-5 h-[360px] w-[262px] rounded-[18px]"
          style={{ backgroundColor: variant.paper }}
        />
        <p className="absolute left-[50px] top-[54px] w-[220px] text-[25px] font-semibold leading-9 text-[var(--ink)]">
          {quoteMedium}
        </p>
        <p className="absolute left-[50px] top-[148px] w-[190px] text-sm leading-[23px] text-[var(--body)]">
          {captionMedium}
        </p>
        <ShareIllustration className="left-[160px] top-[200px] h-[100px] w-[130px]" />
        <QrMark className="left-[50px] top-[296px]" />
        <p className="absolute left-[106px] top-[310px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          慢聊小记
        </p>
      </div>
    );
  }

  if (variant.layout === "envelope") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div
          className="absolute left-[30px] top-[46px] h-[270px] w-[254px] rounded-[22px]"
          style={{ backgroundColor: variant.paper }}
        />
        <div
          className="absolute left-[30px] top-[46px] h-[146px] w-[254px] rounded-t-[22px]"
          style={{
            background: `linear-gradient(160deg, ${variant.soft} 0 49%, transparent 50%), linear-gradient(200deg, #e8f0ea 0 49%, transparent 50%)`,
          }}
        />
        <p className="absolute left-[54px] top-[74px] w-[210px] text-[22px] font-semibold leading-8 text-[var(--ink)]">
          {quoteMedium}
        </p>
        <div className="absolute left-[54px] top-[214px] h-[62px] w-[190px] rounded-2xl bg-[var(--card-warm)] px-4 py-3 text-xs leading-[20px] text-[var(--body)]">
          {captionMedium}
        </div>
        <QrMark className="left-[220px] top-[292px]" />
        <p className="absolute left-[54px] top-[330px] text-xs font-semibold text-[var(--sage)]">
          慢聊小记
        </p>
      </div>
    );
  }

  if (variant.layout === "film") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div className="absolute left-[44px] top-5 h-[360px] w-[226px] rounded-[18px] bg-[var(--ink)]" />
        {Array.from({ length: 8 }).map((_, index) => (
          <span key={index} className="absolute left-[58px] h-3 w-5 rounded bg-[var(--page-bg)]" style={{ top: 40 + index * 40 }} />
        ))}
        {Array.from({ length: 8 }).map((_, index) => (
          <span key={index} className="absolute left-[236px] h-3 w-5 rounded bg-[var(--page-bg)]" style={{ top: 40 + index * 40 }} />
        ))}
        <div className="absolute left-[84px] top-[54px] h-[186px] w-[146px] rounded-2xl bg-[#e8f0ea]" />
        <PhotoTiles className="left-[54px] top-[84px] h-[122px] w-[236px] scale-75" />
        <p className="absolute left-[86px] top-[264px] w-[140px] text-[20px] font-semibold leading-8 text-[#fffdf9]">
          {quoteShort}
        </p>
        <p className="absolute left-[86px] top-[334px] text-[10px] leading-4 text-[#d8d0c8]">
          {captionShort}
        </p>
      </div>
    );
  }

  if (variant.layout === "receipt") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div
          className="absolute left-[34px] top-[22px] h-[356px] w-[246px] rounded-[18px]"
          style={{ backgroundColor: variant.paper }}
        />
        <div className="absolute left-[38px] top-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => (
            <span key={index} className="h-4 w-4 rounded-full bg-[var(--page-bg)]" />
          ))}
        </div>
        <div className="absolute left-[38px] bottom-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => (
            <span key={index} className="h-4 w-4 rounded-full bg-[var(--page-bg)]" />
          ))}
        </div>
        <p className="absolute left-[58px] top-[62px] w-[198px] text-[22px] font-semibold leading-8 text-[var(--ink)]">
          {quoteMedium}
        </p>
        <div className="absolute left-[58px] top-[180px] h-[74px] w-[184px] rounded-[18px] bg-[#e8f0ea] px-4 py-3 text-xs leading-[20px] text-[var(--body)]">
          {captionMedium}
        </div>
        <div className="absolute left-[58px] top-[288px] h-px w-[184px] bg-[var(--line)]" />
        <p className="absolute left-[58px] top-[312px] w-[134px] text-xs leading-[20px] text-[var(--body)]">
          来自慢聊小记的一张小票：<br />
          {limitText(captionShort, 14)}
        </p>
        <QrMark className="left-[206px] top-[312px] scale-[0.72] origin-top-left" />
      </div>
    );
  }

  if (variant.layout === "photoQuote") {
    return (
      <div
        className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
        role="img"
        aria-label={`生成的小笺图片预览，${variant.name}`}
        style={{ backgroundColor: variant.card }}
      >
        <div className="absolute inset-0" style={{ backgroundColor: variant.paper }} />
        <PhotoTiles className="left-[20px] top-[30px] h-[122px] w-[236px] scale-125 opacity-80" />
        <div className="absolute left-[38px] top-[168px] h-[164px] w-[238px] rounded-[22px] bg-[#fffdf9]/90 px-6 py-6">
          <p className="text-[23px] font-semibold leading-9 text-[var(--ink)]">{quoteMedium}</p>
          <p className="mt-5 text-xs leading-[20px] text-[var(--body)]">{captionMedium}</p>
        </div>
        <QrMark className="left-[226px] top-[318px]" />
      </div>
    );
  }

  const isMinimal = variant.layout === "minimalTicket";

  return (
    <div
      className="absolute left-5 top-[70px] h-[400px] w-[314px] overflow-hidden rounded-[20px]"
      role="img"
      aria-label={`生成的小笺图片预览，${variant.name}`}
      style={{ backgroundColor: variant.card }}
    >
      <div
        className="absolute left-[24px] top-[18px] h-[364px] w-[266px] rounded-[24px]"
        style={{ backgroundColor: variant.paper }}
      />
      <span className="absolute left-[10px] top-[188px] h-8 w-8 rounded-full bg-[var(--page-bg)]" />
      <span className="absolute right-[10px] top-[188px] h-8 w-8 rounded-full bg-[var(--page-bg)]" />
      <Perforation className="left-[48px] top-[204px]" />
      {!isMinimal ? <ShareIllustration className="left-[188px] top-[84px] h-[100px] w-[130px]" /> : null}
      <p
        className="absolute left-[48px] top-[48px] w-[218px] text-[15px] font-semibold leading-[23px]"
        style={{ color: variant.accent }}
      >
        {isMinimal ? currentDateLabel : "如果你今天也有点累，\n这句话也送给你。"}
      </p>
      <div className="absolute left-[48px] top-[128px] w-[220px] text-[24px] font-semibold leading-9 text-[var(--ink)]">
        {quoteLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <p className="absolute left-[48px] top-[266px] w-[196px] overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-[18px] text-[var(--body)]">
        {captionMedium}
      </p>
      <QrMark className="left-[48px] top-[314px]" />
      <p className="absolute left-[104px] top-[326px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
        {isMinimal ? "慢聊小记" : "慢聊小记 · 小笺票根"}
      </p>
    </div>
  );
}

function NoteContent() {
  const searchParams = useSearchParams();
  const date = searchParams.get("date");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [isMoodPickerOpen, setIsMoodPickerOpen] = useState(false);
  const [isSlipOpen, setIsSlipOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [shareVariant, setShareVariant] = useState(shareVariants[0]);
  const [slipActionFeedback, setSlipActionFeedback] = useState("");
  const [todayLabel, setTodayLabel] = useState(formatLocalDate(new Date()));
  const [prompt, setPrompt] = useState(notePrompts[0]);
  const hasNote = note.trim().length > 0;
  const currentDateLabel = date ? formatNoteDate(date) : todayLabel;
  const slipQuote = getSlipQuote(note, selectedMood);

  useEffect(() => {
    setTodayLabel(formatLocalDate(new Date()));
    setPrompt(notePrompts[Math.floor(Math.random() * notePrompts.length)]);
  }, []);

  const handleMediaClick = () => {
    fileInputRef.current?.click();
  };

  const handleMediaChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedCount(event.target.files?.length ?? 0);
  };

  const handleSaveNote = () => {
    if (!hasNote) return;
    setShareVariant(pickShareVariant(shareVariant, slipQuote.quote));
    setSlipActionFeedback("");
    setIsSlipOpen(true);
  };

  const buildSlipSvg = () => {
    const captionLabel = limitText(slipQuote.caption, 28);
    const titleLines = splitTextLines(limitText(slipQuote.quote, 30), 12, 3)
      .map(
        (line, index) =>
          `<text x="62" y="${146 + index * 34}" font-size="24" font-weight="700" fill="${shareVariant.ink}">${escapeXml(line)}</text>`
      )
      .join("");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1000" viewBox="0 0 375 500">
      <rect width="375" height="500" rx="28" fill="${shareVariant.card}"/>
      <rect x="34" y="26" width="307" height="448" rx="26" fill="${shareVariant.paper}"/>
      <rect x="52" y="42" width="34" height="4" rx="2" fill="${shareVariant.accent}"/>
      <text x="52" y="82" font-size="13" fill="#a49a91">${escapeXml(currentDateLabel)}</text>
      ${titleLines}
      <rect x="52" y="270" width="270" height="1" fill="#e8ded4"/>
      <rect x="52" y="302" width="210" height="56" rx="16" fill="${shareVariant.soft}"/>
      <text x="72" y="335" font-size="14" fill="${shareVariant.body}">${escapeXml(captionLabel)}</text>
      <text x="52" y="430" font-size="15" font-weight="700" fill="${shareVariant.accent}">慢聊小记</text>
      <text x="52" y="452" font-size="11" fill="#a49a91">${escapeXml(captionLabel)}</text>
      <rect x="270" y="390" width="48" height="48" rx="12" fill="#fffdf9" opacity="0.58"/>
      ${qrDots
        .map(
          ([x, y]) =>
            `<rect x="${278 + x * 5}" y="${398 + y * 5}" width="4" height="4" rx="1" fill="#71877b" opacity="0.78"/>`
        )
        .join("")}
    </svg>`;
  };

  const buildSlipPngBlob = async () => {
    const svgBlob = new Blob([buildSlipSvg()], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new window.Image();
      image.decoding = "async";
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("小笺图片生成失败"));
      });
      image.src = svgUrl;
      await loaded;

      const canvas = document.createElement("canvas");
      canvas.width = 750;
      canvas.height = 1000;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器不支持图片生成");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("小笺图片生成失败"));
          }
        }, "image/png");
      });
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };

  const handleDownloadSlip = async () => {
    try {
      setSlipActionFeedback("正在生成图片...");
      const blob = await buildSlipPngBlob();
      const fileName = getSlipImageFileName();
      const pickerWindow = window as SaveFilePickerWindow;

      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "PNG 图片",
              accept: { "image/png": [".png"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSlipActionFeedback("图片已保存");
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.rel = "noopener";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 30000);
      setSlipActionFeedback("已发起下载，请查看浏览器下载记录");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSlipActionFeedback("已取消保存");
        return;
      }
      setSlipActionFeedback("保存失败，请稍后再试");
    }
  };

  const handleShareSlip = async () => {
    try {
      setSlipActionFeedback("正在准备分享...");
      const shareText = `${slipQuote.quote}\n${limitText(slipQuote.caption, 36)}`;
      const blob = await buildSlipPngBlob();
      const file = new File([blob], getSlipImageFileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: "慢聊小记小笺",
          text: shareText,
          files: [file],
        });
        setSlipActionFeedback("已打开分享面板");
        return;
      }
      if (navigator.share) {
        await navigator.share({
          title: "慢聊小记小笺",
          text: shareText,
        });
        setSlipActionFeedback("已打开分享面板");
        return;
      }
      await navigator.clipboard?.writeText(shareText);
      setSlipActionFeedback("当前浏览器不支持直接分享，文字已复制");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSlipActionFeedback("已取消分享");
        return;
      }
      setSlipActionFeedback("分享失败，请稍后再试");
    }
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute inset-x-0 top-0 h-[30px] bg-[var(--page-bg)]" />

        <Link
          href="/"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
          aria-label="返回首页"
        >
          ‹ 返回
        </Link>

        <p className="absolute left-[22px] top-[82px] h-[18px] w-[340px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          {currentDateLabel}
        </p>

        <button
          type="button"
          aria-label="打开小记菜单"
          aria-expanded={isMenuOpen}
          className="absolute left-[328px] top-[78px] z-20 h-[22px] w-10 text-center text-lg font-semibold leading-[22px] text-[var(--sage)]"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          ···
        </button>

        {isMenuOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭小记菜单"
              className="absolute inset-0 z-30 bg-[var(--page-bg)]/60"
              onClick={() => setIsMenuOpen(false)}
            />
            <div className="absolute left-[174px] top-[108px] z-40 h-[126px] w-[194px] rounded-2xl bg-[var(--card-warm)]">
              <Link
                href="/note/calendar"
                className="absolute left-[22px] top-6 flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="进入小记日历"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>小记日历</span>
              </Link>
              <div className="absolute left-5 top-[63px] h-px w-[154px] bg-[var(--line)]" />
              <Link
                href="/note/search"
                className="absolute left-[22px] top-[82px] flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="查找小记内容"
              >
                <Search className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>查找小记内容</span>
              </Link>
            </div>
          </>
        ) : null}

        <h1 className="absolute left-[22px] top-[118px] h-[38px] w-[345px] text-[28px] font-semibold leading-[38px]">
          {prompt.title}
        </h1>

        <p className="absolute left-[22px] top-[164px] h-12 w-[345px] whitespace-pre-line text-sm leading-6 text-[var(--body)]">
          {prompt.lead}
        </p>

        <div className="absolute left-[22px] top-[252px] h-[282px] w-[346px] rounded-[20px] bg-[var(--card-warm)]">
          <textarea
            aria-label="小记内容"
            placeholder="此刻想到的，就从这里开始写。"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="note-scrollbar absolute inset-x-0 top-0 bottom-[56px] h-auto w-full resize-none rounded-t-[20px] bg-transparent px-5 pb-3 pt-7 text-sm leading-6 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
          <div className="absolute inset-x-0 bottom-0 h-[56px] rounded-b-[20px] bg-[var(--card-warm)]">
            <div className="pointer-events-none absolute bottom-[18px] left-5 h-[18px] w-[120px] text-xs leading-[18px] text-[var(--muted)]">
              {note.length} / 500
            </div>
            <div className="absolute bottom-[18px] right-5 h-5 w-[142px]">
              <button
                type="button"
                className={
                  selectedMood
                    ? "flex h-full w-full items-center justify-end gap-1 bg-transparent pr-6 text-right text-xs font-semibold leading-5 text-[var(--sage)]"
                    : "flex h-full w-full items-center justify-end gap-1 bg-transparent text-right text-xs font-semibold leading-5 text-[var(--sage)]"
                }
                onClick={() => setIsMoodPickerOpen(true)}
              >
                <InlineMoodIcon mood={selectedMood} />
                <span className="max-w-[90px] truncate">
                  {selectedMood ? selectedMood.name : "选择心情"}
                </span>
              </button>
              {selectedMood ? (
                <button
                  type="button"
                  aria-label="删除已选心情"
                  className="absolute right-0 top-0 h-5 w-5 text-center text-xs font-semibold leading-5 text-[var(--muted)]"
                  onClick={() => setSelectedMood(null)}
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          aria-label="选择图片或视频"
          onChange={handleMediaChange}
        />

        <button
          type="button"
          className="absolute left-[22px] top-[552px] h-[58px] w-[166px] rounded-2xl bg-[var(--card-warm)] text-left"
          onClick={handleMediaClick}
        >
          <span className="absolute left-5 top-[18px] text-lg font-semibold leading-5 text-[var(--sage)]">
            +
          </span>
          <span className="absolute left-11 top-3.5 text-[13px] font-semibold leading-[18px] text-[var(--sage)]">
            添加图片/视频
          </span>
          <span className="absolute left-11 top-[33px] text-[10px] leading-[14px] text-[var(--muted)]">
            照片/短视频
          </span>
        </button>

        {selectedCount > 0 ? (
          <div className="absolute left-[22px] top-[622px] h-[18px] w-[150px] text-xs leading-[18px] text-[var(--muted)]">
            已选择 {selectedCount} 个
          </div>
        ) : null}

        <button
          type="button"
          disabled={!hasNote}
          onClick={handleSaveNote}
          className={
            hasNote
              ? "absolute left-[286px] top-[552px] h-[58px] w-[82px] rounded-2xl bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
              : "absolute left-[286px] top-[552px] h-[58px] w-[82px] rounded-2xl bg-[#d8d1c9] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
          }
        >
          记一下
        </button>

        <Image
          src="/quiet-leaf.svg"
          alt=""
          width={125}
          height={115}
          priority
          className="absolute left-64 top-[660px] h-[115px] w-[125px]"
        />

        <Link
          href="/note/history"
          className="absolute inset-x-0 bottom-[48px] z-10 h-5 text-center text-[13px] font-semibold leading-5 text-[var(--sage)]"
          aria-label="查看我的小记"
        >
          我的小记 ›
        </Link>

        {isMoodPickerOpen ? (
          <div className="absolute inset-0 z-50 bg-[var(--page-bg)]">
            <button
              type="button"
              aria-label="关闭心情选择"
              className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
              onClick={() => setIsMoodPickerOpen(false)}
            >
              ×
            </button>

            <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
              小记
            </p>
            <h2 className="absolute left-[22px] top-[88px] h-[38px] w-[340px] text-[27px] font-semibold leading-[38px]">
              给此刻选一种天气。
            </h2>
            <p className="absolute left-[22px] top-36 h-[22px] w-[344px] text-[13px] leading-[22px] text-[var(--body)]">
              也可以跳过。只是给这一刻留一个小标记。
            </p>

            <div className="absolute left-[22px] top-[238px] grid w-[326px] grid-cols-2 gap-x-[18px] gap-y-[20px]">
              {moods.slice(0, 8).map((mood) => (
                <button
                  key={mood.name}
                  type="button"
                  className="relative h-[78px] rounded-[18px] text-left"
                  style={{ backgroundColor: mood.tone }}
                  onClick={() => {
                    setSelectedMood(mood);
                    setIsMoodPickerOpen(false);
                  }}
                >
                  <span className="absolute left-5 top-[22px]">
                    <WeatherIcon icon={mood.icon} />
                  </span>
                  <span className="absolute left-[66px] top-[15px] text-[17px] font-semibold leading-[23px]">
                    {mood.name}
                  </span>
                  <span className="absolute left-[66px] top-[44px] text-xs leading-4 text-[var(--body)]">
                    {mood.desc}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="absolute left-[22px] top-[630px] h-[78px] w-[326px] rounded-[18px] text-left"
              style={{ backgroundColor: moods[8].tone }}
              onClick={() => {
                setSelectedMood(moods[8]);
                setIsMoodPickerOpen(false);
              }}
            >
              <span className="absolute left-[23px] top-[22px]">
                <WeatherIcon icon={moods[8].icon} />
              </span>
              <span className="absolute left-[66px] top-[19px] text-[17px] font-semibold leading-[23px]">
                {moods[8].name}
              </span>
              <span className="absolute left-[66px] top-[48px] text-xs leading-4 text-[var(--body)]">
                {moods[8].desc}
              </span>
            </button>

            <button
              type="button"
              className="absolute left-[22px] top-[728px] h-11 w-[326px] rounded-[18px] bg-[var(--card-warm)] text-center text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
              onClick={() => setIsMoodPickerOpen(false)}
            >
              暂时跳过
            </button>
            <p className="absolute left-[22px] top-[792px] h-[17px] w-[326px] text-center text-[11px] leading-[17px] text-[var(--muted)]">
              之后仍然可以在小记里补上或修改。
            </p>
            <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
          </div>
        ) : null}

        {isSlipOpen ? (
          <div className="absolute inset-0 z-[80]">
            <div className="absolute inset-0 bg-[#5b534d]/50" />
            <section className="absolute left-[18px] top-[82px] h-[682px] w-[354px] rounded-[24px] bg-[var(--page-bg)]">
              <p className="absolute left-5 top-6 h-5 w-[180px] text-[13px] font-semibold leading-5 text-[var(--sage)]">
                小笺
              </p>
              <button
                type="button"
                aria-label="关闭小笺"
                className="absolute right-4 top-5 h-8 w-8 text-center text-[22px] leading-8 text-[var(--muted)]"
                onClick={() => setIsSlipOpen(false)}
              >
                ×
              </button>

              <SharePreview
                variant={shareVariant}
                currentDateLabel={currentDateLabel}
                slipQuote={slipQuote}
              />

              <button
                type="button"
                className="absolute left-5 top-[498px] h-[46px] w-[150px] rounded-[15px] bg-[var(--card-warm)] text-[13px] font-semibold leading-5 text-[var(--body)]"
                onClick={handleShareSlip}
              >
                分享给朋友
              </button>
              <button
                type="button"
                className="absolute left-[184px] top-[498px] h-[46px] w-[150px] rounded-[15px] bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
                onClick={handleDownloadSlip}
              >
                保存图片
              </button>
              <p
                aria-live="polite"
                className="absolute left-5 top-[556px] h-5 w-[314px] text-center text-[11px] leading-5 text-[var(--muted)]"
              >
                {slipActionFeedback}
              </p>
              <button
                type="button"
                className="absolute left-[120px] top-[620px] h-5 w-[120px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
                onClick={() => setIsSlipOpen(false)}
              >
                继续写一点
              </button>
            </section>
            <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
          </div>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export default function NotePage() {
  return (
    <Suspense fallback={null}>
      <NoteContent />
    </Suspense>
  );
}
