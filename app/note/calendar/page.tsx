"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";

const weeks = ["一", "二", "三", "四", "五", "六", "日"];
const moodIcons: Record<string, string> = {
  sun: "☀️",
  sunny: "☀️",
  sunCloud: "🌤️",
  partly: "⛅",
  cloud: "☁️",
  rain: "🌧️",
  storm: "⛈️",
  fog: "🌫️",
  rainbow: "🌈",
  moon: "🌙",
};

type CalendarDay = {
  date: string;
  count: number;
  noteIds: string[];
  moods: Array<{ name: string | null; icon: string | null }>;
};
type LoadState = "loading" | "ready" | "guest" | "error";

const getShanghaiMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

const shiftMonth = (month: string, offset: number) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const formatMoodIcon = (icon: string | null) => {
  if (!icon) return "•";
  return moodIcons[icon] ?? icon;
};

export default function NoteCalendarPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setMonth(getShanghaiMonth());
  }, []);

  useEffect(() => {
    if (!month) return;

    let cancelled = false;
    setLoadState("loading");
    setErrorMessage("");

    apiRequest<{ month: string; days: CalendarDay[] }>(`/api/notes/calendar?month=${month}`)
      .then((data) => {
        if (cancelled) return;
        setDays(data.days);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setDays([]);
        if (error instanceof ClientApiError && error.status === 401) {
          setLoadState("guest");
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "日历暂时加载失败");
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [month]);

  const calendar = useMemo(() => {
    if (!month) return { year: 0, monthNumber: 0, daysInMonth: 0, leadingEmptyDays: 0 };
    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const leadingEmptyDays = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
    return { year, monthNumber, daysInMonth, leadingEmptyDays };
  }, [month]);

  const dayMap = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href="/note"
          aria-label="关闭小记日历"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          我的小记
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[340px] text-[28px] font-semibold leading-[38px]">
          心情日历
        </h1>
        <p className="absolute left-[22px] top-[140px] h-[22px] w-[344px] text-[13px] leading-[22px] text-[var(--body)]">
          点开有心情标记的日期，可以回看那天的小记。
        </p>

        <section className="absolute left-[22px] top-[210px] h-[500px] w-[346px] rounded-[20px] bg-[var(--card-warm)]">
          <button
            type="button"
            onClick={() => setMonth((value) => (value ? shiftMonth(value, -1) : value))}
            disabled={!month}
            className="absolute left-[14px] top-[21px] h-9 w-9 text-[22px] leading-6 text-[var(--muted)]"
            aria-label="查看上个月"
          >
            ‹
          </button>
          <div className="absolute left-[80px] top-[27px] h-[22px] w-[168px] text-center text-base font-semibold leading-[22px]">
            {month ? `${calendar.year} 年 ${calendar.monthNumber} 月` : "正在确认月份…"}
          </div>
          <button
            type="button"
            onClick={() => setMonth((value) => (value ? shiftMonth(value, 1) : value))}
            disabled={!month}
            className="absolute left-[294px] top-[21px] h-9 w-9 text-[22px] leading-6 text-[var(--muted)]"
            aria-label="查看下个月"
          >
            ›
          </button>

          <div className="absolute left-[26px] top-20 grid w-[286px] grid-cols-7 text-center text-[10px] leading-[14px] text-[var(--muted)]">
            {weeks.map((week) => (
              <span key={week}>{week}</span>
            ))}
          </div>
          <div className="absolute left-[23px] top-[94px] h-px w-[286px] bg-[var(--line)]" />

          <div className="absolute left-5 top-[112px] grid w-[306px] grid-cols-7 gap-y-[17px]">
            {Array.from({ length: calendar.leadingEmptyDays }, (_, index) => (
              <div key={`empty-${index}`} className="h-[35px]" aria-hidden="true" />
            ))}
            {Array.from({ length: calendar.daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = `${month}-${String(day).padStart(2, "0")}`;
              const noteDay = dayMap.get(date);
              const latestMood = noteDay?.moods.at(-1) ?? null;
              const dayCell = (
                <div
                  className={
                    noteDay
                      ? "flex h-[35px] w-8 flex-col items-center justify-start rounded-[9px] bg-[#f7f2ec] text-center"
                      : "flex h-[35px] w-8 flex-col items-center justify-start text-center"
                  }
                >
                  <div className="flex h-5 w-8 items-center justify-center text-base leading-5">
                    {noteDay ? formatMoodIcon(latestMood?.icon ?? null) : null}
                  </div>
                  <div
                    className={
                      noteDay
                        ? "text-[11px] font-semibold leading-[15px] text-[var(--sage)]"
                        : "text-[11px] leading-[15px] text-[var(--body)]"
                    }
                  >
                    {day}
                  </div>
                </div>
              );

              return (
                <div key={date} className="flex h-[35px] justify-center">
                  {noteDay ? (
                    <Link
                      href={`/note/history?date=${date}`}
                      aria-label={`查看 ${calendar.year} 年 ${calendar.monthNumber} 月 ${day} 日的小记`}
                      className="block"
                    >
                      {dayCell}
                    </Link>
                  ) : (
                    dayCell
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="absolute left-5 top-[424px] w-[306px] text-center text-xs leading-5 text-[var(--muted)]"
            aria-live="polite"
          >
            {loadState === "loading" ? "正在加载这个月的小记…" : null}
            {loadState === "guest" ? (
              <>
                请先登录，再查看只属于你的小记。
                <Link href="/me" className="mt-1 block font-semibold text-[var(--sage)]">
                  返回登录
                </Link>
              </>
            ) : null}
            {loadState === "error" ? errorMessage || "日历暂时加载失败，请稍后再试。" : null}
            {loadState === "ready" && days.length === 0 ? "这个月还没有写下小记。" : null}
            {loadState === "ready" && days.length > 0 ? "有心情标记的日期，代表那天写过小记。" : null}
          </div>
        </section>

        <Link
          href="/note"
          className="absolute left-[22px] top-[740px] h-5 w-[180px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          ‹&nbsp;&nbsp;返回小记
        </Link>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
