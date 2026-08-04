import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AiGenerationStatus,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import type { ResponsePlan } from "../conversation-os/control";
import { extractCommittedAssistantMoveEnvelope } from "../conversation-os";
import { prisma } from "../lib/prisma";
import {
  buildAttemptTransitions,
  classifyExecutionError,
  preflightResponsePlan,
  toUserSafeExecutionStatus,
  type ChatExecutionTrace,
} from "../services/ai/chatExecutionLifecycle";
import {
  buildCommittedAssistantMove,
  commitValidatedAssistantMessage,
} from "../services/ai/chatReplyService";
import { ensureProactiveChatGreeting } from "../services/chat/proactiveGreetingService";
import {
  CHAT_PROMPT_VERSION,
  sanitizeChatHistory,
} from "../services/ai/promptBuilder";
import { enforceResponsePlan } from "../services/ai/responsePlanValidator";
import type { AiGenerationResult } from "../services/ai/types";

const plan: ResponsePlan = {
  planId: "execution-check:turn-1:response-plan",
  decisionOwner: "conversation_os.response_planner",
  behaviorSource: "ordinary_conversation",
  planningDepth: "minimal",
  answerObligations: [],
  disclosureScope: { conversationId: "execution-check", turnId: "turn-1" },
  correction: null,
  responseActions: ["acknowledge_without_psychologizing"],
  groundingFacts: [],
  requiredDisclosure: [],
  clinicalStrategy: null,
  positiveFunctionContract: null,
  interactionMoveHandoffPlan: null,
  questionPolicy: { mode: "none", reason: "deterministic check" },
  closurePolicy: { mode: "forbid_closure", reason: "deterministic check" },
  tone: ["natural"],
  stance: ["direct"],
  lengthGuidance: "short",
  prohibitedClaims: [],
  safetyConstraints: [],
  relevanceProvenance: [{
    planElement: "responseAction:acknowledge_without_psychologizing",
    source: "current_turn",
    sourceTurnId: "turn-1",
    evidence: ["test interaction state"],
  }],
  evidence: ["test plan"],
};

const generation = (text: string): AiGenerationResult => ({
  text,
  model: "deterministic-test",
  promptVersion: CHAT_PROMPT_VERSION,
  latencyMs: 0,
  rawLLMOutput: text,
  postProcessSteps: [],
  finalReplySource: "llm",
});

