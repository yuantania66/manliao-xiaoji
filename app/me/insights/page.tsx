"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const INSIGHTS_AUTH_KEY = "xinqingInsightsAnalysisAuthorized";

type InsightRange = "7d" | "30d" | "90d";
type InsightSentiment = "positive" | "neutral" | "negative";

const ranges = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "90d", label: "最近90天" },
];

const insightWordsByRange: Record<
  InsightRange,
  Array<{ word: string; count: string; sentiment: InsightSentiment }>
> = {
  "7d": [
    { word: "工作", count: "3 次", sentiment: "positive" },
    { word: "松弛", count: "2 次", sentiment: "positive" },
    { word: "加班", count: "2 次", sentiment: "negative" },
    { word: "想念", count: "1 次", sentiment: "neutral" },
    { word: "散步", count: "1 次", sentiment: "positive" },
    { word: "委屈", count: "1 次", sentiment: "negative" },
  ],
  "30d": [
    { word: "工作", count: "6 次", sentiment: "neutral" },
    { word: "疲惫", count: "5 次", sentiment: "negative" },
    { word: "期待", count: "3 次", sentiment: "positive" },
    { word: "关系", count: "2 次", sentiment: "neutral" },
    { word: "成长", count: "2 次", sentiment: "positive" },
    { word: "焦虑", count: "2 次", sentiment: "negative" },
  ],
  "90d": [
    { word: "调整", count: "11 次", sentiment: "positive" },
    { word: "工作", count: "9 次", sentiment: "negative" },
    { word: "家人", count: "7 次", sentiment: "neutral" },
    { word: "计划", count: "6 次", sentiment: "positive" },
    { word: "边界", count: "5 次", sentiment: "neutral" },
    { word: "自责", count: "4 次", sentiment: "negative" },
  ],
};

const sentimentToneClass: Record<InsightSentiment, string> = {
  positive: "bg-[#ddebf3] text-[#5f8290]",
  neutral: "bg-[#f8ecc8] text-[#9b8349]",
  negative: "bg-[#f4e4d3] text-[#b9826e]",
};

const getStoredInsightsAuthorization = () => {
  try {
    return window.localStorage?.getItem(INSIGHTS_AUTH_KEY) === "true";
  } catch {
    return false;
  }
};

const storeInsightsAuthorization = () => {
  try {
    window.localStorage?.setItem(INSIGHTS_AUTH_KEY, "true");
  } catch {
    // Some embedded browsers disable localStorage; keep the in-page authorization.
  }
};

export default function InsightsPage() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [selectedRange, setSelectedRange] = useState<InsightRange>("30d");

  const insightWords = insightWordsByRange[selectedRange];

  useEffect(() => {
    setIsAuthorized(getStoredInsightsAuthorization());
  }, []);

  const authorizeInsights = () => {
    storeInsightsAuthorization();
    setIsAuthorized(true);
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        <Link
          href="/me"
          className="absolute left-[22px] top-[56px] h-5 w-20 text-[13px] font-semibold leading-5 text-[var(--sage)]"
          aria-label="返回我的"
        >
          ‹ 返回
        </Link>

        {!isAuthorized ? (
          <>
            <p className="absolute left-[22px] top-[100px] h-[18px] w-[120px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
              授权确认
            </p>
            <h1 className="absolute left-[22px] top-[132px] h-[76px] w-[310px] text-[28px] font-semibold leading-[38px]">
              允许慢聊小记整理你的记录吗？
            </h1>
            <div className="absolute left-[22px] top-[228px] w-[322px] text-sm leading-6 text-[var(--body)]">
              <p>慢聊小记观察会从你的聊天和小记里，整理最近常出现的词。</p>
              <p>它只用于回看和自我记录，不做判断，也不做诊断。</p>
            </div>

            <section className="absolute left-[22px] top-[326px] h-[188px] w-[346px] rounded-[18px] bg-[var(--card-warm)] px-[22px] py-[24px]">
              <p className="text-sm font-semibold leading-[22px] text-[var(--sage)]">
                授权后，慢聊小记会使用你的记录生成观察。
              </p>
              <p className="mt-4 text-xs leading-5 text-[var(--body)]">
                你可以先不同意，返回继续聊天或写小记。之后想查看观察时，也可以再来授权。
              </p>
              <p className="mt-4 text-[11px] leading-4 text-[var(--muted)]">
                慢聊小记不会把这些内容作为心理诊断依据。
              </p>
            </section>

            <button
              type="button"
              className="absolute left-[22px] top-[560px] h-[52px] w-[346px] rounded-[26px] bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
              onClick={authorizeInsights}
            >
              同意并查看慢聊小记观察
            </button>

            <Link
              href="/me"
              className="absolute left-[22px] top-[626px] h-[52px] w-[346px] rounded-[26px] bg-[var(--card-warm)] text-center text-[13px] font-semibold leading-[52px] text-[var(--sage)]"
            >
              暂时不授权
            </Link>
          </>
        ) : (
          <>
            <h1 className="absolute left-[22px] top-[100px] h-[38px] w-[300px] text-[28px] font-semibold leading-[38px]">
              慢聊小记观察
            </h1>
            <div className="absolute left-[22px] top-[148px] w-[315px] text-sm leading-6 text-[var(--body)]">
              <p>从聊天和小记里整理出最近常出现的词。</p>
              <p>它不是判断，也不是答案。</p>
            </div>
            <p className="absolute left-[22px] top-[196px] w-[315px] text-[11px] leading-4 text-[var(--muted)]">
              颜色来自记录里的情绪语气，不是词本身。
            </p>

            <p className="absolute left-[22px] top-[222px] h-[18px] w-[120px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
              观察范围
            </p>

            <div className="absolute left-[22px] top-[250px] flex h-[34px] items-center gap-3">
              {ranges.map((range) => (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setSelectedRange(range.key as InsightRange)}
                  className={
                    selectedRange === range.key
                      ? "h-[34px] rounded-[17px] bg-[var(--sage)] px-[23px] text-xs font-semibold leading-4 text-white"
                      : "h-[34px] rounded-[17px] bg-[var(--card-warm)] px-[21px] text-xs font-semibold leading-4 text-[var(--sage)]"
                  }
                  aria-pressed={selectedRange === range.key}
                >
                  {range.label}
                </button>
              ))}
            </div>

            <section className="absolute left-[22px] top-[318px] grid w-[326px] grid-cols-2 gap-x-[34px] gap-y-4">
              {insightWords.map((item) => (
                <div
                  key={item.word}
                  className={`flex h-12 w-[146px] items-center justify-between rounded-[15px] px-4 ${sentimentToneClass[item.sentiment]}`}
                >
                  <span className="text-sm font-semibold leading-[18px] text-[var(--ink)]">
                    {item.word}
                  </span>
                  <span className="text-right text-xs font-normal leading-4">
                    {item.count}
                  </span>
                </div>
              ))}
            </section>

            <section className="absolute left-[22px] top-[545px] h-[104px] w-[346px] rounded-[18px] bg-[var(--card-warm)] px-[22px] pt-[22px]">
              <p className="text-sm font-semibold leading-[23px] text-[var(--sage)]">
                “有些词反复出现，
                <br />
                也许只是因为最近它们离你比较近。”
              </p>
              <p className="mt-4 text-[11px] leading-4 text-[var(--body)]">
                可以切换时间范围，看这些词是慢慢淡了，还是还在身边。
              </p>
            </section>
          </>
        )}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
