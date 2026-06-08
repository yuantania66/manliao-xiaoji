import Link from "next/link";
import { ReactNode } from "react";

export function SettingsShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4">
          9:41
        </div>
        <Link
          href="/me/settings"
          className="absolute left-[22px] top-[50px] h-5 w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]"
          aria-label="返回设置"
        >
          ‹ 返回
        </Link>
        <p className="absolute left-[22px] top-[92px] h-[18px] w-[120px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          设置
        </p>
        <h1 className="absolute left-[22px] top-[122px] h-10 w-[320px] text-[30px] font-semibold leading-10">
          {title}
        </h1>
        <p className="absolute left-[22px] top-[174px] h-12 w-[330px] text-sm leading-6 text-[var(--body)]">
          {lead}
        </p>
        {children}
        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}

export function ToggleRow({
  title,
  copy,
  active,
  onClick,
}: {
  title: string;
  copy: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="relative h-[76px] w-full text-left" onClick={onClick}>
      <span className="absolute left-0 top-[16px] text-[14px] font-semibold leading-5">
        {title}
      </span>
      <span className="absolute left-0 top-[40px] text-[11px] leading-[17px] text-[var(--muted)]">
        {copy}
      </span>
      <span
        className={
          active
            ? "absolute right-0 top-[24px] h-7 w-[48px] rounded-full bg-[var(--sage)]"
            : "absolute right-0 top-[24px] h-7 w-[48px] rounded-full bg-[#d8d1c9]"
        }
      >
        <span
          className={
            active
              ? "absolute right-1 top-1 h-5 w-5 rounded-full bg-[var(--card-warm)]"
              : "absolute left-1 top-1 h-5 w-5 rounded-full bg-[var(--card-warm)]"
          }
        />
      </span>
    </button>
  );
}
