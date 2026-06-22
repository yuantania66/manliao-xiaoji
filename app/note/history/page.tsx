"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { noteEntries } from "@/lib/note-entries";

function NoteHistoryContent() {
  const searchParams = useSearchParams();
  const dateFilter = searchParams.get("date");
  const [query, setQuery] = useState("");
  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const dateEntries = dateFilter
      ? noteEntries.filter((entry) => entry.dateKey === dateFilter)
      : noteEntries;
    if (!keyword) return dateEntries;
    return dateEntries.filter((entry) =>
      [entry.date, entry.month, entry.title, entry.body]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
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
          {dateFilter ? "这一天写下的小记，都放在这里。" : "按时间回看文字、图片和视频，不用一次看完。"}
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
            按天气回看某一天
          </span>
          <span className="absolute left-[314px] top-4 h-[22px] w-5 text-xl leading-[22px] text-[var(--sage)]">
            ›
          </span>
        </Link>

        <section className="note-scrollbar absolute left-[22px] top-[356px] bottom-[38px] w-[346px] overflow-y-auto pr-2">
          {filteredEntries.length > 0 ? (
            filteredEntries.map((entry) => {
              const showMonth = entry.month !== lastMonth;
              lastMonth = entry.month;

              return (
                <div key={entry.dateKey}>
                  {showMonth ? (
                    <h2 className="mb-[28px] h-[18px] text-[13px] font-semibold leading-[18px] text-[var(--sage)]">
                      {entry.month}
                    </h2>
                  ) : null}
                  <Link
                    href={`/note/detail?date=${entry.dateKey}`}
                    className="relative mb-[22px] block min-h-[126px] border-b border-[var(--line)] pb-[22px]"
                    aria-label={`查看 ${entry.date} 的小记`}
                  >
                    <p className="h-[18px] text-xs leading-[18px] text-[var(--muted)]">
                      {entry.date}
                    </p>
                    <h3 className="mt-[9px] min-h-5 w-[205px] text-sm font-semibold leading-5">
                      {entry.title}
                    </h3>
                    <p className="mt-3.5 min-h-[18px] w-[205px] text-xs leading-[18px] text-[var(--body)]">
                      {entry.body}
                    </p>
                    {entry.media === "images" ? (
                      <div className="absolute left-[234px] top-[5px] grid w-[72px] grid-cols-2 gap-1">
                        {["#f4e4d3", "#e8f0ea", "#e4ecf0"].map((color, index) => (
                          <div
                            key={color}
                            className="h-[34px] w-[34px] rounded-lg text-center text-[10px] font-semibold leading-[34px]"
                            style={{
                              backgroundColor: color,
                              color: index === 0 ? "#b9826e" : "var(--sage)",
                            }}
                          >
                            图
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {entry.media === "video" ? (
                      <>
                        <div className="absolute left-[234px] top-[16px] h-[54px] w-[72px] rounded-[10px] bg-[#e4ecf0]">
                          <div className="absolute left-7 top-[17px] h-0 w-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-[var(--sage)]" />
                        </div>
                        <p className="absolute left-[234px] top-[76px] h-[15px] w-[90px] text-[11px] leading-[15px] text-[var(--body)]">
                          视频 · 00:12
                        </p>
                      </>
                    ) : null}
                  </Link>
                </div>
              );
            })
          ) : (
            <div className="pt-4 text-center text-xs leading-5 text-[var(--muted)]">
              没找到相关小记。
            </div>
          )}
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
