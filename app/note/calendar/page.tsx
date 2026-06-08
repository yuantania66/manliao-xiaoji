import Link from "next/link";

const weeks = ["一", "二", "三", "四", "五", "六", "日"];
type Weather = "sun" | "partly" | "cloud" | "rain" | "storm" | "fog" | "rainbow";

const noteDays = new Set([2, 4, 8, 11, 16, 18, 23, 27, 30]);
const weatherDays = new Map<number, Weather>([
  [2, "partly"],
  [4, "sun"],
  [8, "rain"],
  [11, "fog"],
  [16, "cloud"],
  [18, "rainbow"],
  [23, "storm"],
  [27, "partly"],
]);

function MiniWeather({ type }: { type: Weather }) {
  if (type === "sun") {
    return (
      <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="#d6b47b" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((degree) => (
          <line
            key={degree}
            x1="12"
            y1="2.5"
            x2="12"
            y2="5"
            stroke="#d6b47b"
            strokeWidth="1.8"
            strokeLinecap="round"
            transform={`rotate(${degree} 12 12)`}
          />
        ))}
      </svg>
    );
  }

  if (type === "fog") {
    return (
      <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6" aria-hidden="true">
        <path d="M4 8h16M3 12h18M6 16h12" stroke="#a8a19a" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "rainbow") {
    return (
      <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6" aria-hidden="true" fill="none">
        <path d="M4 17a8 8 0 0 1 16 0" stroke="#b9826e" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 17a5 5 0 0 1 10 0" stroke="#d6b47b" strokeWidth="2" strokeLinecap="round" />
        <path d="M10 17a2 2 0 0 1 4 0" stroke="#71877b" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  const cloud = type === "storm" ? "#6e7780" : type === "partly" ? "#71877b" : "#b9c8c6";
  const showSun = type === "partly";
  const showRain = type === "rain" || type === "storm";

  return (
    <svg viewBox="0 0 24 24" className="mx-auto h-6 w-6" aria-hidden="true">
      {showSun ? <circle cx="8" cy="8" r="3" fill="#d6b47b" /> : null}
      <rect x="5" y="11" width="17" height="7" rx="3.5" fill={cloud} />
      <circle cx="12" cy="10" r="5" fill={cloud} />
      <circle cx="7.5" cy="13" r="3.5" fill={cloud} />
      {showRain
        ? [7, 12, 17].map((x) => (
            <line
              key={x}
              x1={x}
              y1="22"
              x2={x + 3}
              y2="19"
              stroke={type === "storm" ? "#d6b47b" : "#7d9ba8"}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ))
        : null}
    </svg>
  );
}

export default function NoteCalendarPage() {
  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <div className="absolute left-5 top-2.5 h-4 w-20 text-[11px] font-semibold leading-4">
          9:41
        </div>
        <Link
          href="/note"
          aria-label="关闭小记日历"
          className="absolute left-[338px] top-[58px] h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
        >
          ×
        </Link>

        <p className="absolute left-[22px] top-[58px] h-[18px] w-[300px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
          我的小记
        </p>
        <h1 className="absolute left-[22px] top-[88px] h-[38px] w-[340px] text-[28px] font-semibold leading-[38px]">
          心情日历
        </h1>
        <p className="absolute left-[22px] top-[140px] h-[22px] w-[344px] text-[13px] leading-[22px] text-[var(--body)]">
          点开有天气的日期，可以回看那天的小记。
        </p>

        <section className="absolute left-[22px] top-[210px] h-[500px] w-[346px] rounded-[20px] bg-[var(--card-warm)]">
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
              const hasNote = noteDays.has(day);
              const weather = weatherDays.get(day);
              const dayCell = (
                <div
                  className={
                    hasNote
                      ? "flex h-[35px] w-8 flex-col items-center justify-start rounded-[9px] bg-[#f7f2ec] text-center"
                      : "flex h-[35px] w-8 flex-col items-center justify-start text-center"
                  }
                >
                  <div className="flex h-5 w-8 items-center justify-center">
                    {weather ? <MiniWeather type={weather} /> : null}
                  </div>
                  <div
                    className={
                      hasNote
                        ? "text-[11px] font-semibold leading-[15px] text-[var(--sage)]"
                        : "text-[11px] leading-[15px] text-[var(--body)]"
                    }
                  >
                    {day}
                  </div>
                </div>
              );

              return (
                <div key={day} className="flex h-[35px] justify-center">
                  {hasNote ? (
                    <Link
                      href={`/note/history?date=2026-06-${String(day).padStart(2, "0")}`}
                      aria-label={`查看 2026 年 6 月 ${day} 日的小记`}
                      className="block"
                    >
                      {dayCell}
                    </Link>
                  ) : (
                    dayCell
                  )}
                </div>
              );
            })}
          </div>

          <p className="absolute left-5 top-[382px] h-[18px] w-[295px] text-xs leading-[18px] text-[var(--muted)]">
            点开有天气的日期，回到那一天的小记。
          </p>

          <div className="absolute left-5 top-[428px] h-12 w-[306px] rounded-[10px] bg-[#f7f2ec] px-5 py-[13px] text-[11px] leading-[17px] text-[var(--body)]">
            有天气标记的日期，代表那天写过小记。
            <br />
            点开日期，可以回到当天慢慢看。
          </div>
        </section>

        <Link
          href="/note"
          className="absolute left-[22px] top-[740px] h-5 w-[180px] text-[13px] font-semibold leading-5 text-[var(--sage)]"
        >
          ‹&nbsp;&nbsp;返回小记
        </Link>

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
