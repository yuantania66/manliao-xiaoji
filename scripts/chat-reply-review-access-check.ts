import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { AiModelMessage } from "../services/ai/types";

const databaseUrl = process.env.CHAT_REPLY_REVIEW_ACCESS_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CHAT_REPLY_REVIEW_ACCESS_TEST_DATABASE_URL is required");
const databaseError = "Review access checks require a loopback PostgreSQL test database";
let database: URL;
try {
  database = new URL(databaseUrl);
} catch {
  throw new Error(databaseError);
}
if (!["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
    [...database.searchParams.keys()].some((key) => /^host(addr)?$/i.test(key)) ||
    !/^\/[\w-]+[_-]test$/i.test(database.pathname)) {
  throw new Error(databaseError);
}

type PendingReview = { assistantMessageId: string; completedAt: string; reviewVersion: string };

const evaluateFixture = async (messages: AiModelMessage[], nextAction = "简短回应。") => {
  const { assistantMessage } = JSON.parse(messages.at(-1)!.content) as {
    assistantMessage: { sourceId: string; content: string };
  };
  const evidence = [{ sourceId: assistantMessage.sourceId, quote: assistantMessage.content }];
  const score = { score: 4, reason: "合成例已回应。", evidence };
  return JSON.stringify({
    scores: { understanding: score, responsiveness: score, boundaries: score, expression: score },
    strengths: [],
    weaknesses: [{ dimension: "expression", observation: "措辞可更简洁。", evidence, nextAction }],
    reportedImpact: null,
  });
};

const checkClientSession = async () => {
  const { apiRequest } = await import("../lib/client-api");
  const { saveAuth, getAuthToken } = await import("../lib/client-auth");
  const stored = new Map<string, string>();
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    } },
  });
  try {
    let respond!: (value: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((resolve) => { respond = resolve; });
    saveAuth({ token: "old-review-token" });
    const delayed = apiRequest("/api/internal/chat-reply-reviews");
    saveAuth({ token: "new-review-token" });
    respond(Response.json({}, { status: 401 }));
    await assert.rejects(delayed);
    assert.equal(getAuthToken(), "new-review-token", "Old request must not clear a different login");
    const current = apiRequest("/api/internal/chat-reply-reviews");
    respond(Response.json({}, { status: 401 }));
    await assert.rejects(current);
    assert.equal(getAuthToken(), null, "Current 401 must still clear the expired login");
  } finally {
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(globalThis, "window");
  }
};

