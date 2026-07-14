"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { H1_REASON_TAGS, type H1PublicCase, type H1ReviewPayload, type H1Selection } from "@/lib/h1-eval/types";

const emptySelection = (item: H1PublicCase, round: 1 | 2): H1Selection => ({
  caseId: item.id,
  round,
  best: null,
  secondBest: null,
  unacceptable: [],
  reasonTags: [],
  note: "",
  willingToContinue: null,
  updatedAt: "",
});

export default function H1ReviewClient() {
  const [payload, setPayload] = useState<H1ReviewPayload | null>(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("正在读取盲选数据…");
  const latestSaveRef = useRef("");

  const load = useCallback(async () => {
    const response = await fetch("/api/debug/h1-review", { cache: "no-store" });
    if (!response.ok) throw new Error("无法读取本地盲选数据");
    const next = await response.json() as H1ReviewPayload;
    setPayload(next);
    setMessage(next.generationStatus === "running" ? "第一轮已完成，正在自动生成第二轮…" : "已自动保存");
  }, []);

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const cases = payload?.publicCases ?? [];
  const current = cases[index] ?? null;
  const round = payload?.activeRound ?? 1;
  const selection = useMemo(() => {
    if (!current) return null;
    return payload?.selections.find((item) => item.round === round && item.caseId === current.id)
      ?? emptySelection(current, round);
  }, [current, payload?.selections, round]);

  useEffect(() => {
    if (index >= cases.length) setIndex(Math.max(0, cases.length - 1));
  }, [cases.length, index]);

  const completed = cases.filter((item) =>
    payload?.selections.some((selectionItem) =>
      selectionItem.round === round && selectionItem.caseId === item.id && selectionItem.best
    )
  ).length;

  const save = async (next: H1Selection) => {
    latestSaveRef.current = next.updatedAt;
    setSaving(true);
    setMessage("保存中…");
    try {
      const response = await fetch("/api/debug/h1-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("保存失败");
      const result = await response.json() as { payload: H1ReviewPayload; roundComplete: boolean };
      if (latestSaveRef.current === next.updatedAt) {
        setPayload(result.payload);
        setMessage(result.roundComplete && round === 1 ? "第一轮完成，正在自动进入第二轮…" : "已自动保存");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const update = (changes: Partial<H1Selection>) => {
    if (!selection) return;
    const next = { ...selection, ...changes, updatedAt: new Date().toISOString() };
    setPayload((previous) => previous ? {
      ...previous,
      selections: [
        ...previous.selections.filter((item) => !(item.round === round && item.caseId === next.caseId)),
        next,
      ],
    } : previous);
    void save(next);
  };

  if (!payload) {
    return <main className="min-h-screen bg-[#f5f1ea] p-6 text-[#282521]">{message}</main>;
  }

  if (!current || !selection) {
    return (
      <main className="min-h-screen bg-[#f5f1ea] px-6 py-16 text-[#282521]">
        <div className="mx-auto max-w-2xl rounded-3xl border border-[#ddd4c8] bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#71877b]">H1 blind review</p>
          <h1 className="mt-3 text-3xl font-semibold">还没有候选数据</h1>
          <p className="mt-4 text-[#6d665f]">先运行 <code className="rounded bg-[#f1ece4] px-2 py-1">npm run experience:h1-candidates</code>。</p>
          {payload.generationMessage ? <p className="mt-3 text-sm text-red-700">{payload.generationMessage}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f1ea] px-4 py-6 text-[#282521] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-[#ddd4c8] bg-[#fffdfa] p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#71877b]">H1 blind review · Round {round}</p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">一次只判断一个 Case</h1>
            <p className="mt-2 text-sm text-[#746d65]">候选来源与生成动作已隐藏。只按你愿不愿意继续聊来选。</p>
          </div>
          <div className="min-w-44">
            <div className="flex items-center justify-between text-sm"><span>进度</span><strong>{completed} / {cases.length}</strong></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e5ded5]"><div className="h-full rounded-full bg-[#71877b] transition-all" style={{ width: `${cases.length ? (completed / cases.length) * 100 : 0}%` }} /></div>
            <p className={`mt-2 text-xs ${saving ? "text-[#9a6b42]" : "text-[#71877b]"}`}>{message}</p>
          </div>
        </header>

        <section className="rounded-3xl border border-[#ddd4c8] bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#71877b]">Case {current.id}</p>
              <p className="mt-3 text-xl leading-relaxed sm:text-2xl">{current.userInput || "（空消息）"}</p>
              <p className="mt-3 text-sm text-[#81796f]">必要上下文：{current.necessaryContext}</p>
            </div>
            <span className="rounded-full bg-[#edf2ed] px-3 py-1 text-xs font-medium text-[#556b5f]">{index + 1} / {cases.length}</span>
          </div>

          <div className="mt-7 grid gap-3">
            {current.candidates.map((candidate) => {
              const selected = selection.best === candidate.label;
              const rejected = selection.unacceptable.includes(candidate.label);
              return (
                <article key={candidate.label} className={`rounded-2xl border p-4 transition ${selected ? "border-[#71877b] bg-[#edf3ee] ring-2 ring-[#71877b]/20" : rejected ? "border-[#d8b9ad] bg-[#fff7f4]" : "border-[#e3ddd4] bg-[#fffdfa] hover:border-[#b9c5bd]"}`}>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => update({ best: candidate.label, unacceptable: selection.unacceptable.filter((label) => label !== candidate.label) })} className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${selected ? "border-[#71877b] bg-[#71877b] text-white" : "border-[#cfc7bd] bg-white"}`} aria-label={`选择候选 ${candidate.label} 为最优`}>{candidate.label}</button>
                    <button type="button" onClick={() => update({ best: candidate.label, unacceptable: selection.unacceptable.filter((label) => label !== candidate.label) })} className="flex-1 text-left text-base leading-7 sm:text-lg">{candidate.text}</button>
                    <label className="flex shrink-0 items-start gap-2 text-xs text-[#81796f]">
                      <input type="checkbox" checked={rejected} onChange={(event) => update({ best: event.target.checked && selection.best === candidate.label ? null : selection.best, secondBest: event.target.checked && selection.secondBest === candidate.label ? null : selection.secondBest, unacceptable: event.target.checked ? [...selection.unacceptable, candidate.label] : selection.unacceptable.filter((label) => label !== candidate.label) })} className="mt-1" />
                      不可接受
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          <button type="button" onClick={() => update({ best: "all_unacceptable", secondBest: null, unacceptable: current.candidates.map((candidate) => candidate.label) })} className={`mt-4 w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition ${selection.best === "all_unacceptable" ? "border-[#9d5749] bg-[#fff0eb] text-[#8a4033]" : "border-[#d9d1c8] bg-white text-[#6f665e] hover:bg-[#faf6f0]"}`}>全部不行</button>

          <div className="mt-7 grid gap-6 border-t border-[#e7e0d8] pt-6 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">次优（可选）</label>
              <select value={selection.secondBest ?? ""} onChange={(event) => update({ secondBest: event.target.value || null })} className="mt-2 w-full rounded-xl border border-[#d9d1c8] bg-white px-3 py-2.5">
                <option value="">未选择</option>
                {current.candidates.filter((candidate) => candidate.label !== selection.best).map((candidate) => <option key={candidate.label} value={candidate.label}>{candidate.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-sm font-semibold">是否愿意继续聊</p>
              <div className="mt-2 flex gap-2">
                {[{ label: "是", value: true }, { label: "否", value: false }].map((option) => <button key={option.label} type="button" onClick={() => update({ willingToContinue: option.value })} className={`flex-1 rounded-xl border px-4 py-2.5 text-sm ${selection.willingToContinue === option.value ? "border-[#71877b] bg-[#edf3ee] font-semibold" : "border-[#d9d1c8] bg-white"}`}>{option.label}</button>)}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold">原因标签（可选）</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {H1_REASON_TAGS.map((tag) => {
                const active = selection.reasonTags.includes(tag);
                return <button key={tag} type="button" onClick={() => update({ reasonTags: active ? selection.reasonTags.filter((value) => value !== tag) : [...selection.reasonTags, tag] })} className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-[#71877b] bg-[#71877b] text-white" : "border-[#d9d1c8] bg-white text-[#6f665e]"}`}>{tag}</button>;
              })}
            </div>
          </div>

          <div className="mt-6">
            <label className="text-sm font-semibold" htmlFor="review-note">简短原因（可选）</label>
            <textarea key={`${round}-${current.id}`} id="review-note" defaultValue={selection.note} onBlur={(event) => update({ note: event.target.value })} rows={3} className="mt-2 w-full resize-y rounded-xl border border-[#d9d1c8] bg-white px-3 py-2.5" placeholder="只写判断依据，不需要提供理想回复。" />
          </div>
        </section>

        <nav className="mt-5 flex items-center justify-between gap-3">
          <button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} className="rounded-xl border border-[#d6cec4] bg-white px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">上一个</button>
          <button type="button" disabled={index === cases.length - 1} onClick={() => setIndex((value) => Math.min(cases.length - 1, value + 1))} className="rounded-xl bg-[#2f3e37] px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">下一个</button>
        </nav>
      </div>
    </main>
  );
}
