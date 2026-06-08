import Link from "next/link";

const weeks = ["一", "二", "三", "四", "五", "六", "日"];
const activeDays = new Set([2, 4, 11, 18, 23, 27]);

function HandHeart() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 36"
      className="absolute left-1/2 top-1/2 h-9 w-10 -translate-x-1/2 -translate-y-1/2"
      fill="none"
    >
      <path
        d="M20 30C12.4 24.4 6 18.8 6 11.7C6 7.4 9.1 4.8 12.9 4.8C15.8 4.8 18.1 6.3 20 8.8C21.9 6.3 24.2 4.8 27.1 4.8C30.9 4.8 34 7.4 34 11.7C34 18.8 27.6 24.4 20 30Z"
        stroke="#d77b70"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ChatCalendarPage() {
  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4">
          9:41
        </div>
        <Link
          href="/chat"
          aria-label="关闭聊天日历"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          聊聊
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[300px] text-[28px] font-semibold leading-[38px]">
          聊天日历
        </h1>
        <p className="absolute left-[22px] top-[136px] h-[22px] w-[340px] text-[13px] leading-[22px] text-[var(--body)]">
          有手写爱心的日子，代表你曾经来这里聊过。
        </p>

        <section className="absolute left-[22px] top-[210px] h-[470px] w-[346px] rounded-[20px] bg-[var(--card-warm)]">
          <div className="absolute left-[20px] top-[27px] h-6 w-[18px] text-[22px] leading-6 text-[var(--muted)]">
            ‹
          </div>
          <div className="absolute left-[80px] top-[27px] h-[22px] w-[168px] text-center text-base font-semibold leading-[22px]">
            2026 年 6 月
          </div>
          <div className="absolute left-[302px] top-[27px] h-6 w-[18px] text-[22px] leading-6 text-[var(--muted)]">
            ›
          </div>

          <div className="absolute left-[26px] top-20 grid w-[286px] grid-cols-7 text-center text-[10px] leading-[14px] text-[var(--muted)]">
            {weeks.map((week) => (
              <span key={week}>{week}</span>
            ))}
          </div>
          <div className="absolute left-[23px] top-[94px] h-px w-[286px] bg-[var(--line)]" />

          <div className="absolute left-5 top-[112px] grid w-[306px] grid-cols-7 gap-y-[17px]">
            {Array.from({ length: 30 }, (_, index) => {
              const day = index + 1;
              const active = activeDays.has(day);
              const dayContent = (
                <div
                  className={
                    active
                      ? "relative h-[35px] w-10 text-[11px] font-semibold leading-[35px] text-[#9e5048]"
                      : "h-[35px] text-[11px] leading-[35px] text-[var(--body)]"
                  }
                >
                  {active ? <HandHeart /> : null}
                  <span className="relative z-10">{day}</span>
                </div>
              );

              return (
                <div
                  key={day}
                  className="flex h-[35px] items-center justify-center text-center"
                >
                  {active ? (
                    <Link
                      href={`/chat?date=2026-06-${String(day).padStart(2, "0")}`}
                      aria-label={`查看 2026 年 6 月 ${day} 日的聊天`}
                      className="block"
                    >
                      {dayContent}
                    </Link>
                  ) : (
                    dayContent
                  )}
                </div>
              );
            })}
          </div>

          <p className="absolute left-5 top-[364px] h-[18px] w-[295px] text-xs leading-[18px] text-[var(--muted)]">
            点开有爱心的日期，回到那一段聊天。
          </p>

          <div className="absolute left-5 top-[410px] h-12 w-[306px] rounded-[10px] bg-[#f7f2ec] px-5 py-[13px] text-[11px] leading-[17px] text-[var(--body)]">
            有手写爱心的日期，代表那天聊过天。
            <br />
            点开日期，可以回到当天慢慢看。
          </div>
        </section>

        <Link
          href="/chat"
          className="absolute left-[22px] top-[690px] h-5 w-[180px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          ‹&nbsp;&nbsp;返回聊天
        </Link>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
