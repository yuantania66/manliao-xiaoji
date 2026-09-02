"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";

type NoteItem = {
  id: string;
  content: string;
  moodName: string | null;
  moodIcon: string | null;
  mediaUrls: unknown[];
  recordDate: string;
};
type LoadState = "loading" | "ready" | "guest" | "error";

const formatMonth = (date: string) => {
  const [year, month] = date.split("-");
  return `${year} 年 ${Number(month)} 月`;
};

const formatDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
};

function NoteHistoryContent() {
  const searchParams = useSearchParams();
  const dateFilter = searchParams.get("date");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<NoteItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ pageSize: "100" });
      if (dateFilter) params.set("date", dateFilter);
      if (query.trim()) params.set("q", query.trim());

      setLoadState("loading");
      setErrorMessage("");
      apiRequest<{ items: NoteItem[] }>(`/api/notes?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setItems(data.items);
          setLoadState("ready");
        })
        .catch((error) => {
          if (cancelled) return;
          setItems([]);
          if (error instanceof ClientApiError && error.status === 401) {
            setLoadState("guest");
            return;
          }
          setErrorMessage(error instanceof Error ? error.message : "小记暂时加载失败");
          setLoadState("error");
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dateFilter, query]);

  let lastMonth = "";

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href="/note"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[30px] text-[var(--sage)]"
          aria-label="返回小记"
        >
          ‹ 返回
        </Link>

        <h1 className="absolute left-[22px] top-[78px] h-10 w-[220px] text-[30px] font-semibold leading-10">
          我的小记
        </h1>
        <Link
          href="/note"
          className="absolute left-[298px] top-[86px] h-5 w-[70px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          + 记一下
        </Link>
        <p className="absolute left-[22px] top-[132px] h-[22px] w-[330px] text-[13px] leading-[22px] text-[var(--body)]">
          {dateFilter ? "这一天写下的小记，都放在这里。" : "按时间回看自己写下的小记，不用一次看完。"}
        </p>

        <div className="absolute left-[22px] top-[178px] h-11 w-[346px] rounded-2xl bg-[var(--card-warm)]">
          <span className="pointer-events-none absolute left-5 top-3 h-[18px] w-6 text-[15px] font-semibold leading-[18px] text-[var(--sage)]">
            ⌕
          </span>
          <input
            aria-label="查找小记内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="查找小记内容"
            className="absolute inset-y-0 left-[48px] right-5 bg-transparent text-xs leading-[18px] text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
        </div>

        <Link
          href="/note/calendar"
          className="absolute left-[22px] top-[242px] h-14 w-[346px] rounded-[18px] bg-[var(--card-sage)]"
        >
          <span className="absolute left-5 top-4 h-[22px] w-[120px] text-[15px] font-semibold leading-[22px]">
            心情日历
          </span>
          <span className="absolute left-[110px] top-[18px] h-[18px] w-40 text-xs leading-[18px] text-[var(--sage)]">
            按日期回看某一天
          </span>
          <span className="absolute left-[314px] top-4 h-[22px] w-5 text-xl leading-[22px] text-[var(--sage)]">
            ›
          </span>
        </Link>

        <section
          className="note-scrollbar absolute bottom-[38px] left-[22px] top-[330px] w-[346px] overflow-y-auto pr-2"
          aria-live="polite"
        >
          {loadState === "loading" ? (
            <div className="pt-8 text-center text-xs leading-5 text-[var(--muted)]">正在加载小记…</div>
          ) : null}
          {loadState === "guest" ? (
            <div className="rounded-[18px] bg-[var(--card-warm)] px-5 py-6 text-center text-xs leading-6 text-[var(--body)]">
              请先登录，再查看只属于你的小记。
              <Link href="/me" className="mt-2 block font-semibold text-[var(--sage)]">
                返回登录
              </Link>
            </div>
          ) : null}
          {loadState === "error" ? (
            <div className="rounded-[18px] bg-[var(--card-warm)] px-5 py-6 text-center text-xs leading-6 text-[var(--body)]">
              {errorMessage || "小记暂时加载失败，请稍后再试。"}
            </div>
          ) : null}
          {loadState === "ready" && items.length === 0 ? (
            <div className="pt-8 text-center text-xs leading-5 text-[var(--muted)]">
              {query.trim() ? "没找到相关小记。" : dateFilter ? "这一天还没有小记。" : "还没有写下小记。"}
            </div>
          ) : null}
          {loadState === "ready"
            ? items.map((entry) => {
                const month = formatMonth(entry.recordDate);
                const showMonth = month !== lastMonth;
                lastMonth = month;

                return (
                  <div key={entry.id}>
                    {showMonth ? (
                      <h2 className="mb-5 h-[18px] text-[13px] font-semibold leading-[18px] text-[var(--sage)]">
                        {month}
                      </h2>
                    ) : null}
                    <Link
                      href={`/note/detail?id=${encodeURIComponent(entry.id)}`}
                      className="relative mb-[22px] block min-h-[112px] border-b border-[var(--line)] pb-[22px]"
                      aria-label={`查看 ${formatDate(entry.recordDate)} 的小记`}
                    >
                      <p className="h-[18px] text-xs leading-[18px] text-[var(--muted)]">
                        {formatDate(entry.recordDate)}
                        {entry.moodName ? ` · ${entry.moodName}` : ""}
                      </p>
                      <p className="mt-3 line-clamp-3 w-[270px] whitespace-pre-line text-sm leading-6 text-[var(--body)]">
                        {entry.content}
                      </p>
                      {entry.mediaUrls.length > 0 ? (
                        <span className="absolute right-0 top-0 rounded-full bg-[var(--card-sage)] px-2 py-1 text-[10px] text-[var(--sage)]">
                          附件 {entry.mediaUrls.length}
                        </span>
                      ) : null}
                    </Link>
                  </div>
                );
              })
            : null}
        </section>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export default function NoteHistoryPage() {
  return (
    <Suspense fallback={null}>
      <NoteHistoryContent />
    </Suspense>
  );
}
