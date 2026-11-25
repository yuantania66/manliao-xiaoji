import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatMessage, Prisma } from "@prisma/client";

const databaseUrl = process.env.CHAT_RETRIEVAL_CONTEXT_TEST_DATABASE_URL?.trim();
assert(databaseUrl, "CHAT_RETRIEVAL_CONTEXT_TEST_DATABASE_URL is required");
const database = new URL(databaseUrl);
assert(["postgresql:", "postgres:"].includes(database.protocol), "Expected PostgreSQL");
assert(["127.0.0.1", "[::1]"].includes(database.hostname), "Expected a loopback database");
assert.match(decodeURIComponent(database.pathname), /^\/[\w-]+_test$/iu);
assert(![...database.searchParams.keys()].some((key) => /^host(addr)?$/iu.test(key)), "Host override is not allowed");
process.env.DATABASE_URL = databaseUrl;

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { buildConversationRetrievalContext } = await import("../services/understanding/retrievalContextService");
  const userId = `retrieval-context-test-${randomUUID()}`;
  const otherUserId = `retrieval-context-test-${randomUUID()}`;
  const now = new Date();
  const beforeNow = new Date(now.getTime() - 60_000);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("Historical source retrieval must not call an external service");

  try {
    await prisma.user.createMany({ data: [{ id: userId }, { id: otherUserId }] });
    const [session, history, otherSession] = await prisma.$transaction([
      prisma.chatSession.create({ data: { userId } }),
      prisma.chatSession.create({ data: { userId } }),
      prisma.chatSession.create({ data: { userId: otherUserId } }),
    ]);

    const save = (content: string, override: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) =>
      prisma.chatMessage.create({
        data: { userId, sessionId: session.id, role: "USER", content, createdAt: beforeNow, ...override },
      });
    const current = (content: string) => save(content, { createdAt: now });
    const recall = (currentMessage: Pick<ChatMessage, "id" | "content" | "createdAt">,
      override: Partial<Parameters<typeof buildConversationRetrievalContext>[0]> = {}) =>
      buildConversationRetrievalContext({ userId, sessionId: session.id, currentMessage, recentMessages: [], ...override });
    const sourceIds = async (message: ChatMessage) =>
      (await recall(message)).recalledContext?.candidates.map(({ sourceTurnId }) => sourceTurnId) ?? [];

    const same = await save("我最近在整理海棠预算。");
    await save("这是另一会话的海棠预算。", { sessionId: history.id });
    const sameCurrent = await current("上次说的海棠预算，我有了进展。");
    const sameRecall = await recall(sameCurrent, {
      recentMessages: [{ id: same.id, role: "user", status: "saved", content: "这是假造的相邻内容。" }],
    });
    assert.deepEqual(sameRecall.recalledContext?.candidates.map(({ sourceTurnId, sourceConversationId, role, text }) =>
      ({ sourceTurnId, sourceConversationId, role, text })), [
      { sourceTurnId: same.id, sourceConversationId: session.id, role: "user", text: same.content },
    ], "Prefer the visible original in this session and ignore caller-provided wording");

    const racedSource = await save("这条白栀记录稍后会被删除。");
    const survivingSource = await save("我的另一条白栀记录仍可使用。");
    const racedCurrent = await current("上次说的白栀记录，我有了进展。");
    const recentMessages = [{ id: racedSource.id, role: "user" as const, status: "saved" as const, content: racedSource.content }];
    const chatMessages = prisma.chatMessage;
    const findMany = chatMessages.findMany;
    let deletedDuringLookup = false;
    // Pause the older-window read after the recent source passed its initial privacy check.
    chatMessages.findMany = ((args: Prisma.ChatMessageFindManyArgs) => {
      const ids = args.where?.id;
      if (!deletedDuringLookup && typeof ids === "object" && Array.isArray(ids.notIn) && ids.notIn.includes(racedSource.id)) {
        return findMany(args).then(async (rows) => {
          await chatMessages.update({ where: { id: racedSource.id }, data: { contentDeletedAt: now } });
          deletedDuringLookup = true;
          return rows;
        });
      }
      return findMany(args);
    }) as typeof findMany;
    try {
      const racedRecall = await recall(racedCurrent, { recentMessages });
      assert(deletedDuringLookup, "The old-window query must allow the source deletion to precede final retrieval");
      assert.deepEqual(racedRecall.recalledContext?.candidates.map(({ sourceTurnId }) => sourceTurnId), [survivingSource.id],
        "A recent source deleted during lookup must disappear without hiding an unrelated visible source");
    } finally {
      chatMessages.findMany = findMany;
    }

    const cross = await save("我之前在整理木槿展览。", { sessionId: history.id });
    await save(cross.content, { userId: otherUserId, sessionId: otherSession.id });
    await save(cross.content, { sessionId: otherSession.id });
    await save(cross.content, { userId: otherUserId });
    const crossCurrent = await current("上次说的木槿展览，我还有进展。");
    assert.deepEqual(await sourceIds(crossCurrent), [cross.id],
      "Require candidate user and session ownership even when several records exactly match");
    const generic = await current("她后来怎么样了？");
    const genericRecall = await recall(generic, {
      recentMessages: [{ id: cross.id, role: "user", status: "saved", content: cross.content }],
    });
    assert(!genericRecall.recalledContext?.candidates.some(({ sourceConversationId }) => sourceConversationId !== session.id),
      "A generic pronoun and a caller-supplied history ID cannot authorize cross-session recall");

    const deleted = await save("我之前参加了青柚展览。", { contentDeletedAt: now });
    assert.equal(deleted.status, "SAVED", "Fixture must isolate soft deletion from message status");
    const deletedCurrent = await current("上次说的青柚展览，我还有进展。");
    assert.deepEqual(await sourceIds(deletedCurrent), [], "Saved soft-deleted messages cannot become candidates");

    const revoked = await save("我之前准备了银杏画册。", { sessionId: history.id });
    const rawData = {
      userId, sessionId: history.id, sourceType: "CHAT_MESSAGE", sourceId: revoked.id,
      role: "USER", kind: "CONVERSATION_MESSAGE", content: revoked.content, occurredAt: beforeNow, payload: {},
    } as const;
    const olderRaw = await prisma.rawMemory.create({ data: rawData });
    const newerRaw = await prisma.rawMemory.create({
      data: { ...rawData, sourceRevision: 2, revisionOfRawMemoryId: olderRaw.id },
    });
    const rawEvent = (rawMemoryId: string, eventType: "RESTORED" | "REDACTION_REQUESTED", offset: number) =>
      prisma.rawMemoryEvent.create({ data: { userId, rawMemoryId, eventType, createdAt: new Date(beforeNow.getTime() + offset) } });
    await rawEvent(newerRaw.id, "RESTORED", 1_000);
    await rawEvent(newerRaw.id, "REDACTION_REQUESTED", 2_000);
    await rawEvent(olderRaw.id, "RESTORED", 3_000);
    const revokedCurrent = await current("上次说的银杏画册，我还有进展。");
    assert.deepEqual(await sourceIds(revokedCurrent), [], "A late restore on an older revision cannot override current raw revocation");
    await rawEvent(newerRaw.id, "RESTORED", 4_000);
    assert.deepEqual(await sourceIds(revokedCurrent), [revoked.id], "A later restore on the current revision becomes visible");

    await save("我之前准备了雪松清单。", { createdAt: now });
    await save("我之前准备了雪松清单。", { createdAt: new Date(now.getTime() + 1) });
    const cutoff = await current("上次说的雪松清单，我还有进展。");
    assert.deepEqual(await sourceIds(cutoff), [], "Same-time, current and future turns cannot be historic sources");

    for (const [label, statedCurrent] of [
      ["unknown ID", { ...crossCurrent, id: randomUUID() }],
      ["altered wording", { ...crossCurrent, content: `${crossCurrent.content}还有别的。` }],
      ["altered timestamp", { ...crossCurrent, createdAt: new Date(now.getTime() + 1) }],
      ["foreign row", await save(crossCurrent.content, { userId: otherUserId, sessionId: otherSession.id, createdAt: now })],
    ] as const) {
      assert.equal((await recall(statedCurrent)).recalledContext, null, `Reject current scope with ${label}`);
    }
    assert.equal((await recall(crossCurrent, { sessionId: history.id })).recalledContext, null);
    assert.equal((await recall(crossCurrent, { userId: otherUserId })).recalledContext, null);

    console.log("Historical source retrieval passed on isolated PostgreSQL: exact original, scope, boundaries, raw lifecycle and current-turn identity.");
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
