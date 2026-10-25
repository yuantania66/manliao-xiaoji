import { createHash, randomBytes as secureRandomBytes } from "node:crypto";

import { AppError } from "./errors";

// Process-local anonymous capability registry. It intentionally has no Auth or DB dependency.
export const GUEST_SESSION_DEFAULTS = {
  ttlMs: 24 * 60 * 60 * 1000,
  payloadTtlMs: 10 * 60 * 1000,
  maxOwners: 1000,
  maxConversations: 4000,
  maxConversationsPerOwner: 16,
  maxAttempts: 10000,
  maxAttemptsPerConversation: 128,
  maxPending: 32,
  maxPendingPerOwner: 4,
  maxPayloads: 1000,
  maxPayloadBytes: 128 * 1024,
  maxTotalPayloadBytes: 16 * 1024 * 1024,
  maxInputBytes: 128 * 1024,
  maxRateKeys: 4000,
  issuanceIpDailyLimit: 60,
  ipDailyLimit: 20,
  greetingOwnerDailyLimit: 3,
};

type Limits = typeof GUEST_SESSION_DEFAULTS;
type Transport = "web" | "mini";
type Payload = Record<string, unknown> & { guestAttempt: number };
type Attempt = {
  state: "pending" | "complete" | "expired" | "unknown";
  promise?: Promise<Payload>;
  payload?: Payload;
  payloadUntil?: number;
  bytes: number;
  retryable: boolean;
};
type Turn = { digest: string; attempts: Map<number, Attempt> };
type Conversation = { turns: Map<string, Turn> };
type Owner = {
  id: string;
  hash: string;
  transport: Transport;
  expiresAt: number;
  conversations: Map<string, Conversation>;
  greetingDate?: string;
  greetings: number;
};
export type GuestAuthority = {
  ownerId: string;
  conversationId: string;
  expiresAt: number;
  ownerHash: string;
};
type Rate = { date: string; executions: number; issuances: number };

const invalid = () => new AppError("UNAUTHORIZED", "游客连接已失效，请重新连接", 401, { reason: "GUEST_SESSION_INVALID" });
const conflict = () => new AppError("CONFLICT", "该请求与先前请求不一致", 409, { reason: "GUEST_REQUEST_CONFLICT" });
const expired = () => new AppError("CONFLICT", "此回复已过期，请保留本机记录", 410, { reason: "GUEST_RESULT_EXPIRED" });
const unknown = () => new AppError("CONFLICT", "此请求结果未知，请勿自动重发", 503, { reason: "GUEST_EXECUTION_UNKNOWN" });
const capacity = () => new AppError("RATE_LIMITED", "游客连接暂时繁忙，请稍后再试", 429, { reason: "GUEST_CAPACITY" });
const rateLimited = () => new AppError("RATE_LIMITED", "今天的游客体验次数已用完", 429, { reason: "RATE_LIMITED" });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const dateKey = (now: number) => new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const credentialPattern = /^[a-f0-9]{64}$/;
const conversationPattern = /^gc_[a-f0-9]{32}$/;
const turnPattern = /^[a-zA-Z0-9:_-]{8,160}$/;

export const guestCookieName = () => process.env.NODE_ENV === "production" ? "__Host-manliao-guest" : "manliao-guest";
export const guestNoStore = <T extends Response>(response: T): T => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export const readGuestJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body as Record<string, unknown>;
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON 对象", 400);
  }
};

// Cookie owners are never exchangeable for JavaScript-readable Mini credentials.
const transportCredential = (request: Request) => {
  const transportHeader = request.headers.get("x-guest-transport");
  const credentialHeader = request.headers.get("x-guest-credential");
  const cookie = request.headers.get("cookie") ?? "";
  if (transportHeader === "mini") {
    if (cookie.trim()) throw invalid();
    return { transport: "mini" as const, credential: credentialHeader ?? "" };
  }
  if (transportHeader !== null || credentialHeader !== null) throw invalid();
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw invalid();
  const origin = request.headers.get("origin");
  if (origin ? origin !== new URL(request.url).origin : request.headers.get("sec-fetch-site") !== "same-origin") throw invalid();
  const entries = cookie.split(";").map((part) => part.trim().split("="));
  const guestCookies = entries.filter(([name]) => name === "manliao-guest" || name === "__Host-manliao-guest");
  if (guestCookies.length > 1 || (guestCookies.length === 1 && guestCookies[0][0] !== guestCookieName())) throw invalid();
  return { transport: "web" as const, credential: guestCookies[0]?.[1] ?? "" };
};

