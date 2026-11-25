import assert from "node:assert/strict";
import type { MessageRole, MessageStatus } from "@prisma/client";
import { NextRequest } from "next/server";

const databaseUrl = process.env.CHAT_REPLY_FEEDBACK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("CHAT_REPLY_FEEDBACK_TEST_DATABASE_URL is required");
}
const { protocol, hostname, pathname, searchParams } = new URL(databaseUrl);
const databaseName = decodeURIComponent(pathname.replace(/^\/+/, ""));
if (
  !["postgres:", "postgresql:"].includes(protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
  searchParams.has("host") ||
  !/(?:^|[_-])(?:test|testing|spec|ci)(?:[_-]|$)/i.test(databaseName)
) {
  throw new Error("Feedback checks require a loopback PostgreSQL test database");
}

const run = async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "chat-reply-feedback-test-secret";
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const { POST } = await import("../app/api/chat/messages/[messageId]/feedback/route");
  const { readReplyFeedbackSnapshot } = await import("../services/ai/chatReplyFeedback");

  const fixtureUserIds: string[] = [];
  try {
    const [owner, other] = await prisma.$transaction([
      prisma.user.create({ data: {} }),
      prisma.user.create({ data: {} }),
    ]);
    fixtureUserIds.push(owner.id, other.id);
    const [{ token }, { token: otherToken }, chat, otherChat] = await Promise.all([
      createSession(owner.id),
      createSession(other.id),
      prisma.chatSession.create({ data: { userId: owner.id } }),
      prisma.chatSession.create({ data: { userId: owner.id } }),
    ]);
    const message = (
      role: MessageRole,
      content: string,
      secondsAfterStart: number,
      properties: { userId?: string; sessionId?: string; status?: MessageStatus; replyToMessageId?: string; contentDeletedAt?: Date } = {}
    ) => prisma.chatMessage.create({
      data: {
        userId: owner.id,
        sessionId: chat.id,
        role,
        content,
        createdAt: new Date(Date.UTC(2026, 10, 24, 0, 0, secondsAfterStart)),
        ...properties,
      },
    });
    const userMessage = await message("USER", "Synthetic initial user message", 0);
    const assistantMessage = await message("ASSISTANT", "Synthetic published reply", 1, {
      replyToMessageId: userMessage.id,
    });
    const [source, laterSource, wrongOwner, wrongChat, blockedSource, wrongRole, sameTime, blockedTarget, deletedSource, deletedTarget] =
      await Promise.all([
        message("USER", "Synthetic explicit feedback message", 2),
        message("USER", "Synthetic later correction", 3),
        message("USER", "Synthetic wrong owner", 2, { userId: other.id }),
        message("USER", "Synthetic wrong chat", 2, { sessionId: otherChat.id }),
        message("USER", "Synthetic blocked source", 2, { status: "BLOCKED" }),
        message("ASSISTANT", "Synthetic wrong role", 2),
        message("USER", "Synthetic simultaneous message", 1),
        message("ASSISTANT", "Synthetic blocked reply", 1, { status: "BLOCKED" }),
        message("USER", "Synthetic marker-only deleted source", 2, { contentDeletedAt: new Date() }),
        message("ASSISTANT", "Synthetic marker-only deleted reply", 1, { contentDeletedAt: new Date() }),
      ]);

    const post = (
      body: Record<string, unknown>,
      options: { messageId?: string; authorization?: string } = {}
    ) => {
      const messageId = options.messageId ?? assistantMessage.id;
      return POST(new NextRequest(`http://localhost/api/chat/messages/${messageId}/feedback`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.authorization ?? token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }), { params: Promise.resolve({ messageId }) });
    };
    const snapshot = async () => {
      const value = await readReplyFeedbackSnapshot({ userId: owner.id, assistantMessageId: assistantMessage.id });
      assert(value);
      return value;
    };
    const reference = ({ id, content }: { id: string; content: string }) => ({ id, content });
    const initial = await snapshot();
    assert.deepEqual(initial.assistantMessage, reference(assistantMessage));
    assert.deepEqual(initial.userMessage, reference(userMessage));
    assert.deepEqual(initial.feedback, [], "Subsequent chat messages do not attach themselves");

    for (const candidate of [wrongOwner, wrongChat, blockedSource, deletedSource, wrongRole, sameTime, userMessage]) {
      const response = await post({ signal: "helpful", sourceMessageId: candidate.id });
      assert(response.status >= 400 && response.status < 500, `Invalid source accepted: ${candidate.content}`);
    }
    assert.equal((await post({ signal: "helpful", sourceMessageId: 5 })).status, 400);
    assert.equal((await post({ signal: "helpful" }, { authorization: otherToken })).status, 404);
    assert.equal((await post({ signal: "helpful" }, { messageId: blockedTarget.id })).status, 404);
    assert.equal(await readReplyFeedbackSnapshot({ userId: other.id, assistantMessageId: assistantMessage.id }), null);
    assert.equal(await readReplyFeedbackSnapshot({ userId: owner.id, assistantMessageId: blockedTarget.id }), null);
    assert.equal((await post({ signal: "helpful" }, { messageId: deletedTarget.id })).status, 404);
    assert.equal(await readReplyFeedbackSnapshot({ userId: owner.id, assistantMessageId: deletedTarget.id }), null);
    assert.equal((await snapshot()).version, initial.version, "Rejected links must not change feedback");

    const direct = await post({ signal: "too_mechanical", comment: "Synthetic direct feedback" });
    assert.equal(direct.status, 201);
    const { data: directData } = await direct.json();
    assert.equal(directData.signal, "too_mechanical");
    assert(Number.isFinite(Date.parse(directData.createdAt)));
    assert(Number.isFinite(Date.parse(directData.updatedAt)));
    const directSnapshot = await snapshot();
    assert.equal(directSnapshot.feedback.length, 1);
    assert.equal(directSnapshot.feedback[0].sourceMessage, null);
    assert.notEqual(directSnapshot.version, initial.version);

    const explicit = { signal: "helpful", comment: "Synthetic linked feedback", tags: ["fixture"], sourceMessageId: source.id };
    const simultaneous = await Promise.all([post(explicit), post(explicit)]);
    assert.deepEqual(simultaneous.map((response) => response.status), [201, 201]);
    const linked = await snapshot();
    assert.equal(linked.feedback.length, 2);
    const linkedRow = linked.feedback.find((feedback) => feedback.id !== directData.id);
    assert(linkedRow);
    assert.deepEqual(linkedRow.sourceMessage, reference(source));
    assert.deepEqual(linkedRow.tags, explicit.tags);
    assert.notEqual(linked.version, directSnapshot.version);

    assert.equal((await post(explicit)).status, 201);
    const repeated = await snapshot();
    assert.equal(repeated.version, linked.version, "Identical feedback must keep the same input version");
    assert.equal(repeated.feedback.length, 2);

    const legacyEdit = { signal: "helpful", comment: "Synthetic changed feedback", tags: ["fixture"] };
    assert.equal((await post(legacyEdit)).status, 201);
    const edited = await snapshot();
    assert.notEqual(edited.version, repeated.version);
    const editedRow = edited.feedback.find((feedback) => feedback.id === linkedRow.id);
    assert.equal(editedRow?.comment, legacyEdit.comment);
    assert.deepEqual(editedRow?.sourceMessage, reference(source), "Omission must preserve the existing link");

    assert.equal((await post({ ...legacyEdit, sourceMessageId: null })).status, 201);
    const detached = await snapshot();
    assert.notEqual(detached.version, edited.version);
    assert.equal(detached.feedback.find((feedback) => feedback.id === linkedRow.id)?.sourceMessage, null);

    assert.equal((await post({ ...legacyEdit, sourceMessageId: laterSource.id })).status, 201);
    const relinked = await snapshot();
    assert.notEqual(relinked.version, detached.version);
    assert.equal(relinked.feedback.length, 2, "Later feedback must update the same signal row");
    assert.deepEqual(relinked.feedback.find((feedback) => feedback.id === linkedRow.id)?.sourceMessage, reference(laterSource));

    await prisma.chatMessage.update({ where: { id: laterSource.id }, data: { status: "BLOCKED" } });
    const hidden = await snapshot();
    assert.notEqual(hidden.version, relinked.version);
    assert.deepEqual(hidden.feedback.map((feedback) => feedback.id), [directData.id], "A blocked source must disappear from evaluation");
    await prisma.chatMessage.update({ where: { id: laterSource.id }, data: { status: "SAVED" } });
    await prisma.chatMessage.update({ where: { id: laterSource.id }, data: { contentDeletedAt: new Date() } });
    assert.deepEqual((await snapshot()).feedback.map((feedback) => feedback.id), [directData.id], "A deletion marker must override status when selecting evidence");
    await prisma.chatMessage.delete({ where: { id: laterSource.id } });
    const afterDeletion = await snapshot();
    assert.notEqual(afterDeletion.version, relinked.version);
    assert.deepEqual(afterDeletion.feedback.map((feedback) => feedback.id), [directData.id]);
    assert.equal(await prisma.aiMessageFeedback.count({ where: { id: linkedRow.id } }), 0, "Source deletion must remove linked feedback");
    console.log("Chat reply feedback checks passed with synthetic isolated PostgreSQL data.");
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
