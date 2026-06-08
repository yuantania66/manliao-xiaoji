"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { getNoteEntryByDate } from "@/lib/note-entries";

function DetailMedia({ media }: { media: "images" | "video" | "none" }) {
  if (media === "images") {
    return (
      <div className="mt-6 grid grid-cols-3 gap-2">
        {["#f4e4d3", "#e8f0ea", "#e4ecf0"].map((color, index) => (
          <div
            key={color}
            className="h-[82px] rounded-[14px] text-center text-xs font-semibold leading-[82px]"
            style={{
              backgroundColor: color,
              color: index === 0 ? "#b9826e" : "var(--sage)",
            }}
          >
            图
          </div>
        ))}
      </div>
    );
  }

  if (media === "video") {
    return (
      <div className="mt-6 h-[128px] rounded-[18px] bg-[#e4ecf0]">
        <div className="relative mx-auto top-[42px] h-11 w-11 rounded-full bg-[var(--card-warm)]">
          <div className="absolute left-[18px] top-[13px] h-0 w-0 border-y-[9px] border-l-[14px] border-y-transparent border-l-[var(--sage)]" />
        </div>
        <p className="mt-[54px] text-center text-xs leading-5 text-[var(--body)]">
          视频 · 00:12
        </p>
      </div>
    );
  }

  return null;
}

function NoteDetailContent() {
  const searchParams = useSearchParams();
  const entry = getNoteEntryByDate(searchParams.get("date"));

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4">
          9:41
        </div>

        <Link
          href={`/note/history?date=${entry.dateKey}`}
          className="absolute left-[22px] top-[50px] h-5 w-24 text-[13px] font-semibold leading-[30px] text-[var(--sage)]"
          aria-label="返回我的小记"
        >
          ‹ 返回
        </Link>

        <p className="absolute left-[22px] top-[94px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          {entry.date}
        </p>

        <h1 className="absolute left-[22px] top-[132px] w-[336px] text-[28px] font-semibold leading-[38px]">
          {entry.title}
        </h1>

        <section className="note-scrollbar absolute left-[22px] top-[236px] bottom-[136px] w-[346px] overflow-y-auto rounded-[20px] bg-[var(--card-warm)] px-5 py-7">
          {entry.mood ? (
            <div className="mb-5 inline-flex h-8 items-center gap-2 rounded-full bg-[var(--card-sage)] px-4 text-xs font-semibold leading-5 text-[var(--sage)]">
              <span>☼</span>
              <span>{entry.mood}</span>
            </div>
          ) : null}

          <p className="whitespace-pre-line text-[15px] font-semibold leading-7 text-[var(--ink)]">
            {entry.title}
          </p>
          <p className="mt-5 whitespace-pre-line text-sm leading-7 text-[var(--body)]">
            {entry.body}
          </p>

          <DetailMedia media={entry.media} />
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
