import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { AiModelMessage } from "../services/ai/types";

const databaseUrl = process.env.CHAT_REPLY_TRAINING_CANDIDATE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CHAT_REPLY_TRAINING_CANDIDATE_TEST_DATABASE_URL is required");
const databaseError = "Training candidate checks require a loopback PostgreSQL test database";
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

const noticeVersion = "chat_reply_training_candidates_v1";
const scores = { understanding: 4, responsiveness: 3, boundaries: 2, expression: 4 };
const evaluateFixture = async (messages: AiModelMessage[]) => {
  const { assistantMessage, userMessage } = JSON.parse(messages.at(-1)!.content) as {
    assistantMessage: { sourceId: string; content: string };
    userMessage: { sourceId: string; content: string } | null;
  };
  const evidence = [assistantMessage, ...(userMessage ? [userMessage] : [])]
    .map(({ sourceId, content }) => ({ sourceId, quote: content }));
  return JSON.stringify({
    scores: Object.fromEntries(Object.entries(scores).map(([dimension, score]) => [dimension, {
      score, reason: "合成评分分析必须留在审核包中。", evidence,
    }])),
    strengths: [{ dimension: "understanding", observation: "合成优点原话必须留在审核包中。", evidence }],
    weaknesses: [{ dimension: "boundaries", observation: "合成不足原话必须留在审核包中。", evidence, nextAction: "合成建议不得进入材料。" }],
    reportedImpact: null,
  });
};

type PendingReview = { assistantMessageId: string; reviewVersion: string };

