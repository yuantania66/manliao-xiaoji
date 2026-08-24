import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  attachCommittedAssistantMoveEnvelope,
  activeHandoff,
  buildCommittedResponseMove,
  buildProactiveGreetingAssistantMoveEnvelope,
  buildResponsePlanAssistantMoveEnvelope,
  buildSafetyAssistantMoveEnvelope,
  extractCommittedAssistantMoveEnvelope,
  handoffCompleted,
  handoffResolved,
  handoffSuperseded,
  parseCommittedAssistantMoveEnvelope,
  proactiveGreetingRequiredFunctionFor,
} from "../conversation-os";
import type { InteractionMoveHandoffCommitEvidence } from "../conversation-os";
import type { ResponsePlan } from "../conversation-os/control";

const main = async () => {
const greetingCases = [
  {
    move: "simple_greeting" as const,
    intent: {
      move: "simple_greeting" as const,
      requiredFunction: "initiate_reciprocal_contact" as const,
      realization: { kind: "reciprocal_contact" as const },
      expectedUserContribution: "none" as const,
      userBurden: "none" as const,
    },
    requiredFunction: "initiate_reciprocal_contact",
    claims: [],
    questionOrRequest: null,
    expectedUserContribution: "none",
    userBurden: "none",
  },
  {
    move: "open_statement" as const,
    intent: {
      move: "open_statement" as const,
      requiredFunction: "offer_self_contained_conversation_entry" as const,
      realization: {
        kind: "self_contained_entry" as const,
        topic: "fixture topic",
        proposition: "A self-contained fixture proposition.",
      },
      expectedUserContribution: "none" as const,
      userBurden: "none" as const,
    },
    requiredFunction: "offer_self_contained_conversation_entry",
    claims: [{
      text: "A self-contained fixture proposition.",
      subject: "conversation" as const,
      provenance: ["proactiveIntent.realization.proposition"],
    }],
    questionOrRequest: null,
    expectedUserContribution: "none",
    userBurden: "none",
  },
  {
    move: "light_question" as const,
    intent: {
      move: "light_question" as const,
      requiredFunction: "ask_one_bounded_low_burden_question" as const,
      realization: {
        kind: "bounded_question" as const,
        topic: "fixture topic",
        question: "A bounded fixture question?",
      },
      expectedUserContribution: "answer" as const,
      userBurden: "low" as const,
    },
    requiredFunction: "ask_one_bounded_low_burden_question",
    claims: [],
    questionOrRequest: { kind: "question", text: "A bounded fixture question?" },
    expectedUserContribution: "answer",
    userBurden: "low",
  },
] as const;

for (const item of greetingCases) {
  const assistantMoveId = `assistant-${item.move}`;
  const envelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId,
    generationId: `generation-${item.move}`,
    intent: item.intent,
  });
  assert.equal(proactiveGreetingRequiredFunctionFor(item.move), item.requiredFunction);
  assert.equal(envelope.assistantMoveId, assistantMoveId);
  assert.equal(envelope.origin.kind, "proactive_greeting");
  assert.equal(envelope.committedMove.sourceTurnId, null);
  assert.deepEqual(envelope.committedMove.claims, item.claims);
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

