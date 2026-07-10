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
let userId = "";
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
  if (phone) {
    await prisma.user.deleteMany({ where: { phone } }).catch(() => null);
    await prisma.verificationCode.deleteMany({ where: { phone } }).catch(() => null);
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
  userId = loginData.user.id;
  if (!token || !userId) throw new Error("phone login: missing token or user id");
});

addCheck("note create/list/detail/update/delete", async () => {
  const recordDate = "2026-07-02";
  const created = expectOk(
    await request("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        content: "local smoke note",
        recordDate,
        moodName: "晴朗",
        moodIcon: "sunny",
        mediaUrls: [],
      }),
    }),
    "create note"
  );

  const listData = expectOk(await request(`/api/notes?date=${recordDate}`), "list notes");
  if (!listData.items.some((item) => item.id === created.id)) {
    throw new Error("list notes: created note not found");
  }

  const detail = expectOk(await request(`/api/notes/${created.id}`), "note detail");
  if (detail.content !== "local smoke note") throw new Error("note detail: content mismatch");

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
  if (!uploadedUrl.includes("/uploads/notes/")) throw new Error("upload note image: missing upload URL");
});

addCheck("chat create/send/history/search/calendar", async () => {
  const session = expectOk(
    await request("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "local smoke chat" }),
    }),
    "create chat session"
  );

  const messageData = expectOk(
    await request(`/api/chat/sessions/${session.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: "我有点累，local-smoke-chat" }),
    }),
    "send chat message"
  );
  if (!messageData.userMessage?.id || !messageData.assistantMessage?.id) {
    throw new Error("send chat message: missing user or assistant message");
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
