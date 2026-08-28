"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";

type NoteItem = {
  id: string;
  content: string;
  moodName: string | null;
  recordDate: string;
};
type SearchState = "idle" | "loading" | "ready" | "guest" | "error";

const formatDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
};

export default function NoteSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteItem[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setSearchState("idle");
      setErrorMessage("");
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchState("loading");
      setErrorMessage("");
      const params = new URLSearchParams({ q: trimmedQuery, pageSize: "50" });
      apiRequest<{ items: NoteItem[] }>(`/api/notes?${params.toString()}`)
        .then((data) => {
          if (cancelled) return;
          setResults(data.items);
          setSearchState("ready");
        })
        .catch((error) => {
          if (cancelled) return;
          setResults([]);
          if (error instanceof ClientApiError && error.status === 401) {
            setSearchState("guest");
            return;
          }
          setErrorMessage(error instanceof Error ? error.message : "搜索暂时不可用");
          setSearchState("error");
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
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
            maxLength={100}
            className="absolute left-[50px] top-3.5 h-5 w-[250px] bg-transparent text-[13px] leading-5 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
        </div>

        <p className="absolute left-[22px] top-60 h-[22px] w-[340px] text-[13px] leading-[22px] text-[var(--body)]">
          可以搜索自己写过的小记，也可以搜索记录过的心情。
        </p>

        <section
          className="note-scrollbar absolute bottom-[42px] left-[22px] top-[300px] w-[346px] overflow-y-auto"
          aria-live="polite"
        >
          {searchState === "loading" ? (
            <p className="pt-6 text-center text-xs leading-5 text-[var(--muted)]">正在查找…</p>
          ) : null}
          {searchState === "guest" ? (
            <div className="rounded-[18px] bg-[var(--card-warm)] px-6 py-5 text-center text-xs leading-6 text-[var(--body)]">
              请先登录，再搜索只属于你的小记。
              <Link href="/me" className="mt-2 block font-semibold text-[var(--sage)]">
                返回登录
              </Link>
            </div>
          ) : null}
          {searchState === "error" ? (
            <div className="rounded-[18px] bg-[var(--card-warm)] px-6 py-5 text-center text-xs leading-6 text-[var(--body)]">
              {errorMessage || "搜索暂时不可用，请稍后再试。"}
            </div>
          ) : null}
          {searchState === "ready" && results.length === 0 ? (
            <div className="h-[92px] rounded-[18px] bg-[var(--card-warm)] px-6 py-[18px]">
              <h2 className="text-base font-semibold leading-[22px]">没有搜索结果</h2>
              <p className="mt-2 text-xs leading-[18px] text-[var(--body)]">换一句更短的话试试。</p>
            </div>
          ) : null}
          {searchState === "ready" && results.length > 0 ? (
            <div className="flex flex-col gap-3">
              {results.map((result) => (
                <Link
                  key={result.id}
                  href={`/note/detail?id=${encodeURIComponent(result.id)}`}
                  className="block min-h-[92px] rounded-[18px] bg-[var(--card-warm)] px-6 py-[16px]"
                >
                  <p className="text-[11px] leading-4 text-[var(--muted)]">
                    {formatDate(result.recordDate)}
                    {result.moodName ? ` · ${result.moodName}` : ""}
                  </p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-line text-xs leading-[20px] text-[var(--body)]">
                    {result.content}
                  </p>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