const main = async () => {
assert.deepEqual(preflightResponsePlan(plan), { passed: true, failureReasons: [] });
assert.equal(
  preflightResponsePlan({ ...plan, decisionOwner: "conversation_os.response_planner", relevanceProvenance: [] }).passed,
  false
);
const emotionalActionWithoutContract: ResponsePlan = {
  ...plan,
  responseActions: ["offer_emotional_support"],
  relevanceProvenance: [{
    planElement: "responseAction:offer_emotional_support",
    source: "current_turn",
    sourceTurnId: "turn-1",
    evidence: ["currentUserMessage=我有点难受"],
  }],
};
assert.deepEqual(
  preflightResponsePlan(emotionalActionWithoutContract).failureReasons,
  ["missing_or_mismatched_positive_function_contract:offer_emotional_support"]
);
const contractWithoutMatchingAction: ResponsePlan = {
  ...plan,
  positiveFunctionContract: {
    action: "offer_emotional_support",
    supportFunction: "return_focus_control",
    sourceTurnId: "turn-1",
    sourceText: "我有点难受",
    affectEvidenceSpans: [{
      source: "current_user_message",
      sourceTurnId: "turn-1",
      text: "难受",
      start: 3,
      end: 5,
      category: "distress",
      intensity: "low",
      object: "self_experience",
    }],
    explicitAffectOrImpactTerms: ["难受"],
    intensityCeiling: "current_user_expression",
    evidence: ["preflight fixture"],
  },
};
assert.deepEqual(
  preflightResponsePlan(contractWithoutMatchingAction).failureReasons,
  ["positive_function_contract_without_matching_action"]
);
assert.deepEqual(
  preflightResponsePlan({
    ...emotionalActionWithoutContract,
    positiveFunctionContract: {
      action: "offer_emotional_support",
      supportFunction: "return_focus_control",
      sourceTurnId: "turn-1",
      sourceText: "我很疲惫",
      affectEvidenceSpans: [],
      explicitAffectOrImpactTerms: [],
      intensityCeiling: "current_user_expression",
      evidence: ["empty evidence fixture"],
    },
}).failureReasons,
  ["missing_emotional_support_evidence_spans"]
);

const emotionalPlanWithEvidence: ResponsePlan = {
  ...emotionalActionWithoutContract,
  positiveFunctionContract: contractWithoutMatchingAction.positiveFunctionContract,
};
assert.deepEqual(preflightResponsePlan(emotionalPlanWithEvidence), { passed: true, failureReasons: [] });
assert.deepEqual(
  preflightResponsePlan({
    ...emotionalPlanWithEvidence,
    positiveFunctionContract: {
      ...(emotionalPlanWithEvidence.positiveFunctionContract as Extract<
        NonNullable<ResponsePlan["positiveFunctionContract"]>,
        { action: "offer_emotional_support" }
      >),
      sourceTurnId: "another-turn",
      affectEvidenceSpans: [{
        ...(emotionalPlanWithEvidence.positiveFunctionContract as Extract<
          NonNullable<ResponsePlan["positiveFunctionContract"]>,
          { action: "offer_emotional_support" }
        >).affectEvidenceSpans[0],
        sourceTurnId: "another-turn",
      }],
    },
  }).failureReasons,
  ["emotional_support_evidence_wrong_turn"]
);
assert.deepEqual(
  preflightResponsePlan({
    ...emotionalPlanWithEvidence,
    positiveFunctionContract: {
      ...(emotionalPlanWithEvidence.positiveFunctionContract as Extract<
        NonNullable<ResponsePlan["positiveFunctionContract"]>,
        { action: "offer_emotional_support" }
      >),
      affectEvidenceSpans: [{
        ...(emotionalPlanWithEvidence.positiveFunctionContract as Extract<
          NonNullable<ResponsePlan["positiveFunctionContract"]>,
          { action: "offer_emotional_support" }
        >).affectEvidenceSpans[0],
        start: 0,
        end: 2,
      }],
    },
  }).failureReasons,
  ["emotional_support_evidence_span_not_in_source_text"]
);

const committedMoveFixture = (
  text: string,
  questionMode: ResponsePlan["questionPolicy"]["mode"]
) => buildCommittedAssistantMove({
  generation: generation(text),
  controlTrace: {
    responsePlan: {
      ...plan,
      questionPolicy: { mode: questionMode, reason: "committed move fixture" },
    },
  },
  execution: {
    planId: plan.planId,
    requestId: "committed-move-request",
    turnId: "committed-move-turn",
  },
} as unknown as Parameters<typeof buildCommittedAssistantMove>[0]);
assert.deepEqual(
  committedMoveFixture("现场怎么样？", "optional_after_answer").questionOrRequest,
  { kind: "question" }
);
assert.deepEqual(
  committedMoveFixture("现场怎么样？那就从这里说起。", "optional_after_answer").questionOrRequest,
  { kind: "question" }
);
assert.equal(
  committedMoveFixture("听起来你去看了音乐节。", "optional_after_answer").questionOrRequest,
  null
);
assert.equal(
  committedMoveFixture("现场怎么样？", "none").questionOrRequest,
  null
);

let doubleFailureCalls = 0;
const doubleFailure = await enforceResponsePlan({
  plan,
  generate: async () => {
    doubleFailureCalls += 1;
    return generation(doubleFailureCalls === 1 ? "还想说什么？" : "那你呢？");
  },
});
assert.equal(doubleFailureCalls, 2);
assert.equal(doubleFailure.outcome, "failed");
assert.equal(doubleFailure.generation.finalReplySource, "constraint_failure");
assert.equal(doubleFailure.generation.text, "那你呢？");
assert(!doubleFailure.generation.text.includes("本轮回复未通过"));

let retryCalls = 0;
const retrySuccess = await enforceResponsePlan({
  plan,
  generate: async () => generation(++retryCalls === 1 ? "还想说什么？" : "好，我们接着来。"),
});
assert.equal(retrySuccess.outcome, "validated");
assert.equal(retrySuccess.regenerateAttempted, true);
assert.equal(retrySuccess.generation.finalReplySource, "llm_regenerate");

const idleAnswerPlan: ResponsePlan = {
  ...plan,
  planId: "execution-check:idle-answer:response-plan",
  relevanceProvenance: [{
    planElement: "responseAction:acknowledge_without_psychologizing",
    source: "current_turn",
    sourceTurnId: "idle-answer-turn",
    evidence: ["currentUserMessage=发呆"],
  }],
};
let idleAnswerRetryConstraint = "";
const idleAnswerRetry = await enforceResponsePlan({
  plan: idleAnswerPlan,
  generate: async (constraint) => {
    if (!constraint) return generation("发呆也挺好。");
    idleAnswerRetryConstraint = constraint;
    return generation("原来是发呆。");
  },
});
assert.equal(idleAnswerRetry.outcome, "validated");
assert.equal(idleAnswerRetry.regenerateAttempted, true);
assert.equal(idleAnswerRetry.generation.finalReplySource, "llm_regenerate");
assert(idleAnswerRetryConstraint.includes("删掉助手自行添加的评价词“挺好”"));
assert(idleAnswerRetryConstraint.includes("不要换一个话题继续采访用户"));
assert(!idleAnswerRetryConstraint.includes("原来是发呆。"));

const retryTransitions = buildAttemptTransitions({
  attempts: retrySuccess.attempts.map((attempt, index) => ({
    attemptId: `attempt-${index + 1}`,
    phase: retrySuccess.validations[index].passed ? "VALIDATED" : "REJECTED",
    generation: attempt,
    validation: retrySuccess.validations[index],
  })),
  validated: true,
});
assert.deepEqual(
  retryTransitions.map((item) => item.phase),
  ["GENERATED", "REJECTED", "RETRYING", "GENERATED", "VALIDATED"]
);

const failedExecution: ChatExecutionTrace = {
  requestId: "request-check",
  conversationId: "conversation-check",
  turnId: "turn-check",
  planId: plan.planId,
  phase: "FAILED",
  planPreflight: { passed: true, failureReasons: [] },
  transitions: [
    { phase: "PLANNED", reason: "deterministic check" },
    { phase: "FAILED", reason: "deterministic check" },
  ],
  attempts: [],
  failure: {
    code: "GENERATION_NONCONFORMANT",
    reason: "internal validator detail",
    retryable: true,
  },
};
const publicStatus = toUserSafeExecutionStatus(failedExecution);
assert.equal(publicStatus.type, "system_status");
assert(!publicStatus.message.includes("validator"));
assert(!publicStatus.message.includes("ResponsePlan"));
assert.equal(classifyExecutionError(new Error("provider unavailable")).code, "PROVIDER_ERROR");
const timeoutError = new Error("request timed out");
timeoutError.name = "AbortError";
assert.equal(classifyExecutionError(timeoutError).code, "TIMEOUT");
for (const code of [
  "PLAN_INVALID",
  "GENERATION_NONCONFORMANT",
  "SAFETY_BLOCKED",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "PERSISTENCE_ERROR",
] as const) {
  const status = toUserSafeExecutionStatus({
    ...failedExecution,
    failure: { code, reason: `private:${code}`, retryable: code !== "SAFETY_BLOCKED" },
  });
  assert.equal(status.code, code);
  assert(!status.message.includes("private:"));
}

const history = Array.from({ length: 20 }, (_, index) => {
  const userId = `u-${index}`;
  const assistantId = `a-${index}`;
  return [
    {
      id: userId,
      role: "user" as const,
      content: `blind user turn ${index}`,
      status: "saved" as const,
    },
    {
      id: assistantId,
      role: "assistant" as const,
      content: index % 5 === 4 ? `legacy committed answer ${index}` : `blind committed answer ${index}`,
      status: "saved" as const,
      promptVersion: index % 5 === 4 ? "legacy-v1" : CHAT_PROMPT_VERSION,
      replyToMessageId: userId,
    },
  ];
}).flat();
const sanitized = sanitizeChatHistory({
  userMessage: "a new blind message",
  recentMessages: history,
});
for (const index of [16, 17, 18, 19]) {
  assert(sanitized.included.some((item) => item.content === `blind user turn ${index}`));
}
assert(sanitized.included.some((item) => item.content === "legacy committed answer 19"));
const metamorphicHistory = sanitizeChatHistory({
  userMessage: "completely different current wording",
  recentMessages: history,
});
assert.deepEqual(metamorphicHistory.included, sanitized.included);
const blockedHistory = sanitizeChatHistory({
  userMessage: "continue",
  recentMessages: [
    { id: "blocked-source", role: "user", content: "source", status: "saved" },
    {
      id: "blocked-reply",
      role: "assistant",
      content: "internal failure",
      status: "blocked",
      replyToMessageId: "blocked-source",
    },
    { id: "kept-user", role: "user", content: "kept", status: "saved" },
  ],
});
assert(blockedHistory.included.some((item) => item.content === "source"));
assert(!blockedHistory.included.some((item) => item.content === "internal failure"));
assert(blockedHistory.included.some((item) => item.content === "kept"));

const irregularRoles = sanitizeChatHistory({
  userMessage: "resume",
  recentMessages: [
    { id: "u1", role: "user", content: "first user", status: "saved" },
    { id: "u2", role: "user", content: "second user", status: "saved" },
    {
      id: "a2",
      role: "assistant",
      content: "legacy answer",
      status: "saved",
      promptVersion: "legacy-v1",
      replyToMessageId: "u2",
    },
    {
      id: "a-extra",
      role: "assistant",
      content: "independent committed assistant event",
      status: "saved",
      promptVersion: CHAT_PROMPT_VERSION,
    },
  ],
});
assert(irregularRoles.included.some((item) => item.content === "first user"));
assert(irregularRoles.included.some((item) => item.content === "second user"));
assert(irregularRoles.included.some((item) => item.content === "legacy answer"));
assert(irregularRoles.included.some((item) => item.content === "independent committed assistant event"));
assert.equal(irregularRoles.filteredHistory.length, 0);

const validatorSource = await readFile(
  new URL("../services/ai/responsePlanValidator.ts", import.meta.url),
  "utf8"
);
const orchestrationSource = await readFile(
  new URL("../services/ai/chatOrchestrationService.ts", import.meta.url),
  "utf8"
);
const guestRouteSource = await readFile(
  new URL("../app/api/chat/guest/route.ts", import.meta.url),
  "utf8"
);
const loggedRouteSource = await readFile(
  new URL("../app/api/chat/sessions/[sessionId]/messages/route.ts", import.meta.url),
  "utf8"
);
const clientSource = await readFile(
  new URL("../app/chat/chat-client.tsx", import.meta.url),
  "utf8"
);
assert(!validatorSource.includes("RESPONSE_PLAN_CONSTRAINT_FAILURE_REPLY"));
assert(!orchestrationSource.includes("本轮回复未通过既定回复计划约束"));
assert(guestRouteSource.includes('status: "failed"'));
assert(loggedRouteSource.includes('status: "failed"'));
assert(clientSource.includes('type: "system_status"'));
assert(clientSource.includes("重新生成"));

const fixtureUser = await prisma.user.create({ data: {} });
try {
  const session = await prisma.chatSession.create({ data: { userId: fixtureUser.id } });
  const proactiveSession = await prisma.chatSession.create({ data: { userId: fixtureUser.id } });
  const previousProvider = process.env.AI_PROVIDER;
  const previousQwenKey = process.env.QWEN_API_KEY;
  const previousGreetingMode = process.env.PROACTIVE_GREETING_MODE;
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "synthetic-test-key";
  process.env.PROACTIVE_GREETING_MODE = "deterministic";
  let proactiveMessage: Awaited<ReturnType<typeof ensureProactiveChatGreeting>>;
  try {
    proactiveMessage = await ensureProactiveChatGreeting({
      sessionId: proactiveSession.id,
      userId: fixtureUser.id,
      force: true,
    });
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousQwenKey === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = previousQwenKey;
    if (previousGreetingMode === undefined) delete process.env.PROACTIVE_GREETING_MODE;
    else process.env.PROACTIVE_GREETING_MODE = previousGreetingMode;
  }
  assert(proactiveMessage);
  const storedProactiveMessage = await prisma.chatMessage.findUniqueOrThrow({
    where: { id: proactiveMessage.id },
    select: { id: true, aiGeneration: { select: { executionTrace: true } } },
  });
  const proactiveEnvelope = extractCommittedAssistantMoveEnvelope(
    storedProactiveMessage.aiGeneration?.executionTrace
  );
  assert(proactiveEnvelope);
  assert.equal(proactiveEnvelope.assistantMoveId, storedProactiveMessage.id);
  if (proactiveEnvelope.origin.kind !== "proactive_greeting") {
    throw new Error("Expected a proactive greeting envelope.");
  }
  assert.equal(proactiveEnvelope.committedMove.sourceTurnId, null);
  if (!proactiveEnvelope.handoff || proactiveEnvelope.handoff.edge !== "opens") {
    throw new Error("Expected an opening handoff edge.");
  }
  assert.equal(proactiveEnvelope.handoff.edge, "opens");

  const userTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      role: MessageRole.USER,
      content: "concurrency fixture",
      status: MessageStatus.SAVED,
    },
  });
  const storedGenerations = await Promise.all([
    prisma.aiGeneration.create({ data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: userTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: userTurn.content,
      outputText: "one committed reply",
      status: AiGenerationStatus.GENERATED,
      requestId: "concurrent-request-a",
      turnId: userTurn.id,
      attemptId: "concurrent-attempt-a",
    } }),
    prisma.aiGeneration.create({ data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: userTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: userTurn.content,
      outputText: "one committed reply",
      status: AiGenerationStatus.GENERATED,
      requestId: "concurrent-request-b",
      turnId: userTurn.id,
      attemptId: "concurrent-attempt-b",
    } }),
  ]);
  const metadata = {
    purpose: ["acknowledge_without_psychologizing"],
    claims: [],
    assumptions: [],
    questionOrRequest: null,
    expectedUserContribution: "none" as const,
    userBurden: "none" as const,
    sourceTurnId: userTurn.id,
    evidence: ["concurrency fixture"],
  };
  const results = await Promise.all([
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: session.id,
      content: "one committed reply",
      status: MessageStatus.SAVED,
      aiGenerationId: storedGenerations[0].id,
      replyToMessageId: userTurn.id,
      interactionMetadata: metadata,
      execution: {
        ...failedExecution,
        requestId: "concurrent-request-a",
        turnId: userTurn.id,
        phase: "VALIDATED",
        transitions: [
          { phase: "PLANNED", reason: "deterministic check" },
          { phase: "VALIDATED", reason: "deterministic check" },
        ],
        failure: undefined,
      },
    }),
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: session.id,
      content: "one committed reply",
      status: MessageStatus.SAVED,
      aiGenerationId: storedGenerations[1].id,
      replyToMessageId: userTurn.id,
      interactionMetadata: metadata,
      execution: {
        ...failedExecution,
        requestId: "concurrent-request-b",
        turnId: userTurn.id,
        phase: "VALIDATED",
        transitions: [
          { phase: "PLANNED", reason: "deterministic check" },
          { phase: "VALIDATED", reason: "deterministic check" },
        ],
        failure: undefined,
      },
    }),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(
    await prisma.chatMessage.count({
      where: { replyToMessageId: userTurn.id, role: MessageRole.ASSISTANT },
    }),
    1
  );
  const committed = await prisma.chatMessage.findUniqueOrThrow({
    where: { replyToMessageId: userTurn.id },
    select: {
      aiGenerationId: true,
      interactionMetadata: true,
      aiGeneration: { select: { executionTrace: true } },
    },
  });
  assert.equal(
    (committed.interactionMetadata as { sourceTurnId?: string } | null)?.sourceTurnId,
    userTurn.id
  );
  assert.equal(
    (committed.aiGeneration?.executionTrace as { phase?: string } | null)?.phase,
    "COMMITTED"
  );
  const committedEnvelope = extractCommittedAssistantMoveEnvelope(
    committed.aiGeneration?.executionTrace
  );
  assert(committedEnvelope);
  assert.equal(committedEnvelope.assistantMoveId, results[0].id);
  assert.equal(committedEnvelope.origin.kind, "response_plan");
  assert.equal(committedEnvelope.committedMove.sourceTurnId, userTurn.id);
  assert.equal(committedEnvelope.handoff, null);
  const generationTraces = await prisma.aiGeneration.findMany({
    where: { id: { in: storedGenerations.map((item) => item.id) } },
    select: { id: true, executionTrace: true },
  });
  const envelopedTraces = generationTraces.filter((item) =>
    extractCommittedAssistantMoveEnvelope(item.executionTrace)
  );
  assert.equal(envelopedTraces.length, 1);
  assert.equal(envelopedTraces[0].id, committed.aiGenerationId);

  const rejectedCommitTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      role: MessageRole.USER,
      content: "reject commit boundary fixture",
      status: MessageStatus.SAVED,
    },
  });
  const rejectedCommitGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: rejectedCommitTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: rejectedCommitTurn.content,
      outputText: "must not commit",
      status: AiGenerationStatus.FAILED,
      executionTrace: {
        ...failedExecution,
        turnId: rejectedCommitTurn.id,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await assert.rejects(
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: session.id,
      content: "must not commit",
      status: MessageStatus.SAVED,
      aiGenerationId: rejectedCommitGeneration.id,
      replyToMessageId: rejectedCommitTurn.id,
      interactionMetadata: {
        ...metadata,
        sourceTurnId: rejectedCommitTurn.id,
      },
      execution: {
        ...failedExecution,
        turnId: rejectedCommitTurn.id,
      },
    }),
    /validated execution/
  );
  assert.equal(
    await prisma.chatMessage.count({
      where: { replyToMessageId: rejectedCommitTurn.id, role: MessageRole.ASSISTANT },
    }),
    0
  );
  const rejectedTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: rejectedCommitGeneration.id },
    select: { executionTrace: true },
  });
  assert.equal(extractCommittedAssistantMoveEnvelope(rejectedTrace.executionTrace), null);

  const rolledBackTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      role: MessageRole.USER,
      content: "atomic rollback fixture",
      status: MessageStatus.SAVED,
    },
  });
  const rolledBackGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: rolledBackTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: rolledBackTurn.content,
      outputText: "must roll back",
      status: AiGenerationStatus.GENERATED,
    },
  });
  await assert.rejects(
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: session.id,
      content: "must roll back",
      status: MessageStatus.SAVED,
      aiGenerationId: rolledBackGeneration.id,
      replyToMessageId: rolledBackTurn.id,
      interactionMetadata: {
        ...metadata,
        sourceTurnId: "mismatched-source-turn",
      },
      execution: {
        ...failedExecution,
        requestId: "rollback-request",
        turnId: rolledBackTurn.id,
        phase: "VALIDATED",
        transitions: [
          { phase: "PLANNED", reason: "atomic rollback fixture" },
          { phase: "VALIDATED", reason: "atomic rollback fixture" },
        ],
        failure: undefined,
      },
    }),
    /Invalid committed Assistant move envelope/
  );
  assert.equal(
    await prisma.chatMessage.count({
      where: { replyToMessageId: rolledBackTurn.id, role: MessageRole.ASSISTANT },
    }),
    0
  );
  const rolledBackTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: rolledBackGeneration.id },
    select: { executionTrace: true },
  });
  assert.equal(extractCommittedAssistantMoveEnvelope(rolledBackTrace.executionTrace), null);

  const safetyTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      role: MessageRole.USER,
      content: "safety foundation boundary fixture",
      status: MessageStatus.SAVED,
    },
  });
  const safetyGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: safetyTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: safetyTurn.content,
      outputText: "safety response",
      status: AiGenerationStatus.GENERATED,
    },
  });
  const safetyMessage = await commitValidatedAssistantMessage({
    userId: fixtureUser.id,
    sessionId: session.id,
    content: "safety response",
    status: MessageStatus.SAVED,
    aiGenerationId: safetyGeneration.id,
    replyToMessageId: safetyTurn.id,
    interactionMetadata: { ...metadata, sourceTurnId: safetyTurn.id },
    execution: {
      ...failedExecution,
      requestId: "safety-request",
      turnId: safetyTurn.id,
      phase: "VALIDATED",
      transitions: [
        { phase: "PLANNED", reason: "safety foundation fixture" },
        { phase: "VALIDATED", reason: "safety foundation fixture" },
      ],
      failure: undefined,
    },
    envelopeOrigin: null,
  });
  assert.equal(safetyMessage.interactionMoveEnvelope, null);
  const safetyTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: safetyGeneration.id },
    select: { executionTrace: true },
  });
  assert.equal(
    (safetyTrace.executionTrace as { phase?: string } | null)?.phase,
    "COMMITTED"
  );
  assert.equal(extractCommittedAssistantMoveEnvelope(safetyTrace.executionTrace), null);

  const failedTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      role: MessageRole.USER,
      content: "failed execution fixture",
      status: MessageStatus.SAVED,
    },
  });
  const failedGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: session.id,
      sourceType: AiSourceType.CHAT,
      sourceId: failedTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: failedTurn.content,
      outputText: "rejected raw candidate",
      status: AiGenerationStatus.FAILED,
      requestId: "failed-request-fixture",
      turnId: failedTurn.id,
      attemptId: "failed-attempt-fixture",
      executionTrace: {
        ...failedExecution,
        turnId: failedTurn.id,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  assert.equal(
    await prisma.chatMessage.count({
      where: { replyToMessageId: failedTurn.id, role: MessageRole.ASSISTANT },
    }),
    0
  );
  assert.equal(
    extractCommittedAssistantMoveEnvelope(failedGeneration.executionTrace),
    null
  );
} finally {
  await prisma.user.delete({ where: { id: fixtureUser.id } });
}

console.log("chat execution lifecycle checks passed");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
