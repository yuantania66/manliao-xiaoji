import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "next/dist/server/node-environment-baseline.js";
import type { WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import type { AiModelMessage } from "../services/ai/types";

const databaseUrl = process.env.CHAT_APPROVED_ADVICE_ROUTE_TEST_DATABASE_URL?.trim();
assert(databaseUrl, "CHAT_APPROVED_ADVICE_ROUTE_TEST_DATABASE_URL is required");
const database = new URL(databaseUrl);
assert(["postgresql:", "postgres:"].includes(database.protocol), "Expected PostgreSQL");
assert(["127.0.0.1", "[::1]"].includes(database.hostname), "Expected a loopback database");
assert.match(decodeURIComponent(database.pathname), /^\/[\w-]+_test$/iu);
assert(![...database.searchParams.keys()].some((key) => /^host(addr)?$/iu.test(key)), "Host override is not allowed");

const qwenUrl = "https://approved-advice-route.invalid/v1";
const advice = "先回应用户眼下的需要，再给出一个低压力的选择。";
const copiedAdvice = `给你的建议是：“${advice.replace("，", "，\n")}”`;
const originalText = "合成原话：我正在整理租房预算。";
const requestText = "接着聊上次说的租房预算。";
const topic = "租房预算";
const ordinaryReply = "我们可以接着聊租房预算，先沿着已经说到的部分。";
const originalReply = "合成历史回复内容。";

type OfferedSource = { sourceRef: string; text: string; createdAt: string };
type Reference = { sourceRef: string; currentQuote: string; sourceQuote: string };
const validReference = (sources: OfferedSource[]): Reference | null => {
  const original = sources.find(({ text }) => text === originalText);
  return original ? { sourceRef: original.sourceRef, currentQuote: topic, sourceQuote: topic } : null;
};
const evaluationOutput = async (messages: AiModelMessage[]) => {
  const { assistantMessage, userMessage } = JSON.parse(messages.at(-1)!.content) as {
    assistantMessage: { sourceId: string; content: string };
    userMessage: { sourceId: string; content: string };
  };
  const score = { score: 4, reason: "合成评语只用于审核。", evidence: [{ sourceId: assistantMessage.sourceId, quote: assistantMessage.content }] };
  return JSON.stringify({
    scores: { understanding: score, responsiveness: score, boundaries: score, expression: score },
    strengths: [],
    weaknesses: [{
      dimension: "responsiveness", observation: "这项改法依据合成用户原话。",
      evidence: [{ sourceId: userMessage.sourceId, quote: userMessage.content }],
      nextAction: advice,
    }],
    reportedImpact: null,
  });
};

async function main() {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "synthetic-approved-advice-route-secret";
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "synthetic-approved-advice-route-key";
  process.env.QWEN_BASE_URL = qwenUrl;
  process.env.AI_MAIN_MODEL = "qwen-fixture-main";
  process.env.AI_SAFETY_MODEL = "qwen-fixture-safety";
  process.env.AI_EXTRACTOR_MODEL = "qwen-fixture-extractor";
  process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = "true";
  process.env.HILL_HELPING_SHADOW = "false";
  process.env.HILL_HELPING_ORDINARY_HANDOFF = "false";
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../app/api/chat/sessions/[sessionId]/messages/route");
  const { prisma } = await import("../lib/prisma");
  const { createSession } = await import("../lib/auth");
  const { runChatReplyEvaluationBatch } = await import("../services/ai/chatReplyEvaluationBatch");
  const { decideChatReplyReviewPacket, readApprovedChatReplyAdviceForSource } = await import("../services/ai/chatReplyReviewPacket");

  const previousFetch = globalThis.fetch;
  const ids: string[] = [];
  try {
    assert.equal(await prisma.chatReplyEvaluationJob.count(), 0, "Use an isolated database with an empty evaluation queue");
    const [owner, reviewer, other] = await prisma.$transaction(Array.from({ length: 3 }, () => prisma.user.create({ data: {} })));
    ids.push(owner.id, reviewer.id, other.id);
    const sourceSession = await prisma.chatSession.create({ data: { userId: owner.id } });
    const sourceTime = Date.now() - 60_000;
    const source = await prisma.chatMessage.create({
      data: { userId: owner.id, sessionId: sourceSession.id, role: "USER", content: originalText, createdAt: new Date(sourceTime) },
    });
    const historicalReply = await prisma.chatMessage.create({
      data: {
        userId: owner.id, sessionId: sourceSession.id, role: "ASSISTANT", replyToMessageId: source.id,
        content: originalReply, createdAt: new Date(sourceTime + 1_000),
      },
    });
    assert.deepEqual(await runChatReplyEvaluationBatch({ evaluate: evaluationOutput, limit: 10 }),
      { completed: 1, failed: 0, skipped: 0, superseded: 0 });
    const { packet } = await prisma.chatReplyEvaluationJob.findUniqueOrThrow({ where: { assistantMessageId: historicalReply.id } });
    assert(packet);
    const review = (decision: "APPROVED" | "REJECTED") => decideChatReplyReviewPacket({ packet, reviewerId: reviewer.id, decision });
    assert.equal(await readApprovedChatReplyAdviceForSource({ userId: owner.id, sourceTurnId: source.id, text: source.content }), null);
    await review("APPROVED");

    const { token: ownerToken } = await createSession(owner.id);
    const { token: otherToken } = await createSession(other.id);

    const send = async (sessionId: string, token: string, turnId: string, content: string) => {
      const tasks: unknown[] = [];
      const store = { afterContext: { after: (task: unknown) => tasks.push(task) } } as unknown as WorkStore;
      const response = await workAsyncStorage.run(store, () => POST(new NextRequest(
        `http://localhost/api/chat/sessions/${sessionId}/messages`,
        { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ turnId, content }) },
      ), { params: Promise.resolve({ sessionId }) }));
      return { response, payload: await response.json(), tasks };
    };

    const run = async ({ label, content = requestText, userId = owner.id, token = ownerToken, reference = validReference,
      onInterpret, expectAdvice, expectOffered = true, expectAmbiguous = false, replay = false, sameSession = false, echoCount = 0 }:
      { label: string; content?: string; userId?: string; token?: string; reference?: (offered: OfferedSource[]) => Reference | null;
        onInterpret?: () => Promise<unknown>; expectAdvice: boolean; expectOffered?: boolean; expectAmbiguous?: boolean; replay?: boolean;
        sameSession?: boolean; echoCount?: number }) => {
      const session = sameSession ? sourceSession : await prisma.chatSession.create({ data: { userId } });
      const turnId = `advice-route-${randomUUID()}`;
      const calls: string[] = [];
      const unforeseen: string[] = [];
      const surfaces: AiModelMessage[][] = [];
      let offered: OfferedSource[] = [];
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string; temperature: number; messages: AiModelMessage[] };
        const key = `${body.model}:${body.temperature}`;
        calls.push(key);
        const reply = (text: string) => Response.json({ model: body.model, choices: [{ message: { content: text } }] });
        if (String(url) !== `${qwenUrl}/chat/completions`) {
          unforeseen.push("unexpected endpoint");
          return new Response(null, { status: 400 });
        }
        if (key === "qwen-fixture-extractor:0.1") return reply(JSON.stringify({
          facts: [], experiences: [], interpretations: [], people: [], topics: [],
        }));
        if (key === "qwen-fixture-extractor:0.2") return reply(JSON.stringify({
          events: [], emotionSlices: [], eventRelations: [], noteCandidate: { shouldGenerate: false },
        }));
        if (key === "qwen-fixture-safety:0") return reply(JSON.stringify({
          schemaVersion: 1, riskLevel: "none", categories: [], currentness: "current", evidence: [], requiresSafetyResponse: false,
        }));
        if (key === "qwen-fixture-main:0.1") {
          const wire = JSON.parse(body.messages.at(-1)!.content) as { recalledSources?: OfferedSource[] };
          offered = wire.recalledSources ?? [];
          if (offered.length) {
            assert.deepEqual(Object.keys(wire).sort(), ["currentUserMessage", "recalledSources"]);
            assert(!JSON.stringify(wire).includes(source.id), "Historical reference must expose only request-local aliases");
          }
          await onInterpret?.();
          return reply(JSON.stringify({ literalMeaning: content, confidence: 0.98, responseRelation: { candidates: [] }, notes: [],
            ...(offered.length ? { recalledReference: reference(offered) } : {}),
          }));
        }
        if (key === "qwen-fixture-main:0.75") {
          surfaces.push(body.messages);
          return Response.json({
            model: body.model, choices: [{ message: { content: surfaces.length <= echoCount ? copiedAdvice : ordinaryReply } }],
            fixtureVendorEcho: body.messages,
          });
        }
        unforeseen.push(key);
        return new Response(null, { status: 400 });
      };

      const { response, payload, tasks } = await send(session.id, token, turnId, content);
      const expectFailure = echoCount === 2;
      assert.equal(response.status, expectFailure ? 200 : 201, `${label}: ${JSON.stringify(payload)}`);
      assert.equal(payload.data.status, expectFailure ? "failed" : "committed", label);
      assert.equal(payload.data.userMessage.id, turnId, label);
      assert.equal(tasks.length, expectFailure ? 0 : 1, `${label}: schedule follow-up only after reply commit`);
      if (expectFailure) assert.equal(payload.data.assistantMessage, undefined, label);
      else assert.equal(payload.data.assistantMessage.content, ordinaryReply, label);
      assert.deepEqual(unforeseen, [], label);
      assert.equal(calls.filter((call) => call === "qwen-fixture-main:0.1").length, 1, `${label}: one existing interpretation call`);
      assert.equal(surfaces.length, echoCount ? 2 : 1, `${label}: retry just once after an advice echo`);
      if (echoCount) assert(!JSON.stringify(surfaces[1]).includes(advice), `${label}: retry uses the original prompt`);
      assert.equal(offered.some(({ text }) => text === originalText), expectOffered, label);
      assert.equal(offered.length > 1, expectAmbiguous, label);
      assert(!JSON.stringify(offered).includes(source.id), "Model sees aliases and no stored message IDs");
      const prompt = surfaces[0];
      const recommendation = prompt.filter(({ content: message }) => message.includes(advice));
      assert.equal(recommendation.length, expectAdvice ? 1 : 0, label);
      assert.deepEqual(prompt.at(-1), { role: "user", content }, label);
      if (expectAdvice) {
        assert.strictEqual(prompt.at(-2), recommendation[0], label);
        assert.equal(recommendation[0].role, "system", label);
      }
      const privateReviewContent = sameSession ? ["合成评语只用于审核。"] : [originalText, originalReply, "合成评语只用于审核。", source.id];
      for (const secret of privateReviewContent) {
        assert(!JSON.stringify(prompt).includes(secret), `${label}: Surface prompt contains restricted material`);
      }
      const saved = await prisma.aiGeneration.findMany({ where: { userId, sessionId: session.id, turnId } });
      assert(saved.length, `${label}: real route must persist the generation`);
      for (const secret of [advice, copiedAdvice, ...privateReviewContent]) {
        assert(!JSON.stringify(saved).includes(secret), `${label}: persisted generation contains restricted material`);
        assert(!JSON.stringify(payload).includes(secret), `${label}: public response contains restricted material`);
      }
      if (replay) {
        const count = calls.length;
        const again = await send(session.id, token, turnId, content);
        assert.equal(again.payload.data.assistantMessage.id, payload.data.assistantMessage.id, "Replay the first committed result");
        assert.equal(calls.length, count, "Retrying the same turn must not make any more Qwen calls");
        const foreign = await send(session.id, otherToken, `advice-route-${randomUUID()}`, content);
        assert.equal(foreign.response.status, 404, "The other account cannot send to this session");
        assert.equal(calls.length, count, "Wrong session must be rejected before the provider");
      }
      if (!sameSession) await prisma.chatSession.delete({ where: { id: session.id, userId } });
    };

    await run({ label: "approved original in another session", expectAdvice: true, replay: true });
    await run({ label: "unknown alias", reference: () => ({ sourceRef: "R999", currentQuote: topic, sourceQuote: topic }), expectAdvice: false });
    await run({ label: "invalid original quote", reference: (sources) => ({ ...validReference(sources)!, sourceQuote: "租房价格" }), expectAdvice: false });
    const competingSession = await prisma.chatSession.create({ data: { userId: owner.id } });
    const competing = await prisma.chatMessage.create({
      data: { userId: owner.id, sessionId: competingSession.id, role: "USER", content: "另一条提过租房预算的合成消息。", createdAt: new Date(sourceTime + 2_000) },
    });
    await run({ label: "quote matches multiple offered sources", expectAmbiguous: true, expectAdvice: false });
    await prisma.chatMessage.delete({ where: { id: competing.id } });
    await run({ label: "current directive", content: `${requestText}先别问我。`, expectOffered: false, expectAdvice: false });
    await run({ label: "user changes their mind about recall", content: `${requestText}算了，还是别提这个了。`, expectOffered: false, expectAdvice: false });
    await run({ label: "other account", userId: other.id, token: otherToken, expectOffered: false, expectAdvice: false });
    await run({ label: "revoked while interpretation runs", onInterpret: () => review("REJECTED"), expectAdvice: false });
    await review("APPROVED");
    await run({ label: "reapproved after review", expectAdvice: true });
    await run({ label: "advice echo recovered with original prompt", expectAdvice: true, echoCount: 1 });
    await run({ label: "advice repeated on retry stays private", expectAdvice: true, echoCount: 2 });
    await run({ label: "same-session source uses an alias for verification", expectAdvice: true, sameSession: true });
    console.log("Approved advice on the authenticated chat route passed with isolated PostgreSQL and fixture-only Qwen requests.");
  } finally {
    globalThis.fetch = previousFetch;
    try {
      if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