const limitsFromEnvironment = (): Limits => {
  const limits = { ...GUEST_SESSION_DEFAULTS };
  for (const key of Object.keys(limits) as (keyof Limits)[]) {
    const envKey = key === "ipDailyLimit" ? "GUEST_AI_IP_DAILY_LIMIT" : `GUEST_SESSION_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    const value = process.env[envKey];
    if (value === undefined) continue;
    const number = Number(value);
    // Overrides can reduce retention, and cannot silently remove a hard bound.
    if (!Number.isSafeInteger(number) || number <= 0 || number > GUEST_SESSION_DEFAULTS[key] * (key.endsWith("Ms") ? 1 : 100)) throw capacity();
    limits[key] = number;
  }
  limits.payloadTtlMs = Math.min(limits.payloadTtlMs, limits.ttlMs);
  return limits;
};

export function createGuestSessionManager(options: {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
  limits?: Partial<Limits>;
  trustProxy?: boolean;
  scheduleCleanup?: (callback: () => void, delayMs: number) => () => void;
} = {}) {
  const now = options.now ?? Date.now;
  const random = options.randomBytes ?? secureRandomBytes;
  const limits = { ...limitsFromEnvironment(), ...options.limits };
  const owners = new Map<string, Owner>();
  const rates = new Map<string, Rate>();
  let pendingTotal = 0;
  const pendingByOwner = new Map<Owner, number>();
  const scheduleCleanup = options.scheduleCleanup ?? ((callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  });
  let cancelCleanup: (() => void) | undefined;
  const newId = (bytes: number) => {
    const result = random(bytes);
    if (result.length !== bytes) throw capacity();
    return Buffer.from(result).toString("hex");
  };
  const discardConversation = (conversation: Conversation) => {
    for (const turn of conversation.turns.values()) for (const attempt of turn.attempts.values()) {
      attempt.payload = undefined;
      attempt.bytes = 0;
      if (attempt.state === "complete") attempt.state = "expired";
    }
    conversation.turns.clear();
  };
  const discardOwner = (owner: Owner) => {
    for (const conversation of owner.conversations.values()) discardConversation(conversation);
    owner.conversations.clear();
    owners.delete(owner.hash);
  };
  const sweep = () => {
    const time = now();
    for (const owner of owners.values()) {
      if (owner.expiresAt <= time) { discardOwner(owner); continue; }
      for (const conversation of owner.conversations.values()) for (const turn of conversation.turns.values()) for (const attempt of turn.attempts.values()) {
        if (attempt.state === "complete" && (attempt.payloadUntil ?? 0) <= time) {
          attempt.state = "expired";
          attempt.payload = undefined;
          attempt.bytes = 0;
        }
      }
    }
    const day = dateKey(time);
    for (const [key, rate] of rates) if (rate.date !== day) rates.delete(key);
  };
  const armCleanup = () => {
    cancelCleanup?.();
    let deadline = rates.size ? (Math.floor((now() + 8 * 60 * 60 * 1000) / 86400000) + 1) * 86400000 - 8 * 60 * 60 * 1000 : Infinity;
    for (const owner of owners.values()) {
      deadline = Math.min(deadline, owner.expiresAt);
      for (const c of owner.conversations.values()) for (const t of c.turns.values()) for (const a of t.attempts.values()) {
        if (a.payloadUntil !== undefined && a.state === "complete") deadline = Math.min(deadline, a.payloadUntil);
      }
    }
    cancelCleanup = Number.isFinite(deadline) ? scheduleCleanup(() => { sweep(); armCleanup(); }, Math.max(1, deadline - now())) : undefined;
  };
  const counts = () => {
    let conversations = 0, attempts = 0, pending = 0, payloads = 0, bytes = 0;
    for (const owner of owners.values()) {
      conversations += owner.conversations.size;
      for (const conversation of owner.conversations.values()) for (const turn of conversation.turns.values()) for (const attempt of turn.attempts.values()) {
        attempts++;
        if (attempt.state === "pending") pending++;
        if (attempt.payload) payloads++;
        bytes += attempt.bytes;
      }
    }
    return { conversations, attempts, pending, payloads, bytes };
  };
  const rateFor = (request: Request) => {
    const trustProxy = options.trustProxy ?? process.env.GUEST_TRUST_PROXY === "true";
    const ip = trustProxy ? (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 128) : "unknown";
    const key = hash(ip);
    let rate = rates.get(key);
    if (!rate) {
      if (rates.size >= limits.maxRateKeys) throw capacity();
      rate = { date: dateKey(now()), executions: 0, issuances: 0 };
      rates.set(key, rate);
    }
    return rate;
  };
  const findOwner = (request: Request) => {
    sweep();
    const input = transportCredential(request);
    const owner = credentialPattern.test(input.credential) ? owners.get(hash(input.credential)) : undefined;
    if (owner && owner.transport !== input.transport) throw invalid();
    return { ...input, owner };
  };
  const active = (authority: GuestAuthority) => {
    const owner = owners.get(authority.ownerHash);
    if (!owner || owner.id !== authority.ownerId || owner.expiresAt <= now() || !owner.conversations.has(authority.conversationId)) throw invalid();
    return owner;
  };
  const bootstrap = (request: Request, body: Record<string, unknown>) => {
    const input = findOwner(request);
    if (body.newConversation !== undefined && typeof body.newConversation !== "boolean") throw conflict();
    if (body.conversationId !== undefined && (typeof body.conversationId !== "string" || !conversationPattern.test(body.conversationId))) throw conflict();
    let owner = input.owner;
    let credential = input.credential;
    let issued = false;
    if (!owner) {
      if (owners.size >= limits.maxOwners || counts().conversations >= limits.maxConversations) throw capacity();
      const rate = rateFor(request);
      if (rate.issuances >= limits.issuanceIpDailyLimit) throw rateLimited();
      credential = newId(32);
      const ownerHash = hash(credential);
      if (owners.has(ownerHash)) throw capacity();
      owner = { id: `go_${newId(16)}`, hash: ownerHash, transport: input.transport, expiresAt: now() + limits.ttlMs, conversations: new Map(), greetings: 0 };
      owners.set(ownerHash, owner);
      rate.issuances++;
      issued = true;
    }
    let conversationId = typeof body.conversationId === "string" && !issued && body.newConversation !== true ? body.conversationId : undefined;
    if (conversationId && !owner.conversations.has(conversationId)) throw invalid();
    if (!conversationId) {
      if (owner.conversations.size >= limits.maxConversationsPerOwner || counts().conversations >= limits.maxConversations) throw capacity();
      conversationId = `gc_${newId(16)}`;
      if (owner.conversations.has(conversationId)) throw capacity();
      owner.conversations.set(conversationId, { turns: new Map() });
    }
    armCleanup();
    return {
      data: { ownerId: owner.id, conversationId, expiresAt: new Date(owner.expiresAt).toISOString(), ...(input.transport === "mini" ? { credential } : {}) },
      cookieCredential: input.transport === "web" && issued ? credential : undefined,
      maxAge: Math.max(0, Math.floor((owner.expiresAt - now()) / 1000)),
    };
  };
  const authorize = (request: Request, conversationId: unknown): GuestAuthority => {
    const { owner } = findOwner(request);
    if (!owner || typeof conversationId !== "string" || !owner.conversations.has(conversationId)) throw invalid();
    return { ownerId: owner.id, ownerHash: owner.hash, conversationId, expiresAt: owner.expiresAt };
  };
  const revoke = (request: Request, body: Record<string, unknown>) => {
    const authority = authorize(request, body.conversationId);
    if (body.ownerId !== authority.ownerId) throw invalid();
    const owner = active(authority);
    if (body.scope === "owner") discardOwner(owner);
    else if (body.scope === "conversation") {
      discardConversation(owner.conversations.get(authority.conversationId)!);
      owner.conversations.delete(authority.conversationId);
    }
    else throw conflict();
    armCleanup();
    return { revoked: true };
  };
  const execute = async (input: {
    request: Request;
    authority: GuestAuthority;
    endpoint: "reply" | "greeting";
    turnId: unknown;
    retryOfAttempt?: unknown;
    inputs: Record<string, unknown>;
  }, generate: (attempt: number) => Promise<Record<string, unknown>>): Promise<Payload> => {
    sweep();
    const owner = active(input.authority);
    if (typeof input.turnId !== "string" || !turnPattern.test(input.turnId)) throw conflict();
    if (input.retryOfAttempt !== undefined && (!Number.isSafeInteger(input.retryOfAttempt) || Number(input.retryOfAttempt) < 1)) throw conflict();
    const serialized = JSON.stringify(input.inputs);
    if (Buffer.byteLength(serialized) > limits.maxInputBytes) throw capacity();
    const digest = hash(serialized);
    const conversation = owner.conversations.get(input.authority.conversationId)!;
    const key = `${input.endpoint}:${input.turnId}`;
    const turn = conversation.turns.get(key);
    if (turn && turn.digest !== digest) throw conflict();
    const attemptNumber = input.retryOfAttempt === undefined ? 1 : Number(input.retryOfAttempt) + 1;
    const existing = turn?.attempts.get(attemptNumber);
    const deliver = (attempt: Attempt): Promise<Payload> | Payload => {
      active(input.authority);
      if (attempt.state === "pending") return attempt.promise!;
      if (attempt.state === "expired") throw expired();
      if (attempt.state === "unknown") throw unknown();
      return attempt.payload!;
    };
    if (existing) return deliver(existing);
    if (input.retryOfAttempt !== undefined) {
      const prior = turn?.attempts.get(Number(input.retryOfAttempt));
      if (prior?.state === "expired") throw expired();
      if (prior?.state === "unknown") throw unknown();
      if (!prior || prior.state !== "complete" || !prior.retryable) throw conflict();
    }
    const total = counts();
    const ownerPending = pendingByOwner.get(owner) ?? 0;
    let conversationAttempts = 0;
    for (const t of conversation.turns.values()) conversationAttempts += t.attempts.size;
    if (total.attempts >= limits.maxAttempts || conversationAttempts >= limits.maxAttemptsPerConversation || pendingTotal >= limits.maxPending || ownerPending >= limits.maxPendingPerOwner || pendingTotal + total.payloads >= limits.maxPayloads) throw capacity();
    const rate = rateFor(input.request);
    const day = dateKey(now());
    if (owner.greetingDate !== day) { owner.greetingDate = day; owner.greetings = 0; }
    if (rate.executions >= limits.ipDailyLimit || (input.endpoint === "greeting" && owner.greetings >= limits.greetingOwnerDailyLimit)) throw rateLimited();
    // No await between admission, reservation, and publishing the pending attempt.
    rate.executions++;
    if (input.endpoint === "greeting") owner.greetings++;
    const record = turn ?? { digest, attempts: new Map<number, Attempt>() };
    const attempt: Attempt = { state: "pending", bytes: 0, retryable: false };
    record.attempts.set(attemptNumber, attempt);
    conversation.turns.set(key, record);
    pendingTotal++;
    pendingByOwner.set(owner, ownerPending + 1);
    attempt.promise = Promise.resolve().then(async () => {
      let started = false;
      try {
        active(input.authority);
        started = true;
        const result = await generate(attemptNumber);
        active(input.authority);
        sweep();
        const payload = { ...result, guestAttempt: attemptNumber };
        const bytes = Buffer.byteLength(JSON.stringify(payload));
        if (bytes > limits.maxPayloadBytes || counts().bytes + bytes > limits.maxTotalPayloadBytes) throw unknown();
        attempt.payload = payload;
        attempt.bytes = bytes;
        attempt.payloadUntil = Math.min(now() + limits.payloadTtlMs, owner.expiresAt);
        attempt.retryable = result.status === "failed" && typeof result.systemStatus === "object" && result.systemStatus !== null && (result.systemStatus as Record<string, unknown>).retryable === true;
        attempt.state = "complete";
        armCleanup();
        return payload;
      } catch {
        attempt.state = "unknown";
        // 401 is reserved for rejection before the model starts. Late results
        // must not invite the client to bootstrap and automatically regenerate.
        if (!started) {
          rate.executions = Math.max(0, rate.executions - 1);
          if (input.endpoint === "greeting" && owner.greetingDate === day) owner.greetings = Math.max(0, owner.greetings - 1);
          throw invalid();
        }
        throw unknown();
      } finally {
        // Settled Promises would otherwise retain the reply after payload expiry.
        attempt.promise = undefined;
        pendingTotal--;
        const remaining = (pendingByOwner.get(owner) ?? 1) - 1;
        if (remaining) pendingByOwner.set(owner, remaining);
        else pendingByOwner.delete(owner);
      }
    });
    return attempt.promise;
  };
  return { bootstrap, authorize, revoke, execute, dispose: () => cancelCleanup?.() };
}

type GuestGlobal = typeof globalThis & { __manliaoGuestSessions?: ReturnType<typeof createGuestSessionManager> };
export const getGuestSessionManager = () => {
  const global = globalThis as GuestGlobal;
  return global.__manliaoGuestSessions ??= createGuestSessionManager();
};
