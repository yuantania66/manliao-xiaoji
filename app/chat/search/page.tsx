"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";

import { apiRequest } from "@/lib/client-api";

type SearchResult = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type SearchResponse = {
  items: SearchResult[];
};

const GUEST_CHAT_CACHE_KEY = "xinqingGuestChatCache";
const GUEST_SESSION_ID = "guest-session";

const formatResultDate = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

const searchGuestMessages = (query: string): SearchResult[] => {
  if (typeof window === "undefined") return [];

  try {
    const messages = JSON.parse(
      window.sessionStorage.getItem(GUEST_CHAT_CACHE_KEY) || "[]"
    ) as Array<{
      id: string;
      role: "user" | "assistant";
      text: string;
      createdAt: string;
    }>;

    return messages
      .filter((message) => message.text.includes(query))
      .slice()
      .reverse()
      .map((message) => ({
        id: message.id,
        sessionId: GUEST_SESSION_ID,
        role: message.role,
        content: message.text,
        createdAt: message.createdAt,
      }));
  } catch {
    return [];
  }
};

export default function ChatSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const trimmedQuery = query.trim();
  useEffect(() => {
    let cancelled = false;

    if (!trimmedQuery) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timer = window.setTimeout(() => {
      apiRequest<SearchResponse>(`/api/chat/search?q=${encodeURIComponent(trimmedQuery)}`)
        .then((data) => {
          if (cancelled) return;
          setResults(data.items);
        })
        .catch(() => {
          if (cancelled) return;
          const guestResults = searchGuestMessages(trimmedQuery);
          setResults(guestResults);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 220);

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
          href="/chat"
          aria-label="关闭查找聊天内容"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          聊聊
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[300px] text-[28px] font-semibold leading-[38px]">
          查找聊天内容
        </h1>

        <div className="absolute left-[22px] top-[158px] h-12 w-[346px] rounded-2xl bg-[var(--card-warm)]">
          <span className="absolute left-5 top-3.5 h-[22px] w-[30px] text-[17px] font-semibold leading-[22px] text-[var(--sage)]">
            ⌕
          </span>
          <input
            aria-label="输入想找的一句话"
            placeholder="输入想找的一句话"
            value={query}
            onChange={handleChange}
            className="absolute left-[50px] top-3.5 h-5 w-[250px] bg-transparent text-[13px] leading-5 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
        </div>

        <p className="absolute left-[22px] top-60 h-[22px] w-[340px] text-[13px] leading-[22px] text-[var(--body)]">
          可以搜索自己说过的话，也可以搜索慢聊小记的回应。
        </p>

        {trimmedQuery && !isSearching && results.length === 0 ? (
          <section className="absolute left-[22px] top-[300px] h-[92px] w-[346px] rounded-[18px] bg-[var(--card-warm)]">
            <h2 className="absolute left-6 top-[22px] h-[22px] w-[170px] text-base font-semibold leading-[22px]">
              没有搜索结果
            </h2>
            <p className="absolute left-6 top-[52px] h-[18px] w-[280px] text-xs leading-[18px] text-[var(--body)]">
              换一句更短的话试试。
            </p>
          </section>
        ) : null}

        {trimmedQuery && isSearching ? (
          <section className="absolute left-[22px] top-[300px] h-[92px] w-[346px] rounded-[18px] bg-[var(--card-warm)]">
            <h2 className="absolute left-6 top-[22px] h-[22px] w-[170px] text-base font-semibold leading-[22px]">
              正在查找
            </h2>
            <p className="absolute left-6 top-[52px] h-[18px] w-[280px] text-xs leading-[18px] text-[var(--body)]">
              正在从真实聊天里找。
            </p>
          </section>
        ) : null}

        {results.length > 0 ? (
          <div className="note-scrollbar absolute left-[22px] top-[300px] flex max-h-[330px] w-[346px] flex-col gap-3 overflow-y-auto pr-1">
            {results.map((result) => (
              <Link
                key={result.id}
                href={`/chat?date=${result.createdAt.slice(0, 10)}&sessionId=${result.sessionId}&messageId=${result.id}`}
                className="block min-h-[86px] rounded-[18px] bg-[var(--card-warm)] px-6 py-[16px] text-xs leading-[20px] text-[var(--body)]"
              >
                <span className="mb-1 block text-[10px] leading-4 text-[var(--muted)]">
                  {result.role === "user" ? "我" : "慢聊小记"} · {formatResultDate(result.createdAt)}
                </span>
                <span>{result.content}</span>
              </Link>
            ))}
          </div>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
