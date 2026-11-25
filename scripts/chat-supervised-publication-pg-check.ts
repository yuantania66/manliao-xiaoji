import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { ChatExecutionTrace } from "../services/ai/chatExecutionLifecycle";

const databaseUrl = process.env.CHAT_SUPERVISED_PUBLICATION_TEST_DATABASE_URL;
assert.ok(databaseUrl, "CHAT_SUPERVISED_PUBLICATION_TEST_DATABASE_URL is required");
const database = new URL(databaseUrl);
assert.ok(["postgresql:", "postgres:"].includes(database.protocol));
assert.ok(["127.0.0.1", "[::1]"].includes(database.hostname));
assert.match(decodeURIComponent(database.pathname.slice(1)), /(?:^|[_-])(?:test|testing|spec|ci)(?:[_-]|$)/i);
assert.ok(!database.searchParams.has("host"));
process.env.DATABASE_URL = databaseUrl;

async function main() {
  const { prisma } = await import("../lib/prisma");
  const { commitValidatedAssistantMessage } = await import("../services/ai/chatReplyService");
  const userId = `supervision-test-${randomUUID()}`;

  try {
    await prisma.user.create({ data: { id: userId } });
    const session = await prisma.chatSession.create({ data: { userId } });
    const content = "Synthetic reply for supervised commit.";

    async function prepareTurn() {
      const turn = await prisma.chatMessage.create({
        data: { userId, sessionId: session.id, role: "USER", content: "Synthetic user turn." },
      });
      const requestId = randomUUID();
      const attemptId = randomUUID();
      const generation = await prisma.aiGeneration.create({
        data: {
          userId, sessionId: session.id, sourceType: "CHAT", sourceId: turn.id,
          requestId, turnId: turn.id, attemptId, model: "test-only", promptVersion: "test-only",
          inputText: turn.content, outputText: content, status: "GENERATED",
        },
      });
      const execution: ChatExecutionTrace = {
        requestId, turnId: turn.id, conversationId: session.id, planId: "synthetic-plan",
        phase: "GENERATED", planPreflight: { passed: true, failureReasons: [] }, transitions: [],
        attempts: [{ attemptId, phase: "GENERATED", generation: { text: content, model: "test-only",
          promptVersion: "test-only", latencyMs: 0, finalReplySource: "llm" } }],
        publication: {
          version: 1, outcome: "ordinary", winnerAttemptId: attemptId,
          risk: { route: "ordinary", currentness: "current", subject: "none", evidence: [] },
          reviews: [], stages: [], elapsedMs: 0,
        },
      };
      return {
        turnId: turn.id,
        commit: () => commitValidatedAssistantMessage({
          userId, sessionId: session.id, replyToMessageId: turn.id,
          content, status: "SAVED", aiGenerationId: generation.id, interactionMetadata: null, envelopeOrigin: null, execution,
        }),
      };
    }

    const ready = await prepareTurn();
    const committed = await ready.commit();
    assert.equal((await ready.commit()).id, committed.id);
    assert.equal(await prisma.chatMessage.count({ where: { replyToMessageId: ready.turnId } }), 1);
    assert.equal((await prisma.chatMessage.findUniqueOrThrow({ where: { id: committed.id } })).interactionMetadata, null);
    assert.equal(await prisma.chatReplyEvaluationJob.count({ where: { assistantMessageId: committed.id } }), 1);
    await prisma.chatMessage.update({
      where: { id: committed.id },
      data: { status: "BLOCKED", content: "", contentDeletedAt: new Date() },
    });
    await assert.rejects(() => ready.commit(), /does not match|no longer visible/u);

    const pending = await prepareTurn();
    const changed = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const tombstone = prisma.$transaction(async (tx) => {
      await tx.chatMessage.update({
        where: { id: pending.turnId },
        data: { status: "BLOCKED", content: "", contentDeletedAt: new Date() },
      });
      changed.resolve();
      await release.promise;
    }, { timeout: 8000 });
    const failedDeletion = tombstone.then(() => undefined, (error: unknown) => changed.reject(error));
    let commitResult: Promise<unknown> | undefined;
    let waitingOnSource = false;
    try {
      await changed.promise;
      commitResult = pending.commit().then(() => null, (error: unknown) => error);
      const started = Date.now();
      while (!waitingOnSource && Date.now() - started < 3000) {
        const [row] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%FOR SHARE%'
          ) AS waiting
        `;
        waitingOnSource = row.waiting;
        if (!waitingOnSource) await delay(25);
      }
    } finally {
      release.resolve();
      await failedDeletion;
    }
    await tombstone;
    const concurrentResult = await commitResult;
    assert.equal(waitingOnSource, true, "publication must wait for the concurrent source update");
    assert.match(String(concurrentResult), /does not match|no longer visible/u);
    assert.equal(await prisma.chatMessage.count({ where: { replyToMessageId: pending.turnId } }), 0);
    console.log("Supervised PostgreSQL commit passed: one visible winner, withheld tombstone replay and concurrent deletion.");
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
