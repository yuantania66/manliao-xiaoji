import assert from "node:assert/strict";
import type { AiModelMessage } from "../services/ai/types";

const databaseUrl = process.env.CHAT_REPLY_EVALUATION_BATCH_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CHAT_REPLY_EVALUATION_BATCH_TEST_DATABASE_URL is required");
const databaseError = "Evaluation batch checks require a loopback PostgreSQL test database";
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

type EvaluationInput = {
  assistantMessage: { sourceId: string; content: string };
  feedback: Array<{ sourceMessage: { sourceId: string; content: string } | null }>;
};

const evaluateFixture = async (messages: AiModelMessage[]) => {
  const input = JSON.parse(messages.at(-1)!.content) as EvaluationInput;
  const evidence = [{ sourceId: input.assistantMessage.sourceId, quote: input.assistantMessage.content }];
  const score = { score: 4, reason: "Synthetic score rationale", evidence };
  const source = input.feedback[0]?.sourceMessage;
  return JSON.stringify({
    scores: { understanding: score, responsiveness: score, boundaries: score, expression: score },
    strengths: [],
    weaknesses: [{ dimension: "responsiveness", observation: "Synthetic observation", evidence, nextAction: "Acknowledge first." }],
    reportedImpact: source ? { sourceId: source.sourceId, quote: source.content } : null,
  });
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
};