const main = async () => {
  await checkClientSession();
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "synthetic-internal-review-test-secret";
  delete process.env.CHAT_REPLY_REVIEWER_USER_IDS;
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const { GET, POST } = await import("../app/api/internal/chat-reply-reviews/route");
  const { createChatReplyReviewPacket } = await import("../services/ai/chatReplyReviewPacket");
  const { readReplyFeedbackSnapshot, recordChatReplyFeedback } = await import("../services/ai/chatReplyFeedback");
  const { evaluateChatReply } = await import("../services/ai/chatReplyEvaluation");
  const { readApprovedChatReplyAdvice } = await import("../services/ai/chatReplyEvaluationReview");
  const { runChatReplyEvaluationBatch } = await import("../services/ai/chatReplyEvaluationBatch");

  const ids: string[] = [];
  try {
    assert.equal(await prisma.chatReplyEvaluationJob.count(), 0, "Use an empty evaluation queue for this check");
    const [owner, reviewer, ordinary] = await prisma.$transaction(Array.from({ length: 3 }, () => prisma.user.create({ data: {} })));
    ids.push(owner.id, reviewer.id, ordinary.id);
    const [ownerSession, reviewerSession, ordinarySession] = await Promise.all(ids.map(createSession));
    const chat = await prisma.chatSession.create({ data: { userId: owner.id } });
    const userMessage = await prisma.chatMessage.create({
      data: { userId: owner.id, sessionId: chat.id, role: "USER", content: "这是一条独立的合成原话。", createdAt: new Date("2026-11-24T00:00:00Z") },
    });
    const assistantMessage = await prisma.chatMessage.create({
      data: { userId: owner.id, sessionId: chat.id, role: "ASSISTANT", content: "这是合成的已发布回复。", replyToMessageId: userMessage.id, createdAt: new Date("2026-11-24T00:00:01Z") },
    });
    const request = (token?: string, body?: unknown, query = "") => new NextRequest(`http://localhost/api/internal/chat-reply-reviews${query}`, {
      method: body === undefined ? "GET" : "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const checkResponse = async (response: Response, status: number) => {
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    const loadDraft = async (assistantMessageId = assistantMessage.id, nextAction?: string) => {
      const target = { userId: owner.id, assistantMessageId };
      const snapshot = await readReplyFeedbackSnapshot(target);
      assert(snapshot);
      const evaluation = await evaluateChatReply(snapshot, (messages) => evaluateFixture(messages, nextAction));
      return { ...target, evaluation };
    };
    const draft = await loadDraft();
    process.env.SESSION_SECRET = "replace-with-a-long-random-secret";
    await assert.rejects(() => createChatReplyReviewPacket(draft), /评价包服务未配置/);
    process.env.SESSION_SECRET = "synthetic-internal-review-test-secret";
    const packet = await createChatReplyReviewPacket(draft);
    assert(!Buffer.from(packet.split(".")[2], "base64url").toString("utf8").includes(assistantMessage.content));
    assert(!packet.includes(owner.id));

    await checkResponse(await GET(request()), 401);
    await checkResponse(await GET(request(reviewerSession.token)), 403);
    process.env.CHAT_REPLY_REVIEWER_USER_IDS = ` ${reviewer.id}, `;
    assert.deepEqual((await checkResponse(await GET(request(reviewerSession.token)), 200)).data, { canReview: true });
    await checkResponse(await POST(request(ownerSession.token, { operation: "preview", packet })), 403);
    await checkResponse(await POST(request(ordinarySession.token, { operation: "approve", packet })), 403);
    await checkResponse(await POST(request(reviewerSession.token, {
      operation: "approve", packet, reviewerId: ordinary.id,
    })), 400);

    const altered = packet.split(".");
    altered[2] = (altered[2].startsWith("a") ? "b" : "a") + altered[2].slice(1);
    await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet: altered.join(".") })), 400);
    const preview = (await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet })), 200)).data;
    assert.deepEqual(preview.evaluation, draft.evaluation);
    assert.equal(preview.evidence.userMessage.content, userMessage.content);
    assert.equal(preview.evidence.assistantMessage.content, assistantMessage.content);
    assert(!Object.hasOwn(preview, "userId"));

    const approved = (await checkResponse(await POST(request(reviewerSession.token, { operation: "approve", packet })), 200)).data;
    assert.equal(approved.decision, "APPROVED");
    const stored = await prisma.chatReplyEvaluationReview.findUniqueOrThrow({
      where: { assistantMessageId_evaluationVersion: { assistantMessageId: assistantMessage.id, evaluationVersion: approved.evaluationVersion } },
    });
    assert.equal(stored.reviewerId, reviewer.id);
    assert.deepEqual((await readApprovedChatReplyAdvice(draft))?.advice, [{ dimension: "expression", nextAction: "简短回应。" }]);
    const rejected = (await checkResponse(await POST(request(reviewerSession.token, { operation: "reject", packet })), 200)).data;
    assert.equal(rejected.decision, "REJECTED");
    assert.equal(await readApprovedChatReplyAdvice(draft), null);

    await recordChatReplyFeedback({ ...draft, signal: "HELPFUL", tags: null, comment: "新的合成反馈。" });
    await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet })), 409);
    await checkResponse(await POST(request(reviewerSession.token, { operation: "approve", packet })), 409);
    const updated = await createChatReplyReviewPacket(await loadDraft());
    delete process.env.CHAT_REPLY_REVIEWER_USER_IDS;
    await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet: updated })), 403);
    process.env.CHAT_REPLY_REVIEWER_USER_IDS = reviewer.id;
    await prisma.chatMessage.update({ where: { id: assistantMessage.id }, data: { contentDeletedAt: new Date() } });
    await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet: updated })), 404);
    await checkResponse(await POST(request(reviewerSession.token, { operation: "approve", packet: updated })), 404);
    await prisma.chatMessage.delete({ where: { id: assistantMessage.id } });
    await checkResponse(await POST(request(reviewerSession.token, { operation: "preview", packet: updated })), 404);

    const saveQueuedReply = (index: number) => prisma.chatMessage.create({ data: {
      userId: owner.id, sessionId: chat.id, role: "ASSISTANT", content: `合成待审回复 ${index}`,
    } });
    const pending = await prisma.$transaction(Array.from({ length: 21 }, (_, index) => saveQueuedReply(index)));
    const runBatch = () => runChatReplyEvaluationBatch({ evaluate: evaluateFixture, limit: 25 });
    assert.deepEqual(await runBatch(), { completed: 21, failed: 0, skipped: 0, superseded: 0 });
    const completedAt = (index: number) => new Date(Date.UTC(2026, 10, 24, 4, 0, index));
    await prisma.$transaction(pending.map(({ id }, index) => prisma.chatReplyEvaluationJob.update({
      where: { assistantMessageId: id }, data: { completedAt: completedAt(index) },
    })));
    const waiting = await saveQueuedReply(21);
    const getQueue = (token?: string) => GET(request(token, undefined, "?pending=1"));
    const list = async () => (await checkResponse(await getQueue(reviewerSession.token), 200)).data as {
      items: PendingReview[]; hasMore: boolean;
    };
    const queuedPost = (operation: "preview" | "approve" | "reject", { assistantMessageId, reviewVersion }: PendingReview) =>
      POST(request(reviewerSession.token, { operation, assistantMessageId, reviewVersion }));
    await checkResponse(await getQueue(), 401);
    await checkResponse(await getQueue(ordinarySession.token), 403);
    const initialQueue = await list();
    assert.deepEqual(Object.keys(initialQueue).sort(), ["hasMore", "items"]);
    assert.equal(initialQueue.hasMore, true);
    assert.deepEqual(initialQueue.items.map(({ assistantMessageId, completedAt }) => [assistantMessageId, completedAt]),
      pending.slice(0, 20).map(({ id }, index) => [id, completedAt(index).toISOString()]));
    for (const item of initialQueue.items) {
      assert.deepEqual(Object.keys(item).sort(), ["assistantMessageId", "completedAt", "reviewVersion"]);
      assert(typeof item.reviewVersion === "string" && item.reviewVersion.length > 0);
    }
    const [first, second, changing] = initialQueue.items;
    const queueBody = { operation: "preview", assistantMessageId: first.assistantMessageId, reviewVersion: first.reviewVersion };
    await checkResponse(await POST(request(ownerSession.token, queueBody)), 403);
    await checkResponse(await POST(request(undefined, queueBody)), 401);
    process.env.CHAT_REPLY_REVIEWER_USER_IDS = " , , ";
    await checkResponse(await getQueue(reviewerSession.token), 403);
    await checkResponse(await queuedPost("preview", first), 403);
    process.env.CHAT_REPLY_REVIEWER_USER_IDS = reviewer.id;
    for (const invalidBody of [
      { ...queueBody, operation: "publish" }, { ...queueBody, reviewVersion: " " },
      { operation: "approve", assistantMessageId: first.assistantMessageId }, { ...queueBody, packet },
    ]) await checkResponse(await POST(request(reviewerSession.token, invalidBody)), 400);

    const otherDraft = await loadDraft(first.assistantMessageId, "先承接用户表达。");
    const otherPacket = await createChatReplyReviewPacket(otherDraft);
    const manual = (await checkResponse(await POST(request(reviewerSession.token, { operation: "approve", packet: otherPacket })), 200)).data;
    assert.deepEqual((await list()).items[0], first, "A separate evaluation of this evidence leaves the queued version pending");
    const queuedPreview = (await checkResponse(await queuedPost("preview", first), 200)).data;
    const queuedDraft = await loadDraft(first.assistantMessageId);
    assert.deepEqual(queuedPreview.evaluation, queuedDraft.evaluation);
    assert.equal(queuedPreview.evidence.assistantMessage.content, pending[0].content);
    assert.equal(await readApprovedChatReplyAdvice(queuedDraft), null);
    const queueApproval = (await checkResponse(await queuedPost("approve", first), 200)).data;
    assert.equal(queueApproval.decision, "APPROVED");
    assert.notEqual(queueApproval.evaluationVersion, manual.evaluationVersion);
    assert.equal(queueApproval.evaluationVersion, (await readApprovedChatReplyAdvice(queuedDraft))?.evaluationVersion);
    await checkResponse(await queuedPost("reject", first), 409);
    const remaining = await list();
    assert.equal(remaining.hasMore, false);
    assert.deepEqual(remaining.items.map(({ assistantMessageId }) => assistantMessageId), pending.slice(1).map(({ id }) => id));
    const [rejectedResponse, duplicateResponse] = (await Promise.all([
      queuedPost("reject", second), queuedPost("reject", second),
    ])).sort((left, right) => left.status - right.status);
    const queueRejection = (await checkResponse(rejectedResponse, 200)).data;
    assert.equal(queueRejection.decision, "REJECTED");
    await checkResponse(duplicateResponse, 409);
    assert(!(await list()).items.some(({ assistantMessageId }) => assistantMessageId === second.assistantMessageId));

    const feedback = await recordChatReplyFeedback({
      userId: owner.id, assistantMessageId: changing.assistantMessageId, signal: "HELPFUL", tags: null, comment: "复核前更新的合成反馈。",
    });
    await checkResponse(await queuedPost("preview", changing), 409);
    await checkResponse(await queuedPost("approve", changing), 409);
    assert(!(await list()).items.some(({ assistantMessageId }) => assistantMessageId === changing.assistantMessageId));
    assert.deepEqual(await runBatch(), { completed: 2, failed: 0, skipped: 0, superseded: 0 });
    const refreshed = (await list()).items.find(({ assistantMessageId }) => assistantMessageId === changing.assistantMessageId);
    assert(refreshed);
    assert.notEqual(refreshed.reviewVersion, changing.reviewVersion);
    const refreshedPreview = (await checkResponse(await queuedPost("preview", refreshed), 200)).data;
    assert.equal(refreshedPreview.evidence.feedback[0].comment, "复核前更新的合成反馈。");
    assert((await list()).items.some(({ assistantMessageId }) => assistantMessageId === waiting.id));
    await prisma.aiMessageFeedback.delete({ where: { id: feedback.id } });
    assert.equal((await runBatch()).completed, 1);
    const restored = (await list()).items.find(({ assistantMessageId }) => assistantMessageId === changing.assistantMessageId);
    assert(restored);
    assert.notEqual(restored.reviewVersion, changing.reviewVersion, "Restored evidence still requires the new queue revision");
    await checkResponse(await queuedPost("approve", changing), 409);
    await prisma.chatMessage.delete({ where: { id: changing.assistantMessageId } });
    await checkResponse(await queuedPost("preview", restored), 404);
    await checkResponse(await queuedPost("approve", restored), 404);
    console.log("Internal reply review access checks passed on an isolated synthetic database.");
  } finally {
    try {
      if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
