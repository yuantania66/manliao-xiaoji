import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { ProactiveMoveIntentV1 } from "../conversation-os/interactionMoveEnvelope";

type StubResponse = { label: string; content: string };

const explicitDatabaseUrl = process.env.PROACTIVE_COMMIT_TEST_DATABASE_URL?.trim();
if (!explicitDatabaseUrl) {
  throw new Error(
    "PREREQUISITE_FAILED: PROACTIVE_COMMIT_TEST_DATABASE_URL must name a dedicated test database"
  );
}
if (process.env.PROACTIVE_COMMIT_TEST_ALLOW_DDL !== "1") {
  throw new Error(
    "PREREQUISITE_FAILED: set PROACTIVE_COMMIT_TEST_ALLOW_DDL=1 to acknowledge temporary test-only DDL"
  );
}

const parsedDatabaseUrl = new URL(explicitDatabaseUrl);
const expectedDatabaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, ""));
if (!expectedDatabaseName || !/(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/i.test(expectedDatabaseName)) {
  throw new Error(
    `PREREQUISITE_FAILED: database name must be visibly test-scoped; received ${JSON.stringify(expectedDatabaseName)}`
  );
}

const environmentKeys = [
  "DATABASE_URL",
  "AI_PROVIDER",
  "QWEN_API_KEY",
  "QWEN_BASE_URL",
  "AI_MAIN_MODEL",
  "AI_PROACTIVE_GREETING_MODEL",
  "AI_TIMEOUT_MS",
] as const;
const previousEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

const queuedResponses: StubResponse[] = [];
const receivedPaths: string[] = [];

const readRequestBody = (request: IncomingMessage) =>
  new Promise<void>((resolve, reject) => {
    request.on("data", () => undefined);
    request.on("end", resolve);
    request.on("error", reject);
  });

const server = createServer(async (request, response) => {
  receivedPaths.push(request.url ?? "");
  await readRequestBody(request);
  const scripted = queuedResponses.shift();
  if (request.method !== "POST" || request.url !== "/compatible-mode/v1/chat/completions") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unexpected request" }));
    return;
  }
  if (!scripted) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "response queue exhausted" }));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    id: `stub-${scripted.label}`,
    model: "qwen-commit-contract-stub",
    choices: [{ message: { role: "assistant", content: scripted.content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }));
});

const listen = (target: Server) => new Promise<number>((resolve, reject) => {
  target.once("error", reject);
  target.listen(0, "127.0.0.1", () => {
    target.off("error", reject);
    const address = target.address();
    if (!address || typeof address === "string") {
      reject(new Error("Loopback Qwen stub did not expose an OS-assigned port"));
      return;
    }
    resolve(address.port);
  });
});

const close = (target: Server) => new Promise<void>((resolve, reject) => {
  target.close((error) => error ? reject(error) : resolve());
});

const enqueue = (label: string, ...contents: string[]) => {
  assert.equal(queuedResponses.length, 0, `${label}: previous Qwen responses were not consumed`);
  contents.forEach((content, index) => queuedResponses.push({
    label: `${label}-${index + 1}`,
    content,
  }));
};

const assertQueueDrained = (label: string) => {
  assert.equal(queuedResponses.length, 0, `${label}: not every expected Qwen call occurred`);
};

const firstContactIntent = {
  move: "open_statement" as const,
  requiredFunction: "offer_self_contained_conversation_entry" as const,
  realization: {
    kind: "self_contained_entry" as const,
    topic: "assistant first-contact identity and low-pressure entry",
    proposition: "你好，我是小慢。不用先想好完整话题，从此刻最想说的一句话开始就可以。",
  },
  expectedUserContribution: "none" as const,
  userBurden: "none" as const,
};
const openIntent = {
  move: "open_statement" as const,
  requiredFunction: "offer_self_contained_conversation_entry" as const,
  realization: {
    kind: "self_contained_entry" as const,
    topic: "cloud shapes",
    proposition: "云的形状常常让熟悉的天空显得像一张不断改写的草稿。",
  },
  expectedUserContribution: "none" as const,
  userBurden: "none" as const,
};
const repairIntent = {
  move: "open_statement" as const,
  requiredFunction: "offer_self_contained_conversation_entry" as const,
  realization: {
    kind: "self_contained_entry" as const,
    topic: "small routines",
    proposition: "把常用物品放回固定位置，常常能替下一次行动省下一点力气。",
  },
  expectedUserContribution: "none" as const,
  userBurden: "none" as const,
};
const lightIntent = {
  move: "light_question" as const,
  requiredFunction: "ask_one_bounded_low_burden_question" as const,
  realization: {
    kind: "bounded_question" as const,
    topic: "remembered reading",
    question: "最近读到的文字里，哪一句还留在脑中？",
  },
  expectedUserContribution: "answer" as const,
  userBurden: "low" as const,
};

