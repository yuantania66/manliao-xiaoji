"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";

type NoteDetail = {
  id: string;
  content: string;
  moodName: string | null;
  moodIcon: string | null;
  mediaUrls: unknown[];
  recordDate: string;
};
type LoadState = "loading" | "ready" | "guest" | "missing" | "error";

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

const formatDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
};

function NoteDetailContent() {
  const searchParams = useSearchParams();
  const noteId = searchParams.get("id")?.trim() ?? "";
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(noteId ? "loading" : "missing");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!noteId) {
      setNote(null);
      setLoadState("missing");
      return;
    }

    let cancelled = false;
    setLoadState("loading");
    setErrorMessage("");
    apiRequest<NoteDetail>(`/api/notes/${encodeURIComponent(noteId)}`)
      .then((data) => {
        if (cancelled) return;
        setNote(data);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setNote(null);
        if (error instanceof ClientApiError && error.status === 401) {
          setLoadState("guest");
          return;
        }
        if (error instanceof ClientApiError && error.status === 404) {
          setLoadState("missing");
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "小记暂时加载失败");
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href={note ? `/note/history?date=${note.recordDate}` : "/note/history"}
          className="absolute left-[22px] top-[50px] h-5 w-24 text-[13px] font-semibold leading-[30px] text-[var(--sage)]"
          aria-label="返回我的小记"
        >
          ‹ 返回
        </Link>

        <p className="absolute left-[22px] top-[94px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          {note ? formatDate(note.recordDate) : "我的小记"}
        </p>

        <h1 className="absolute left-[22px] top-[132px] w-[336px] text-[28px] font-semibold leading-[38px]">
          {note ? "这一天写下的小记" : "查看小记"}
        </h1>

        <section
          className="note-scrollbar absolute bottom-[136px] left-[22px] top-[212px] w-[346px] overflow-y-auto rounded-[20px] bg-[var(--card-warm)] px-5 py-7"
          aria-live="polite"
        >
          {loadState === "loading" ? (
            <p className="pt-8 text-center text-xs leading-6 text-[var(--muted)]">正在加载小记…</p>
          ) : null}
          {loadState === "guest" ? (
            <div className="pt-8 text-center text-xs leading-6 text-[var(--body)]">
              请先登录，再查看只属于你的小记。
              <Link href="/me" className="mt-2 block font-semibold text-[var(--sage)]">
                返回登录
              </Link>
            </div>
          ) : null}
          {loadState === "missing" ? (
            <div className="pt-8 text-center text-xs leading-6 text-[var(--body)]">
              没有找到这篇小记。
              <Link href="/note/history" className="mt-2 block font-semibold text-[var(--sage)]">
                返回我的小记
              </Link>
            </div>
          ) : null}
          {loadState === "error" ? (
            <p className="pt-8 text-center text-xs leading-6 text-[var(--body)]">
              {errorMessage || "小记暂时加载失败，请稍后再试。"}
            </p>
          ) : null}
          {loadState === "ready" && note ? (
            <>
              {note.moodName || note.moodIcon ? (
                <div className="mb-5 inline-flex h-8 items-center gap-2 rounded-full bg-[var(--card-sage)] px-4 text-xs font-semibold leading-5 text-[var(--sage)]">
                  <span>{note.moodIcon ? moodIcons[note.moodIcon] ?? note.moodIcon : "•"}</span>
                  {note.moodName ? <span>{note.moodName}</span> : null}
                </div>
              ) : null}

              <p className="whitespace-pre-line text-sm leading-7 text-[var(--body)]">{note.content}</p>

              {note.mediaUrls.length > 0 ? (
                <p className="mt-6 rounded-[14px] bg-[var(--card-sage)] px-4 py-3 text-xs leading-5 text-[var(--sage)]">
                  这篇小记保存了 {note.mediaUrls.length} 个附件。
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        <Image
          src="/quiet-leaf.svg"
          alt=""
          width={125}
          height={115}
          priority
          className="absolute left-64 top-[676px] h-[115px] w-[125px]"
        />

        <Link
          href="/note/history"
          className="absolute inset-x-0 bottom-[48px] z-10 h-5 text-center text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          我的小记 ›
        </Link>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export default function NoteDetailPage() {
  return (
    <Suspense fallback={null}>
      <NoteDetailContent />
    </Suspense>
  );
}