const run = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "synthetic-reply-evaluation-batch-test-secret";
  const { prisma } = await import("../lib/prisma");
  const { runChatReplyEvaluationBatch } = await import("../services/ai/chatReplyEvaluationBatch");
  const { recordChatReplyFeedback, readReplyFeedbackSnapshot } = await import("../services/ai/chatReplyFeedback");
  const { previewChatReplyReviewPacket } = await import("../services/ai/chatReplyReviewPacket");

  let userId: string | undefined;
  try {
    assert.equal(await prisma.chatReplyEvaluationJob.count(), 0, "Use an empty evaluation queue for this check");
    const owner = await prisma.user.create({ data: {} });
    userId = owner.id;
    const chat = await prisma.chatSession.create({ data: { userId } });
    const save = (role: "USER" | "ASSISTANT" | "SYSTEM", content: string, second: number, properties: {
      replyToMessageId?: string;
      status?: "SAVED" | "BLOCKED";
    } = {}) => prisma.chatMessage.create({
      data: {
        sessionId: chat.id,
        userId: owner.id,
        role,
        content,
        createdAt: new Date(Date.UTC(2026, 10, 24, 0, 0, second)),
        ...properties,
      },
    });
    const original = await save("USER", "Synthetic original request", 0);
    const reply = await save("ASSISTANT", "Synthetic published reply", 1, { replyToMessageId: original.id });
    const linkedSource = await save("USER", "Synthetic feedback: that reply made me feel understood", 2);
    await save("SYSTEM", "Synthetic unrelated system event", 3);
    await save("ASSISTANT", "Synthetic blocked reply", 4, { status: "BLOCKED" });
    assert.deepEqual(await prisma.chatReplyEvaluationJob.findMany({
      select: { assistantMessageId: true },
    }), [{ assistantMessageId: reply.id }], "Only visible assistant replies are enqueued");

    const target = { userId, assistantMessageId: reply.id };
    const job = () => prisma.chatReplyEvaluationJob.findUniqueOrThrow({ where: { assistantMessageId: reply.id } });
    const feedback = (comment: string) => recordChatReplyFeedback({
      ...target, signal: "HELPFUL", tags: null, comment, sourceMessageId: linkedSource.id,
    });
    const noWork = { completed: 0, failed: 0, superseded: 0, skipped: 0 };
    const batch = (cutoff?: Date) => runChatReplyEvaluationBatch({ evaluate: evaluateFixture, limit: 20, cutoff });
    const initialJob = await job();
    assert.equal(initialJob.packet, null);
    assert.deepEqual(await batch(new Date(initialJob.availableAt.getTime() - 1)), noWork);
    assert.equal((await batch()).completed, 1);
    const initial = await job();
    assert(initial.packet && initial.completedAt);
    assert.equal(initial.evidenceVersion, (await readReplyFeedbackSnapshot(target))?.version);
    const preview = await previewChatReplyReviewPacket(initial.packet);
    assert.equal(preview.assistantMessageId, reply.id);
    assert.equal(preview.evaluation.reviewStatus, "pending_human_review");
    assert.equal(preview.evidence.userMessage?.id, original.id);
    assert.deepEqual(preview.evidence.feedback, []);
    const unrelated = await save("USER", "Synthetic unrelated continuation", 5);
    await prisma.chatMessage.update({ where: { id: unrelated.id }, data: { content: "Unrelated edit" } });
    assert.deepEqual(await batch(), noWork);
    assert.equal((await job()).packet, initial.packet, "Repeating the batch preserves the completed packet");

    await feedback("Synthetic late feedback");
    const queued = await job();
    assert(queued.revision > initial.revision);
    assert.equal(queued.packet, null);
    await assert.rejects(() => previewChatReplyReviewPacket(initial.packet!), { status: 409 });

    const entered = deferred();
    const resume = deferred();
    const inflight = runChatReplyEvaluationBatch({
      limit: 1,
      evaluate: async (messages) => {
        entered.resolve();
        await resume.promise;
        return evaluateFixture(messages);
      },
    });
    try {
      await Promise.race([entered.promise, inflight.then(() => assert.fail("Worker did not enter the evaluator"))]);
      const concurrent = await runChatReplyEvaluationBatch({
        limit: 1,
        evaluate: async () => assert.fail("A concurrent worker started the same job"),
      });
      assert.deepEqual(concurrent, noWork);
      await feedback("Synthetic edited feedback while scoring");
      const changed = await job();
      assert(changed.revision > queued.revision);
      assert.equal(changed.packet, null);
    } finally {
      resume.resolve();
      await inflight;
    }
    assert.equal((await inflight).superseded, 1, "The in-flight older revision may not publish");
    assert.equal((await job()).packet, null);
    assert.equal((await batch()).completed, 1);
    const revised = await job();
    assert(revised.packet);
    const revisedPreview = await previewChatReplyReviewPacket(revised.packet);
    assert.deepEqual(revisedPreview.evaluation.reportedImpact, {
      status: "user_reported", sourceId: linkedSource.id, quote: linkedSource.content,
    });
    assert.equal(revisedPreview.evidence.feedback[0].comment, "Synthetic edited feedback while scoring");

    await feedback("Synthetic edited feedback while scoring");
    const repeated = await job();
    assert.equal(repeated.revision, revised.revision, "Identical feedback leaves the completed revision intact");
    assert.equal(repeated.packet, revised.packet);
    assert.deepEqual(await batch(), noWork);

    const editedSource = await prisma.chatMessage.update({
      where: { id: linkedSource.id }, data: { content: "Synthetic correction: that reply felt too generic" },
    });
    await assert.rejects(() => previewChatReplyReviewPacket(revised.packet!), { status: 409 });
    assert.equal((await batch()).completed, 1);
    const edited = await job();
    assert(edited.packet);
    assert.deepEqual((await previewChatReplyReviewPacket(edited.packet)).evaluation.reportedImpact, {
      status: "user_reported", sourceId: editedSource.id, quote: editedSource.content,
    });

    await prisma.chatMessage.delete({ where: { id: linkedSource.id } });
    assert.equal((await job()).packet, null, "Deleting an explicit source clears its stored packet");
    await assert.rejects(() => previewChatReplyReviewPacket(edited.packet!), { status: 409 });
    assert.equal((await batch()).completed, 1);
    const withoutFeedback = await job();
    assert(withoutFeedback.packet);
    assert.equal((await previewChatReplyReviewPacket(withoutFeedback.packet)).evaluation.reportedImpact.status, "unknown");

    await prisma.chatMessage.delete({ where: { id: original.id } });
    assert.equal((await job()).packet, null, "Deleting the original request clears its stored packet");
    await assert.rejects(() => previewChatReplyReviewPacket(withoutFeedback.packet!), { status: 409 });
    await prisma.chatReplyEvaluationJob.update({
      where: { assistantMessageId: reply.id },
      data: { leaseToken: "synthetic-interrupted-worker", leaseUntil: new Date(Date.now() + 60_000) },
    });
    assert.deepEqual(await batch(), noWork, "A still-live lease prevents reclaim");
    await prisma.chatReplyEvaluationJob.update({
      where: { assistantMessageId: reply.id },
      data: { leaseUntil: new Date(0) },
    });
    assert.equal((await batch()).completed, 1, "An expired lease allows an interrupted job to finish");
    const reclaimed = await job();
    assert(reclaimed.packet);
    assert.equal((await previewChatReplyReviewPacket(reclaimed.packet)).evidence.userMessage, null);

    const retryTarget = await save("ASSISTANT", "Synthetic provider-retry reply", 6);
    const cutoff = new Date();
    let failures = 0;
    const failed = await runChatReplyEvaluationBatch({
      limit: 20,
      cutoff,
      evaluate: async () => {
        failures += 1;
        throw new Error("Synthetic evaluator failure");
      },
    });
    assert.equal(failed.failed, 1);
    assert.equal(failures, 1);
    const retry = await prisma.chatReplyEvaluationJob.findUniqueOrThrow({ where: { assistantMessageId: retryTarget.id } });
    assert.equal(retry.packet, null);
    assert(retry.availableAt > cutoff, "Failures must wait until a later batch");
    assert.deepEqual(await batch(cutoff), noWork);
    assert.equal((await batch(retry.availableAt)).completed, 1);

    await prisma.chatMessage.delete({ where: { id: reply.id } });
    assert.equal(await prisma.chatReplyEvaluationJob.count({ where: { assistantMessageId: reply.id } }), 0);
    await assert.rejects(() => previewChatReplyReviewPacket(reclaimed.packet!), { status: 404 });
    console.log("Chat reply evaluation batch checks passed with synthetic isolated PostgreSQL data.");
  } finally {
    try {
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.$disconnect();
    }
  }
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
