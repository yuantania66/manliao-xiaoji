"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiRequest, ClientApiError } from "@/lib/client-api";
import { clearAuth, getStoredAuth, saveAuth } from "@/lib/client-auth";

type ProfileState = "guest" | "logged";

type AuthUser = {
  id: string;
  phone: string | null;
  wechatOpenid: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
};

const collageTiles = [
  { left: -62.14, top: 118, width: 102.516, height: 121.777, rotate: 18, color: "#f4e4d3" },
  { left: 11.73, top: 144, width: 89.358, height: 114.296, rotate: 9, color: "#e8f0ea" },
  { left: 86, top: 170, width: 74, height: 104, rotate: 0, color: "#e4ecf0" },
  { left: 144, top: 106.42, width: 89.358, height: 114.296, rotate: -9, color: "#f1d4c8" },
  { left: 202, top: 121.13, width: 102.516, height: 121.777, rotate: -18, color: "#eef3f0" },
  { left: 260, top: 136.4, width: 113.149, height: 126.26, rotate: -27, color: "#f4e4d3" },
  { left: 318, top: 74.5, width: 120.997, height: 127.634, rotate: -36, color: "#e8f0ea" },
];

const getInitialProfileState = (): ProfileState => {
  if (typeof window === "undefined") {
    return "guest";
  }

  const search = new URLSearchParams(window.location.search);
  if (search.get("state") === "guest") {
    return "guest";
  }

  if (search.get("state") === "logged") {
    return "logged";
  }

  return getStoredAuth()?.token ? "logged" : "guest";
};

