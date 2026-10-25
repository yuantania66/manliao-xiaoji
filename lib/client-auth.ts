"use client";

import { revokeGuestSession } from "./client-guest-session";

export type StoredAuthUser = {
  id: string;
  phone: string | null;
  wechatOpenid: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
};

export type StoredAuth = {
  token: string;
  expiresAt?: string;
  user?: StoredAuthUser;
};

const AUTH_TOKEN_KEY = "xinqingAuthToken";
const AUTH_EXPIRES_AT_KEY = "xinqingAuthExpiresAt";
const AUTH_USER_KEY = "xinqingAuthUser";
const LEGACY_LOGGED_IN_KEY = "xinqingLoggedIn";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const AUTH_REVISION_KEY = "xinqingAuthRevision";
let authGeneration = 0;
let listening = false;
let observedIdentity: string | null = null;
let notifiedIdentity: string | null = null;
const authListeners = new Set<() => void>();

const notifyAuthChange = () => {
  authGeneration += 1;
  authListeners.forEach((listener) => listener());
};

const listenForAuthChanges = () => {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || [AUTH_REVISION_KEY, AUTH_TOKEN_KEY, AUTH_EXPIRES_AT_KEY, AUTH_USER_KEY].includes(event.key)) {
      captureAuthAuthority();
      if (notifiedIdentity !== observedIdentity) {
        notifiedIdentity = observedIdentity;
        authListeners.forEach((listener) => listener());
      }
    }
  });
};

export const subscribeAuthChanges = (listener: () => void) => {
  listenForAuthChanges();
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
};

// This is a non-secret publication marker, never an authentication credential.
const publishAuthChange = () => {
  try { safeStorage()?.setItem(AUTH_REVISION_KEY, `${Date.now()}:${Math.random()}`); }
  finally { captureAuthAuthority(); notifiedIdentity = observedIdentity; notifyAuthChange(); }
};

const safeStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  return (
    document.cookie
      .split("; ")
      .find((item) => item.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
};

const setCookieValue = (name: string, value: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;
};

const removeCookieValue = (name: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; SameSite=Lax; Max-Age=0`;
};

export const getAuthToken = () => {
  let storageToken: string | null = null;
  try { storageToken = safeStorage()?.getItem(AUTH_TOKEN_KEY) ?? null; } catch { /* Cookie fallback. */ }
  if (storageToken) return storageToken;

  try {
    const cookieToken = getCookieValue(AUTH_TOKEN_KEY);
    return cookieToken ? decodeURIComponent(cookieToken) : null;
  } catch { return null; }
};

export const getStoredAuth = (): StoredAuth | null => {
  const storage = safeStorage();
  const token = getAuthToken();
  if (!token) return null;

  try {
  const expiresAt =
    storage?.getItem(AUTH_EXPIRES_AT_KEY) ??
    (getCookieValue(AUTH_EXPIRES_AT_KEY)
      ? decodeURIComponent(getCookieValue(AUTH_EXPIRES_AT_KEY)!)
      : undefined);
  const userText = storage?.getItem(AUTH_USER_KEY);

  let user: StoredAuthUser | undefined;
  if (userText) {
    try {
      user = JSON.parse(userText) as StoredAuthUser;
    } catch {
      user = undefined;
    }
  }

  return { token, expiresAt, user };
  } catch { return null; }
};

export type AuthAuthority = {
  generation: number; revision: string | null; token: string | null;
  userId: string | null; expiresAt?: string; readable: boolean;
};

export const captureAuthAuthority = (): AuthAuthority => {
  listenForAuthChanges();
  const auth = getStoredAuth();
  let revision: string | null = null;
  let readable = typeof window !== "undefined";
  try {
    const storage = safeStorage();
    readable = readable && Boolean(storage);
    revision = storage?.getItem(AUTH_REVISION_KEY) ?? null;
    storage?.getItem(AUTH_TOKEN_KEY);
    storage?.getItem(AUTH_USER_KEY);
    storage?.getItem(AUTH_EXPIRES_AT_KEY);
  } catch { readable = false; }
  const identity = JSON.stringify([revision, auth?.token ?? null, auth?.user?.id ?? null, auth?.expiresAt, readable]);
  if (observedIdentity !== null && observedIdentity !== identity) authGeneration += 1;
  observedIdentity = identity;
  return { generation: authGeneration, revision, token: auth?.token ?? null,
    userId: auth?.user?.id ?? null, expiresAt: auth?.expiresAt, readable };
};

export const isAuthIdentityCurrent = (authority: AuthAuthority) => {
  const current = captureAuthAuthority();
  return authority.readable && current.readable && authority.generation === current.generation &&
    authority.revision === current.revision && authority.token === current.token &&
    authority.userId === current.userId && authority.expiresAt === current.expiresAt;
};

export const isAuthAuthorityCurrent = (authority: AuthAuthority) =>
  isAuthIdentityCurrent(authority) && (!authority.expiresAt || Date.parse(authority.expiresAt) > Date.now());

// A failed local cleanup may already have removed part of the old identity.
// Its retry is allowed only within that exact publication, with no new login.
export const isAuthCleanupCurrent = (authority: AuthAuthority) => {
  const current = captureAuthAuthority();
  return authority.readable && current.readable && authority.generation === current.generation &&
    authority.revision === current.revision && (!current.token || current.token === authority.token) &&
    (!current.userId || current.userId === authority.userId);
};

export const createAuthRequestScope = () => {
  let generation = 0;
  return {
    invalidate: () => { generation += 1; },
    begin: () => {
      const request = ++generation;
      let authority = captureAuthAuthority();
      return {
        authority,
        isActive: () => generation === request,
        ownsIdentity: () => generation === request && isAuthIdentityCurrent(authority),
        isCurrent: () => generation === request && isAuthAuthorityCurrent(authority),
        // Called synchronously after this operation's own guarded save/clear.
        acceptPublication: () => { authority = captureAuthAuthority(); },
      };
    },
  };
};

export const updateAuthUser = (authority: AuthAuthority, user: StoredAuthUser) => {
  if (!isAuthAuthorityCurrent(authority) || user.id !== authority.userId) return false;
  safeStorage()?.setItem(AUTH_USER_KEY, JSON.stringify(user));
  return true;
};

export const getCancellationUserSnapshot = () => getStoredAuth()?.user ?? null;

export const saveAuth = ({ token, expiresAt, user }: StoredAuth) => {
  const storage = safeStorage();

  storage?.setItem(AUTH_TOKEN_KEY, token);
  if (expiresAt) storage?.setItem(AUTH_EXPIRES_AT_KEY, expiresAt);
  else storage?.removeItem(AUTH_EXPIRES_AT_KEY);
  if (user) storage?.setItem(AUTH_USER_KEY, JSON.stringify(user));
  else storage?.removeItem(AUTH_USER_KEY);
  storage?.setItem(LEGACY_LOGGED_IN_KEY, "true");

  setCookieValue(AUTH_TOKEN_KEY, token);
  if (expiresAt) setCookieValue(AUTH_EXPIRES_AT_KEY, expiresAt);
  else removeCookieValue(AUTH_EXPIRES_AT_KEY);
  publishAuthChange();
  revokeGuestSession();
};

export const clearAuth = () => {
  const storage = safeStorage();

  storage?.removeItem(AUTH_TOKEN_KEY);
  storage?.removeItem(AUTH_EXPIRES_AT_KEY);
  storage?.removeItem(AUTH_USER_KEY);
  storage?.removeItem(LEGACY_LOGGED_IN_KEY);

  removeCookieValue(AUTH_TOKEN_KEY);
  removeCookieValue(AUTH_EXPIRES_AT_KEY);
  publishAuthChange();
  revokeGuestSession();
};

export const clearCancelledAccount = (userId: string, authority = captureAuthAuthority()) => {
  if (!userId.trim() || typeof window === "undefined") {
    throw new Error("当前账号标识不可用");
  }
  if (authority.userId !== userId || !isAuthCleanupCurrent(authority)) {
    throw new Error("登录状态已变化，请重新确认当前账号");
  }
  try {
  const local = window.localStorage;
  const session = window.sessionStorage;
  const localKeys = [
    AUTH_TOKEN_KEY,
    AUTH_EXPIRES_AT_KEY,
    AUTH_USER_KEY,
    LEGACY_LOGGED_IN_KEY,
    `xinqingInsightsAnalysisAuthorized:${userId}`,
  ];
  const sessionPrefixes = [`xinqingChatCache:${userId}`, `xinqingChatCalendarCache:${userId}:`];
  for (const key of localKeys) local.removeItem(key);
  for (const key of Object.keys(session)) {
    if (sessionPrefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      session.removeItem(key);
    }
  }
  removeCookieValue(AUTH_TOKEN_KEY);
  removeCookieValue(AUTH_EXPIRES_AT_KEY);
  if (localKeys.some((key) => local.getItem(key) !== null)) throw new Error("本机账号数据清理失败");
  if (Object.keys(session).some((key) => sessionPrefixes.some((prefix) => key === prefix || key.startsWith(prefix)))) {
    throw new Error("本机会话缓存清理失败");
  }
  publishAuthChange();
  revokeGuestSession();
  } catch (error) {
    // Only this synchronous cleanup can adopt its own partial removals.
    const remaining = captureAuthAuthority();
    authority.generation = remaining.generation;
    authority.revision = remaining.revision;
    throw error;
  }
};

export const shouldRequestCloudAccountCancellation = (cloudCancelled: boolean) => !cloudCancelled;
