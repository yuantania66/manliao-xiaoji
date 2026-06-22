"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";
import { getStoredAuth } from "@/lib/client-auth";

const weeks = ["一", "二", "三", "四", "五", "六", "日"];

type CalendarDay = {
  date: string;
  chatMessageCount: number;
  chatSessionIds: string[];
};

type CalendarResponse = {
  month: string;
  days: CalendarDay[];
};

type CachedChatCalendar = {
  activeDates: string[];
  dateSessionIds: [string, string][];
};

const CALENDAR_CACHE_PREFIX = "xinqingChatCalendarCache";
const CHAT_CACHE_PREFIX = "xinqingChatCache";
const GUEST_CHAT_CACHE_KEY = "xinqingGuestChatCache";
const GUEST_SESSION_ID = "guest-session";

const getCurrentMonth = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());

const formatMonthTitle = (month: string) => {
  const [year, monthText] = month.split("-");
  return `${year} 年 ${Number(monthText)} 月`;
};

const shiftMonth = (month: string, offset: number) => {
  const [year, monthText] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthText - 1 + offset, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
};

const getMonthDays = (month: string) => {
  const [year, monthText] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthText, 0)).getUTCDate();
};

const getLeadingBlanks = (month: string) => {
  const [year, monthText] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthText - 1, 1)).getUTCDay();
  return day === 0 ? 6 : day - 1;
};

const getCalendarCacheKey = (month: string) => {
  const auth = getStoredAuth();
  return auth?.token && auth.user?.id
    ? `${CALENDAR_CACHE_PREFIX}:${auth.user.id}:${month}`
    : null;
};

const readCalendarCache = (month: string): CachedChatCalendar | null => {
  if (typeof window === "undefined") return null;
  const key = getCalendarCacheKey(month);
  if (!key) return null;

  try {
    const cached = JSON.parse(
      window.sessionStorage.getItem(key) || "null"
    ) as CachedChatCalendar | null;
    return Array.isArray(cached?.activeDates) && Array.isArray(cached?.dateSessionIds)
      ? cached
      : null;
  } catch {
    return null;
  }
};

const writeCalendarCache = (month: string, value: CachedChatCalendar) => {
  if (typeof window === "undefined") return;
  const key = getCalendarCacheKey(month);
  if (!key) return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
};

const formatDateInShanghai = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));

const collectDatesFromMessages = (
  month: string,
  messages: { createdAt?: string }[],
  sessionId: string
): [string[], [string, string][]] => {
  const dates = Array.from(
    new Set(
      messages
        .map((message) => {
          if (!message?.createdAt) return null;
          const date = formatDateInShanghai(message.createdAt);
          return date.startsWith(`${month}-`) ? date : null;
        })
        .filter((date): date is string => Boolean(date))
    )
  ).sort();

  return [dates, dates.map((date) => [date, sessionId])];
};

const readLocalChatCalendar = (month: string): CachedChatCalendar | null => {
  if (typeof window === "undefined") return null;

  const activeDates = new Set<string>();
  const dateSessionIds = new Map<string, string>();

  const mergeDates = (value: [string[], [string, string][]]) => {
    value[0].forEach((date) => activeDates.add(date));
    value[1].forEach(([date, sessionId]) => {
      if (!dateSessionIds.has(date)) dateSessionIds.set(date, sessionId);
    });
  };

  try {
    const cached = JSON.parse(
      window.sessionStorage.getItem(GUEST_CHAT_CACHE_KEY) || "[]"
    ) as { createdAt?: string }[];
    if (Array.isArray(cached)) {
      mergeDates(collectDatesFromMessages(month, cached, GUEST_SESSION_ID));
    }
  } catch {
    // Ignore corrupt local cache and continue with other cache sources.
  }

  try {
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith(`${CHAT_CACHE_PREFIX}:`))
      .forEach((key) => {
        const cached = JSON.parse(window.sessionStorage.getItem(key) || "null") as {
          sessionId?: string;
          messages?: { createdAt?: string }[];
        } | null;
        if (!cached?.sessionId || !Array.isArray(cached.messages)) return;
        mergeDates(collectDatesFromMessages(month, cached.messages, cached.sessionId));
      });
  } catch {
    // Ignore corrupt local cache and let the calendar fall back gracefully.
  }

  if (activeDates.size === 0) return null;

  return {
    activeDates: Array.from(activeDates).sort(),
    dateSessionIds: Array.from(dateSessionIds.entries()).sort(([dateA], [dateB]) =>
      dateA.localeCompare(dateB)
    ),
  };
};

