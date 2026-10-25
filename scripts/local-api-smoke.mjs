import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const port = Number(process.env.LOCAL_API_PORT || 3400);
const externalBaseUrl = process.env.LOCAL_API_BASE_URL?.replace(/\/$/, "");
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const timeoutMs = Number(process.env.LOCAL_API_TIMEOUT_MS || 30000);
const prisma = new PrismaClient();

let serverProcess = null;
let token = "";
let phone = "";
let secondaryPhone = "";
let userId = "";
let primaryToken = "";
let uploadedUrl = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nextBin = () =>
  join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");

const startServer = () => {
  if (externalBaseUrl) return;

  serverProcess = spawn(nextBin(), ["start", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_PROVIDER: process.env.AI_PROVIDER || "mock",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => {
    if (process.env.LOCAL_API_SMOKE_VERBOSE === "1") process.stdout.write(chunk);
  });
  serverProcess.stderr.on("data", (chunk) => {
    if (process.env.LOCAL_API_SMOKE_VERBOSE === "1") process.stderr.write(chunk);
  });
};

const stopServer = async () => {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  await sleep(500);
  if (!serverProcess.killed) serverProcess.kill("SIGKILL");
};

const fetchWithTimeout = async (path, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { rawText: text };
  }
};

const request = async (path, init = {}) => {
  const response = await fetchWithTimeout(path, init);
  const body = await parseJson(response);
  return { response, body };
};

const expectStatus = ({ response, body }, status, label) => {
  if (response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${response.status} ${JSON.stringify(body)}`);
  }
};

const expectOk = (result, label) => {
  if (!result.response.ok || result.body?.ok !== true) {
    throw new Error(`${label}: expected ok response, got ${result.response.status} ${JSON.stringify(result.body)}`);
  }
  return result.body.data;
};

const waitForHealth = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await request("/api/health");
      if (result.response.ok && result.body?.ok) return;
    } catch {
      // Keep waiting while next start warms up.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
};

const uniquePhone = () => {
  const suffix = String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 90) + 10);
  return `1${suffix}`;
};

const cleanup = async () => {
  const phones = [phone, secondaryPhone].filter(Boolean);
  if (phones.length > 0) {
    await prisma.user.deleteMany({ where: { phone: { in: phones } } }).catch(() => null);
    await prisma.verificationCode.deleteMany({ where: { phone: { in: phones } } }).catch(() => null);
  }

  if (uploadedUrl) {
    const match = uploadedUrl.match(/\/uploads\/notes\/([^/]+)$/);
    if (match) {
      await rm(join(process.cwd(), "public", "uploads", "notes", match[1]), {
        force: true,
      }).catch(() => null);
    }
  }

  await prisma.$disconnect();
};

const checks = [];
const addCheck = (name, fn) => checks.push({ name, fn });

addCheck("anonymous protected APIs reject", async () => {
  token = "";
  expectStatus(await request("/api/notes"), 401, "anonymous notes");
  expectStatus(await request("/api/notes/calendar"), 401, "anonymous note calendar");
  expectStatus(await request("/api/insights"), 401, "anonymous insights");
  expectStatus(await request("/api/calendar"), 401, "anonymous calendar");
  expectStatus(await request("/api/chat/sessions"), 401, "anonymous chat sessions");
});

addCheck("phone login with dev code", async () => {
  phone = uniquePhone();
  const codeData = expectOk(
    await request("/api/auth/code", {
      method: "POST",
      body: JSON.stringify({ phone, scene: "login" }),
    }),
    "send code"
  );
  if (!/^\d{6}$/.test(codeData.devCode || "")) {
    throw new Error("send code: expected devCode in non-production local smoke");
  }

  const loginData = expectOk(
    await request("/api/auth/phone", {
      method: "POST",
      body: JSON.stringify({ phone, code: codeData.devCode }),
    }),
    "phone login"
  );
  token = loginData.token;
  primaryToken = token;
  userId = loginData.user.id;
  if (!token || !userId) throw new Error("phone login: missing token or user id");
});

addCheck("note create/list/detail/update/delete", async () => {
  const recordDate = "2026-07-02";
  const clientRequestId = `smoke-note-${Date.now()}`;
  const payload = {
    content: "local smoke note query-marker-alpha", recordDate,
    moodName: "晴朗", moodIcon: "sunny", mediaUrls: [], clientRequestId,
  };
  const missingIdPayload = { ...payload };
  delete missingIdPayload.clientRequestId;
  expectStatus(await request("/api/notes", {
    method: "POST", body: JSON.stringify(missingIdPayload),
  }), 400, "note create requires clientRequestId");
  const created = expectOk(
    await request("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    "create note"
  );

  const replay = expectOk(await request("/api/notes", {
    method: "POST", body: JSON.stringify(payload),
  }), "replay text note");
  if (replay.id !== created.id || await prisma.note.count({ where: { userId, clientRequestId } }) !== 1) {
    throw new Error("text note replay: duplicate created");
  }
  expectStatus(await request("/api/notes", {
    method: "POST", body: JSON.stringify({ ...payload, content: "conflicting payload" }),
  }), 409, "text note idempotency conflict");
  const listData = expectOk(await request(`/api/notes?date=${recordDate}`), "list notes");
  if (!listData.items.some((item) => item.id === created.id)) {
    throw new Error("list notes: created note not found");
  }

  const queryData = expectOk(await request("/api/notes?q=query-marker-alpha"), "query notes");
  if (!queryData.items.some((item) => item.id === created.id)) {
    throw new Error("query notes: created note not found");
  }
  const blankQueryData = expectOk(await request("/api/notes?q=%20%20"), "blank query notes");
  if (blankQueryData.total !== expectOk(await request("/api/notes"), "ordinary list notes").total) {
    throw new Error("blank query notes: expected ordinary list contract");
  }
  expectStatus(await request(`/api/notes?q=${"x".repeat(101)}`), 400, "overlong note query");
  expectStatus(await request("/api/notes?date=2026-02-31"), 400, "invalid note date");
  expectOk(await request("/api/notes?date=2028-02-29"), "valid leap-day note date");

  const detail = expectOk(await request(`/api/notes/${created.id}`), "note detail");
  if (detail.content !== "local smoke note query-marker-alpha") {
    throw new Error("note detail: content mismatch");
  }

  const updated = expectOk(
    await request(`/api/notes/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "local smoke note updated" }),
    }),
    "update note"
  );
  if (updated.content !== "local smoke note updated") throw new Error("update note: content mismatch");

  expectOk(await request(`/api/notes/${created.id}`, { method: "DELETE" }), "delete note");
  expectStatus(await request(`/api/notes/${created.id}`), 404, "deleted note detail");
});