const verdict = ({
  intent,
  candidate,
  accept,
  topicDistinct,
}: {
  intent: ProactiveMoveIntentV1;
  candidate: string;
  accept: boolean;
  topicDistinct: boolean | null;
}) => JSON.stringify({
  intent,
  candidate,
  evidenceSpan: candidate,
  verdict: accept ? "accept" : "reject",
  intentFaithfullyRealized: accept,
  propositionDelivered: intent.move === "open_statement" ? accept : null,
  semanticClarity: accept,
  anchoredCommunicativePoint: accept,
  selfContained: accept,
  requiresSecondAssistantReveal: !accept,
  createsUserObligation: !accept,
  groundingObeyed: true,
  contradictoryMove: !accept,
  topicDistinct,
});

const restoreEnvironment = () => {
  for (const key of environmentKeys) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

let prisma: (typeof import("../lib/prisma"))["prisma"] | undefined;
let fixtureUserCreated = false;
let triggerCreated = false;
let functionCreated = false;
const fixtureTag = `proactive-commit-test-${randomUUID()}`;
const fixtureSessionId = `proactive-commit-test-session-${randomUUID()}`;
const fixtureUserId = `proactive-commit-test-user-${randomUUID()}`;
const triggerName = `a${randomBytes(12).toString("hex")}`;
const functionName = `b${randomBytes(12).toString("hex")}`;

const quotedIdentifier = (value: string) => {
  assert.match(value, /^[a-f][a-f0-9]+$/);
  return `"${value}"`;
};
const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const main = async () => {
  const port = await listen(server);
  process.env.DATABASE_URL = explicitDatabaseUrl;
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "synthetic-proactive-commit-test-key";
  process.env.QWEN_BASE_URL = `http://127.0.0.1:${port}/compatible-mode/v1`;
  process.env.AI_MAIN_MODEL = "qwen-commit-contract-stub";
  process.env.AI_PROACTIVE_GREETING_MODEL = "qwen-commit-contract-stub";
  process.env.AI_TIMEOUT_MS = "5000";

  const prismaModule = await import("../lib/prisma");
  prisma = prismaModule.prisma;
  const [{ databaseName, schemaName, canCreate, canTrigger }] = await prisma.$queryRawUnsafe<Array<{
    databaseName: string;
    schemaName: string;
    canCreate: boolean;
    canTrigger: boolean;
  }>>(`
    SELECT
      current_database() AS "databaseName",
      current_schema() AS "schemaName",
      has_schema_privilege(current_user, current_schema(), 'CREATE') AS "canCreate",
      has_table_privilege(current_user, '"ChatSession"', 'TRIGGER') AS "canTrigger"
  `);
  assert.equal(
    databaseName,
    expectedDatabaseName,
    "PREREQUISITE_FAILED: explicit URL database and server-reported database differ"
  );
  assert.match(databaseName, /(?:^|[_-])(test|testing|spec|ci)(?:[_-]|$)/i);
  assert.equal(typeof schemaName, "string");
  assert(schemaName.length > 0, "PREREQUISITE_FAILED: current_schema() must be available");
  assert.equal(canCreate, true, "PREREQUISITE_FAILED: current user needs CREATE on current schema");
  assert.equal(canTrigger, true, 'PREREQUISITE_FAILED: current user needs TRIGGER on "ChatSession"');

  const [{ ensureProactiveChatGreeting }, guestRoute, guestCache, envelopeModule] = await Promise.all([
    import("../services/chat/proactiveGreetingService"),
    import("../app/api/chat/guest/greeting/route"),
    import("../lib/guest-proactive-greeting"),
    import("../conversation-os/interactionMoveEnvelope"),
  ]);
  const { POST } = guestRoute;
  const {
    appendGuestRecentGreeting,
    guestProactiveGreetingKind,
    parseGuestRecentGreetings,
  } = guestCache;
  const {
    INTERACTION_MOVE_ENVELOPE_TRACE_KEY,
    parseCommittedAssistantMoveEnvelope,
  } = envelopeModule;
  const parseStoredEnvelope = (trace: unknown, label: string) => {
    const storedEnvelope = typeof trace === "object" && trace !== null && !Array.isArray(trace)
      ? (trace as Record<string, unknown>)[INTERACTION_MOVE_ENVELOPE_TRACE_KEY]
      : undefined;
    const parsed = parseCommittedAssistantMoveEnvelope(storedEnvelope);
    const reasonCodes = parsed.status === "invalid"
      ? parsed.reasons.join("|")
      : parsed.status;
    assert.equal(parsed.status, "valid", `${label}: ${reasonCodes}`);
    return parsed;
  };

  await prisma.user.create({
    data: { id: fixtureUserId, nickname: fixtureTag },
  });
  fixtureUserCreated = true;
  await prisma.chatSession.create({
    data: { id: fixtureSessionId, userId: fixtureUserId, title: fixtureTag },
  });

  const counts = async () => ({
    generations: await prisma!.aiGeneration.count({ where: { sessionId: fixtureSessionId } }),
    messages: await prisma!.chatMessage.count({
      where: { sessionId: fixtureSessionId, role: "ASSISTANT" },
    }),
  });
  const invokeAuth = () => ensureProactiveChatGreeting({
    sessionId: fixtureSessionId,
    userId: fixtureUserId,
    force: true,
    dedupeWindowMs: 0,
  });
  const requireCommittedAuthMessage = (
    result: Awaited<ReturnType<typeof invokeAuth>>,
    label: string
  ) => {
    assert.equal(result.status, "committed", label);
    if (result.status !== "committed") throw new Error(label);
    return result.message;
  };
  const invokeGuest = async (body: Record<string, unknown>) => {
    const response = await POST(new Request("http://localhost/api/chat/guest/greeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never);
    return {
      status: response.status,
      json: await response.json() as Record<string, unknown>,
    };
  };
  const requireGuestMessage = (json: Record<string, unknown>) => {
    assert.equal(json.ok, true);
    assert(json.data && typeof json.data === "object");
    const message = (json.data as Record<string, unknown>).assistantMessage;
    assert(message && typeof message === "object");
    return message as Record<string, unknown>;
  };
  const assertNoCommittableGuestEvent = (json: Record<string, unknown>) => {
    assert.equal(json.ok, false);
    const serialized = JSON.stringify(json);
    assert(!serialized.includes("assistantMessage"));
    assert(!serialized.includes("interactionMoveEnvelope"));
  };

  const authSurface = "你好，我是小慢。还没想好聊什么也没关系，可以先从此刻的一句话开始。";
  enqueue(
    "auth-success",
    authSurface,
    verdict({ intent: firstContactIntent, candidate: authSurface, accept: true, topicDistinct: null })
  );
  const authMessage = requireCommittedAuthMessage(
    await invokeAuth(),
    "Auth success must return a committed greeting"
  );
  assertQueueDrained("auth-success");
  assert.deepEqual(await counts(), { generations: 1, messages: 1 });
  const storedGeneration = await prisma.aiGeneration.findFirstOrThrow({
    where: { sessionId: fixtureSessionId },
    select: { id: true, outputText: true, executionTrace: true },
  });
  assert.equal(authMessage.content, authSurface);
  assert.equal(storedGeneration.outputText, authMessage.content);
  const parsedAuthEnvelope = parseStoredEnvelope(
    storedGeneration.executionTrace,
    "Auth stored envelope invalid"
  );
  if (parsedAuthEnvelope.status !== "valid") throw new Error("Auth envelope must parse");
  assert.equal(parsedAuthEnvelope.envelope.schemaVersion, 2);
  if (parsedAuthEnvelope.envelope.schemaVersion !== 2) throw new Error("Auth envelope must be v2");
  assert.deepEqual(parsedAuthEnvelope.envelope.proactiveIntent, firstContactIntent);
  assert.deepEqual(parsedAuthEnvelope.envelope, authMessage.interactionMoveEnvelope);
  assert.deepEqual(parsedAuthEnvelope.envelope.committedMove.claims, [{
    text: firstContactIntent.realization.proposition,
    subject: "conversation",
    provenance: ["proactiveIntent.realization.proposition"],
  }]);
  assert.equal(parsedAuthEnvelope.envelope.committedMove.questionOrRequest, null);
  assert.equal(
    parsedAuthEnvelope.envelope.handoff.greetingFunction,
    parsedAuthEnvelope.envelope.proactiveIntent.requiredFunction
  );

  const beforeMalformed = await counts();
  enqueue("auth-malformed-intent", "{", "not-json", "{", "still-not-json");
  assert.equal((await invokeAuth()).status, "retryable_failure");
  assertQueueDrained("auth-malformed-intent");
  assert.deepEqual(await counts(), beforeMalformed);

  const rejectedIntent = {
    ...openIntent,
    realization: {
      ...openIntent.realization,
      topic: "rejected fixture topic",
      proposition: "一张旧票根有时会把某段旅程的细节重新带回眼前。",
    },
  };
  const rejectedSurfaceOne = "我有件事想晚一点再告诉你。";
  const rejectedSurfaceTwo = "先猜猜我准备分享什么。";
  const beforeRejected = await counts();
  enqueue(
    "auth-validator-rejection",
    JSON.stringify(rejectedIntent),
    rejectedSurfaceOne,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceOne, accept: false, topicDistinct: null }),
    rejectedSurfaceTwo,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceTwo, accept: false, topicDistinct: null }),
    JSON.stringify(rejectedIntent),
    rejectedSurfaceOne,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceOne, accept: false, topicDistinct: null }),
    rejectedSurfaceTwo,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceTwo, accept: false, topicDistinct: null })
  );
  assert.equal((await invokeAuth()).status, "retryable_failure");
  assertQueueDrained("auth-validator-rejection");
  assert.deepEqual(await counts(), beforeRejected);

  const loser = "我想分享一个关于日常习惯的小想法。";
  const winner = repairIntent.realization.proposition;
  const beforeRepair = await counts();
  enqueue(
    "auth-single-winner-repair",
    JSON.stringify(repairIntent),
    loser,
    verdict({ intent: repairIntent, candidate: loser, accept: false, topicDistinct: null }),
    winner,
    verdict({ intent: repairIntent, candidate: winner, accept: true, topicDistinct: null })
  );
  const repairedMessage = requireCommittedAuthMessage(
    await invokeAuth(),
    "Auth repair must commit its one accepted winner"
  );
  assertQueueDrained("auth-single-winner-repair");
  assert.deepEqual(await counts(), {
    generations: beforeRepair.generations + 1,
    messages: beforeRepair.messages + 1,
  });
  assert.equal(repairedMessage.content, winner);
  assert.equal(await prisma.aiGeneration.count({
    where: { sessionId: fixtureSessionId, outputText: loser },
  }), 0);
  const repairedGeneration = await prisma.aiGeneration.findFirstOrThrow({
    where: { sessionId: fixtureSessionId, outputText: winner },
    select: { outputText: true, executionTrace: true },
  });
  const parsedRepairEnvelope = parseStoredEnvelope(
    repairedGeneration.executionTrace,
    "Repair winner stored envelope invalid"
  );
  if (parsedRepairEnvelope.status !== "valid") throw new Error("Repair winner envelope must parse");
  assert.equal(parsedRepairEnvelope.envelope.schemaVersion, 2);
  if (parsedRepairEnvelope.envelope.schemaVersion !== 2) throw new Error("Repair winner must be v2");
  assert.deepEqual(parsedRepairEnvelope.envelope.proactiveIntent, repairIntent);
  assert.deepEqual(parsedRepairEnvelope.envelope.committedMove.claims, [{
    text: repairIntent.realization.proposition,
    subject: "conversation",
    provenance: ["proactiveIntent.realization.proposition"],
  }]);

  enqueue(
    "guest-auth-parity",
    JSON.stringify(repairIntent),
    winner,
    verdict({ intent: repairIntent, candidate: winner, accept: true, topicDistinct: null })
  );
  const guestSuccess = await invokeGuest({
    kind: "return",
    recentMessages: [],
    recentGreetings: [],
  });
  assertQueueDrained("guest-auth-parity");
  assert.equal(guestSuccess.status, 200);
  const guestMessage = requireGuestMessage(guestSuccess.json);
  const parsedGuestEnvelope = parseCommittedAssistantMoveEnvelope(guestMessage.interactionMoveEnvelope);
  assert.equal(parsedGuestEnvelope.status, "valid");
  if (parsedGuestEnvelope.status !== "valid") throw new Error("Guest envelope must parse");
  assert.equal(parsedGuestEnvelope.envelope.schemaVersion, 2);
  if (parsedGuestEnvelope.envelope.schemaVersion !== 2) throw new Error("Guest envelope must be v2");
  assert.deepEqual(parsedGuestEnvelope.envelope.proactiveIntent, parsedRepairEnvelope.envelope.proactiveIntent);
  assert.deepEqual(parsedGuestEnvelope.envelope.committedMove, parsedRepairEnvelope.envelope.committedMove);
  assert.deepEqual(parsedGuestEnvelope.envelope.handoff, parsedRepairEnvelope.envelope.handoff);

  enqueue(
    "guest-first-contact",
    authSurface,
    verdict({ intent: firstContactIntent, candidate: authSurface, accept: true, topicDistinct: null })
  );
  const guestFirstContact = await invokeGuest({
    kind: "initial",
    recentMessages: [],
    recentGreetings: [],
  });
  assertQueueDrained("guest-first-contact");
  const guestFirstContactMessage = requireGuestMessage(guestFirstContact.json);
  const parsedGuestFirstContact = parseCommittedAssistantMoveEnvelope(
    guestFirstContactMessage.interactionMoveEnvelope
  );
  assert.equal(parsedGuestFirstContact.status, "valid");
  if (parsedGuestFirstContact.status !== "valid") throw new Error("Guest first-contact envelope must parse");
  assert.equal(parsedGuestFirstContact.envelope.schemaVersion, 2);
  if (parsedGuestFirstContact.envelope.schemaVersion !== 2) throw new Error("Guest first-contact envelope must be v2");
  assert.deepEqual(parsedGuestFirstContact.envelope.proactiveIntent, firstContactIntent);

  const cachedGreetings = appendGuestRecentGreeting([], {
    text: String(guestMessage.content),
    interactionMoveEnvelope: parsedGuestEnvelope.envelope,
  });
  const roundTrippedGreetings = parseGuestRecentGreetings(JSON.stringify(cachedGreetings));
  assert.deepEqual(roundTrippedGreetings, cachedGreetings);
  const textMisleadingStructuredHistory = parseGuestRecentGreetings(JSON.stringify([{
    ...roundTrippedGreetings[0],
    text: "嗨。",
  }]));
  assert.equal(textMisleadingStructuredHistory[0]?.text, "嗨。");
  assert.equal(guestProactiveGreetingKind({
    localMessageCount: 0,
    recentGreetings: textMisleadingStructuredHistory,
  }), "return");
  assert.equal(guestProactiveGreetingKind({
    localMessageCount: 1,
    recentGreetings: [],
  }), "return");
  const guestQuestionSurface = lightIntent.realization.question;
  enqueue(
    "guest-structured-history",
    JSON.stringify(lightIntent),
    guestQuestionSurface,
    verdict({ intent: lightIntent, candidate: guestQuestionSurface, accept: true, topicDistinct: true })
  );
  const guestSecond = await invokeGuest({
    kind: "return",
    recentMessages: [],
    recentGreetings: textMisleadingStructuredHistory,
  });
  assertQueueDrained("guest-structured-history");
  const guestSecondMessage = requireGuestMessage(guestSecond.json);
  const parsedSecondGuestEnvelope = parseCommittedAssistantMoveEnvelope(
    guestSecondMessage.interactionMoveEnvelope
  );
  assert.equal(parsedSecondGuestEnvelope.status, "valid");
  if (parsedSecondGuestEnvelope.status !== "valid") throw new Error("Second Guest envelope must parse");
  assert.equal(parsedSecondGuestEnvelope.envelope.schemaVersion, 2);
  if (parsedSecondGuestEnvelope.envelope.schemaVersion !== 2) throw new Error("Second Guest envelope must be v2");
  assert.deepEqual(parsedSecondGuestEnvelope.envelope.proactiveIntent, lightIntent);

  enqueue("guest-malformed-intent", "{", "still-not-json");
  const guestMalformed = await invokeGuest({
    kind: "return",
    recentMessages: [],
    recentGreetings: [],
  });
  assertQueueDrained("guest-malformed-intent");
  assertNoCommittableGuestEvent(guestMalformed.json);

  enqueue(
    "guest-validator-rejection",
    JSON.stringify(rejectedIntent),
    rejectedSurfaceOne,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceOne, accept: false, topicDistinct: null }),
    rejectedSurfaceTwo,
    verdict({ intent: rejectedIntent, candidate: rejectedSurfaceTwo, accept: false, topicDistinct: null })
  );
  const guestRejected = await invokeGuest({
    kind: "return",
    recentMessages: [],
    recentGreetings: [],
  });
  assertQueueDrained("guest-validator-rejection");
  assertNoCommittableGuestEvent(guestRejected.json);

  await prisma.chatMessage.create({
    data: {
      sessionId: fixtureSessionId,
      userId: fixtureUserId,
      role: "USER",
      content: "这是已提交的旧对话。",
      status: "SAVED",
    },
  });
  const oldUserNewSession = await prisma.chatSession.create({
    data: { userId: fixtureUserId, title: `${fixtureTag}-return` },
  });
  const returnSurface = openIntent.realization.proposition;
  enqueue(
    "auth-old-user-new-session",
    JSON.stringify(openIntent),
    returnSurface,
    verdict({ intent: openIntent, candidate: returnSurface, accept: true, topicDistinct: null })
  );
  const oldUserGreeting = await ensureProactiveChatGreeting({
    sessionId: oldUserNewSession.id,
    userId: fixtureUserId,
  });
  assertQueueDrained("auth-old-user-new-session");
  assert.equal(oldUserGreeting.status, "committed");
  if (oldUserGreeting.status !== "committed") throw new Error("Old user return greeting must commit");
  assert.equal(
    oldUserGreeting.message.interactionMoveEnvelope.proactiveIntent.realization.kind,
    "self_contained_entry"
  );
  assert.notDeepEqual(
    oldUserGreeting.message.interactionMoveEnvelope.proactiveIntent,
    firstContactIntent,
    "An old user opening an empty session must not receive first-contact identity intent"
  );

  const beforeRollback = await counts();
  const sessionBeforeRollback = await prisma.chatSession.findUniqueOrThrow({
    where: { id: fixtureSessionId },
    select: { lastMessage: true, lastMessageAt: true },
  });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${quotedIdentifier(functionName)}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'proactive commit rollback fixture';
    END;
    $$
  `);
  functionCreated = true;
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${quotedIdentifier(triggerName)}
    BEFORE UPDATE ON "ChatSession"
    FOR EACH ROW
    WHEN (OLD."id" = ${sqlLiteral(fixtureSessionId)} AND NEW."id" = ${sqlLiteral(fixtureSessionId)})
    EXECUTE FUNCTION ${quotedIdentifier(functionName)}()
  `);
  triggerCreated = true;

  const rollbackSurface = lightIntent.realization.question;
  enqueue(
    "auth-late-transaction-rollback",
    JSON.stringify(lightIntent),
    rollbackSurface,
    verdict({ intent: lightIntent, candidate: rollbackSurface, accept: true, topicDistinct: true })
  );
  assert.equal((await invokeAuth()).status, "retryable_failure");
  assertQueueDrained("auth-late-transaction-rollback");
  assert.deepEqual(await counts(), beforeRollback);
  assert.deepEqual(
    await prisma.chatSession.findUniqueOrThrow({
      where: { id: fixtureSessionId },
      select: { lastMessage: true, lastMessageAt: true },
    }),
    sessionBeforeRollback
  );
  assert.equal(await prisma.aiGeneration.count({
    where: { sessionId: fixtureSessionId, outputText: rollbackSurface },
  }), 0);

  assert(receivedPaths.length > 0);
  assert(receivedPaths.every((path) => path === "/compatible-mode/v1/chat/completions"));
  console.log("proactive structured commit checks passed");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const cleanupFailures: unknown[] = [];
    const recordCleanupFailure = (label: string) => (error: unknown) => {
      cleanupFailures.push(error);
      console.error(`${label} cleanup failed`, error);
    };
    queuedResponses.length = 0;
    if (prisma) {
      if (triggerCreated) {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS ${quotedIdentifier(triggerName)} ON "ChatSession"`
        ).catch(recordCleanupFailure("exact trigger"));
      }
      if (functionCreated) {
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS ${quotedIdentifier(functionName)}()`
        ).catch(recordCleanupFailure("exact function"));
      }
      if (fixtureUserCreated) {
        await prisma.user.delete({ where: { id: fixtureUserId } })
          .catch(recordCleanupFailure("exact fixture User"));
      }
      await prisma.$disconnect().catch(recordCleanupFailure("Prisma disconnect"));
    }
    await close(server).catch(recordCleanupFailure("loopback Qwen stub"));
    restoreEnvironment();
    if (cleanupFailures.length > 0) process.exitCode = 1;
  });
