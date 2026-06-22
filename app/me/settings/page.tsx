"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/client-api";
import { clearAuth } from "@/lib/client-auth";

const settingItems = [
  { title: "隐私政策", href: "/me/settings/privacy", copy: "查看数据如何被保存与使用" },
  { title: "账号注销", href: "/me/settings/cancel", copy: "了解注销前需要确认的事项" },
  { title: "意见反馈", href: "/me/settings/feedback", copy: "把问题或建议告诉我们" },
];

export default function SettingsPage() {
  const router = useRouter();

  const logout = async () => {
    try {
      await apiRequest<{ loggedOut: boolean }>("/api/auth/logout", {
        method: "POST",
      });
    } catch {
      // Local auth must be cleared even if the session has already expired.
    } finally {
      clearAuth();
      router.push("/me?state=guest");
    }
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href="/me"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
          aria-label="返回我的"
        >
          ‹ 返回
        </Link>

        <p className="absolute left-[22px] top-[92px] h-[18px] w-[120px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          我的
        </p>
        <h1 className="absolute left-[22px] top-[122px] h-10 w-[300px] text-[30px] font-semibold leading-10">
          设置
        </h1>
        <p className="absolute left-[22px] top-[174px] h-12 w-[330px] text-sm leading-6 text-[var(--body)]">
          这里放着隐私、注销和反馈相关的内容。
        </p>

        <section className="absolute left-[22px] top-[252px] h-[228px] w-[346px] rounded-[24px] bg-[var(--card-warm)]">
          {settingItems.map((item, index) => (
            <Link
              key={item.title}
              href={item.href}
              className="absolute left-5 h-[76px] w-[306px]"
              style={{ top: index * 76 }}
            >
              <span className="absolute left-0 top-[17px] h-5 text-[14px] font-semibold leading-5">
                {item.title}
              </span>
              <span className="absolute left-0 top-[42px] h-[18px] text-[11px] leading-[18px] text-[var(--muted)]">
                {item.copy}
              </span>
              <span className="absolute right-0 top-[25px] h-[26px] w-5 text-[22px] leading-[26px] text-[var(--muted)]">
                ›
              </span>
              {index < settingItems.length - 1 ? (
                <span className="absolute bottom-0 left-0 h-px w-full bg-[var(--line)]" />
              ) : null}
            </Link>
          ))}
        </section>

        <button
          type="button"
          className="absolute left-[22px] top-[512px] h-[52px] w-[346px] rounded-[20px] bg-[var(--card-warm)] text-[13px] font-semibold leading-5 text-[#b9826e]"
          onClick={logout}
        >
          退出登录
        </button>

        <p className="absolute left-1/2 top-[706px] h-[34px] w-[330px] -translate-x-1/2 whitespace-pre-line text-center text-[11px] leading-[17px] text-[var(--muted)]">
          {"新晴 v2.0.0\n慢慢说，也慢慢回看。"}
        </p>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
