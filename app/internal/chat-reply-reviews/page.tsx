"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";
import { AUTH_CHANGED_EVENT, getAuthToken } from "@/lib/client-auth";
import type { ChatReplyEvaluation } from "@/services/ai/chatReplyEvaluation";

const reviewPath = "/api/internal/chat-reply-reviews";
const labels = {
  understanding: "理解",
  responsiveness: "回应",
  boundaries: "边界",
  expression: "表达",
} satisfies Record<keyof ChatReplyEvaluation["scores"], string>;
const dimensions = Object.keys(labels) as Array<keyof typeof labels>;
const buttonStyle = "rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
const completionTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
});
const feedbackLabels: Record<string, string> = {
  HELPFUL: "有帮助",
  UNHELPFUL: "没有帮助",
  OFF_TARGET: "没有答到点上",
  TOO_MECHANICAL: "太机械",
  OVER_ANALYZED: "分析过多",
  UNSAFE: "不安全",
};

type Operation = "preview" | "approve" | "reject" | "approveTraining";
type Access = "checking" | "allowed" | "denied" | "unavailable";
type QueuedTarget = { assistantMessageId: string; reviewVersion: string };
type ReviewTarget = { packet: string } | QueuedTarget;
type PendingReviews = { items: Array<QueuedTarget & { completedAt: string }>; hasMore: boolean };
type PendingState = { status: "loading" | "failed" } | ({ status: "loaded" } & PendingReviews);
type SourceMessage = { id: string; content: string };
type ReviewPreview = {
  assistantMessageId: string;
  evaluation: ChatReplyEvaluation;
  trainingCandidateEligible?: boolean;
  evidence: {
    assistantMessage: SourceMessage;
    userMessage: SourceMessage | null;
    feedback: Array<{ signal: string; comment: string | null; sourceMessage: SourceMessage | null }>;
  };
};

const accessDenied = (cause: unknown) => cause instanceof ClientApiError && (cause.status === 401 || cause.status === 403);

const subscribeToAuth = (notify: () => void) => {
  window.addEventListener(AUTH_CHANGED_EVENT, notify);
  window.addEventListener("storage", notify);
  window.addEventListener("focus", notify);
  window.addEventListener("pageshow", notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    window.removeEventListener(AUTH_CHANGED_EVENT, notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("pageshow", notify);
    document.removeEventListener("visibilitychange", notify);
  };
};

function EvidenceList({ evidence }: { evidence: Array<{ sourceId: string; quote: string }> }) {
  return (
    <ul className="mt-3 space-y-2">
      {evidence.map(({ sourceId, quote }, index) => (
        <li key={index} className="border-l-2 border-[var(--sage)] pl-3">
          <blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere]">{quote}</blockquote>
          <p className="text-xs text-[var(--body)] [overflow-wrap:anywhere]">来源 {sourceId}</p>
        </li>
      ))}
    </ul>
  );
}

function SourceQuote({ message }: { message: SourceMessage }) {
  return <EvidenceList evidence={[{ sourceId: message.id, quote: message.content }]} />;
}

