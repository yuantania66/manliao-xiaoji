"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { apiRequest } from "@/lib/client-api";
import { AUTH_CHANGED_EVENT, getAuthToken } from "@/lib/client-auth";
import { chatReplyTrainingNoticeVersion as noticeVersion } from "@/lib/chat-reply-training-consent";

const path = "/api/settings/training-consent";
const buttonStyle = "mt-3 rounded-xl border border-[var(--line)] px-4 py-2 font-semibold text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2";

type Consent = { enabled: boolean; noticeVersion: string };
type State = { status: "loading" } | { status: "saving" } | { status: "error" } |
  { status: "ready"; consent: Consent; message: string };

const subscribeToAuth = (notify: () => void) => {
  const events = [AUTH_CHANGED_EVENT, "storage", "focus", "pageshow"];
  events.forEach((event) => window.addEventListener(event, notify));
  return () => events.forEach((event) => window.removeEventListener(event, notify));
};

function ConsentControl({ token }: { token: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const active = useRef<AbortController | null>(null);

  const send = useCallback(async (enabled?: boolean) => {
    if (active.current || getAuthToken() !== token) return;
    const controller = new AbortController();
    active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted && getAuthToken() === token;
    try {
      const consent = await apiRequest<Consent>(path, {
        cache: "no-store",
        signal: controller.signal,
        ...(enabled === undefined ? {} : { method: "PUT", body: { enabled, noticeVersion } }),
      });
      if (!isCurrent()) return;
      if (typeof consent?.enabled !== "boolean" || typeof consent.noticeVersion !== "string" ||
        (enabled !== undefined && consent.enabled !== enabled) ||
        (enabled === true && consent.noticeVersion !== noticeVersion)) throw new Error("Invalid training consent response");
      setState({ status: "ready", consent, message: enabled === undefined ? "" : enabled
        ? "已开启授权。" : "已撤回授权，关联候选已清除。" });
    } catch {
      if (isCurrent()) setState({ status: "error" });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, [token]);

  useEffect(() => {
    void send();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [send]);

  if (state.status === "loading" || state.status === "saving") {
    return <p role="status" className="mt-2">{state.status === "loading" ? "正在读取授权状态…" : "正在保存授权…"}</p>;
  }
  if (state.status === "error") {
    return (
      <>
        <p role="alert" className="mt-2">暂时无法确认授权状态。</p>
        <button type="button" className={buttonStyle} onClick={() => {
          setState({ status: "loading" });
          void send();
        }}>重新读取</button>
      </>
    );
  }

  const { consent, message } = state;
  const canGrant = consent.noticeVersion === noticeVersion;
  return (
    <>
      <p role="status" className="mt-2">{message || (consent.enabled ? "已开启授权。" : "未开启授权。")}</p>
      {!canGrant && <p className="mt-1">授权说明已有更新。请使用最新版本开启授权。</p>}
      {(consent.enabled || canGrant) && (
        <button type="button" className={buttonStyle} onClick={() => {
          setState({ status: "saving" });
          void send(!consent.enabled);
        }}>{consent.enabled ? "撤回授权" : "同意收录训练候选"}</button>
      )}
    </>
  );
}

export function TrainingConsent() {
  const token = useSyncExternalStore(subscribeToAuth, getAuthToken, () => null);
  return (
    <section aria-labelledby="training-consent-title" className="mt-6 rounded-xl border border-[var(--line)] p-4">
      <h3 id="training-consent-title" className="font-semibold text-[var(--ink)]">训练候选材料授权</h3>
      <p className="mt-2">单独同意后，审核员可筛选去标识后的回复评价评分和标签，收录为训练候选。聊天正文、反馈原话和身份信息不在授权范围内。</p>
      <p className="mt-2">你可以随时撤回。撤回后会清除关联候选，聊天和其他功能可以照常使用。</p>
      {token ? <ConsentControl key={token} token={token} /> : <p className="mt-2">登录后可以管理这项授权。</p>}
    </section>
  );
}
