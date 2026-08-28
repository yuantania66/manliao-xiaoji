"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";

type InsightRange = "7d" | "30d" | "90d";
type InsightWord = { word: string; count: number };
type LoadState = "idle" | "loading" | "ready" | "guest" | "error";
type IdentityState = "checking" | "logged" | "guest" | "error";

const ranges: Array<{ key: InsightRange; label: string }> = [
  { key: "7d", label: "最近7天" },
  { key: "30d", label: "最近30天" },
  { key: "90d", label: "最近90天" },
];

const wordToneClasses = [
  "bg-[#ddebf3] text-[#5f8290]",
  "bg-[#f8ecc8] text-[#9b8349]",
  "bg-[#f4e4d3] text-[#b9826e]",
];

export default function InsightsPage() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [consentToken, setConsentToken] = useState("");
  const [userId, setUserId] = useState("");
  const [identityState, setIdentityState] = useState<IdentityState>("checking");
  const [selectedRange, setSelectedRange] = useState<InsightRange>("30d");
  const [words, setWords] = useState<InsightWord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ user: { id: string } }>("/api/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        setUserId(user.id);
        setIsAuthorized(false);
        setIdentityState("logged");
      })
      .catch((error) => {
        if (cancelled) return;
        setUserId("");
        setIsAuthorized(false);
        setIdentityState(
          error instanceof ClientApiError && error.status === 401 ? "guest" : "error"
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthorized || identityState !== "logged") return;

    let cancelled = false;
    setLoadState("loading");
    setErrorMessage("");

    apiRequest<{ user: { id: string } }>("/api/auth/me")
      .then(({ user }) => {
        if (cancelled) return null;
        if (user.id !== userId) {
          setUserId(user.id);
          setIsAuthorized(false);
          setWords([]);
          setLoadState("idle");
          return null;
        }
        return apiRequest<{ words: InsightWord[] }>(
          `/api/insights?range=${selectedRange}`,
          { headers: { "x-insights-consent": consentToken } }
        );
      })
      .then((data) => {
        if (cancelled || !data) return;
        setWords(data.words);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setWords([]);
        if (error instanceof ClientApiError && error.status === 401) {
          setIdentityState("guest");
          setUserId("");
          setIsAuthorized(false);
          setLoadState("guest");
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "观察暂时加载失败");
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [consentToken, identityState, isAuthorized, selectedRange, userId]);

  const authorizeInsights = async () => {
    if (!userId) return;
    const consent = await apiRequest<{ consentToken: string }>("/api/insights", { method: "POST" });
    setConsentToken(consent.consentToken);
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

        {identityState === "checking" ? (
          <p className="absolute left-[22px] top-[180px] w-[346px] text-center text-xs leading-6 text-[var(--muted)]">
            正在确认登录状态…
          </p>
        ) : identityState === "guest" ? (
          <section className="absolute left-[22px] top-[150px] w-[346px] rounded-[20px] bg-[var(--card-warm)] px-6 py-8 text-center">
            <h1 className="text-xl font-semibold leading-8">请先登录</h1>
            <p className="mt-3 text-xs leading-6 text-[var(--body)]">
              登录后才能授权整理只属于你的聊天和小记。
            </p>
            <Link
              href="/me"
              className="mt-6 block h-11 rounded-[22px] bg-[var(--sage)] text-xs font-semibold leading-[44px] text-white"
            >
              返回登录
            </Link>
          </section>
        ) : identityState === "error" ? (
          <section className="absolute left-[22px] top-[150px] w-[346px] rounded-[20px] bg-[var(--card-warm)] px-6 py-8 text-center">
            <h1 className="text-xl font-semibold leading-8">暂时无法加载观察</h1>
            <p className="mt-3 text-xs leading-6 text-[var(--body)]">请稍后再试。</p>
          </section>
        ) : !isAuthorized ? (
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
              颜色仅用于区分词语。
            </p>

            <p className="absolute left-[22px] top-[222px] h-[18px] w-[120px] text-xs font-semibold leading-[18px] text-[var(--sage)]">
              观察范围
            </p>

            <div className="absolute left-[22px] top-[250px] flex h-[34px] items-center gap-3">
              {ranges.map((range) => (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setSelectedRange(range.key)}
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

            <section
              className="absolute left-[22px] top-[318px] grid w-[326px] grid-cols-2 gap-x-[34px] gap-y-4"
              aria-live="polite"
            >
              {loadState === "loading" ? (
                <p className="col-span-2 py-8 text-center text-xs text-[var(--muted)]">正在整理…</p>
              ) : null}
              {loadState === "guest" ? (
                <div className="col-span-2 rounded-[18px] bg-[var(--card-warm)] px-5 py-6 text-center text-xs leading-6 text-[var(--body)]">
                  请先登录，再查看只属于你的观察。
                  <Link href="/me" className="mt-2 block font-semibold text-[var(--sage)]">
                    返回登录
                  </Link>
                </div>
              ) : null}
              {loadState === "error" ? (
                <p className="col-span-2 rounded-[18px] bg-[var(--card-warm)] px-5 py-6 text-center text-xs leading-6 text-[var(--body)]">
                  {errorMessage || "观察暂时加载失败，请稍后再试。"}
                </p>
              ) : null}
              {loadState === "ready" && words.length === 0 ? (
                <p className="col-span-2 rounded-[18px] bg-[var(--card-warm)] px-5 py-6 text-center text-xs leading-6 text-[var(--body)]">
                  这段时间还没有足够的聊天或小记可以整理。
                </p>
              ) : null}
              {loadState === "ready"
                ? words.map((item, index) => (
                    <div
                      key={item.word}
                      className={`flex h-12 w-[146px] items-center justify-between rounded-[15px] px-4 ${wordToneClasses[index % wordToneClasses.length]}`}
                    >
                      <span className="max-w-[82px] truncate text-sm font-semibold leading-[18px] text-[var(--ink)]">
                        {item.word}
                      </span>
                      <span className="text-right text-xs font-normal leading-4">{item.count} 次</span>
                    </div>
                  ))
                : null}
            </section>

            <section className="absolute left-[22px] top-[545px] h-[104px] w-[346px] rounded-[18px] bg-[var(--card-warm)] px-[22px] pt-[22px]">
              <p className="text-sm font-semibold leading-[23px] text-[var(--sage)]">
                “有些词反复出现，
                <br />
                也许只是因为最近它们离你比较近。”
              </p>
              <p className="mt-4 text-[11px] leading-4 text-[var(--body)]">
                可以切换时间范围，看看出现次数有没有变化。
              </p>
            </section>
          </>
        )}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