export default function MePage() {
  const [profileState, setProfileState] = useState<ProfileState>("guest");
  const [isLoginPanelOpen, setIsLoginPanelOpen] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);
  const [isAgreementPromptOpen, setIsAgreementPromptOpen] = useState(false);
  const [legalPanel, setLegalPanel] = useState<"terms" | "privacy" | null>(null);
  const [loginMode, setLoginMode] = useState<"methods" | "phone" | "wechat">("methods");
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [devCodeHint, setDevCodeHint] = useState("");

  useEffect(() => {
    const storedAuth = getStoredAuth();
    setProfileState(getInitialProfileState());

    if (!storedAuth?.token) {
      setIsAuthChecking(false);
      return;
    }

    let cancelled = false;
    apiRequest<{ user: AuthUser }>("/api/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        saveAuth({ token: storedAuth.token, expiresAt: storedAuth.expiresAt, user });
        setProfileState("logged");
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        setProfileState("guest");
      })
      .finally(() => {
        if (!cancelled) setIsAuthChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isLogged = profileState === "logged";

  const openLoginPanel = () => {
    if (!hasAgreed) {
      setIsAgreementPromptOpen(true);
      return;
    }
    setLoginMode("wechat");
    setPhone("");
    setPhoneCode("");
    setPhoneCodeSent(false);
    setPhoneError("");
    setDevCodeHint("");
    setIsLoginPanelOpen(true);
  };

  const closeLoginPanel = () => {
    setIsLoginPanelOpen(false);
    setPhoneError("");
  };

  const finishLogin = ({
    token,
    expiresAt,
    user,
  }: {
    token: string;
    expiresAt?: string;
    user?: AuthUser;
  }) => {
    if (!hasAgreed) {
      setIsAgreementPromptOpen(true);
      return;
    }
    saveAuth({ token, expiresAt, user });
    setProfileState("logged");
    setIsLoginPanelOpen(false);
  };

  const getErrorMessage = (error: unknown) => {
    if (error instanceof ClientApiError) return error.message;
    if (error instanceof Error) return error.message;
    return "服务暂时不可用，请稍后再试";
  };

  const sendPhoneCode = async () => {
    if (phone.length !== 11) {
      setPhoneError("请输入 11 位手机号码");
      return;
    }

    setIsSendingCode(true);
    setPhoneError("");
    setDevCodeHint("");

    try {
      const data = await apiRequest<{ expiresIn: number; devCode?: string }>("/api/auth/code", {
        method: "POST",
        auth: false,
        body: { phone, scene: "login" },
      });
      setPhoneCodeSent(true);
      setPhoneCode("");
      setDevCodeHint(data.devCode ? `开发环境验证码：${data.devCode}` : "验证码已发送");
    } catch (error) {
      setPhoneError(getErrorMessage(error));
    } finally {
      setIsSendingCode(false);
    }
  };

  const loginWithPhone = async () => {
    if (phone.length !== 11) {
      setPhoneError("请输入 11 位手机号码");
      return;
    }
    if (!phoneCodeSent) {
      setPhoneError("请先获取验证码");
      return;
    }
    if (phoneCode.length !== 6) {
      setPhoneError("请输入 6 位验证码");
      return;
    }

    setIsLoggingIn(true);
    setPhoneError("");

    try {
      const data = await apiRequest<{ user: AuthUser; token: string; expiresAt: string }>(
        "/api/auth/phone",
        {
          method: "POST",
          auth: false,
          body: { phone, code: phoneCode },
        }
      );
      finishLogin(data);
    } catch (error) {
      setPhoneError(getErrorMessage(error));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loginWithWechat = async () => {
    setIsLoggingIn(true);
    setPhoneError("");

    try {
      const data = await apiRequest<{ user: AuthUser; token: string; expiresAt: string }>(
        "/api/auth/wechat",
        {
          method: "POST",
          auth: false,
          body: { code: `web_mock_${Date.now()}` },
        }
      );
      finishLogin(data);
    } catch (error) {
      setPhoneError(getErrorMessage(error));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const agreeAndContinue = () => {
    setHasAgreed(true);
    setIsAgreementPromptOpen(false);
    setLoginMode("wechat");
    setPhone("");
    setPhoneCode("");
    setPhoneCodeSent(false);
    setPhoneError("");
    setDevCodeHint("");
    setIsLoginPanelOpen(true);
  };

  return (
    <main className="min-h-svh bg-[var(--page-bg)] text-[var(--ink)] md:grid md:place-items-center md:p-8">
      <section className="phone-frame relative mx-auto h-svh min-h-[844px] w-full max-w-[390px] overflow-hidden bg-[var(--page-bg)] md:h-[844px] md:rounded-[30px] md:shadow-[0_30px_80px_rgba(45,41,38,0.14)]">
        {collageTiles.map((tile) => (
          <div
            key={`${tile.left}-${tile.top}`}
            className="absolute flex items-center justify-center"
            style={{
              left: tile.left,
              top: tile.top,
              width: tile.width,
              height: tile.height,
            }}
          >
            <div
              className="h-[104px] w-[74px] rounded-[10px] opacity-[0.42]"
              style={{
                backgroundColor: tile.color,
                transform: `rotate(${tile.rotate}deg)`,
              }}
            />
          </div>
        ))}

        <p className="absolute left-[42px] top-[92px] h-[18px] w-20 text-[13px] font-semibold leading-[18px] text-[var(--sage)]">
          慢聊小记
        </p>
        <h1 className="absolute left-[42px] top-32 h-10 w-[300px] text-[30px] font-semibold leading-10">
          {isLogged ? "我的慢聊小记" : "欢迎来到慢聊小记"}
        </h1>
        <p className="absolute left-[42px] top-[178px] h-12 w-[292px] text-sm leading-6 text-[var(--body)]">
          {isAuthChecking
            ? "正在确认登录状态。"
            : isLogged
            ? "你的记录、观察和设置都在这里。"
            : "登录后可同步小记与观察，也可以继续游客模式。"}
        </p>

        <section
          className={
            isLogged
              ? "absolute left-[22px] top-[248px] h-[132px] w-[346px] rounded-[24px] bg-[var(--card-warm)]"
              : "absolute left-[22px] top-[248px] h-[180px] w-[346px] rounded-[24px] bg-[var(--card-warm)]"
          }
        >
          <div className="absolute left-6 top-7 h-[58px] w-[58px] rounded-full bg-[#f4e4d3] text-center text-lg font-semibold leading-[58px] text-[#b9826e]">
            晴
          </div>
          <h2 className="absolute left-[100px] top-[30px] h-[26px] w-[150px] text-lg font-semibold leading-[26px]">
            {isLogged ? "我的慢聊小记" : "游客模式"}
          </h2>
          <p className="absolute left-[100px] top-[60px] h-[18px] w-[190px] text-xs leading-[18px] text-[var(--muted)]">
            {isLogged ? "已连续登录 28 天" : "内容仅保存在本机"}
          </p>
          <Link
            href="/me/settings"
            className="absolute left-[270px] top-[30px] h-8 w-[54px] rounded-2xl bg-[var(--card-sage)] text-xs font-semibold leading-[18px] text-[var(--sage)]"
          >
            <span className="absolute inset-0 flex items-center justify-center">
              设置
            </span>
          </Link>
          {!isLogged ? (
            <>
              <button
                type="button"
                className="absolute left-6 top-[94px] h-[42px] w-[276px] rounded-[21px] bg-[var(--sage)] text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
                onClick={openLoginPanel}
              >
                登录
              </button>
              <div className="absolute left-[30px] top-[148px] flex h-4 w-[286px] items-center text-[10px] leading-4 text-[var(--muted)]">
                <button
                  type="button"
                  aria-label={hasAgreed ? "取消同意协议" : "同意协议"}
                  className="mr-1 h-4 w-4 shrink-0 text-center text-[10px] leading-4 text-[var(--sage)]"
                  onClick={() => setHasAgreed((value) => !value)}
                >
                  {hasAgreed ? "●" : "○"}
                </button>
                <span>我已阅读并同意</span>
                <button
                  type="button"
                  className="mx-0.5 font-semibold text-[var(--sage)]"
                  onClick={() => setLegalPanel("terms")}
                >
                  用户服务协议
                </button>
                <span>、</span>
                <button
                  type="button"
                  className="ml-0.5 font-semibold text-[var(--sage)]"
                  onClick={() => setLegalPanel("privacy")}
                >
                  隐私政策
                </button>
              </div>
            </>
          ) : null}
        </section>

        <Link
          href="/me/insights"
          className={
            isLogged
              ? "absolute left-[22px] top-[430px] h-[104px] w-[346px] rounded-[22px] bg-[var(--card-warm)]"
              : "absolute left-[22px] top-[470px] h-[104px] w-[346px] rounded-[22px] bg-[var(--card-warm)]"
          }
          aria-label="查看慢聊小记观察"
        >
          <h2 className="absolute left-5 top-[26px] h-[26px] w-[250px] text-lg font-semibold leading-[26px]">
            慢聊小记观察
          </h2>
          <p className="absolute left-5 top-[58px] h-[18px] w-[280px] text-xs leading-[18px] text-[var(--body)]">
            从聊天和小记里整理出的主题
          </p>
          <span className="absolute left-[314px] top-[40px] h-[26px] w-5 text-[22px] leading-[26px] text-[var(--muted)]">
            ›
          </span>
        </Link>

        <p className="absolute inset-x-0 top-[628px] h-[34px] whitespace-pre-line text-center text-[11px] leading-[17px] text-[var(--muted)]">
          {"慢聊小记 v2.0.0\n慢慢聊，轻轻记。"}
        </p>

        <nav className="absolute inset-x-0 bottom-0 h-[70px] border-t border-[var(--line)] bg-[var(--card-warm)]">
          <div className="absolute left-[275px] top-[11px] h-[3px] w-9 rounded-sm bg-[var(--sage)]" />
          <div className="grid h-full grid-cols-2 pt-[22px] text-center text-[13px] font-semibold leading-5">
            <Link href="/" className="text-[var(--muted)]" aria-label="返回此刻">
              此刻
            </Link>
            <Link href="/me" className="text-[var(--ink)]" aria-label="我的">
              我的
            </Link>
          </div>
        </nav>

        {isLoginPanelOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭登录方式"
              className="absolute inset-0 z-40 bg-[var(--page-bg)]/60"
              onClick={closeLoginPanel}
            />
            <section
              className={
                loginMode === "phone"
                  ? "absolute inset-x-[22px] bottom-[92px] z-50 h-[322px] rounded-[24px] bg-[var(--card-warm)] shadow-[0_18px_50px_rgba(45,41,38,0.12)]"
                : loginMode === "wechat"
                    ? "absolute inset-x-[22px] bottom-[92px] z-50 h-[258px] rounded-[24px] bg-[var(--card-warm)] shadow-[0_18px_50px_rgba(45,41,38,0.12)]"
                  : "absolute inset-x-[22px] bottom-[92px] z-50 h-[154px] rounded-[24px] bg-[var(--card-warm)] shadow-[0_18px_50px_rgba(45,41,38,0.12)]"
              }
            >
              <h2 className="absolute left-6 top-6 h-[26px] w-[240px] text-lg font-semibold leading-[26px]">
                {loginMode === "phone"
                  ? "手机号码登录"
                  : loginMode === "wechat"
                    ? "微信一键登录"
                    : "选择登录方式"}
              </h2>
              <button
                type="button"
                aria-label="关闭登录方式"
                className="absolute right-5 top-5 h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
                onClick={closeLoginPanel}
              >
                ×
              </button>
              {loginMode === "phone" ? (
                <>
                  <button
                    type="button"
                    className="absolute left-6 top-[52px] h-6 text-xs font-semibold leading-5 text-[var(--sage)]"
                    onClick={() => {
                      setLoginMode("methods");
                      setPhoneError("");
                    }}
                  >
                    ‹ 其他登录方式
                  </button>
                  <div className="absolute left-6 top-[88px] h-12 w-[298px] rounded-[18px] bg-[var(--page-bg)] px-4">
                    <input
                      aria-label="手机号码"
                      className="h-full w-full bg-transparent text-[15px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                      inputMode="numeric"
                      maxLength={11}
                      placeholder="输入手机号码"
                      value={phone}
                      onChange={(event) => {
                        setPhone(event.target.value.replace(/\D/g, "").slice(0, 11));
                        setPhoneError("");
                      }}
                    />
                  </div>
                  <div className="absolute left-6 top-[150px] h-12 w-[298px] rounded-[18px] bg-[var(--page-bg)] px-4">
                    <input
                      aria-label="手机验证码"
                      className="h-full w-[160px] bg-transparent text-[15px] font-semibold tracking-[0.16em] text-[var(--ink)] outline-none placeholder:text-xs placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--muted)] disabled:text-[var(--muted)]"
                      disabled={!phoneCodeSent}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="输入验证码"
                      value={phoneCode}
                      onChange={(event) => {
                        setPhoneCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setPhoneError("");
                      }}
                    />
                    <button
                      type="button"
                      className="absolute right-4 top-0 h-12 text-xs font-semibold text-[var(--sage)] disabled:text-[var(--muted)]"
                      disabled={isSendingCode}
                      onClick={sendPhoneCode}
                    >
                      {isSendingCode ? "发送中" : phoneCodeSent ? "重新获取" : "获取验证码"}
                    </button>
                  </div>
                  <p
                    className={
                      phoneError
                        ? "absolute left-6 top-[210px] h-5 w-[298px] text-center text-[11px] leading-5 text-[#b9826e]"
                        : "absolute left-6 top-[210px] h-5 w-[298px] text-center text-[11px] leading-5 text-[var(--muted)]"
                    }
                  >
                    {phoneError || devCodeHint || "获取验证码后即可登录"}
                  </p>
                  <button
                    type="button"
                    className={
                      phoneCodeSent && phoneCode.length === 6 && !isLoggingIn
                        ? "absolute left-6 bottom-6 h-12 w-[298px] rounded-[18px] bg-[var(--sage)] text-[13px] font-semibold text-[var(--card-warm)]"
                        : "absolute left-6 bottom-6 h-12 w-[298px] rounded-[18px] bg-[#d8d1c9] text-[13px] font-semibold text-[var(--card-warm)]"
                    }
                    disabled={isLoggingIn}
                    onClick={loginWithPhone}
                  >
                    {isLoggingIn ? "登录中" : "登录"}
                  </button>
                </>
              ) : loginMode === "wechat" ? (
                <>
                  <div className="absolute left-6 top-[88px] flex h-14 w-[298px] items-center rounded-[20px] bg-[var(--card-sage)] px-4">
                    <span className="mr-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--sage)] text-base font-semibold text-[var(--card-warm)]">
                      微
                    </span>
                    <span className="text-[13px] font-semibold leading-5 text-[var(--ink)]">
                      使用微信身份登录慢聊小记
                    </span>
                  </div>
                  <p className="absolute left-6 top-[158px] w-[298px] text-xs leading-5 text-[var(--body)]">
                    登录后可同步小记、聊天回看和慢聊小记观察。慢聊小记不会在未获得你确认前公开展示你的内容。
                  </p>
                  <button
                    type="button"
                    className="absolute left-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[var(--page-bg)] text-[13px] font-semibold text-[var(--body)]"
                    onClick={closeLoginPanel}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="absolute right-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[var(--sage)] text-[13px] font-semibold text-[var(--card-warm)] disabled:bg-[#d8d1c9]"
                    disabled={isLoggingIn}
                    onClick={loginWithWechat}
                  >
                    {isLoggingIn ? "登录中" : "允许并登录"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="absolute left-6 top-[82px] h-12 w-[298px] rounded-[18px] bg-[var(--sage)] text-left text-[13px] font-semibold leading-5 text-[var(--card-warm)]"
                    onClick={() => setLoginMode("wechat")}
                  >
                    <span className="absolute left-5 top-3.5 text-base leading-5">
                      ◌
                    </span>
                    <span className="absolute left-[54px] top-3.5">
                      微信一键登录
                    </span>
                  </button>
                </>
              )}
            </section>
          </>
        ) : null}

        {isAgreementPromptOpen ? (
          <>
            <button
              type="button"
              aria-label="关闭协议确认"
              className="absolute inset-0 z-[60] bg-[var(--page-bg)]/60"
              onClick={() => setIsAgreementPromptOpen(false)}
            />
            <section className="absolute left-[22px] top-[304px] z-[70] h-[244px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-6 py-6 shadow-[0_18px_50px_rgba(45,41,38,0.12)]">
              <h2 className="text-lg font-semibold leading-7">请先确认协议</h2>
              <p className="mt-3 text-xs leading-5 text-[var(--body)]">
                登录前需要阅读并同意慢聊小记的用户服务协议和隐私政策。
              </p>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                你可以先查看内容，再决定是否继续登录。
              </p>
              <div className="mt-4 flex gap-3 text-xs font-semibold text-[var(--sage)]">
                <button
                  type="button"
                  aria-label="查看用户服务协议"
                  onClick={() => setLegalPanel("terms")}
                >
                  用户服务协议
                </button>
                <button
                  type="button"
                  aria-label="查看隐私政策"
                  onClick={() => setLegalPanel("privacy")}
                >
                  隐私政策
                </button>
              </div>
              <button
                type="button"
                className="absolute left-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[var(--page-bg)] text-[13px] font-semibold text-[var(--body)]"
                onClick={() => setIsAgreementPromptOpen(false)}
              >
                暂不同意
              </button>
              <button
                type="button"
                className="absolute right-6 bottom-6 h-11 w-[130px] rounded-[18px] bg-[var(--sage)] text-[13px] font-semibold text-[var(--card-warm)]"
                onClick={agreeAndContinue}
              >
                同意并继续
              </button>
            </section>
          </>
        ) : null}

        {legalPanel ? (
          <>
            <button
              type="button"
              aria-label="关闭协议内容"
              className="absolute inset-0 z-[80] bg-[var(--page-bg)]/60"
              onClick={() => setLegalPanel(null)}
            />
            <section className="absolute left-[22px] top-[104px] z-[90] h-[604px] w-[346px] rounded-[24px] bg-[var(--card-warm)] px-6 py-6 shadow-[0_18px_50px_rgba(45,41,38,0.12)]">
              <h2 className="text-lg font-semibold leading-7">
                {legalPanel === "terms" ? "用户服务协议" : "隐私政策"}
              </h2>
              <button
                type="button"
                aria-label="关闭协议内容"
                className="absolute right-5 top-5 h-7 w-7 text-center text-[22px] leading-7 text-[var(--sage)]"
                onClick={() => setLegalPanel(null)}
              >
                ×
              </button>
              <div className="mt-5 h-[468px] overflow-y-auto pr-1 text-xs leading-6 text-[var(--body)] [scrollbar-color:#d8d1c9_transparent] [scrollbar-width:thin]">
                {legalPanel === "terms" ? (
                  <>
                    <p className="font-semibold text-[var(--ink)]">慢聊小记用户服务协议</p>
                    <p className="mt-3">
                      欢迎使用慢聊小记。你在注册、登录或使用慢聊小记前，应当阅读并理解本协议。你点击同意或继续使用，即表示你接受本协议。
                    </p>
                    <p className="mt-3">
                      慢聊小记提供聊天、小记、心情记录、内容回看等服务。你应当以真实、合法、善意的方式使用产品，不得上传违法、侵权、骚扰或危害他人的内容。
                    </p>
                    <p className="mt-3">
                      你保留自己记录内容的权利。为提供保存、展示、同步和回看功能，慢聊小记会在必要范围内处理你主动提交的内容。
                    </p>
                    <p className="mt-3">
                      慢聊小记不面向未成年人提供服务。若你未满十八周岁，请停止注册、登录或使用。
                    </p>
                    <p className="mt-3">
                      如你注销账号，账号资料、登录状态、聊天、小记、心情日历和本机缓存等数据将按产品提示清空，清空后不可恢复。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-[var(--ink)]">慢聊小记隐私政策</p>
                    <p className="mt-3">
                      慢聊小记重视你的隐私。我们仅在实现登录、内容保存、同步、回看、安全维护和反馈处理等必要场景中收集和使用信息。
                    </p>
                    <p className="mt-3">
                      你主动输入的小记、聊天内容、图片视频、心情与日期信息，会用于在产品内展示、保存和生成回看内容。未经你的主动分享或法律法规要求，我们不会公开披露这些内容。
                    </p>
                    <p className="mt-3">
                      使用微信登录时，我们会根据微信小程序规则处理必要的登录标识。
                    </p>
                    <p className="mt-3">
                      你可以查看、更正、删除自己的内容，也可以通过账号注销清空账号及相关数据。游客模式下，内容优先保存在本机。
                    </p>
                    <p className="mt-3">
                      慢聊小记不面向未成年人提供服务。若发现未成年人使用，我们有权停止服务并清除相关数据。
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                className="absolute inset-x-6 bottom-6 h-11 rounded-[18px] bg-[var(--sage)] text-[13px] font-semibold text-[var(--card-warm)]"
                onClick={() => setLegalPanel(null)}
              >
                我知道了
              </button>
            </section>
          </>
        ) : null}

        <div className="absolute bottom-2.5 left-1/2 h-1 w-[100px] -translate-x-1/2 rounded-sm bg-[var(--ink)]" />
      </section>
    </main>
  );
}
