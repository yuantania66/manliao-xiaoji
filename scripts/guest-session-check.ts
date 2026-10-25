import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";

import { AppError } from "../lib/errors";
import { createGuestSessionManager, guestCookieName } from "../lib/guest-session";

// All identifiers, model replies and clocks below are synthetic. Never start a
// server, read an env file, import a real model implementation or connect a DB.
const require = createRequire(`${process.cwd()}/scripts/guest-session-check.ts`);
const origin = "http://localhost:3002";
let randomCalls = 0;
const fakeRandom = (size: number) => Buffer.alloc(size, ++randomCalls);
const request = (body: Record<string, unknown>, headers: Record<string, string> = {}, path = "session", method = "POST") => new NextRequest(`${origin}/api/chat/guest/${path}`, {
  method,
  headers: { "content-type": "application/json", origin, ...headers },
  body: JSON.stringify(body),
});
const reason = (expected: string) => (error: unknown) => error instanceof AppError && (error.details as { reason?: string })?.reason === expected;
const check = async () => {
  let time = Date.UTC(2026, 9, 13, 1);
  let scheduled: (() => void) | undefined;
  const manager = createGuestSessionManager({
    randomBytes: fakeRandom,
    now: () => time,
    scheduleCleanup: (callback) => { scheduled = callback; return () => { scheduled = undefined; }; },
    limits: { payloadTtlMs: 100, ttlMs: 1000, ipDailyLimit: 100, maxPending: 1 },
  });
  const a = manager.bootstrap(request({}), {});
  assert.equal("credential" in a.data, false);
  assert(a.cookieCredential);
  const headers = { cookie: `${guestCookieName()}=${a.cookieCredential}` };
  const auth = manager.authorize(request({}, headers), a.data.conversationId);
  const b = manager.bootstrap(request({}), {});
  assert.throws(() => manager.authorize(request({}, { cookie: `${guestCookieName()}=${b.cookieCredential}` }), a.data.conversationId), reason("GUEST_SESSION_INVALID"));
  assert.throws(() => manager.authorize(request({}), a.data.conversationId), reason("GUEST_SESSION_INVALID"));
  assert.throws(() => manager.bootstrap(request({}, { origin: "https://evil.invalid" }), {}), reason("GUEST_SESSION_INVALID"));
  assert.throws(() => manager.bootstrap(request({}, { "x-guest-transport": "mini", ...headers }), {}), reason("GUEST_SESSION_INVALID"));
  assert.throws(() => manager.bootstrap(request({}, { "x-guest-transport": "mini", "x-guest-credential": a.cookieCredential! }), {}), reason("GUEST_SESSION_INVALID"));
  const mini = manager.bootstrap(request({}, { "x-guest-transport": "mini" }), {});
  assert(mini.data.credential);
  assert.equal(mini.cookieCredential, undefined);
  const input = { request: request({}, headers), authority: auth, endpoint: "reply" as const, turnId: "synthetic-turn-1", inputs: { content: "synthetic" } };
  let calls = 0;
  let finish!: (value: Record<string, unknown>) => void;
  const pending = manager.execute(input, () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const duplicate = manager.execute(input, async () => { throw new Error("duplicate executed"); });
  await Promise.resolve();
  assert.equal(calls, 1);
  await assert.rejects(manager.execute({ ...input, inputs: { content: "changed" } }, async () => ({})), reason("GUEST_REQUEST_CONFLICT"));
  await assert.rejects(manager.execute({ ...input, turnId: "another-turn" }, async () => ({})), reason("GUEST_CAPACITY"));
  finish({ status: "failed", systemStatus: { retryable: true, message: "synthetic failure" } });
  const first = await pending;
  assert.deepEqual(await duplicate, first);
  assert.equal(first.guestAttempt, 1);
  const retry = { ...input, retryOfAttempt: 1 };
  const failedAgain = await manager.execute(retry, async () => { calls++; return { status: "failed", systemStatus: { retryable: true } }; });
  assert.equal(failedAgain.guestAttempt, 2);
  assert.deepEqual(await manager.execute(retry, async () => { throw new Error("retry token executed twice"); }), failedAgain);
  assert.equal(calls, 2);
  await manager.execute({ ...input, retryOfAttempt: 2 }, async () => ({ status: "committed", text: "synthetic reply" }));
  assert.deepEqual(await manager.execute(retry, async () => ({})), failedAgain, "old retry token still selects attempt two after attempt three");
  time += 99;
  assert.deepEqual(await manager.execute(retry, async () => ({})), failedAgain);
  time += 1;
  assert(scheduled, "completion must schedule active cleanup without another request");
  scheduled();
  await assert.rejects(manager.execute(input, async () => ({})), reason("GUEST_RESULT_EXPIRED"));
  await assert.rejects(manager.execute({ ...input, retryOfAttempt: 1 }, async () => ({})), reason("GUEST_RESULT_EXPIRED"));
  await assert.rejects(manager.execute({ ...input, turnId: "unknown-turn" }, async () => { throw new Error("synthetic provider failure"); }), reason("GUEST_EXECUTION_UNKNOWN"));
  await assert.rejects(manager.execute({ ...input, turnId: "unknown-turn" }, async () => { throw new Error("must not run"); }), reason("GUEST_EXECUTION_UNKNOWN"));

  let lateFinish!: (value: Record<string, unknown>) => void;
  const late = manager.execute({ ...input, turnId: "late-result-turn" }, () => new Promise((resolve) => { lateFinish = resolve; }));
  await Promise.resolve();
  manager.revoke(request({}, headers), { ...a.data, scope: "owner" });
  const bHeaders = { cookie: `${guestCookieName()}=${b.cookieCredential}` };
  const bAuth = manager.authorize(request({}, bHeaders), b.data.conversationId);
  await assert.rejects(manager.execute({ ...input, authority: bAuth, request: request({}, bHeaders) }, async () => ({})), reason("GUEST_CAPACITY"), "revoked in-flight work still owns capacity");
  lateFinish({ status: "committed", text: "late synthetic secret" });
  await assert.rejects(late, reason("GUEST_EXECUTION_UNKNOWN"), "late model result cannot masquerade as pre-model 401");
  await manager.execute({ ...input, authority: bAuth, request: request({}, bHeaders) }, async () => ({ status: "committed" }));
  time += 1000;
  scheduled?.();
  assert.throws(() => manager.authorize(request({}, bHeaders), b.data.conversationId), reason("GUEST_SESSION_INVALID"));
  manager.dispose();

  const admission = createGuestSessionManager({ randomBytes: fakeRandom, now: () => time, scheduleCleanup: () => () => {}, limits: { ipDailyLimit: 1, greetingOwnerDailyLimit: 1 } });
  const reservedOwner = admission.bootstrap(request({}), {});
  const reservedHeaders = { cookie: `${guestCookieName()}=${reservedOwner.cookieCredential}` };
  const reservedAuthority = admission.authorize(request({}, reservedHeaders), reservedOwner.data.conversationId);
  const reservedInput = { request: request({}, reservedHeaders), authority: reservedAuthority, endpoint: "greeting" as const, turnId: "pre-model-revoked", inputs: {} };
  let preModelCalls = 0;
  const beforeStart = admission.execute(reservedInput, async () => { preModelCalls++; return {}; });
  admission.revoke(request({}, reservedHeaders), { ...reservedOwner.data, scope: "conversation" });
  await assert.rejects(beforeStart, reason("GUEST_SESSION_INVALID"));
  assert.equal(preModelCalls, 0);
  const nextConversation = admission.bootstrap(request({}, reservedHeaders), {});
  await admission.execute({ ...reservedInput, authority: admission.authorize(request({}, reservedHeaders), nextConversation.data.conversationId) }, async () => { preModelCalls++; return {}; });
  assert.equal(preModelCalls, 1, "pre-model rejection refunds both IP and owner greeting reservations");
  admission.dispose();

  // Real route handlers, with the two existing generation entry modules replaced
  // before loading the routes. A poisoned Prisma module catches accidental use.
  const saved = new Map<string, NodeModule | undefined>();
  const stub = (path: string, exports: unknown) => {
    const id = require.resolve(path);
    saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
  };
  let replyCalls = 0, greetingCalls = 0, databaseCalls = 0;
  const failDb = () => { databaseCalls++; throw new Error("DB forbidden"); };
  stub("../lib/prisma", { prisma: new Proxy({}, { get: failDb }) });
  stub("../services/ai/chatOrchestrationService", {
    createChatReply: async (args: { currentTurnId: string }) => {
      replyCalls++;
      return {
        execution: { phase: "VALIDATED", planId: "synthetic-plan", requestId: "synthetic-request", turnId: args.currentTurnId, attempts: [], transitions: [] },
        generation: { text: "合成回复，仅测试路由", promptVersion: "synthetic" },
        finalSource: "safety", judge: { passed: true, riskLevel: "none", issues: [], rewriteRequired: false, reason: "synthetic" },
      };
    },
  });
  stub("../services/ai/proactiveGreeting", {
    generateProactiveGreeting: async () => {
      greetingCalls++;
      return { text: "合成问候", promptVersion: "synthetic", proactiveIntent: { move: "simple_greeting", requiredFunction: "initiate_reciprocal_contact", realization: { kind: "reciprocal_contact" }, expectedUserContribution: "none", userBurden: "none" } };
    },
  });
  const globalStore = globalThis as typeof globalThis & { __manliaoGuestSessions?: ReturnType<typeof createGuestSessionManager> };
  const previousManager = globalStore.__manliaoGuestSessions;
  const routeManager = createGuestSessionManager({ randomBytes: fakeRandom, now: () => time, scheduleCleanup: () => () => {}, limits: { ipDailyLimit: 4, greetingOwnerDailyLimit: 1 } });
  globalStore.__manliaoGuestSessions = routeManager;
  try {
    const sessionRoute = require("../app/api/chat/guest/session/route") as typeof import("../app/api/chat/guest/session/route");
    const replyRoute = require("../app/api/chat/guest/route") as typeof import("../app/api/chat/guest/route");
    const greetingRoute = require("../app/api/chat/guest/greeting/route") as typeof import("../app/api/chat/guest/greeting/route");
    const bootResponse = await sessionRoute.POST(request({}));
    assert.equal(bootResponse.status, 200);
    assert.equal(bootResponse.headers.get("cache-control"), "no-store");
    assert.match(bootResponse.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(bootResponse.headers.get("set-cookie")!, /SameSite=strict/i);
    const boot = (await bootResponse.json()).data;
    assert.equal(boot.credential, undefined);
    const webHeaders = { cookie: bootResponse.headers.get("set-cookie")!.split(";")[0] };
    const body = { conversationId: boot.conversationId, turnId: "route-synthetic-turn", content: "合成用户输入" };
    const denied = await replyRoute.POST(request(body, {}, ""));
    assert.equal(denied.status, 401);
    assert.equal(replyCalls, 0);
    const [one, two] = await Promise.all([replyRoute.POST(request(body, webHeaders, "")), replyRoute.POST(request(body, webHeaders, ""))]);
    assert.equal(one.status, 200);
    assert.deepEqual(await one.json(), await two.json());
    assert.equal(replyCalls, 1);
    assert.equal((await replyRoute.POST(request({ ...body, content: "不同输入" }, webHeaders, ""))).status, 409);
    assert.equal((await replyRoute.POST(request({ ...body, retry: true }, webHeaders, ""))).status, 409);
    const hello = { conversationId: boot.conversationId, turnId: "route-greeting-1" };
    assert.equal((await greetingRoute.POST(request(hello, {}, "greeting"))).status, 401);
    const greeting = await greetingRoute.POST(request(hello, webHeaders, "greeting"));
    assert.equal(greeting.status, 200);
    assert.equal((await greeting.json()).data.guestAttempt, 1);
    await greetingRoute.POST(request(hello, webHeaders, "greeting"));
    assert.equal(greetingCalls, 1);
    assert.equal((await greetingRoute.POST(request({ ...hello, turnId: "route-greeting-2" }, webHeaders, "greeting"))).status, 429);
    const miniResponse = await sessionRoute.POST(request({}, { "x-guest-transport": "mini" }));
    const miniBoot = (await miniResponse.json()).data;
    assert(miniBoot.credential);
    const miniHeaders = { "x-guest-transport": "mini", "x-guest-credential": miniBoot.credential };
    assert.equal((await replyRoute.POST(request({ ...body, conversationId: miniBoot.conversationId }, miniHeaders, ""))).status, 200);
    assert.equal((await replyRoute.POST(request(body, miniHeaders, ""))).status, 401);
    await replyRoute.POST(request({ ...body, turnId: "last-ip-turn", debugTrace: true }, webHeaders, ""));
    assert.equal((await replyRoute.POST(request({ ...body, turnId: "over-ip-turn", debugTrace: true }, { ...webHeaders, "x-forwarded-for": "192.0.2.100" }, ""))).status, 429, "debug and untrusted proxy headers cannot bypass quota");
    const deleted = await sessionRoute.DELETE(request({ ownerId: boot.ownerId, conversationId: boot.conversationId, scope: "conversation" }, webHeaders, "session", "DELETE"));
    assert.equal(deleted.status, 200);
    assert.equal(deleted.headers.get("set-cookie"), null);
    assert.equal((await replyRoute.POST(request(body, webHeaders, ""))).status, 401);
    assert.equal(databaseCalls, 0);
    console.log(JSON.stringify({ passed: true, scope: "single-process actual module and routes; deterministic identifiers/clock, synthetic model stubs", modelCalls: 0, networkCalls: 0, databaseCalls, syntheticReplyCalls: replyCalls, syntheticGreetingCalls: greetingCalls, realCredentialsCreated: 0 }));
  } finally {
    routeManager.dispose();
    globalStore.__manliaoGuestSessions = previousManager;
    for (const [id, cached] of saved) {
      if (cached) require.cache[id] = cached;
      else delete require.cache[id];
    }
  }
};

check().catch((error) => { console.error(error); process.exitCode = 1; });