const handoffPlan: ResponsePlan = {
  planId: "plan-fulfills-1",
  decisionOwner: "conversation_os.response_planner",
  behaviorSource: "ordinary_conversation",
  planningDepth: "minimal",
  answerObligations: [],
  disclosureScope: { conversationId: "conversation-1", turnId: "user-turn-1" },
  correction: null,
  responseActions: ["continue_established_thread"],
  groundingFacts: [],
  requiredDisclosure: [],
  clinicalStrategy: null,
  positiveFunctionContract: null,
  interactionMoveHandoffPlan: {
    sourceAssistantMoveId: "assistant-greeting-source",
    sourceGreetingFunction: "initiate_reciprocal_contact",
    sourceUserTurnId: "user-turn-1",
    selectedRelation: "reciprocates_move",
    requiredFunction: "complete_reciprocal_contact",
    completionIntent: "fulfill",
    questionPolicy: "none",
    evidence: [{
      source: "current_user_turn",
      sourceUserTurnId: "user-turn-1",
      text: "你好",
      start: 0,
      end: 2,
    }],
  },
  questionPolicy: { mode: "none", reason: "handoff completion fixture" },
  closurePolicy: { mode: "forbid_closure", reason: "handoff completion fixture" },
  tone: ["natural"],
  stance: ["direct"],
  lengthGuidance: "short",
  prohibitedClaims: [],
  safetyConstraints: [],
  relevanceProvenance: [],
  evidence: ["handoff completion fixture"],
};
const fulfillmentEnvelope = buildResponsePlanAssistantMoveEnvelope({
  assistantMoveId: "assistant-response-fulfills-1",
  planId: handoffPlan.planId,
  sourceUserTurnId: "user-turn-1",
  committedMove,
  handoffCommitEvidence: {
    executionPhase: "VALIDATED",
    finalAttemptPhase: "VALIDATED",
    executionPlanId: handoffPlan.planId,
    executionTurnId: "user-turn-1",
    responsePlan: handoffPlan,
    finalValidation: {
      passed: true,
      failureReasons: [],
      checkedPlanId: handoffPlan.planId,
      planChanged: false,
    },
  },
});
assert.deepEqual(fulfillmentEnvelope.handoff, {
  kind: "proactive_greeting",
  edge: "fulfills",
  sourceAssistantMoveId: "assistant-greeting-source",
  realizedFunction: "complete_reciprocal_contact",
});
const advisoryHandoffPlan: ResponsePlan = {
  ...handoffPlan,
  planId: "plan-advisory-content-1",
  interactionMoveHandoffPlan: {
    ...handoffPlan.interactionMoveHandoffPlan!,
    selectedRelation: "opens_or_redirects_thread",
    requiredFunction: "continue_user_introduced_content",
    questionPolicy: "optional_after_completion",
  },
};
const advisoryHandoffEnvelope = buildResponsePlanAssistantMoveEnvelope({
  assistantMoveId: "assistant-response-advisory-1",
  planId: advisoryHandoffPlan.planId,
  sourceUserTurnId: "user-turn-1",
  committedMove,
  handoffCommitEvidence: {
    executionPhase: "VALIDATED",
    finalAttemptPhase: "VALIDATED",
    executionPlanId: advisoryHandoffPlan.planId,
    executionTurnId: "user-turn-1",
    responsePlan: advisoryHandoffPlan,
    finalValidation: {
      passed: true,
      failureReasons: ["planned_function_semantic:handoff_not_satisfied"],
      hardFailureReasons: [],
      advisoryFailureReasons: ["planned_function_semantic:handoff_not_satisfied"],
      rewriteRequired: true,
      checkedPlanId: advisoryHandoffPlan.planId,
      planChanged: false,
    },
  },
});
assert.equal(advisoryHandoffEnvelope.handoff, null);
assert.equal(handoffCompleted("assistant-greeting-source", [fulfillmentEnvelope]), true);
assert.equal(handoffCompleted("different-greeting", [fulfillmentEnvelope]), false);
assert.equal(handoffCompleted("assistant-greeting-source", [responseEnvelope]), false);
assert.equal(handoffCompleted("assistant-greeting-source", [{
  ...fulfillmentEnvelope,
  unexpected: true,
}]), false);
assert.equal(handoffCompleted("assistant-greeting-source", [{
  handoff: fulfillmentEnvelope.handoff,
}]), false);

const openEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "assistant-greeting-source",
  generationId: "generation-active-source",
  intent: greetingCases[0].intent,
});
const safetyMove = buildCommittedResponseMove({
  plan: null,
  replyText: "请先确保自己处在安全的地方。",
  sourceUserTurnId: "user-turn-safety",
  planId: "unused-safety-plan",
  requestId: "safety-request-1",
});
const safetyEnvelope = buildSafetyAssistantMoveEnvelope({
  assistantMoveId: "assistant-safety-1",
  safetyTraceId: "safety-request-1",
  sourceUserTurnId: "user-turn-safety",
  committedMove: safetyMove,
  sourceAssistantMoveId: openEnvelope.assistantMoveId,
});
assert.deepEqual(safetyEnvelope.origin, {
  kind: "safety_override",
  safetyTraceId: "safety-request-1",
  sourceUserTurnId: "user-turn-safety",
});
assert.deepEqual(safetyEnvelope.handoff, {
  kind: "proactive_greeting",
  edge: "supersedes",
  sourceAssistantMoveId: openEnvelope.assistantMoveId,
  reason: "safety_override",
});
assert.equal(handoffSuperseded(openEnvelope.assistantMoveId, [safetyEnvelope]), true);
assert.equal(handoffResolved(openEnvelope.assistantMoveId, [safetyEnvelope]), true);
assert.equal(handoffResolved(openEnvelope.assistantMoveId, [fulfillmentEnvelope]), true);