addCheck("notes and insights isolate users and drafts", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const month = today.slice(0, 7);
  token = primaryToken;

  const primaryNote = expectOk(
    await request("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: `smoke-owner-alpha-${Date.now()}`,
        content: "owneralpha ".repeat(12),
        recordDate: today,
        moodName: "晴朗",
        moodIcon: "sun",
      }),
    }),
    "create primary ownership note"
  );
  const primaryDraft = expectOk(
    await request("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: `smoke-draft-alpha-${Date.now()}`,
        content: "draftonlyalpha ".repeat(20),
        recordDate: today,
        isDraft: true,
      }),
    }),
    "create primary draft"
  );
  await request("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      clientRequestId: `smoke-future-alpha-${Date.now()}`,
      content: "futureonlyalpha ".repeat(20),
      recordDate: "2099-01-01",
    }),
  }).then((result) => expectOk(result, "create future note"));
  const assistantOnlySession = await prisma.chatSession.create({
    data: { userId, title: "insights role isolation" },
  });
  await prisma.chatMessage.create({
    data: {
      sessionId: assistantOnlySession.id,
      userId,
      role: "ASSISTANT",
      content: "assistantonlyalpha ".repeat(20),
    },
  });

  secondaryPhone = uniquePhone();
  const secondaryCode = expectOk(
    await request("/api/auth/code", {
      method: "POST",
      body: JSON.stringify({ phone: secondaryPhone, scene: "login" }),
    }),
    "send secondary code"
  );
  const secondaryLogin = expectOk(
    await request("/api/auth/phone", {
      method: "POST",
      body: JSON.stringify({ phone: secondaryPhone, code: secondaryCode.devCode }),
    }),
    "secondary phone login"
  );
  token = secondaryLogin.token;
  const foreignNote = expectOk(
    await request("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: `smoke-owner-beta-${Date.now()}`,
        content: "ownerbeta ".repeat(20),
        recordDate: today,
        moodName: "小雨",
        moodIcon: "rain",
      }),
    }),
    "create foreign ownership note"
  );

  token = primaryToken;
  const primaryList = expectOk(await request(`/api/notes?date=${today}&pageSize=100`), "primary dated notes");
  if (!primaryList.items.some((item) => item.id === primaryNote.id)) {
    throw new Error("primary dated notes: own note missing");
  }
  if (primaryList.items.some((item) => item.id === foreignNote.id || item.id === primaryDraft.id)) {
    throw new Error("primary dated notes: foreign or draft note leaked");
  }

  const foreignQuery = expectOk(await request("/api/notes?q=ownerbeta"), "primary foreign query");
  if (foreignQuery.items.length !== 0) throw new Error("primary foreign query: foreign note leaked");
  const draftQuery = expectOk(await request("/api/notes?q=draftonlyalpha"), "primary draft query");
  if (draftQuery.items.length !== 0) throw new Error("primary draft query: draft note leaked");

  const calendar = expectOk(
    await request(`/api/notes/calendar?month=${month}`),
    "primary note calendar"
  );
  const calendarIds = calendar.days.flatMap((day) => day.noteIds);
  if (!calendarIds.includes(primaryNote.id)) throw new Error("primary note calendar: own note missing");
  if (calendarIds.includes(foreignNote.id) || calendarIds.includes(primaryDraft.id)) {
    throw new Error("primary note calendar: foreign or draft note leaked");
  }

  expectStatus(await request(`/api/notes/${foreignNote.id}`), 404, "foreign note detail");

  expectStatus(await request("/api/insights?range=90d"), 403, "insights requires explicit consent");
  const consent = expectOk(await request("/api/insights", { method: "POST", body: "{}" }), "authorize primary insights");
  if (typeof consent.consentToken !== "string" || !consent.consentToken) {
    throw new Error("insights consent: missing server-issued token");
  }
  const consentHeaders = { "x-insights-consent": consent.consentToken };
  token = secondaryLogin.token;
  expectStatus(await request("/api/insights?range=90d", { headers: consentHeaders }), 403,
    "insights consent cannot cross users");
  token = primaryToken;
  const insights = expectOk(await request("/api/insights?range=90d", { headers: consentHeaders }), "primary insights");
  if (insights.words.length > 6) throw new Error("primary insights: more than six words returned");
  if (!insights.words.some((item) => item.word === "owneralpha")) {
    throw new Error("primary insights: own word missing");
  }
  if (
    insights.words.some((item) =>
      ["ownerbeta", "draftonlyalpha", "futureonlyalpha", "assistantonlyalpha"].includes(item.word)
    )
  ) {
    throw new Error("primary insights: foreign, draft, future, or assistant-only word leaked");
  }
  if (
    insights.words.some(
      (item) => Object.keys(item).sort().join(",") !== "count,word" || typeof item.count !== "number"
    )
  ) {
    throw new Error("primary insights: response exposed fields beyond word/count");
  }

  token = "";
  expectStatus(await request("/api/insights?range=90d"), 401, "anonymous insights after login");
  token = primaryToken;
  expectStatus(await request("/api/insights?range=365d", { headers: consentHeaders }), 400, "invalid insights range");
  expectStatus(await request("/api/insights?range=constructor", { headers: consentHeaders }), 400, "prototype insights range");
  expectStatus(await request("/api/notes/calendar?month=2026-13"), 400, "invalid note calendar month");
});