function HandHeart() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 36"
      className="absolute left-1/2 top-1/2 h-9 w-10 -translate-x-1/2 -translate-y-1/2"
      fill="none"
    >
      <path
        d="M20 30C12.4 24.4 6 18.8 6 11.7C6 7.4 9.1 4.8 12.9 4.8C15.8 4.8 18.1 6.3 20 8.8C21.9 6.3 24.2 4.8 27.1 4.8C30.9 4.8 34 7.4 34 11.7C34 18.8 27.6 24.4 20 30Z"
        stroke="#d77b70"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ChatCalendarPage() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [activeDates, setActiveDates] = useState<Set<string>>(new Set());
  const [dateSessionIds, setDateSessionIds] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const cached = readCalendarCache(month);
    const localCalendar = readLocalChatCalendar(month);
    if (cached) {
      setActiveDates(new Set(cached.activeDates));
      setDateSessionIds(new Map(cached.dateSessionIds));
    } else if (localCalendar) {
      setActiveDates(new Set(localCalendar.activeDates));
      setDateSessionIds(new Map(localCalendar.dateSessionIds));
    }

    setIsLoading(!cached && !localCalendar);
    setErrorMessage("");

    apiRequest<CalendarResponse>(`/api/calendar?month=${month}&type=all`)
      .then((data) => {
        if (cancelled) return;
        const chatDays = data.days.filter((day) => day.chatMessageCount > 0);
        const nextActiveDates = chatDays.map((day) => day.date);
        const nextDateSessionIds = chatDays
          .filter((day) => day.chatSessionIds[0])
          .map((day) => [day.date, day.chatSessionIds[0]] as [string, string]);

        setActiveDates(new Set(nextActiveDates));
        setDateSessionIds(new Map(nextDateSessionIds));
        writeCalendarCache(month, {
          activeDates: nextActiveDates,
          dateSessionIds: nextDateSessionIds,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const fallback = readLocalChatCalendar(month) ?? cached;
        if (fallback) {
          setActiveDates(new Set(fallback.activeDates));
          setDateSessionIds(new Map(fallback.dateSessionIds));
          setErrorMessage("");
          return;
        }

        setActiveDates(new Set());
        setDateSessionIds(new Map());
        setErrorMessage(
          error instanceof ClientApiError && error.status !== 500
            ? error.message
            : ""
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month]);

  const calendarCells = useMemo(() => {
    const leadingBlanks = getLeadingBlanks(month);
    const dayCount = getMonthDays(month);
    return [
      ...Array.from({ length: leadingBlanks }, (_, index) => ({
        key: `blank-${index}`,
        day: null,
        date: null,
      })),
      ...Array.from({ length: dayCount }, (_, index) => {
        const day = index + 1;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        return { key: date, day, date };
      }),
    ];
  }, [month]);

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href="/chat"
          aria-label="关闭聊天日历"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          聊聊
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[300px] text-[28px] font-semibold leading-[38px]">
          聊天日历
        </h1>
        <p className="absolute left-[22px] top-[136px] h-[22px] w-[340px] text-[13px] leading-[22px] text-[var(--body)]">
          有手写爱心的日子，代表你曾经来这里聊过。
        </p>

        <section className="absolute left-[22px] top-[210px] h-[470px] w-[346px] rounded-[20px] bg-[var(--card-warm)]">
          <button
            type="button"
            aria-label="上个月"
            className="absolute left-[20px] top-[27px] h-6 w-[18px] text-[22px] leading-6 text-[var(--muted)]"
            onClick={() => setMonth((value) => shiftMonth(value, -1))}
          >
            ‹
          </button>
          <div className="absolute left-[80px] top-[27px] h-[22px] w-[168px] text-center text-base font-semibold leading-[22px]">
            {formatMonthTitle(month)}
          </div>
          <button
            type="button"
            aria-label="下个月"
            className="absolute left-[302px] top-[27px] h-6 w-[18px] text-[22px] leading-6 text-[var(--muted)]"
            onClick={() => setMonth((value) => shiftMonth(value, 1))}
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
            {calendarCells.map(({ key, day, date }) => {
              if (!day || !date) {
                return <div key={key} className="h-[35px]" />;
              }

              const active = activeDates.has(date);
              const sessionId = dateSessionIds.get(date);
              const dayContent = (
                <div
                  className={
                    active
                      ? "relative h-[35px] w-10 text-[11px] font-semibold leading-[35px] text-[#9e5048]"
                      : "h-[35px] text-[11px] leading-[35px] text-[var(--body)]"
                  }
                >
                  {active ? <HandHeart /> : null}
                  <span className="relative z-10">{day}</span>
                </div>
              );

              return (
                <div
                  key={key}
                  className="flex h-[35px] items-center justify-center text-center"
                >
                  {active ? (
                    <Link
                      href={sessionId ? `/chat?date=${date}&sessionId=${sessionId}` : `/chat?date=${date}`}
                      aria-label={`查看 ${date} 的聊天`}
                      className="block"
                    >
                      {dayContent}
                    </Link>
                  ) : (
                    dayContent
                  )}
                </div>
              );
            })}
          </div>

          <p className="absolute left-5 top-[364px] h-[18px] w-[295px] text-xs leading-[18px] text-[var(--muted)]">
            {isLoading
              ? "正在加载真实聊天日历。"
              : errorMessage || "点开有爱心的日期，回到那一段聊天。"}
          </p>

          <div className="absolute left-5 top-[410px] h-12 w-[306px] rounded-[10px] bg-[#f7f2ec] px-5 py-[13px] text-[11px] leading-[17px] text-[var(--body)]">
            有手写爱心的日期，代表那天聊过天。
            <br />
            点开日期，可以回到当天慢慢看。
          </div>
        </section>

        <Link
          href="/chat"
          className="absolute left-[22px] top-[690px] h-5 w-[180px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          ‹&nbsp;&nbsp;返回聊天
        </Link>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
