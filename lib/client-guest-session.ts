"use client";

// Only non-secret handles live in sessionStorage; the credential is HttpOnly.
export type GuestSessionHandle = { ownerId: string; conversationId: string; expiresAt: string };
export type GuestRequestAuthority = { epoch: number; conversationId: string | null };
const HANDLE_KEY = "xinqingGuestSession:v1";
const EPOCH_KEY = "xinqingGuestEpoch:v1";
let epoch = 0;
let handle: GuestSessionHandle | null = null;
let handleLoaded = false;
let bootstrap: Promise<GuestSessionHandle> | null = null;
let listening = false;

export class GuestSessionError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: { reason?: string }) {
    super(message);
    this.name = "GuestSessionError";
  }
}

const sessionStorage = () => {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
};
const isGuestIdentity = () => {
  if (typeof window === "undefined") return false;
  let token: string | null = null;
  try { token = window.localStorage.getItem("xinqingAuthToken"); } catch { /* Cookie remains authoritative. */ }
  try {
    const cookie = typeof document === "undefined" ? null : document.cookie.split("; ")
      .find((item) => item.startsWith("xinqingAuthToken="))?.slice("xinqingAuthToken=".length);
    token ||= cookie ? decodeURIComponent(cookie) : null;
    return !token || token.startsWith("local_demo_");
  } catch { return false; }
};
const changed = () => new GuestSessionError("游客会话已变化，请重新发送。", 409, "CONFLICT", { reason: "GUEST_SESSION_CHANGED" });
const readHandle = () => {
  if (handleLoaded) return handle;
  handleLoaded = true;
  try {
    const value = JSON.parse(sessionStorage()?.getItem(HANDLE_KEY) ?? "null");
    if (value && typeof value.ownerId === "string" && typeof value.conversationId === "string" &&
      typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt))) {
      handle = { ownerId: value.ownerId, conversationId: value.conversationId, expiresAt: value.expiresAt };
    }
  } catch { /* Storage is optional; no credential is reconstructed from it. */ }
  return handle;
};
const forgetHandle = () => {
  handle = null;
  handleLoaded = true;
  try { sessionStorage()?.removeItem(HANDLE_KEY); } catch { /* Memory authority still advances. */ }
};
const rotateAuthority = () => {
  epoch += 1;
  bootstrap = null;
  forgetHandle();
};
const listen = () => {
  if (listening || typeof window === "undefined" || !window.addEventListener) return;
  window.addEventListener("storage", (event) => {
    if (event.key === EPOCH_KEY || event.key === "xinqingAuthToken" || event.key === null) {
      revokeGuestSession("owner", false);
    }
  });
  listening = true;
};

export const captureGuestAuthority = (): GuestRequestAuthority => {
  listen();
  if (readHandle() && Date.parse(readHandle()!.expiresAt) <= Date.now()) rotateAuthority();
  return { epoch, conversationId: readHandle()?.conversationId ?? null };
};
export const isGuestAuthorityCurrent = (authority: GuestRequestAuthority) =>
  authority.epoch === epoch && isGuestIdentity() &&
  (!readHandle() || Date.parse(readHandle()!.expiresAt) > Date.now()) &&
  (!authority.conversationId || authority.conversationId === readHandle()?.conversationId);

const post = async <T>(path: string, body: unknown, method = "POST"): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch {
    throw new GuestSessionError("网络连接失败，请稍后再试", 0, "NETWORK_ERROR");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new GuestSessionError(payload?.error?.message || "服务暂时不可用", response.status,
      payload?.error?.code, payload?.error?.details);
  }
  return payload.data as T;
};

export const revokeGuestSession = (scope: "conversation" | "owner" = "owner", broadcast = true) => {
  const previous = readHandle();
  rotateAuthority();
  if (broadcast && scope === "owner") {
    try { window.localStorage.setItem(EPOCH_KEY, `${Date.now()}:${epoch}`); } catch { /* Best effort cross-tab notification. */ }
  }
  // Target the captured old owner/cid. DELETE deliberately cannot clear a newer cookie.
  if (previous) void post("/api/chat/guest/session", { ...previous, scope }, "DELETE").catch(() => {});
};

const ensureSession = async (authority: GuestRequestAuthority) => {
  if (!isGuestAuthorityCurrent(authority)) throw changed();
  const previous = readHandle();
  if (previous && Date.parse(previous.expiresAt) > Date.now()) return previous;
  if (!bootstrap) {
    const requestEpoch = epoch;
    const pending = post<GuestSessionHandle>("/api/chat/guest/session", {
      ...(previous ? { conversationId: previous.conversationId } : {}),
    }).then((value) => {
      if (requestEpoch !== epoch || !isGuestIdentity()) throw changed();
      if (!value || typeof value.ownerId !== "string" || typeof value.conversationId !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
        throw new GuestSessionError("游客会话暂时不可用", 502, "INVALID_RESPONSE");
      }
      handle = { ownerId: value.ownerId, conversationId: value.conversationId, expiresAt: value.expiresAt };
      try { sessionStorage()?.setItem(HANDLE_KEY, JSON.stringify(handle)); } catch { /* Same-page use remains available. */ }
      return handle;
    });
    bootstrap = pending;
    void pending.finally(() => { if (bootstrap === pending) bootstrap = null; }).catch(() => {});
  }
  const value = await bootstrap;
  if (authority.epoch !== epoch || !isGuestIdentity()) throw changed();
  authority.conversationId = value.conversationId;
  return value;
};

export const requestGuest = async <T>(
  path: "/api/chat/guest" | "/api/chat/guest/greeting",
  body: Record<string, unknown>,
  authority: GuestRequestAuthority,
  retryOfAttempt?: number
): Promise<T> => {
  const originalBody = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  if (retryOfAttempt !== undefined && (!Number.isInteger(retryOfAttempt) || retryOfAttempt < 1 ||
    !isGuestAuthorityCurrent(authority) || !readHandle() || Date.parse(readHandle()!.expiresAt) <= Date.now())) {
    throw changed();
  }
  let session = await ensureSession(authority);
  authority.conversationId = session.conversationId;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!isGuestAuthorityCurrent(authority)) throw changed();
    try {
      const data = await post<T>(path, { ...originalBody, conversationId: session.conversationId,
        ...(retryOfAttempt === undefined ? {} : { retryOfAttempt }) });
      if (!isGuestAuthorityCurrent(authority)) throw changed();
      return data;
    } catch (error) {
      if (!isGuestAuthorityCurrent(authority)) throw changed();
      if (attempt > 0 || retryOfAttempt !== undefined || !(error instanceof GuestSessionError) ||
        error.status !== 401 || error.details?.reason !== "GUEST_SESSION_INVALID") throw error;
      // This server rejection is explicitly before model execution. No network/unknown failure replays.
      rotateAuthority();
      authority.epoch = epoch;
      authority.conversationId = null;
      session = await ensureSession(authority);
      authority.conversationId = session.conversationId;
    }
  }
  throw changed();
};
