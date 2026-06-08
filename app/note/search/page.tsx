"use client";

import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";

const notes = [
  "今天把心情写下来，感觉轻了一点。",
  "小雨的时候，也可以慢慢走。",
  "给自己留一点安静的时间。",
];

export default function NoteSearchPage() {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const results = useMemo(() => {
    if (!trimmedQuery) {
      return [];
    }

    return notes.filter((note) => note.includes(trimmedQuery));
  }, [trimmedQuery]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4">
          9:41
        </div>
        <Link
          href="/note"
          aria-label="关闭查找小记内容"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          小记
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[300px] text-[28px] font-semibold leading-[38px]">
          查找小记内容
        </h1>

        <div className="absolute left-[22px] top-[158px] h-12 w-[346px] rounded-2xl bg-[var(--card-warm)]">
          <span className="absolute left-5 top-3.5 h-[22px] w-[30px] text-[17px] font-semibold leading-[22px] text-[var(--sage)]">
            ⌕
          </span>
          <input
            aria-label="输入想找的小记"
            placeholder="输入想找的一句话"
            value={query}
            onChange={handleChange}
            className="absolute left-[50px] top-3.5 h-5 w-[250px] bg-transparent text-[13px] leading-5 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
        </div>

        <p className="absolute left-[22px] top-60 h-[22px] w-[340px] text-[13px] leading-[22px] text-[var(--body)]">
          可以搜索自己写过的小记，也可以搜索某个天气心情。
        </p>

        {trimmedQuery && results.length === 0 ? (
          <section className="absolute left-[22px] top-[300px] h-[92px] w-[346px] rounded-[18px] bg-[var(--card-warm)]">
            <h2 className="absolute left-6 top-[22px] h-[22px] w-[170px] text-base font-semibold leading-[22px]">
              没有搜索结果
            </h2>
            <p className="absolute left-6 top-[52px] h-[18px] w-[280px] text-xs leading-[18px] text-[var(--body)]">
              换一句更短的话试试。
            </p>
          </section>
        ) : null}

        {results.length > 0 ? (
          <div className="absolute left-[22px] top-[300px] flex w-[346px] flex-col gap-3">
            {results.map((result) => (
              <article
                key={result}
                className="min-h-[72px] rounded-[18px] bg-[var(--card-warm)] px-6 py-[18px] text-xs leading-[20px] text-[var(--body)]"
              >
                {result}
              </article>
            ))}
          </div>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