addCheck("image upload accepts png", async () => {
  const pngBytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 12, 73, 68, 65, 84, 8, 153, 99, 248, 15,
    4, 0, 9, 251, 3, 253, 167, 90, 197, 197, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  const form = new FormData();
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "smoke.png");

  const data = expectOk(
    await request("/api/uploads/notes", {
      method: "POST",
      body: form,
    }),
    "upload note image"
  );
  uploadedUrl = data.items?.[0]?.url || "";
  if (!uploadedUrl.includes("/api/uploads/notes/")) throw new Error("upload note image: missing upload URL");
});

addCheck("image-only note is idempotent and deletes derived data", async () => {
  const clientRequestId = `smoke-image-note-${Date.now()}`;
  const payload = { content: "", mediaUrls: [uploadedUrl], clientRequestId };
  const created = expectOk(await request("/api/notes", { method: "POST", body: JSON.stringify(payload) }), "create image-only note");
  const replay = expectOk(await request("/api/notes", { method: "POST", body: JSON.stringify(payload) }), "replay image-only note");
  if (replay.id !== created.id) throw new Error("image-only note: idempotent replay created a duplicate");

  expectStatus(await request("/api/notes", { method: "POST", body: JSON.stringify({ ...payload, content: "different" }) }), 409, "idempotency conflict");
  const rawCount = await prisma.rawMemory.count({ where: { userId, sourceId: created.id } });
  if (rawCount !== 0) throw new Error("image-only note: text RawMemory must not be created");

  expectOk(await request(`/api/notes/${created.id}`, { method: "DELETE" }), "delete image-only note");
  expectStatus(await request(new URL(uploadedUrl).pathname + new URL(uploadedUrl).search), 404, "deleted note upload");
  if (await prisma.noteUpload.count({ where: { userId, noteId: created.id } })) throw new Error("deleted note: upload row remains");
  uploadedUrl = "";
});

