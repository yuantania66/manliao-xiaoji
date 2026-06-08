"use client";

import { useState } from "react";

import { SettingsShell } from "../settings-shell";

const feedbackTypes = ["使用问题", "功能建议", "其他"];

export default function FeedbackPage() {
  const [type, setType] = useState(feedbackTypes[0]);
  const [content, setContent] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const canSubmit = content.trim().length > 0;

  return (
    <SettingsShell title="意见反馈" lead="哪里不顺、哪里想改，都可以慢慢告诉我们。">
      <section className="absolute left-[22px] top-[252px] h-[334px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-5 py-5">
        <p className="text-[13px] font-semibold leading-5">反馈类型</p>
        <div className="mt-3 flex items-center gap-2">
          {feedbackTypes.map((item) => (
            <button
              key={item}
              type="button"
              className={
                type === item
                  ? "h-10 w-auto rounded-[16px] bg-[var(--sage)] px-4 text-center text-xs font-semibold text-[var(--card-warm)]"
                  : "h-10 w-auto rounded-[16px] bg-[var(--card-sage)] px-4 text-center text-xs font-semibold text-[var(--sage)]"
              }
              onClick={() => setType(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="mt-5 text-[13px] font-semibold leading-5">反馈内容</p>
        <textarea
          value={content}
          maxLength={300}
          aria-label="反馈内容"
          placeholder="把想说的写在这里。"
          onChange={(event) => {
            setContent(event.target.value);
            setSubmitted(false);
          }}
          className="note-scrollbar mt-3 h-[146px] w-full resize-none rounded-[18px] bg-[var(--page-bg)] px-4 py-4 text-sm leading-6 text-[var(--body)] outline-none placeholder:text-[var(--muted)]"
        />
        <p className="mt-2 text-right text-[11px] leading-4 text-[var(--muted)]">
          {content.length} / 300
        </p>
      </section>

      <button
        type="button"
        disabled={!canSubmit}
        className={
          canSubmit
            ? "absolute left-[22px] top-[616px] h-[52px] w-[346px] rounded-[20px] bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
            : "absolute left-[22px] top-[616px] h-[52px] w-[346px] rounded-[20px] bg-[#d8d1c9] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
        }
        onClick={() => setSubmitted(true)}
      >
        {submitted ? "已收到，谢谢你" : "提交反馈"}
      </button>
      <p className="absolute left-[42px] top-[690px] w-[306px] text-center text-[11px] leading-[18px] text-[var(--muted)]">
        当前类型：{type}
      </p>
    </SettingsShell>
  );
}
