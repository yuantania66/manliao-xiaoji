"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/client-api";
import { getStoredAuth, saveAuth } from "@/lib/client-auth";

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
const GUEST_MODE_KEY = "xinqingGuestMode";
const LOCAL_DEMO_TOKEN_PREFIX = "local_demo_";

const formatLocalDate = (date: Date) =>
  `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 星期${
    weekDays[date.getDay()]
  }`;

const homePrompts = [
  {
    title: "今天过得怎么样？",
    lead: "不用急着说清楚。\n先选一个此刻更需要的方式。",
  },
  {
    title: "此刻想靠近哪里？",
    lead: "可以说一会儿，也可以写一点。\n先照顾现在的自己。",
  },
  {
    title: "今天的心情停在哪？",
    lead: "不必马上整理好。\n选一个舒服的方式开始。",
  },
  {
    title: "这一刻需要什么？",
    lead: "想说就慢慢说。\n想留下来，就轻轻记一下。",
  },
];

const chatCopies = [
  "开心也好，难过也好，都可以说说。",
  "有话想放下时，可以慢慢说。",
  "不清楚也没关系，先说一点点。",
  "把此刻交给对话，轻轻开始。",
];

const noteCopies = [
  "留下一点今天的痕迹。",
  "把今天的一小片留住。",
  "写下此刻经过你的事。",
  "给今天放一个温柔标记。",
];

const baseActions = [
  {
    title: "聊聊",
    link: "慢慢说  ›",
    href: "/chat",
    className: "bg-[var(--card-warm)]",
  },
  {
    title: "记一下",
    link: "写一点  ›",
    href: "/note",
    className: "bg-[var(--card-sage)]",
  },
];

type AuthUser = {
  id: string;
  phone: string | null;
  wechatOpenid: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
};