if (process.env.LOCAL_API_SMOKE_PROVIDER_FIXTURE === "1") addCheck("safety provider failure blocks generation and Assistant commit", async () => {
  const session = expectOk(await request("/api/chat/sessions", {
    method: "POST", body: JSON.stringify({ title: "local safety failure control" }),
  }), "create safety control session");
  const before = await prisma.chatMessage.count({ where: { sessionId: session.id, role: "ASSISTANT" } });
  const result = await request(`/api/chat/sessions/${session.id}/messages`, {
    method: "POST", body: JSON.stringify({ content: "我有点累，local-smoke-safety-failure" }),
  });
  expectStatus(result, 200, "safe failure transport");
  const data = expectOk(result, "safety failure response");
  assert.equal(data.status, "failed");
  assert.equal(data.systemStatus.code, "SAFETY_BLOCKED");
  assert(data.userMessage?.id && !data.assistantMessage);
  assert.equal(await prisma.chatMessage.count({ where: { sessionId: session.id, role: "ASSISTANT" } }), before);
  assert.equal(await prisma.chatMessage.count({ where: { replyToMessageId: data.userMessage.id, role: "ASSISTANT" } }), 0);
  const status = await prisma.chatMessage.findUniqueOrThrow({ where: { id: data.systemMessage.id } });
  assert.equal(status.role, "SYSTEM");
  const audit = await prisma.aiGeneration.findFirstOrThrow({ where: { turnId: data.userMessage.id } });
  assert.equal(audit.model, "safety-gate");
  assert.equal(audit.outputText, "");
  assert.equal(audit.status, "FAILED");
  assert.equal(audit.executionTrace.phase, "FAILED");
  assert.deepEqual(audit.executionTrace.attempts, []);
});

if (process.env.LOCAL_API_SMOKE_NOTES_ONLY !== "1") addCheck("chat create/send/history/search/calendar", async () => {
  const session = expectOk(
    await request("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "local smoke chat" }),
    }),
    "create chat session"
  );

  const sent = await request(`/api/chat/sessions/${session.id}/messages`, {
    method: "POST", body: JSON.stringify({ content: "我有点累，local-smoke-chat" }),
  });
  expectStatus(sent, 201, "chat commits before success");
  const messageData = expectOk(sent, "send chat message");
  if (!messageData.userMessage?.id || !messageData.assistantMessage?.id) {
    throw new Error(`send chat message: missing user or assistant message ${JSON.stringify(messageData)}`);
  }

  assert.equal(messageData.status, "committed");
  const committed = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageData.assistantMessage.id }, include: { aiGeneration: true } });
  assert.equal(committed.role, "ASSISTANT");
  assert.equal(committed.userId, userId);
  assert.equal(committed.sessionId, session.id);
  assert.equal(committed.replyToMessageId, messageData.userMessage.id);
  assert.equal(committed.content, messageData.assistantMessage.content);
  assert.equal(committed.aiGeneration.executionTrace.phase, "COMMITTED");
  if (process.env.LOCAL_API_SMOKE_PROVIDER_FIXTURE === "1") {
    assert.equal(committed.content, "有点累啊，愿意的话可以说说吗？");
    assert.equal(committed.aiGeneration.model, "qwen:fixture-surface");
    assert.equal(committed.aiGeneration.executionTrace.attempts.length, 1, "Fixture must not pass through regeneration");
    assert.deepEqual(committed.aiGeneration.executionTrace.attempts[0].validation.failureReasons, []);
    console.log("LOCAL_FIXTURE_CHAT_TRACE", JSON.stringify(committed.aiGeneration.executionTrace));
  }

  const history = expectOk(
    await request(`/api/chat/sessions/${session.id}/messages?pageSize=20`),
    "chat history"
  );
  if (history.total < 2) throw new Error(`chat history: expected at least 2 messages, got ${history.total}`);

  const search = expectOk(await request("/api/chat/search?q=local-smoke-chat"), "chat search");
  if (!search.items.some((item) => item.sessionId === session.id)) {
    throw new Error("chat search: sent message not found");
  }

  const calendar = expectOk(await request("/api/calendar?month=2026-07"), "calendar");
  if (!Array.isArray(calendar.days)) throw new Error("calendar: days must be an array");
});

addCheck("logout invalidates token", async () => {
  expectOk(await request("/api/auth/logout", { method: "POST", body: "{}" }), "logout");
  expectStatus(await request("/api/auth/me"), 401, "auth me after logout");
});

const run = async () => {
  startServer();
  await waitForHealth();
  console.log(`Running local API smoke checks against ${baseUrl}`);

  for (const check of checks) {
    await check.fn();
    console.log(`PASS ${check.name}`);
  }

  console.log(`All ${checks.length} local API smoke checks passed.`);
};

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await stopServer();
}