function EvaluationPreview({ preview }: { preview: ReviewPreview }) {
  const { evaluation, evidence } = preview;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section aria-labelledby="evaluation-title" className="space-y-6 border-t border-[var(--line)] pt-6">
      <h2 id="evaluation-title" ref={heading} tabIndex={-1} className="text-xl font-semibold">评价预览</h2>
      <section aria-labelledby="review-context" className="rounded-xl bg-[var(--page-bg)] p-4 text-sm leading-6">
        <h3 id="review-context" className="font-semibold">对话和反馈原文</h3>
        <dl className="mt-3 space-y-4">
          <div>
            <dt className="font-medium">用户当时的消息</dt>
            <dd>{evidence.userMessage ? <SourceQuote message={evidence.userMessage} /> : "没有可用的原始消息。"}</dd>
          </div>
          <div>
            <dt className="font-medium">已发布的助手回复</dt>
            <dd><SourceQuote message={evidence.assistantMessage} /></dd>
          </div>
          <div>
            <dt className="font-medium">用户反馈</dt>
            <dd>
              {evidence.feedback.length === 0 ? "没有关联反馈。" : (
                <ul className="mt-2 space-y-3">
                  {evidence.feedback.map(({ signal, comment, sourceMessage }, index) => (
                    <li key={index}>
                      <p>{feedbackLabels[signal] || "反馈"}</p>
                      {comment && <blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere]">{comment}</blockquote>}
                      {sourceMessage && <SourceQuote message={sourceMessage} />}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        {dimensions.map((dimension) => {
          const { score, reason, evidence } = evaluation.scores[dimension];
          return (
            <div key={dimension} className="rounded-xl border border-[var(--line)] p-4 text-sm leading-6">
              <h3 className="font-semibold">{labels[dimension]} {score} / 5</h3>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{reason}</p>
              <EvidenceList evidence={evidence} />
            </div>
          );
        })}
      </div>
      <section aria-labelledby="review-strengths">
        <h3 id="review-strengths" className="font-semibold">做得好的地方</h3>
        {evaluation.strengths.length === 0 ? <p className="mt-2 text-sm text-[var(--body)]">未记录优点。</p> : (
          <ul className="mt-2 space-y-4 text-sm leading-6">
            {evaluation.strengths.map(({ dimension, observation, evidence }, index) => (
              <li key={index}>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>{labels[dimension]}</strong> {observation}</p>
                <EvidenceList evidence={evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="review-weaknesses">
        <h3 id="review-weaknesses" className="font-semibold">不足和下一步改法</h3>
        {evaluation.weaknesses.length === 0 ? <p className="mt-2 text-sm text-[var(--body)]">未记录不足。</p> : (
          <ul className="mt-2 space-y-4 text-sm leading-6">
            {evaluation.weaknesses.map(({ dimension, observation, evidence, nextAction }, index) => (
              <li key={index}>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>{labels[dimension]}</strong> {observation}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>改法</strong> {nextAction}</p>
                <EvidenceList evidence={evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="review-impact">
        <h3 id="review-impact" className="font-semibold">用户自述的感受或影响</h3>
        {evaluation.reportedImpact.status === "user_reported" ? (
          <EvidenceList evidence={[evaluation.reportedImpact]} />
        ) : (
          <p className="mt-2 text-sm text-[var(--body)]">未知。缺少用户直接说明。</p>
        )}
      </section>
    </section>
  );
}

function ReviewForm({ token }: { token: string }) {
  const [access, setAccess] = useState<Access>("checking");
  const [packet, setPacket] = useState("");
  const [preview, setPreview] = useState<{ target: ReviewTarget; details: ReviewPreview } | null>(null);
  const [pending, setPending] = useState<PendingState>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const active = useRef<AbortController | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);

  const denyAccess = useCallback(() => {
    active.current?.abort();
    active.current = null;
    pendingRequest.current?.abort();
    setAccess("denied");
    setOperation(null);
    setPacket("");
    setPreview(null);
    setPending({ status: "loading" });
    setError("");
    setConfirmation("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ canReview: true }>(reviewPath, { cache: "no-store", signal: controller.signal })
      .then(({ canReview }) => {
        if (!controller.signal.aborted) setAccess(canReview === true && getAuthToken() === token ? "allowed" : "denied");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setAccess(getAuthToken() !== token || accessDenied(cause) ? "denied" : "unavailable");
      });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (access !== "allowed" || getAuthToken() !== token) return;
    const controller = new AbortController();
    pendingRequest.current = controller;
    apiRequest<PendingReviews>(`${reviewPath}?pending=1`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted && getAuthToken() === token) setPending({ ...response, status: "loaded" });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (getAuthToken() !== token || accessDenied(cause)) denyAccess();
        else setPending({ status: "failed" });
      });
    return () => controller.abort();
  }, [access, denyAccess, refresh, token]);

  const refreshPending = () => {
    pendingRequest.current?.abort();
    setPending({ status: "loading" });
    setRefresh((previous) => previous + 1);
  };

  const canSelectTraining = preview && "assistantMessageId" in preview.target && preview.details.trainingCandidateEligible === true;
  const submit = async (next: Operation, target: ReviewTarget) => {
    if (access !== "allowed" || active.current || (next !== "preview" && preview?.target !== target)) return;
    if (next === "approveTraining" && !canSelectTraining) return;
    if (getAuthToken() !== token) return denyAccess();
    const controller = new AbortController();
    active.current = controller;
    setOperation(next);
    setError("");
    setConfirmation("");
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    const options = { method: "POST", cache: "no-store", signal: controller.signal, body: { operation: next, ...target } } as const;
    try {
      if (next === "preview") {
        setPreview(null);
        const response = await apiRequest<ReviewPreview>(reviewPath, options);
        if (isCurrent() && getAuthToken() === token) setPreview({ target, details: response });
      } else {
        const response = await apiRequest<{ decision: "APPROVED" | "REJECTED"; trainingCandidateSelected?: boolean }>(reviewPath, options);
        if (response.decision !== (next === "reject" ? "REJECTED" : "APPROVED") ||
          (next === "approveTraining" && response.trainingCandidateSelected !== true)) throw new Error("复核结果与请求不一致");
        if (isCurrent() && getAuthToken() === token) {
          if ("packet" in target) setPacket("");
          setPreview(null);
          setConfirmation(next === "approveTraining" ? "已通过复核并收录为训练候选。" : response.decision === "APPROVED" ? "已通过复核。" : "已退回评价。");
          refreshPending();
        }
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setPreview(null);
      if (getAuthToken() !== token || accessDenied(cause)) {
        denyAccess();
      } else if ("assistantMessageId" in target) {
        if (cause instanceof ClientApiError && (cause.status === 404 || cause.status === 409)) {
          setError(next === "approveTraining"
            ? "这条评价或授权状态已变化。请从列表重新打开预览。"
            : "这条评价已更新或已处理。请查看新的待复核列表。");
          refreshPending();
        } else {
          setError("暂时无法处理这条评价。请重新打开预览。");
        }
      } else {
        setError(cause instanceof ClientApiError && cause.status === 409
          ? "这份评价的证据已更新。请获取最新审核包。"
          : "暂时无法处理。请检查审核包后重新预览。");
      }
    } finally {
      if (isCurrent()) {
        active.current = null;
        setOperation(null);
        if (getAuthToken() !== token) denyAccess();
      }
    }
  };

  if (access !== "allowed") {
    const message = access === "checking" ? "正在检查复核权限。" :
      access === "denied" ? "请使用具有复核权限的账号登录。" : "暂时无法检查复核权限，请稍后刷新。";
    return <p role="status" className="text-sm text-[var(--body)]">{message}</p>;
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="pending-review-title" className="space-y-3 border-b border-[var(--line)] pb-5">
        <h2 id="pending-review-title" className="text-lg font-semibold">待复核评价</h2>
        {pending.status === "loading" && <p role="status" className="text-sm text-[var(--body)]">正在加载待复核评价。</p>}
        {pending.status === "failed" && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-red-800">暂时无法加载待复核评价。</p>
            <button type="button" onClick={refreshPending} className={`${buttonStyle} bg-[var(--card-sage)]`}>重试</button>
          </div>
        )}
        {pending.status === "loaded" && (pending.items.length === 0 ? (
          <p role="status" className="text-sm text-[var(--body)]">目前没有待复核评价。</p>
        ) : (
          <>
            <ul className="divide-y divide-[var(--line)]">
              {pending.items.map(({ assistantMessageId, reviewVersion, completedAt }) => (
                <li key={assistantMessageId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium [overflow-wrap:anywhere]">回复 {assistantMessageId}</p>
                    <p className="text-[var(--body)]">完成于 <time dateTime={completedAt}>{completionTime.format(new Date(completedAt))}</time></p>
                  </div>
                  <button
                    type="button"
                    aria-label={`预览回复 ${assistantMessageId} 的评价`}
                    disabled={operation !== null}
                    onClick={() => void submit("preview", { assistantMessageId, reviewVersion })}
                    className={`${buttonStyle} bg-[var(--card-sage)]`}
                  >
                    预览
                  </button>
                </li>
              ))}
            </ul>
            {pending.hasMore && <p className="text-sm text-[var(--body)]">处理后会自动补入后续评价。</p>}
          </>
        ))}
      </section>
      <div>
        <label htmlFor="review-packet" className="block text-sm font-semibold">审核包</label>
        <textarea
          id="review-packet"
          value={packet}
          disabled={operation !== null && operation !== "preview"}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          rows={4}
          onChange={(event) => {
            active.current?.abort();
            active.current = null;
            setOperation(null);
            setPacket(event.target.value);
            setPreview(null);
            setError("");
            setConfirmation("");
          }}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--page-bg)] p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      <button
        type="button"
        disabled={!packet.trim() || operation !== null}
        onClick={() => void submit("preview", { packet: packet.trim() })}
        className={`${buttonStyle} bg-[var(--card-sage)]`}
      >
        打开预览
      </button>
      {operation === "preview" && <p role="status" className="text-sm">正在打开评价预览。</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {confirmation && <p role="status" className="text-sm">{confirmation}</p>}
      {preview && (
        <>
          <EvaluationPreview preview={preview.details} />
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={operation !== null} onClick={() => void submit("approve", preview.target)}
              className={`${buttonStyle} bg-[var(--ink)] text-[var(--card-warm)]`}>
              {operation === "approve" ? "正在通过…" : "通过复核"}
            </button>
            {canSelectTraining && (
              <button type="button" disabled={operation !== null} onClick={() => void submit("approveTraining", preview.target)}
                className={`${buttonStyle} bg-[var(--card-sage)]`}>
                {operation === "approveTraining" ? "正在通过并收录…" : "通过并收录为训练候选"}
              </button>
            )}
            <button type="button" disabled={operation !== null} onClick={() => void submit("reject", preview.target)}
              className={`${buttonStyle} border border-[var(--line)] bg-[var(--page-bg)]`}>
              {operation === "reject" ? "正在退回…" : "退回评价"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatReplyReviewsPage() {
  const token = useSyncExternalStore(subscribeToAuth, getAuthToken, () => null);
  return (
    <main className="min-h-svh bg-[var(--page-bg)] px-4 py-8 text-[var(--ink)] sm:px-8">
      <section className="mx-auto max-w-4xl rounded-2xl bg-[var(--card-warm)] p-5 sm:p-8">
        <h1 className="mb-5 text-2xl font-semibold">回复评价人工复核</h1>
        {token ? <ReviewForm key={token} token={token} /> : (
          <p role="status" className="text-sm text-[var(--body)]">请使用具有复核权限的账号登录。</p>
        )}
      </section>
    </main>
  );
}
