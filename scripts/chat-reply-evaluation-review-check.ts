import assert from "node:assert/strict";

import { AppError } from "../lib/errors";
import { evaluateChatReply } from "../services/ai/chatReplyEvaluation";
import type { readReplyFeedbackSnapshot } from "../services/ai/chatReplyFeedback";

const databaseUrl = process.env.CHAT_REPLY_EVALUATION_REVIEW_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("CHAT_REPLY_EVALUATION_REVIEW_TEST_DATABASE_URL is required");
}
const { protocol, hostname, pathname, searchParams } = new URL(databaseUrl);
const databaseName = decodeURIComponent(pathname.replace(/^\/+/, ""));
if (
  !["postgres:", "postgresql:"].includes(protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
  searchParams.has("host") ||
  !/(?:^|[_-])(?:test|testing|spec|ci)(?:[_-]|$)/i.test(databaseName)
) {
  throw new Error("Review checks require a loopback PostgreSQL test database");
}

type Snapshot = NonNullable<Awaited<ReturnType<typeof readReplyFeedbackSnapshot>>>;

const draft = (snapshot: Snapshot, {
  reason = "Synthetic full evaluation rationale",
  nextAction = "Acknowledge the request before giving suggestions.",
} = {}) => {
  const evidence = [{ sourceId: snapshot.assistantMessage.id, quote: snapshot.assistantMessage.content }];
  const score = { score: 4, reason, evidence };
  const source = snapshot.feedback[0]?.sourceMessage;
  return evaluateChatReply(snapshot, async () => JSON.stringify({
    scores: { understanding: score, responsiveness: score, boundaries: score, expression: score },
    strengths: [{ dimension: "boundaries", observation: "Synthetic complete strength", evidence }],
    weaknesses: [{ dimension: "responsiveness", observation: "Synthetic complete weakness", evidence, nextAction }],
    reportedImpact: source ? { sourceId: source.id, quote: source.content } : null,
  }));
};

const run = async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { prisma } = await import("../lib/prisma");
  const { readReplyFeedbackSnapshot, recordChatReplyFeedback } = await import("../services/ai/chatReplyFeedback");
  const { recordChatReplyEvaluationReview, readApprovedChatReplyAdvice } = await import("../services/ai/chatReplyEvaluationReview");

  const fixtureUserIds: string[] = [];
  try {
    const [owner, other] = await prisma.$transaction([
      prisma.user.create({ data: {} }),
      prisma.user.create({ data: {} }),
    ]);
    fixtureUserIds.push(owner.id, other.id);
    const session = await prisma.chatSession.create({ data: { userId: owner.id } });
    const message = (role: "USER" | "ASSISTANT", content: string, seconds: number, replyToMessageId?: string) =>
      prisma.chatMessage.create({
        data: {
          userId: owner.id,
          sessionId: session.id,
          role,
          content,
          createdAt: new Date(Date.UTC(2026, 10, 24, 0, 0, seconds)),
          replyToMessageId,
        },
      });
    const prompt = await message("USER", "Synthetic private user request", 0);
    const reply = await message("ASSISTANT", "Synthetic private published reply", 1, prompt.id);
    const source = await message("USER", "Synthetic private impact report", 2);
    const target = { userId: owner.id, assistantMessageId: reply.id };
    const reviewerId = "synthetic-human-reviewer";
    const addFeedback = (comment: string) => recordChatReplyFeedback({
      ...target,
      signal: "HELPFUL",
      tags: null,
      comment,
      sourceMessageId: source.id,
    });
    const snapshot = async () => {
      const current = await readReplyFeedbackSnapshot(target);
      assert(current);
      return current;
    };
    const approvals = () => prisma.chatReplyEvaluationReview.findMany({ where: { assistantMessageId: reply.id } });

    await addFeedback("Synthetic private feedback comment");
    const initial = await snapshot();
    const evaluation = await draft(initial);
    const request = { ...target, evaluation };
    assert.equal(await readApprovedChatReplyAdvice(request), null, "A validated draft alone must not expose advice");
    await assert.rejects(() => recordChatReplyEvaluationReview({
      ...request, reviewerId: " ", decision: "APPROVED",
    }), AppError);
    assert.equal((await approvals()).length, 0, "A blank reviewer must not create approval");
    await recordChatReplyEvaluationReview({ ...request, reviewerId, decision: "APPROVED" });

    const approved = await readApprovedChatReplyAdvice(request);
    assert(approved);
    assert.equal(approved.evidenceVersion, initial.version);
    assert(typeof approved.evaluationVersion === "string" && approved.evaluationVersion.length > 0);
    assert.deepEqual(approved, {
      evidenceVersion: initial.version,
      evaluationVersion: approved.evaluationVersion,
      advice: [{ dimension: "responsiveness", nextAction: evaluation.weaknesses[0].nextAction }],
    }, "Return approved actions without exposing scores, quotations, private evidence or reviewer data");
    const stored = await approvals();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].decision, "APPROVED");
    assert.equal(stored[0].reviewerId, reviewerId);
    assert.equal(stored[0].evidenceVersion, approved.evidenceVersion);
    assert.equal(stored[0].evaluationVersion, approved.evaluationVersion);

    const reordered: typeof evaluation = JSON.parse(JSON.stringify(evaluation, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value
    ));
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(evaluation));
    assert.deepEqual(await readApprovedChatReplyAdvice({ ...target, evaluation: reordered }), approved);

    const mutable = structuredClone(evaluation);
    const pendingRead = readApprovedChatReplyAdvice({ ...target, evaluation: mutable });
    mutable.weaknesses[0].nextAction = "Synthetic unapproved mutation";
    assert.deepEqual(await pendingRead, approved, "A pending read must keep the approved captured advice");

    const changedAdvice = await draft(initial, { nextAction: "Offer a shorter concrete suggestion." });
    assert.equal(await readApprovedChatReplyAdvice({ ...target, evaluation: changedAdvice }), null);
    const changedRationale = await draft(initial, { reason: "Synthetic changed full rationale with the same advice" });
    const rationaleRequest = { ...target, evaluation: changedRationale };
    assert.deepEqual(changedRationale.weaknesses, evaluation.weaknesses);
    assert.equal(await readApprovedChatReplyAdvice(rationaleRequest), null, "Unchanged advice does not cover a changed evaluation");
    await recordChatReplyEvaluationReview({ ...rationaleRequest, reviewerId, decision: "APPROVED" });
    const approvedRationale = await readApprovedChatReplyAdvice(rationaleRequest);
    assert(approvedRationale);
    assert.deepEqual(approvedRationale.advice, approved.advice);
    assert.notEqual(approvedRationale.evaluationVersion, approved.evaluationVersion);

    const foreignRequest = { ...rationaleRequest, userId: other.id };
    assert.equal(await readApprovedChatReplyAdvice(foreignRequest), null);
    await assert.rejects(() => recordChatReplyEvaluationReview({
      ...foreignRequest, reviewerId, decision: "APPROVED",
    }), AppError);
    assert.deepEqual(await readApprovedChatReplyAdvice(rationaleRequest), approvedRationale);

    await recordChatReplyEvaluationReview({ ...rationaleRequest, reviewerId, decision: "REJECTED" });
    assert.equal(await readApprovedChatReplyAdvice(rationaleRequest), null, "Rejection must revoke approval");
    await recordChatReplyEvaluationReview({ ...rationaleRequest, reviewerId, decision: "APPROVED" });
    assert.deepEqual(await readApprovedChatReplyAdvice(rationaleRequest), approvedRationale);

    await addFeedback("Synthetic edited private feedback comment");
    const edited = await snapshot();
    assert.notEqual(edited.version, initial.version);
    assert.equal(await readApprovedChatReplyAdvice(rationaleRequest), null, "Edited feedback invalidates approval");
    await assert.rejects(() => recordChatReplyEvaluationReview({
      ...rationaleRequest, reviewerId, decision: "APPROVED",
    }), AppError);
    const editedRequest = { ...target, evaluation: await draft(edited) };
    assert.equal(await readApprovedChatReplyAdvice(editedRequest), null);
    await recordChatReplyEvaluationReview({ ...editedRequest, reviewerId, decision: "APPROVED" });
    assert(await readApprovedChatReplyAdvice(editedRequest));

    await prisma.chatMessage.delete({ where: { id: source.id } });
    const withoutSource = await snapshot();
    assert.notEqual(withoutSource.version, edited.version);
    assert.equal(await readApprovedChatReplyAdvice(editedRequest), null, "Deleting the evidence invalidates advice");
    await assert.rejects(() => recordChatReplyEvaluationReview({
      ...editedRequest, reviewerId, decision: "APPROVED",
    }), AppError);
    const currentRequest = { ...target, evaluation: await draft(withoutSource) };
    assert.equal(await readApprovedChatReplyAdvice(currentRequest), null);
    await recordChatReplyEvaluationReview({ ...currentRequest, reviewerId, decision: "APPROVED" });
    assert(await readApprovedChatReplyAdvice(currentRequest));
    assert((await approvals()).length > 0);

    await prisma.chatMessage.delete({ where: { id: reply.id } });
    assert.equal(await readApprovedChatReplyAdvice(currentRequest), null);
    assert.equal((await approvals()).length, 0, "Deleting the target must remove stored reviews");
    console.log("Chat reply evaluation review checks passed with synthetic isolated PostgreSQL data.");
  } finally {
    try {
      if (fixtureUserIds.length) await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