const adjacentEvents = [
  {
    id: openEnvelope.assistantMoveId,
    role: "assistant",
    status: "saved",
    interactionMoveEnvelope: openEnvelope,
  },
  { id: "user-turn-safety", role: "user", status: "saved" },
];
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", adjacentEvents), true);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  adjacentEvents[0],
  { id: "intervening-user", role: "user", status: "saved" },
  adjacentEvents[1],
]), false);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  { ...adjacentEvents[0], id: "wrong-message-id" },
  adjacentEvents[1],
]), false);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  { ...adjacentEvents[0], interactionMoveEnvelope: { ...openEnvelope, unexpected: true } },
  adjacentEvents[1],
]), false);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  ...adjacentEvents,
  {
    id: safetyEnvelope.assistantMoveId,
    role: "assistant",
    status: "saved",
    interactionMoveEnvelope: safetyEnvelope,
  },
]), false);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  { ...adjacentEvents[0], status: "blocked" },
  adjacentEvents[1],
]), false);
assert.equal(activeHandoff(openEnvelope.assistantMoveId, "user-turn-safety", [
  { ...adjacentEvents[0] },
  { ...adjacentEvents[0] },
  adjacentEvents[1],
]), false);
assert.equal(handoffSuperseded(openEnvelope.assistantMoveId, [{
  ...safetyEnvelope,
  origin: { kind: "response_plan", planId: "plan-x", sourceUserTurnId: "user-turn-safety" },
}]), false);
assert.equal(handoffSuperseded(openEnvelope.assistantMoveId, [{
  ...safetyEnvelope,
  handoff: null,
}]), false);
assert.throws(() => buildSafetyAssistantMoveEnvelope({
  assistantMoveId: openEnvelope.assistantMoveId,
  safetyTraceId: "safety-request-1",
  sourceUserTurnId: "user-turn-safety",
  committedMove: safetyMove,
  sourceAssistantMoveId: openEnvelope.assistantMoveId,
}), /self_target_forbidden/);

const deferredPlan: ResponsePlan = {
  ...handoffPlan,
  planId: "plan-deferred-1",
  interactionMoveHandoffPlan: {
    ...handoffPlan.interactionMoveHandoffPlan!,
    requiredFunction: "defer_handoff_completion",
    completionIntent: "defer",
  },
};
const deferredEnvelope = buildResponsePlanAssistantMoveEnvelope({
  assistantMoveId: "assistant-response-deferred-1",
  planId: deferredPlan.planId,
  sourceUserTurnId: "user-turn-1",
  committedMove,
  handoffCommitEvidence: {
    executionPhase: "VALIDATED",
    finalAttemptPhase: "VALIDATED",
    executionPlanId: deferredPlan.planId,
    executionTurnId: "user-turn-1",
    responsePlan: deferredPlan,
    finalValidation: {
      passed: true,
      failureReasons: [],
      checkedPlanId: deferredPlan.planId,
      planChanged: false,
    },
  },
});
assert.equal(deferredEnvelope.handoff, null);

const invalidEvidenceCases: Array<Partial<InteractionMoveHandoffCommitEvidence>> = [
  { executionPlanId: "wrong-plan" },
  { executionTurnId: "wrong-turn" },
  { finalAttemptPhase: "REJECTED" },
  { finalValidation: { passed: false, failureReasons: ["rejected"], checkedPlanId: handoffPlan.planId, planChanged: false } },
  { finalValidation: { passed: true, failureReasons: [], checkedPlanId: "wrong-plan", planChanged: false } },
];
for (const invalidEvidence of invalidEvidenceCases) {
  assert.throws(() => buildResponsePlanAssistantMoveEnvelope({
    assistantMoveId: `assistant-invalid-${Object.keys(invalidEvidence)[0]}`,
    planId: handoffPlan.planId,
    sourceUserTurnId: "user-turn-1",
    committedMove,
    handoffCommitEvidence: {
      executionPhase: "VALIDATED",
      finalAttemptPhase: "VALIDATED",
      executionPlanId: handoffPlan.planId,
      executionTurnId: "user-turn-1",
      responsePlan: handoffPlan,
      finalValidation: {
        passed: true,
        failureReasons: [],
        checkedPlanId: handoffPlan.planId,
        planChanged: false,
      },
      ...invalidEvidence,
    },
  }), /Invalid validated interaction move handoff commit evidence/);
}

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
    intent: greetingCases[0].intent,
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
assert(plannerSource.includes("parseCommittedAssistantMoveEnvelope"));
assert(!plannerSource.includes("persistentHandoffLifecycleState"));
for (const source of [authReplySource, authGreetingSource, guestReplySource, guestGreetingSource]) {
  assert(source.includes("interactionMoveEnvelope"));
}
assert(authReplySource.includes('execution.phase !== "VALIDATED"'));
assert(guestReplySource.indexOf('reply.execution.phase !== "VALIDATED"') <
  guestReplySource.indexOf("const interactionMoveEnvelope = reply.finalSource"));
assert(authReplySource.includes('reply.finalSource === "safety" ? "safety_override" : "response_plan"'));
assert(authReplySource.includes("activeHandoff("));
assert(guestReplySource.includes('reply.finalSource === "safety"'));
assert(guestReplySource.includes("activeHandoff("));

console.log("interaction move envelope checks passed");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
