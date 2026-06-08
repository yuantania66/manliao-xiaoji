"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { CalendarDays, Search } from "lucide-react";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

const createReply = (text: string) => {
  if (text.length < 8) {
    return "我在。你可以再多说一点点，也可以就停在这里。";
  }

  return "听起来这件事在你心里停了一会儿。先不用急着整理清楚，我会慢慢陪你把它说完。";
};

const formatChatDate = (date: string) => {
  const [, month, day] = date.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
};

function ChatContent() {
  const searchParams = useSearchParams();
  const date = searchParams.get("date");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextId, setNextId] = useState(1);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();

    if (!text) {
      return;
    }

    const userMessage: Message = { id: nextId, role: "user", text };
    setMessages((current) => [...current, userMessage]);
    setNextId((current) => current + 2);
    setInput("");

    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: nextId + 1,
          role: "assistant",
          text: createReply(text),
        },
      ]);
    }, 500);
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute inset-x-0 top-0 h-[30px] bg-[var(--page-bg)]" />
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4 text-[var(--ink)]">
          9:41
        </div>

        <Link
          href="/"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
          aria-label="返回首页"
        >
          ‹ 返回
        </Link>

        <h1 className="absolute left-[22px] top-[82px] h-[38px] w-[345px] text-[28px] font-semibold leading-[38px]">
          慢慢说。
        </h1>

        {date ? (
          <p className="absolute left-[22px] top-[122px] h-[18px] w-[260px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
            {formatChatDate(date)} 的聊天
          </p>
        ) : null}

        <button
          type="button"
          aria-label="打开聊天菜单"
          aria-expanded={isMenuOpen}
          className="absolute left-[328px] top-[78px] z-[2147483601] h-[22px] w-10 text-center text-lg font-semibold leading-[22px] text-[var(--sage)]"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          ···
        </button>

        {isMenuOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭聊天菜单"
              className="absolute inset-0 z-[2147483599] bg-[var(--page-bg)]/60"
              onClick={() => setIsMenuOpen(false)}
            />
            <div className="absolute left-[174px] top-[108px] z-[2147483600] h-[126px] w-[194px] rounded-2xl bg-[var(--card-warm)]">
              <Link
                href="/chat/calendar"
                className="absolute left-[22px] top-6 flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="进入聊天日历"
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>聊天日历</span>
              </Link>
              <div className="absolute left-5 top-[63px] h-px w-[154px] bg-[var(--line)]" />
              <Link
                href="/chat/search"
                className="absolute left-[22px] top-[82px] flex h-[22px] w-[150px] items-center gap-3 text-left text-sm font-semibold leading-[22px] text-[var(--ink)]"
                aria-label="查找聊天内容"
              >
                <Search className="h-4 w-4 shrink-0 text-[var(--ink)]" strokeWidth={2} />
                <span>查找聊天内容</span>
              </Link>
            </div>
          </>
        ) : null}

        {messages.length === 0 ? (
          <>
            <div className="absolute left-[242px] top-[178px] h-28 w-28 rounded-full bg-[#f4e4d3]" />
            <Image
              src="/quiet-leaf.svg"
              alt=""
              width={125}
              height={115}
              priority
              className="absolute left-[244px] top-[168px] h-[115px] w-[125px]"
            />

            <p className="absolute left-[30px] top-80 h-[66px] w-80 whitespace-pre-line text-xl font-medium leading-[33px] text-[var(--soft-copy)] opacity-80">
              {"不用急。\n想说到哪里，就说到哪里。"}
            </p>
          </>
        ) : (
          <div className="absolute left-[22px] right-[22px] top-[156px] flex max-h-[520px] flex-col gap-[18px] overflow-y-auto pb-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[274px] rounded-[18px] bg-[var(--sage)] px-3.5 py-3 text-[13px] leading-[22px] text-[var(--card-warm)]"
                    : "mr-auto max-w-[306px] rounded-[18px] bg-[var(--card-warm)] px-3.5 py-3 text-[13px] leading-[22px] text-[var(--body)]"
                }
              >
                {message.text}
              </div>
            ))}
          </div>
        )}

        <form
          className="absolute left-[18px] top-[716px] h-[54px] w-[354px] rounded-2xl bg-[var(--card-warm)]"
          onSubmit={handleSubmit}
        >
          <input
            aria-label="聊天输入"
            placeholder="说点什么。"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="absolute left-4 top-[17px] h-5 w-[230px] bg-transparent text-[13px] leading-5 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
          />
          <button
            type="submit"
            className="absolute left-[288px] top-2 h-[38px] w-14 rounded-[14px] bg-[var(--sage)] text-xs font-semibold leading-[18px] text-[var(--card-warm)]"
          >
            发送
          </button>
        </form>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatContent />
    </Suspense>
  );
}
