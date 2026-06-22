"use client";

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
  const storageToken = safeStorage()?.getItem(AUTH_TOKEN_KEY);
  if (storageToken) return storageToken;

  const cookieToken = getCookieValue(AUTH_TOKEN_KEY);
  return cookieToken ? decodeURIComponent(cookieToken) : null;
};

export const getStoredAuth = (): StoredAuth | null => {
  const storage = safeStorage();
  const token = getAuthToken();
  if (!token) return null;

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
};

export const saveAuth = ({ token, expiresAt, user }: StoredAuth) => {
  const storage = safeStorage();

  storage?.setItem(AUTH_TOKEN_KEY, token);
  if (expiresAt) storage?.setItem(AUTH_EXPIRES_AT_KEY, expiresAt);
  if (user) storage?.setItem(AUTH_USER_KEY, JSON.stringify(user));
  storage?.setItem(LEGACY_LOGGED_IN_KEY, "true");

  setCookieValue(AUTH_TOKEN_KEY, token);
  if (expiresAt) setCookieValue(AUTH_EXPIRES_AT_KEY, expiresAt);
};

export const clearAuth = () => {
  const storage = safeStorage();

  storage?.removeItem(AUTH_TOKEN_KEY);
  storage?.removeItem(AUTH_EXPIRES_AT_KEY);
  storage?.removeItem(AUTH_USER_KEY);
  storage?.removeItem(LEGACY_LOGGED_IN_KEY);

  removeCookieValue(AUTH_TOKEN_KEY);
  removeCookieValue(AUTH_EXPIRES_AT_KEY);
};