const main = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "synthetic-chat-reply-training-candidate-test-secret";
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const consentApi = await import("../app/api/settings/training-consent/route");
  const reviewApi = await import("../app/api/internal/chat-reply-reviews/route");
  const { runChatReplyEvaluationBatch } = await import("../services/ai/chatReplyEvaluationBatch");
  const { recordChatReplyFeedback } = await import("../services/ai/chatReplyFeedback");

  const ids: string[] = [];
  try {
    assert.equal(await prisma.chatReplyEvaluationJob.count(), 0, "Use an empty evaluation queue for this check");
    const [owner, reviewer, other] = await prisma.$transaction(Array.from({ length: 3 }, () => prisma.user.create({ data: {} })));
    ids.push(owner.id, reviewer.id, other.id);
    process.env.CHAT_REPLY_REVIEWER_USER_IDS = reviewer.id;
    const [ownerSession, reviewerSession, otherSession] = await Promise.all(ids.map(createSession));
    const chat = await prisma.chatSession.create({ data: { userId: owner.id } });
    const request = (path: string, method: string, token?: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const check = async (response: Response, status: number) => {
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return (await response.json()).data;
    };
    const consentPath = "/api/settings/training-consent";
    const reviewPath = "/api/internal/chat-reply-reviews";
    const getConsent = (token?: string) => consentApi.GET(request(consentPath, "GET", token));
    const putConsent = (body: unknown, token = ownerSession.token) => consentApi.PUT(request(consentPath, "PUT", token, body));
    const consent = (enabled: boolean) => ({ enabled, noticeVersion });
    const getGrant = () => prisma.chatReplyTrainingConsent.findUniqueOrThrow({ where: { userId: owner.id } });
    const review = (body: unknown, token = reviewerSession.token) => reviewApi.POST(request(reviewPath, "POST", token, body));
    const submit = (operation: "preview" | "approve" | "approveTraining", ref: PendingReview) => review({ operation, ...ref });
    const candidate = (ref: PendingReview) => prisma.chatReplyTrainingCandidate.findUnique({ where: { assistantMessageId: ref.assistantMessageId } });
    const savePair = async (label: string, originalAt: Date, replyAt = new Date(originalAt.getTime() + 1)) => {
      const original = await prisma.chatMessage.create({ data: {
        sessionId: chat.id, userId: owner.id, role: "USER", content: `合成用户原话，不应进入材料 ${label}。`, createdAt: originalAt,
      } });
      const reply = await prisma.chatMessage.create({ data: {
        sessionId: chat.id, userId: owner.id, role: "ASSISTANT", content: `合成小慢原话，不应进入材料 ${label}。`,
        replyToMessageId: original.id, createdAt: replyAt,
      } });
      return { original, reply };
    };
    const rememberSource = (source: { id: string; content: string; createdAt: Date }) => prisma.rawMemory.create({ data: {
      userId: owner.id, sessionId: chat.id, role: "USER", sourceType: "CHAT_MESSAGE", sourceId: source.id,
      kind: "CONVERSATION_MESSAGE", content: source.content, occurredAt: source.createdAt, payload: {},
    } });
    const requestRedaction = (rawMemoryId: string) => prisma.rawMemoryEvent.create({
      data: { userId: owner.id, rawMemoryId, eventType: "REDACTION_REQUESTED" },
    });
    const runBatch = async (expected: number) => assert.deepEqual(await runChatReplyEvaluationBatch({ evaluate: evaluateFixture, limit: 20 }), {
      completed: expected, failed: 0, skipped: 0, superseded: 0,
    });
    const pending = async (assistantMessageId: string) => {
      const list = await check(await reviewApi.GET(request(`${reviewPath}?pending=1`, "GET", reviewerSession.token)), 200) as { items: PendingReview[] };
      const item = list.items.find((row) => row.assistantMessageId === assistantMessageId);
      assert(item, "Expected an unreviewed synthetic batch item");
      return { assistantMessageId, reviewVersion: item.reviewVersion };
    };
    const assertEligible = async (ref: PendingReview, isEligible: boolean) => {
      assert.equal((await check(await submit("preview", ref), 200)).trainingCandidateEligible, isEligible);
    };
    const select = async (ref: PendingReview) => {
      const decision = await check(await submit("approveTraining", ref), 200);
      assert.equal(decision.decision, "APPROVED");
      assert.equal(decision.trainingCandidateSelected, true);
      const stored = await candidate(ref);
      assert(stored);
      assert.equal(stored.userId, owner.id);
      assert.equal(stored.evaluationVersion, decision.evaluationVersion);
      assert.equal(stored.evidenceVersion, decision.evidenceVersion);
      assert.deepEqual(stored.material, { scores, strengths: ["understanding"], weaknesses: ["boundaries"] });
    };

    await check(await getConsent(), 401);
    await check(await consentApi.PUT(request(consentPath, "PUT", undefined, consent(true))), 401);
    assert.deepEqual(await check(await getConsent(ownerSession.token), 200), consent(false));
    await check(await putConsent({ enabled: true }), 409);
    await check(await putConsent({ enabled: true, noticeVersion: "outdated-notice" }), 409);
    await check(await putConsent({ ...consent(true), userId: other.id }), 400);
    assert.deepEqual(await check(await getConsent(ownerSession.token), 200), consent(false));

    const beforeConsent = await savePair("before consent", new Date(Date.now() - 60_000));
    await runBatch(1);
    const beforeConsentReview = await pending(beforeConsent.reply.id);
    await assertEligible(beforeConsentReview, false);
    await check(await submit("approveTraining", beforeConsentReview), 409);
    assert.equal(await candidate(beforeConsentReview), null);
    assert.equal(await prisma.chatReplyEvaluationReview.count({ where: { assistantMessageId: beforeConsent.reply.id } }), 0);
    assert.equal((await check(await submit("approve", beforeConsentReview), 200)).decision, "APPROVED");
    assert.equal(await candidate(beforeConsentReview), null);

    assert.deepEqual(await check(await putConsent(consent(true)), 200), consent(true));
    const grantedAt = (await getGrant()).grantedAt;
    const afterGrant = new Date(grantedAt.getTime() + 1);
    assert.deepEqual(await check(await getConsent(otherSession.token), 200), consent(false));
    assert.deepEqual(await check(await putConsent(consent(true)), 200), consent(true));
    assert.deepEqual((await getGrant()).grantedAt, grantedAt, "Repeating opt-in must preserve the original grant time");

    const mixedDates = await savePair("original before consent", new Date(grantedAt.getTime() - 1), afterGrant);
    const selected = await savePair("exact grant time", grantedAt, afterGrant);
    const fromFeedback = await savePair("later feedback", afterGrant);
    const fromSourceDelete = await savePair("later source removal", afterGrant);
    const fromRedaction = await savePair("later redaction", afterGrant);
    const alreadyRedacted = await savePair("redacted before review", afterGrant);
    const fromWithdrawal = await savePair("later withdrawal", afterGrant);
    await runBatch(7);
    const mixedReview = await pending(mixedDates.reply.id);
    await assertEligible(mixedReview, false);
    await check(await submit("approveTraining", mixedReview), 409);
    assert.equal((await check(await submit("approve", mixedReview), 200)).decision, "APPROVED");
    assert.equal(await candidate(mixedReview), null);

    const selectedReview = await pending(selected.reply.id);
    await assertEligible(selectedReview, true);
    await check(await review({ operation: "approveTraining", ...selectedReview }, ownerSession.token), 403);
    const selectedJob = await prisma.chatReplyEvaluationJob.findUniqueOrThrow({ where: { assistantMessageId: selected.reply.id } });
    assert(selectedJob.packet);
    await check(await review({ operation: "approveTraining", packet: selectedJob.packet }), 400);
    await select(selectedReview);
    await check(await submit("approveTraining", selectedReview), 409);
    assert.equal(await prisma.chatReplyTrainingCandidate.count({ where: { assistantMessageId: selected.reply.id } }), 1);
    assert.equal((await check(await review({ operation: "reject", packet: selectedJob.packet }), 200)).decision, "REJECTED");
    assert.equal(await candidate(selectedReview), null);
    assert.equal((await check(await review({ operation: "approve", packet: selectedJob.packet }), 200)).decision, "APPROVED");
    assert.equal(await candidate(selectedReview), null, "Ordinary approval cannot recreate a training candidate");

    const editedReview = await pending(fromFeedback.reply.id);
    await select(editedReview);
    await recordChatReplyFeedback({ userId: owner.id, assistantMessageId: fromFeedback.reply.id, signal: "HELPFUL", tags: null, comment: "稍后提供的合成反馈。" });
    assert.equal(await candidate(editedReview), null, "A new evidence revision immediately deletes the prior material");
    await check(await submit("approveTraining", editedReview), 409);

    const deletedSourceReview = await pending(fromSourceDelete.reply.id);
    await select(deletedSourceReview);
    await prisma.chatMessage.delete({ where: { id: fromSourceDelete.original.id } });
    assert.equal(await candidate(deletedSourceReview), null);
    assert.equal((await prisma.chatMessage.findUniqueOrThrow({ where: { id: fromSourceDelete.reply.id } })).replyToMessageId, null);

    const redactedReview = await pending(fromRedaction.reply.id);
    const raw = await rememberSource(fromRedaction.original);
    await select(redactedReview);
    await requestRedaction(raw.id);
    assert.equal(await candidate(redactedReview), null, "Redaction must delete derived material even while the source row remains");
    assert(await prisma.chatMessage.findUnique({ where: { id: fromRedaction.original.id } }));
    const redactedBeforeReview = await pending(alreadyRedacted.reply.id);
    await requestRedaction((await rememberSource(alreadyRedacted.original)).id);
    await assertEligible(redactedBeforeReview, false);
    await check(await submit("approveTraining", redactedBeforeReview), 409);
    assert.equal(await candidate(redactedBeforeReview), null);
    assert.equal((await check(await submit("approve", redactedBeforeReview), 200)).decision, "APPROVED");

    const withdrawnReview = await pending(fromWithdrawal.reply.id);
    await select(withdrawnReview);
    assert.deepEqual(await check(await putConsent({ enabled: false }), 200), consent(false));
    assert.deepEqual(await check(await getConsent(ownerSession.token), 200), consent(false));
    assert.equal(await candidate(withdrawnReview), null);
    assert.equal(await prisma.chatReplyEvaluationReview.count({ where: { assistantMessageId: fromWithdrawal.reply.id, decision: "APPROVED" } }), 1);

    assert.deepEqual(await check(await putConsent(consent(true)), 200), consent(true));
    const renewedAt = (await getGrant()).grantedAt;
    assert(renewedAt > grantedAt);
    const race = await savePair("concurrent withdrawal", renewedAt);
    await runBatch(3); // The changed-feedback and source-deletion jobs also need fresh scoring.
    const raceReview = await pending(race.reply.id);
    await assertEligible(raceReview, true);
    const [selection, withdrawal] = await Promise.all([submit("approveTraining", raceReview), putConsent({ enabled: false })]);
    assert([200, 409].includes(selection.status), `Unexpected concurrent selection status ${selection.status}`);
    assert.equal(selection.headers.get("cache-control"), "no-store");
    assert.deepEqual(await check(withdrawal, 200), consent(false));
    assert.equal(await prisma.chatReplyTrainingCandidate.count({ where: { userId: owner.id } }), 0);
    assert.equal(await prisma.chatReplyTrainingConsent.findUnique({ where: { userId: owner.id } }), null);
    if (selection.status === 409) assert.equal((await check(await submit("approve", raceReview), 200)).decision, "APPROVED");
    console.log("Chat reply training consent and candidate checks passed with synthetic isolated PostgreSQL data.");
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
