import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const databaseUrl = process.env.CHAT_TURN_LOOKUP_TEST_DATABASE_URL?.trim();
assert(databaseUrl, "CHAT_TURN_LOOKUP_TEST_DATABASE_URL is required");
const database = new URL(databaseUrl);
assert(["postgresql:", "postgres:"].includes(database.protocol), "Expected PostgreSQL");
assert(["127.0.0.1", "[::1]"].includes(database.hostname), "Expected a loopback database");
assert.match(decodeURIComponent(database.pathname), /^\/[\w-]+_test$/iu);
assert(![...database.searchParams.keys()].some((key) => /^host(addr)?$/iu.test(key)), "Host override is not allowed");

async function main() {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "synthetic-chat-turn-lookup-test-secret";
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "synthetic-turn-lookup-test";
  process.env.QWEN_BASE_URL = "https://turn-lookup-fixture.invalid/v1";
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const { persistExecutionSystemMessage } = await import("../services/ai/chatReplyService");
  const { GET } = await import("../app/api/chat/sessions/[sessionId]/messages/route");
  const ids: string[] = [];
  const originalFetch = globalThis.fetch;
  let forbiddenFetches = 0;
  globalThis.fetch = async () => {
    forbiddenFetches++;
    throw new Error("A history-only request must not call an external provider");
  };

  try {
    const [owner, other] = await prisma.$transaction([prisma.user.create({ data: {} }), prisma.user.create({ data: {} })]);
    ids.push(owner.id, other.id);
    const { token: ownerToken } = await createSession(owner.id);
    const { token: otherToken } = await createSession(other.id);
    const [session, otherSession] = await prisma.$transaction([
      prisma.chatSession.create({ data: { userId: owner.id } }),
      prisma.chatSession.create({ data: { userId: other.id } }),
    ]);

    const request = async (params: Record<string, string>, token = ownerToken) => {
      const url = new URL(`http://localhost/api/chat/sessions/${session.id}/messages`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await GET(new NextRequest(url, { headers: { authorization: `Bearer ${token}` } }),
        { params: Promise.resolve({ sessionId: session.id }) });
      return { status: response.status, payload: await response.json() };
    };
    const history = await request({ historyOnly: "1", retryGreeting: "1" });
    assert.equal(history.status, 200);
    assert.deepEqual(history.payload.data.items, []);
    assert.equal(history.payload.data.turnResult, null);
    assert.equal(history.payload.data.greetingStatus, null);

    const createTurn = (prefix: string, createdAt = new Date()) => prisma.chatMessage.create({ data: {
      id: `${prefix}-${randomUUID()}`, userId: owner.id, sessionId: session.id, role: "USER", content: "合成的用户话轮。", createdAt,
    } });
    const turn = await createTurn("lookup-turn");
    const found = (turnId: string, extra: Record<string, string> = {}) =>
      request({ turnId, ...extra }).then(({ status, payload }) => {
        assert.equal(status, 200);
        assert.equal(payload.data.turnResult.turnId, turnId);
        return payload.data;
      });
    const awaiting = await found(turn.id);
    assert.equal(awaiting.turnResult.status, "unresolved");
    assert.equal(awaiting.turnResult.userMessage.id, turn.id);
    assert.equal(awaiting.turnResult.systemMessage, null);
    assert.equal(awaiting.turnResult.assistantMessage, null);
    assert.equal((await found(`missing-${randomUUID()}`)).turnResult.status, "not_found");

    const failure = await persistExecutionSystemMessage({ userId: owner.id, sessionId: session.id, systemStatus: {
      type: "system_status", code: "PROVIDER_ERROR", message: "这是已保存的合成失败状态。", retryable: true, turnId: turn.id,
    } });
    const failed = (await found(turn.id)).turnResult;
    assert.equal(failed.status, "failed");
    assert.equal(failed.systemMessage.id, failure.id);
    assert.equal(failed.systemMessage.content, failure.content);
    assert.equal(failed.systemMessage.interactionMetadata, undefined);
    assert.equal(failed.assistantMessage, null);

    const assistant = await prisma.chatMessage.create({ data: {
      userId: owner.id, sessionId: session.id, role: "ASSISTANT", replyToMessageId: turn.id, content: "这是后来保存的合成回复。",
    } });
    const unrelated = await createTurn("newer-turn", new Date(Date.now() + 1000));
    const resolved = await found(turn.id, { historyOnly: "1", pageSize: "1" });
    assert.equal(resolved.turnResult.status, "committed");
    assert.equal(resolved.turnResult.assistantMessage.id, assistant.id);
    assert.equal(resolved.turnResult.systemMessage, null);
    assert(resolved.hasMore);
    assert.equal(resolved.items.length, 1);
    assert.equal(resolved.items[0].id, unrelated.id);

    const wrongScope = await createTurn("wrong-scope");
    await prisma.chatMessage.create({ data: {
      userId: other.id, sessionId: otherSession.id, role: "ASSISTANT", replyToMessageId: wrongScope.id, content: "合成的其他账号内容。",
    } });
    assert.equal((await found(wrongScope.id)).turnResult.status, "unresolved");
    assert.equal((await request({ turnId: turn.id }, otherToken)).status, 404);
    assert.equal((await request({ turnId: "!" })).status, 400);

    const retired = await createTurn("removed-turn");
    const removedReply = await prisma.chatMessage.create({ data: {
      userId: owner.id, sessionId: session.id, role: "ASSISTANT", replyToMessageId: retired.id,
      content: "此合成墓碑文本不能展示。", contentDeletedAt: new Date(),
    } });
    const removed = await found(retired.id);
    assert.equal(removed.turnResult.status, "unresolved");
    assert(!JSON.stringify(removed).includes(removedReply.content));
    const olderPage = await request({ historyOnly: "1", before: removedReply.id });
    assert.equal(olderPage.status, 200);
    assert(!JSON.stringify(olderPage.payload).includes(removedReply.content));

    assert.equal(forbiddenFetches, 0, "Neither history nor turn lookup may enter model generation");
    console.log("Authenticated chat history and exact turn lookup checks passed against isolated PostgreSQL.");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
