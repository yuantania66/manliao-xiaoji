import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  attachCommittedAssistantMoveEnvelope,
  buildCommittedResponseMove,
  buildProactiveGreetingAssistantMoveEnvelope,
  buildResponsePlanAssistantMoveEnvelope,
  extractCommittedAssistantMoveEnvelope,
  parseCommittedAssistantMoveEnvelope,
  proactiveGreetingRequiredFunctionFor,
} from "../conversation-os";

const main = async () => {
const greetingCases = [
  {
    move: "simple_greeting" as const,
    requiredFunction: "initiate_reciprocal_contact",
    questionOrRequest: null,
    expectedUserContribution: "none",
    userBurden: "none",
  },
  {
    move: "open_statement" as const,
    requiredFunction: "offer_self_contained_conversation_entry",
    questionOrRequest: null,
    expectedUserContribution: "none",
    userBurden: "none",
  },
  {
    move: "light_question" as const,
    requiredFunction: "ask_one_bounded_low_burden_question",
    questionOrRequest: { kind: "question" },
    expectedUserContribution: "answer",
    userBurden: "low",
  },
] as const;

for (const item of greetingCases) {
  const assistantMoveId = `assistant-${item.move}`;
  const envelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId,
    generationId: `generation-${item.move}`,
    greetingMove: item.move,
  });
  assert.equal(proactiveGreetingRequiredFunctionFor(item.move), item.requiredFunction);
  assert.equal(envelope.assistantMoveId, assistantMoveId);
  assert.equal(envelope.origin.kind, "proactive_greeting");
  assert.equal(envelope.committedMove.sourceTurnId, null);
  assert.deepEqual(envelope.committedMove.questionOrRequest, item.questionOrRequest);
  assert.equal(envelope.committedMove.expectedUserContribution, item.expectedUserContribution);
  assert.equal(envelope.committedMove.userBurden, item.userBurden);
  assert.equal(envelope.handoff.edge, "opens");
  assert.equal(envelope.handoff.greetingFunction, item.requiredFunction);
  assert.deepEqual(parseCommittedAssistantMoveEnvelope(envelope), {
    status: "valid",
    envelope,
  });
}

const committedMove = buildCommittedResponseMove({
  plan: null,
  replyText: "你好。",
  sourceUserTurnId: "user-turn-1",
  planId: "plan-1",
  requestId: "request-1",
});
const responseEnvelope = buildResponsePlanAssistantMoveEnvelope({
  assistantMoveId: "assistant-response-1",
  planId: "plan-1",
  sourceUserTurnId: "user-turn-1",
  committedMove,
});
assert.equal(responseEnvelope.assistantMoveId, "assistant-response-1");
assert.equal(responseEnvelope.committedMove.sourceTurnId, "user-turn-1");
assert.equal(responseEnvelope.handoff, null);

const trace = attachCommittedAssistantMoveEnvelope(
  { phase: "COMMITTED", promptVersion: "generation-provenance-only" },
  responseEnvelope
);
assert.equal(trace.phase, "COMMITTED");
assert.equal(trace.promptVersion, "generation-provenance-only");
assert.deepEqual(extractCommittedAssistantMoveEnvelope(trace), responseEnvelope);
assert.equal(extractCommittedAssistantMoveEnvelope({ phase: "FAILED" }), null);

const invalidUnknownKey = parseCommittedAssistantMoveEnvelope({
  ...responseEnvelope,
  unexpected: true,
});
assert.equal(invalidUnknownKey.status, "invalid");

const invalidSource = parseCommittedAssistantMoveEnvelope({
  ...responseEnvelope,
  committedMove: { ...responseEnvelope.committedMove, sourceTurnId: "another-turn" },
});
assert.equal(invalidSource.status, "invalid");

const invalidSelfTarget = parseCommittedAssistantMoveEnvelope({
  ...responseEnvelope,
  handoff: {
    kind: "proactive_greeting",
    edge: "fulfills",
    sourceAssistantMoveId: responseEnvelope.assistantMoveId,
    realizedFunction: "complete_reciprocal_contact",
  },
});
assert.equal(invalidSelfTarget.status, "invalid");

const invalidProactiveEdge = parseCommittedAssistantMoveEnvelope({
  ...buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId: "assistant-greeting-1",
    generationId: "generation-greeting-1",
    greetingMove: "simple_greeting",
  }),
  handoff: null,
});
assert.equal(invalidProactiveEdge.status, "invalid");

const invalidVersion = parseCommittedAssistantMoveEnvelope({
  ...responseEnvelope,
  schemaVersion: 2,
});
assert.equal(invalidVersion.status, "invalid");

const coreSource = await readFile(
  new URL("../conversation-os/interactionMoveEnvelope.ts", import.meta.url),
  "utf8"
);
const plannerSource = await readFile(
  new URL("../conversation-os/control/responsePlanner.ts", import.meta.url),
  "utf8"
);
const authReplySource = await readFile(
  new URL("../services/ai/chatReplyService.ts", import.meta.url),
  "utf8"
);
const authGreetingSource = await readFile(
  new URL("../services/chat/proactiveGreetingService.ts", import.meta.url),
  "utf8"
);
const guestReplySource = await readFile(
  new URL("../app/api/chat/guest/route.ts", import.meta.url),
  "utf8"
);
const guestGreetingSource = await readFile(
  new URL("../app/api/chat/guest/greeting/route.ts", import.meta.url),
  "utf8"
);

assert(!coreSource.includes("promptVersion"));
assert(plannerSource.includes("isProactiveGreetingPromptVersion"));
assert(!plannerSource.includes("interactionMoveEnvelope"));
for (const source of [authReplySource, authGreetingSource, guestReplySource, guestGreetingSource]) {
  assert(source.includes("interactionMoveEnvelope"));
}
assert(authReplySource.includes('execution.phase !== "VALIDATED"'));
assert(guestReplySource.indexOf('reply.execution.phase !== "VALIDATED"') <
  guestReplySource.indexOf("const interactionMoveEnvelope = reply.finalSource"));
assert(authReplySource.includes('reply.finalSource === "safety" ? null : "response_plan"'));
assert(guestReplySource.includes('reply.finalSource === "safety"'));

console.log("interaction move envelope checks passed");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