export default function Home() {
  const [todayLabel, setTodayLabel] = useState(formatLocalDate(new Date()));
  const [prompt, setPrompt] = useState(homePrompts[0]);
  const [chatCopy, setChatCopy] = useState(chatCopies[0]);
  const [noteCopy, setNoteCopy] = useState(noteCopies[0]);
  const [needsEntryChoice, setNeedsEntryChoice] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    setTodayLabel(formatLocalDate(new Date()));
    setPrompt(homePrompts[Math.floor(Math.random() * homePrompts.length)]);
    setChatCopy(chatCopies[Math.floor(Math.random() * chatCopies.length)]);
    setNoteCopy(noteCopies[Math.floor(Math.random() * noteCopies.length)]);

    const forceEntryChoice = new URLSearchParams(window.location.search).get("entry") === "1";
    const isLoggedIn = Boolean(getStoredAuth()?.token);
    const isGuestMode = window.sessionStorage.getItem(GUEST_MODE_KEY) === "true";
    setNeedsEntryChoice(forceEntryChoice || (!isLoggedIn && !isGuestMode));
  }, []);

  const enterGuestMode = () => {
    window.sessionStorage.setItem(GUEST_MODE_KEY, "true");
    setNeedsEntryChoice(false);
  };

  const loginDirectly = async () => {
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const data = await apiRequest<{ user: AuthUser; token: string; expiresAt: string }>(
        "/api/auth/wechat",
        {
          method: "POST",
          auth: false,
          body: { code: `web_home_${Date.now()}` },
        }
      );
      saveAuth(data);
      window.sessionStorage.removeItem(GUEST_MODE_KEY);
      setNeedsEntryChoice(false);
    } catch {
      saveAuth({
        token: `${LOCAL_DEMO_TOKEN_PREFIX}${Date.now()}`,
        user: {
          id: "local-demo-user",
          phone: null,
          wechatOpenid: "local_demo",
          nickname: "本地演示用户",
          avatarUrl: null,
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
        },
      });
      window.sessionStorage.setItem(GUEST_MODE_KEY, "true");
      setNeedsEntryChoice(false);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const actions = useMemo(
    () =>
      baseActions.map((action) => ({
        ...action,
        copy: action.href === "/chat" ? chatCopy : noteCopy,
      })),
    [chatCopy, noteCopy],
  );

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute inset-x-0 top-0 h-[30px] bg-[var(--page-bg)]" />

        <div className="px-[22px] pt-[62px]">
          <p className="h-[18px] text-xs leading-[18px] text-[var(--muted)]">
            {todayLabel}
          </p>
          <h1 className="mt-[25px] text-[30px] font-semibold leading-[42px] tracking-normal">
            {prompt.title}
          </h1>
          <p className="mt-[21px] whitespace-pre-line text-sm leading-[25px] text-[var(--body)]">
            {prompt.lead}
          </p>
        </div>

        <Image
          src="/quiet-leaf.svg"
          alt=""
          width={125}
          height={115}
          priority
          className="absolute left-[248px] top-[202px] h-[115px] w-[125px]"
        />

        <div className="absolute left-[22px] right-[22px] top-[328px] space-y-4">
          {actions.map((action) => {
            const content = (
              <>
                <span className="block text-[22px] font-semibold leading-[30px] text-[var(--ink)]">
                  {action.title}
                </span>
                <span className="mt-2.5 block text-[13px] font-normal leading-[22px] text-[var(--body)]">
                  {action.copy}
                </span>
                <span className="mt-[19px] block text-xs font-semibold leading-[18px] text-[var(--sage)]">
                  {action.link}
                </span>
              </>
            );
            const className = `${action.className} block h-[138px] w-full rounded-[18px] px-5 py-[22px] text-left outline-none transition-[filter,opacity] hover:brightness-[0.98]`;

            return action.href ? (
              <Link
                key={action.title}
                href={action.href}
                aria-label={
                  action.href === "/chat" ? "进入聊天界面" : "进入小记界面"
                }
                className={className}
              >
                {content}
              </Link>
            ) : (
              <button key={action.title} type="button" className={className}>
                {content}
              </button>
            );
          })}
        </div>

        <nav className="absolute inset-x-0 bottom-0 h-[70px] border-t border-[var(--line)] bg-[var(--card-warm)]">
          <div className="absolute left-20 top-[11px] h-[3px] w-9 rounded-sm bg-[var(--sage)]" />
          <div className="grid h-full grid-cols-2 pt-[22px] text-center text-[13px] font-semibold leading-5 text-[var(--ink)]">
            <Link href="/" aria-label="此刻">
              此刻
            </Link>
            <Link href="/me" aria-label="进入我的页面">
              我的
            </Link>
          </div>
        </nav>

        {needsEntryChoice ? (
          <div className="absolute inset-0 z-[2147483500] bg-[var(--ink)]/12 px-[22px] pb-[88px] pt-[420px]">
            <div className="rounded-[22px] bg-[var(--card-warm)] px-6 pb-6 pt-7 shadow-[0_24px_70px_rgba(45,41,38,0.16)]">
              <p className="text-xs font-semibold leading-[18px] text-[var(--sage)]">
                新晴
              </p>
              <h2 className="mt-4 text-[24px] font-semibold leading-[34px] text-[var(--ink)]">
                先选择一种方式
              </h2>
              <p className="mt-3 whitespace-pre-line text-[13px] leading-[22px] text-[var(--body)]">
                登录后可以保存聊天和小记。
                {"\n"}也可以先轻轻试用一会儿。
              </p>
              <button
                type="button"
                onClick={loginDirectly}
                disabled={isLoggingIn}
                className="mt-6 flex h-11 w-full items-center justify-center rounded-[15px] bg-[var(--sage)] text-[13px] font-semibold text-[var(--card-warm)] disabled:bg-[#d8d1c9]"
              >
                {isLoggingIn ? "登录中" : "登录"}
              </button>
              {loginError ? (
                <p className="mt-3 text-center text-[11px] leading-[16px] text-[#b9826e]">
                  {loginError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={enterGuestMode}
                className="mx-auto mt-4 block bg-transparent text-xs leading-[18px] text-[var(--muted)]"
              >
                游客模式
              </button>
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
