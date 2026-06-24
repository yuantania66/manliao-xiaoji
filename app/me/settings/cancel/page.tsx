"use client";

import { useState } from "react";

import { apiRequest } from "@/lib/client-api";
import { clearAuth, getStoredAuth } from "@/lib/client-auth";

import { SettingsShell } from "../settings-shell";

export default function AccountCancelPage() {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmStep, setConfirmStep] = useState<"risk" | "sms">("risk");
  const [cleared, setCleared] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [devCodeHint, setDevCodeHint] = useState("");
  const phone = getStoredAuth()?.user?.phone ?? "";
  const maskedPhone = phone ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "未绑定手机号";
  const needsCode = Boolean(phone);

  const getErrorMessage = (cancelError: unknown) =>
    cancelError instanceof Error ? cancelError.message : "服务暂时不可用，请稍后再试";

  const sendCancelCode = async () => {
    if (!phone || isSendingCode) return;
    setIsSendingCode(true);
    setError("");
    setDevCodeHint("");
    try {
      const data = await apiRequest<{ expiresIn: number; devCode?: string }>("/api/auth/code", {
        method: "POST",
        body: { phone, scene: "cancel_account" },
      });
      setCodeSent(true);
      setVerifyCode("");
      setDevCodeHint(data.devCode ? `开发环境验证码：${data.devCode}` : "验证码已发送");
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
    } finally {
      setIsSendingCode(false);
    }
  };

  const cancelAccount = async () => {
    if (isCancelling) return;
    if (needsCode && !codeSent) {
      setError("请先发送验证码");
      return;
    }
    if (needsCode && verifyCode.length !== 6) {
      setError("请输入 6 位验证码");
      return;
    }

    setIsCancelling(true);
    setError("");
    try {
      await apiRequest<{ cancelled: boolean }>("/api/auth/cancel", {
        method: "POST",
        body: needsCode ? { code: verifyCode } : { confirm: true },
      });
      clearAuth();
      try {
        window.localStorage.clear();
      } catch {
        // Ignore storage failures after the server-side cancellation succeeds.
      }
      setCleared(true);
      setIsConfirming(false);
    } catch (cancelError) {
      setError(getErrorMessage(cancelError));
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <SettingsShell title="账号注销" lead="注销会触发二次验证，确认后所有数据都会被清空。">
      <section className="absolute left-[22px] top-[252px] h-[250px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-5 py-5">
        <h2 className="text-[14px] font-semibold leading-5">注销后会发生什么</h2>
        <div className="mt-5 space-y-4 text-xs leading-5 text-[var(--body)]">
          <p>账号资料、登录状态、云端同步记录会被清空。</p>
          <p>本机小记、聊天记录、心情日历和慢聊小记观察也会被清空。</p>
          <p>点击注销后需要二次验证；验证通过后立即执行清空。</p>
        </div>
      </section>

      <button
        type="button"
        className={
          cleared
            ? "absolute left-[22px] top-[532px] h-[52px] w-[346px] rounded-[20px] bg-[#d8d1c9] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
            : "absolute left-[22px] top-[532px] h-[52px] w-[346px] rounded-[20px] bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
        }
        onClick={() => {
          if (!cleared) {
            setIsConfirming(true);
            setConfirmStep("risk");
            setCodeSent(false);
            setVerifyCode("");
            setError("");
          }
        }}
      >
        {cleared ? "账号与数据已清空" : "注销账号"}
      </button>
      <p className="absolute left-[42px] top-[606px] w-[306px] text-center text-[11px] leading-[18px] text-[var(--muted)]">
        二次验证用于避免误触。确认后不可恢复。
      </p>

      {isConfirming ? (
        <>
          <button
            type="button"
            aria-label="取消注销确认"
            className="absolute inset-0 z-40 bg-[var(--page-bg)]/60"
            onClick={() => setIsConfirming(false)}
          />
          <section
            className={
              confirmStep === "risk"
                ? "absolute left-[22px] top-[304px] z-50 h-[242px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-6 py-6 shadow-[0_18px_50px_rgba(45,41,38,0.12)]"
                : "absolute left-[22px] top-[248px] z-50 h-[346px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-6 py-6 shadow-[0_18px_50px_rgba(45,41,38,0.12)]"
            }
          >
            {confirmStep === "risk" ? (
              <>
                <h2 className="text-lg font-semibold leading-7">确认注销账号？</h2>
                <p className="mt-3 text-xs leading-5 text-[var(--body)]">
                  注销后，账号、聊天、小记、图片视频记录、心情日历和本机缓存都会被清空。
                </p>
                <p className="mt-3 text-xs leading-5 text-[#b9826e]">
                  这些内容清空后不可恢复。下一步会进行手机验证码确认。
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold leading-7">手机验证码确认</h2>
                <p className="mt-3 text-xs leading-5 text-[var(--body)]">
                  {needsCode
                    ? `注销前需要向绑定手机 ${maskedPhone} 发送验证码。验证通过后，将立即清空账号与所有数据。`
                    : "当前账号未绑定手机。确认后，将立即清空账号与所有数据。"}
                </p>
                {needsCode ? (
                  <>
                    <button
                      type="button"
                      className={
                        codeSent
                          ? "mt-5 h-10 w-full rounded-[16px] bg-[#d8d1c9] text-xs font-semibold text-[var(--card-warm)]"
                          : "mt-5 h-10 w-full rounded-[16px] bg-[var(--card-sage)] text-xs font-semibold text-[var(--sage)]"
                      }
                      onClick={sendCancelCode}
                    >
                      {isSendingCode ? "发送中" : codeSent ? "重新发送验证码" : "发送验证码"}
                    </button>
                    <input
                      value={verifyCode}
                      inputMode="numeric"
                      maxLength={6}
                      aria-label="注销验证码"
                      disabled={!codeSent}
                      placeholder="输入 6 位短信验证码"
                      onChange={(event) => {
                        setVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setError("");
                      }}
                      className="mt-4 h-12 w-full rounded-[18px] bg-[var(--page-bg)] px-4 text-center text-lg font-semibold tracking-[0.28em] text-[var(--ink)] outline-none placeholder:text-center placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--muted)] disabled:text-[var(--muted)]"
                    />
                  </>
                ) : null}
                <p
                  className={
                    error
                      ? "mt-2 h-5 text-center text-[11px] leading-5 text-[#b9826e]"
                      : "mt-2 h-5 text-center text-[11px] leading-5 text-[var(--muted)]"
                  }
                >
                  {error ||
                    devCodeHint ||
                    (needsCode ? (codeSent ? "验证码已发送" : "请先发送验证码") : "无需短信验证码")}
                </p>
              </>
            )}
            <button
              type="button"
              className="absolute left-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[var(--page-bg)] text-[13px] font-semibold text-[var(--body)]"
              onClick={() => setIsConfirming(false)}
            >
              先不注销
            </button>
            <button
              type="button"
              className={
                confirmStep === "risk"
                  ? "absolute right-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[#c86f5f] text-[13px] font-semibold text-[var(--card-warm)]"
                  : (!needsCode || (codeSent && verifyCode.length === 6)) && !isCancelling
                  ? "absolute right-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[#c86f5f] text-[13px] font-semibold text-[var(--card-warm)]"
                  : "absolute right-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[#d8d1c9] text-[13px] font-semibold text-[var(--card-warm)]"
              }
              onClick={() => {
                if (confirmStep === "risk") {
                  setConfirmStep("sms");
                  setCodeSent(false);
                  setVerifyCode("");
                  setError("");
                  return;
                }
                cancelAccount();
              }}
            >
              {confirmStep === "risk" ? "下一步" : isCancelling ? "注销中" : "确认注销"}
            </button>
          </section>
        </>
      ) : null}
    </SettingsShell>
  );
}
