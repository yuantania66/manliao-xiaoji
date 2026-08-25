import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";

import {
  AiGenerationStatus,
  AiSourceType,
  MessageRole,
  MessageStatus,
  Prisma,
} from "@prisma/client";

import type { ResponsePlan } from "../conversation-os/control";
import { buildCanonicalOrdinaryPostureProvenance } from "../conversation-os/control/responsePlanPreflightAuthority";
import {
  activeHandoff,
  attachCommittedAssistantMoveEnvelope,
  buildProactiveGreetingAssistantMoveEnvelope,
  extractCommittedAssistantMoveEnvelope,
  handoffCompleted,
  handoffResolved,
  handoffSuperseded,
} from "../conversation-os";
import { prisma } from "../lib/prisma";
import {
  buildAttemptTransitions,
  classifyExecutionError,
  createPlanPreflightRecoveryDirective,
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
  behaviorSource: "legacy_compat",
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
  ordinaryPosture: null,
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

const ordinaryPlan: ResponsePlan = {
  ...plan,
  behaviorSource: "ordinary_conversation",
  ordinaryPosture: {
    mode: "accompany",
    sourceSpans: [{
      source: "current_user_turn",
      sourceTurnId: "turn-1",
      start: 0,
      end: 4,
      text: "当前内容",
    }],
    requiredContribution: {
      targetSpanIndexes: [0],
      instruction: "对用户当前表达的具体内容作出贴切回应。",
    },
    evidence: ["owner=conversation_os.response_planner"],
  },
  relevanceProvenance: [
    ...plan.relevanceProvenance,
    buildCanonicalOrdinaryPostureProvenance({
      mode: "accompany",
      sourceSpans: [{
        source: "current_user_turn",
        sourceTurnId: "turn-1",
        start: 0,
        end: 4,
        text: "当前内容",
      }],
      requiredContribution: {
        targetSpanIndexes: [0],
        instruction: "对用户当前表达的具体内容作出贴切回应。",
      },
      evidence: ["owner=conversation_os.response_planner"],
    }),
  ],
};

const ordinaryAuthority = {
  expectedInteractionMoveHandoffPlan: null,
  currentSource: {
    conversationId: "execution-check",
    userTurnId: "turn-1",
    userText: "当前内容",
  },
  adjacentCommittedUserSources: [],
  targetSource: null,
  expectedAnswerObligations: [],
  canonicalProvenance: [],
} as const;

const generation = (text: string): AiGenerationResult => ({
  text,
  model: "deterministic-test",
  promptVersion: CHAT_PROMPT_VERSION,
  latencyMs: 0,
  rawLLMOutput: text,
  postProcessSteps: [],
  finalReplySource: "llm",
});

const consumeRequest = (request: IncomingMessage) =>
  new Promise<void>((resolve, reject) => {
    request.on("data", () => undefined);
    request.on("end", resolve);
    request.on("error", reject);
  });

const listenOnLoopback = (server: Server) => new Promise<number>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Lifecycle Qwen stub did not expose an OS-assigned port"));
      return;
    }
    resolve(address.port);
  });
});

const closeServer = (server: Server) => new Promise<void>((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const main = async () => {
assert.deepEqual(preflightResponsePlan(ordinaryPlan, ordinaryAuthority), { passed: true, failureReasons: [] });
assert.deepEqual(
  preflightResponsePlan({
    ...ordinaryPlan,
    ordinaryPosture: ordinaryPlan.ordinaryPosture && {
      ...ordinaryPlan.ordinaryPosture,
      sourceSpans: [{
        ...ordinaryPlan.ordinaryPosture.sourceSpans[0],
        text: "伪造内容",
      }],
    },
  }, ordinaryAuthority).failureReasons,
  ["ordinary_posture_source_span_authority_mismatch", "ordinary_posture_provenance_mismatch"]
);
const postureModeTamper = structuredClone(ordinaryPlan) as ResponsePlan & {
  ordinaryPosture: NonNullable<ResponsePlan["ordinaryPosture"]>;
};
postureModeTamper.ordinaryPosture.mode = "invalid" as "accompany";
assert(preflightResponsePlan(postureModeTamper, ordinaryAuthority).failureReasons.includes("invalid_ordinary_posture_mode"));
assert(preflightResponsePlan(postureModeTamper, ordinaryAuthority).failureReasons.includes("ordinary_posture_provenance_mismatch"));

const postureInstructionTamper = structuredClone(ordinaryPlan);
postureInstructionTamper.ordinaryPosture!.requiredContribution.instruction = "篡改后的 instruction";
assert.deepEqual(
  preflightResponsePlan(postureInstructionTamper, ordinaryAuthority).failureReasons,
  ["ordinary_posture_provenance_mismatch"]
);

const postureTargetTamper = structuredClone(ordinaryPlan);
postureTargetTamper.ordinaryPosture!.requiredContribution.targetSpanIndexes = [0, 0];
assert(preflightResponsePlan(postureTargetTamper, ordinaryAuthority).failureReasons.includes("invalid_ordinary_posture_target_span_indexes"));
assert(preflightResponsePlan(postureTargetTamper, ordinaryAuthority).failureReasons.includes("ordinary_posture_provenance_mismatch"));

const postureProvenanceTamper = structuredClone(ordinaryPlan);
postureProvenanceTamper.relevanceProvenance = postureProvenanceTamper.relevanceProvenance.map((item) =>
  item.planElement === "ordinaryPosture:binding"
    ? { ...item, evidence: ["legacy_noncanonical_posture_evidence"] }
    : item
);
assert.deepEqual(
  preflightResponsePlan(postureProvenanceTamper, ordinaryAuthority).failureReasons,
  ["ordinary_posture_provenance_mismatch"]
);
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
const emotionalPlanWithoutEvidence: ResponsePlan = {
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
};
const emotionalPlanWithoutEvidencePreflight = preflightResponsePlan(
  emotionalPlanWithoutEvidence
);
assert.deepEqual(
  emotionalPlanWithoutEvidencePreflight.failureReasons,
  ["missing_emotional_support_evidence_spans"]
);
assert.deepEqual(
  createPlanPreflightRecoveryDirective(
    emotionalPlanWithoutEvidence,
    emotionalPlanWithoutEvidencePreflight
  ),
  {
    attempt: 1,
    rejectedPlanId: emotionalPlanWithoutEvidence.planId,
    failureReason: "missing_emotional_support_evidence_spans",
    unavailableActions: ["offer_emotional_support"],
  },
  "Only the exact empty-span local failure may create a turn-local recovery directive."
);
assert.equal(
  createPlanPreflightRecoveryDirective(emotionalPlanWithoutEvidence, {
    passed: false,
    failureReasons: [
      "missing_emotional_support_evidence_spans",
      "invalid_decision_owner",
    ],
  }),
  null,
  "A mixed local and authority failure must remain fail-closed."
);
assert.equal(
  createPlanPreflightRecoveryDirective(emotionalPlanWithoutEvidence, {
    passed: false,
    failureReasons: ["emotional_support_evidence_wrong_turn"],
  }),
  null,
  "Evidence-integrity failures must remain fail-closed."
);
const recoveredOrdinaryPlan: ResponsePlan = {
  ...plan,
  planId: `${plan.planId}:recovery-1`,
};
assert.equal(
  createPlanPreflightRecoveryDirective(
    recoveredOrdinaryPlan,
    preflightResponsePlan(recoveredOrdinaryPlan)
  ),
  null,
  "A recovered plan cannot request another recovery."
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
assert.equal(doubleFailure.validations.at(-1)?.passed, false);
assert((doubleFailure.validations.at(-1)?.hardFailureReasons?.length ?? 0) > 0);
assert.equal(doubleFailure.validations.at(-1)?.advisoryFailureReasons?.length, 0);

const positiveOnlyPlan: ResponsePlan = {
  ...plan,
  planId: "execution-check:positive-only-semantic-failure",
  responseActions: ["establish_assistant_identity"],
  positiveFunctionContract: {
    action: "establish_assistant_identity",
    mode: "first_contact",
    displayName: "小慢",
    sourceTurnId: plan.disclosureScope.turnId,
    targetProposition: null,
    evidence: ["authority=first_contact_no_topic_structure"],
  },
};
let positiveSemanticCalls = 0;
const positiveSemanticDoubleFailure = await enforceResponsePlan({
  plan: positiveOnlyPlan,
  plannedFunctionSemanticContext: {
    currentUserText: "你好",
    handoffTargetAssistantText: null,
  },
  generate: async () => generation("我是小慢。"),
  plannedFunctionSemanticProvider: async (input) => {
    positiveSemanticCalls += 1;
    assert.equal(input.handoffBinding, null);
    assert.equal(input.positiveFunctionBinding?.action, "establish_assistant_identity");
    return {
      schemaVersion: 1,
      planId: input.planId,
      handoff: null,
      positiveFunction: {
        binding: {
          action: "establish_assistant_identity",
          mode: "first_contact",
          sourceTurnId: plan.disclosureScope.turnId,
          targetProposition: null,
        },
        status: "not_satisfied",
        realizedAction: null,
        targetAddressed: false,
        contractRealized: false,
        containsContradictoryMove: false,
        evidence: [],
      },
      semanticQuestionCount: 0,
    };
  },
});
assert.equal(positiveSemanticCalls, 2);
assert.equal(positiveSemanticDoubleFailure.outcome, "failed");
assert.equal(positiveSemanticDoubleFailure.generation.finalReplySource, "constraint_failure");
assert.equal(positiveSemanticDoubleFailure.validations.length, 2);
assert(positiveSemanticDoubleFailure.validations.every((validation) => !validation.passed));

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
  attempts: retrySuccess.attempts.map((attempt, index) => {
    const validation = retrySuccess.validations[index];
    return {
      attemptId: `attempt-${index + 1}`,
      phase: validation.passed ? "VALIDATED" : "REJECTED",
      generation: attempt,
      validation,
    };
  }),
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
    retryable: false,
  },
};
const publicStatus = toUserSafeExecutionStatus(failedExecution);
assert.equal(publicStatus.type, "system_status");
assert(!publicStatus.message.includes("validator"));
assert(!publicStatus.message.includes("ResponsePlan"));
assert.equal(publicStatus.retryable, false);
assert(publicStatus.message.includes("已经尝试修正"));
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
    failure: {
      code,
      reason: `private:${code}`,
      retryable: code === "PROVIDER_ERROR" || code === "TIMEOUT" || code === "PERSISTENCE_ERROR",
    },
  });
  assert.equal(status.code, code);
  assert(!status.message.includes("private:"));
  assert.equal(
    status.retryable,
    code === "PROVIDER_ERROR" || code === "TIMEOUT" || code === "PERSISTENCE_ERROR"
  );
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
  const failedProactiveSession = await prisma.chatSession.create({ data: { userId: fixtureUser.id } });
  const proactiveSurface = "你好，我是小慢，一个AI聊天助手。你可以在这里随便聊，也可以和我一起慢慢理清一些事情；不用先想好完整话题，想到什么就从什么开始。";
  const proactiveIntent = {
    move: "open_statement" as const,
    requiredFunction: "offer_self_contained_conversation_entry" as const,
    realization: {
      kind: "self_contained_entry" as const,
      topic: "assistant first-contact identity and low-pressure entry",
      proposition: proactiveSurface,
    },
    expectedUserContribution: "none" as const,
    userBurden: "none" as const,
  };
  const successfulProactiveVerdict = JSON.stringify({
      intent: proactiveIntent,
      candidate: proactiveSurface,
      evidenceSpan: proactiveSurface,
      verdict: "accept",
      intentFaithfullyRealized: true,
      propositionDelivered: true,
      semanticClarity: true,
      anchoredCommunicativePoint: true,
      selfContained: true,
      requiresSecondAssistantReveal: false,
      createsUserObligation: false,
      groundingObeyed: true,
      contradictoryMove: false,
      topicDistinct: null,
    });
  const qwenResponses = ["第一候选", "第二候选", "第三候选", "第四候选"];
  const qwenServer = createServer(async (request, response) => {
    await consumeRequest(request);
    if (request.method !== "POST" || request.url !== "/compatible-mode/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected lifecycle fixture request" }));
      return;
    }
    const content = qwenResponses.shift();
    if (!content) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "lifecycle fixture response queue exhausted" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      model: "qwen-lifecycle-stub",
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
  const qwenPort = await listenOnLoopback(qwenServer);
  const environmentKeys = [
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
  let proactiveResult: Awaited<ReturnType<typeof ensureProactiveChatGreeting>>;
  try {
    process.env.AI_PROVIDER = "qwen";
    process.env.QWEN_API_KEY = "synthetic-lifecycle-test-key";
    process.env.QWEN_BASE_URL = `http://127.0.0.1:${qwenPort}/compatible-mode/v1`;
    process.env.AI_MAIN_MODEL = "qwen-lifecycle-stub";
    process.env.AI_PROACTIVE_GREETING_MODEL = "qwen-lifecycle-stub";
    process.env.AI_TIMEOUT_MS = "5000";
    const failedGreeting = await ensureProactiveChatGreeting({
      sessionId: failedProactiveSession.id,
      userId: fixtureUser.id,
      force: true,
    });
    assert.equal(failedGreeting.status, "retryable_failure");
    if (failedGreeting.status !== "retryable_failure") {
      throw new Error("Expected visible retryable proactive greeting failure.");
    }
    assert.equal(failedGreeting.systemStatus.retryable, true);
    assert.equal(qwenResponses.length, 0, "Lifecycle proactive failure fixture must consume both bounded attempts");
    assert.equal(await prisma.chatMessage.count({
      where: { sessionId: failedProactiveSession.id },
    }), 0);
    assert.equal(await prisma.aiGeneration.count({
      where: { sessionId: failedProactiveSession.id },
    }), 0);
    qwenResponses.push(proactiveSurface, successfulProactiveVerdict);
    proactiveResult = await ensureProactiveChatGreeting({
      sessionId: proactiveSession.id,
      userId: fixtureUser.id,
      force: true,
    });
    assert.equal(qwenResponses.length, 0, "Lifecycle proactive fixture must consume two Qwen calls");
  } finally {
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await closeServer(qwenServer);
  }
  assert.equal(proactiveResult.status, "committed");
  if (proactiveResult.status !== "committed") {
    throw new Error("Expected committed proactive greeting.");
  }
  const proactiveMessage = proactiveResult.message;
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

  const handoffTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: proactiveSession.id,
      role: MessageRole.USER,
      content: "你好",
      status: MessageStatus.SAVED,
    },
  });
  const handoffPlan: ResponsePlan = {
    ...plan,
    planId: "handoff-commit-plan",
    disclosureScope: { conversationId: proactiveSession.id, turnId: handoffTurn.id },
    interactionMoveHandoffPlan: {
      sourceAssistantMoveId: proactiveEnvelope.assistantMoveId,
      sourceGreetingFunction: proactiveEnvelope.handoff.greetingFunction,
      sourceUserTurnId: handoffTurn.id,
      selectedRelation: "reciprocates_move",
      requiredFunction: "complete_reciprocal_contact",
      completionIntent: "fulfill",
      questionPolicy: "none",
      evidence: [{
        source: "current_user_turn",
        sourceUserTurnId: handoffTurn.id,
        start: 0,
        end: 2,
        text: "你好",
      }],
    },
  };
  const validatedSourceAssistantMoveId = handoffPlan.interactionMoveHandoffPlan!.sourceAssistantMoveId;
  const validatedRequiredFunction = handoffPlan.interactionMoveHandoffPlan!.requiredFunction;
  const handoffReplyText = "很高兴见到你。";
  const enforcedHandoff = await enforceResponsePlan({
    plan: handoffPlan,
    handoffSemanticContext: {
      targetAssistantText: proactiveMessage.content,
      currentUserText: handoffTurn.content,
    },
    generate: async () => {
      handoffPlan.interactionMoveHandoffPlan!.sourceAssistantMoveId = "mutated-outer-target";
      handoffPlan.interactionMoveHandoffPlan!.requiredFunction = "respect_user_boundary";
      return generation(handoffReplyText);
    },
    handoffSemanticProvider: async (input) => ({
      schemaVersion: 1,
      planId: input.planId,
      sourceAssistantMoveId: input.planBinding.sourceAssistantMoveId,
      sourceUserTurnId: input.planBinding.sourceUserTurnId,
      selectedRelation: input.planBinding.selectedRelation,
      requiredFunction: input.planBinding.requiredFunction,
      completionIntent: input.planBinding.completionIntent,
      questionPolicy: input.planBinding.questionPolicy,
      status: "satisfied",
      realizedFunction: input.planBinding.requiredFunction === "defer_handoff_completion"
        ? null
        : input.planBinding.requiredFunction,
      targetAddressed: true,
      relationAddressed: true,
      positiveFunctionRealized: true,
      containsContradictoryMove: false,
      handoffCompletionClaimed: false,
      semanticQuestionCount: 0,
      ordinaryQuestionIndependentlySupported: input.ordinaryQuestionIndependentlySupported,
      optionalQuestionAfterPositiveFunction: false,
      evidence: [{
        start: 0,
        end: input.candidateReply.length,
        text: input.candidateReply,
        reason: "validated frozen execution plan fixture",
      }],
    }),
  });
  assert.equal(enforcedHandoff.outcome, "validated");
  assert(Object.isFrozen(enforcedHandoff.executionPlan));
  assert(Object.isFrozen(enforcedHandoff.executionPlan.interactionMoveHandoffPlan));
  assert.equal(
    enforcedHandoff.executionPlan.interactionMoveHandoffPlan?.sourceAssistantMoveId,
    validatedSourceAssistantMoveId
  );
  assert.equal(
    enforcedHandoff.executionPlan.interactionMoveHandoffPlan?.requiredFunction,
    validatedRequiredFunction
  );
  assert.equal(handoffPlan.interactionMoveHandoffPlan!.sourceAssistantMoveId, "mutated-outer-target");
  assert.equal(handoffPlan.interactionMoveHandoffPlan!.requiredFunction, "respect_user_boundary");
  const committedHandoffPlan = enforcedHandoff.executionPlan;
  const handoffGeneration = await prisma.aiGeneration.create({ data: {
    userId: fixtureUser.id,
    sessionId: proactiveSession.id,
    sourceType: AiSourceType.CHAT,
    sourceId: handoffTurn.id,
    model: "deterministic-test",
    promptVersion: CHAT_PROMPT_VERSION,
    inputText: handoffTurn.content,
    outputText: handoffReplyText,
    status: AiGenerationStatus.GENERATED,
    requestId: "handoff-commit-request",
    turnId: handoffTurn.id,
    attemptId: "handoff-winner",
  } });
  const handoffExecution: ChatExecutionTrace = {
    ...failedExecution,
    requestId: "handoff-commit-request",
    conversationId: proactiveSession.id,
    turnId: handoffTurn.id,
    planId: committedHandoffPlan.planId,
    phase: "VALIDATED",
    transitions: [
      { phase: "PLANNED", reason: "handoff commit fixture" },
      { phase: "GENERATED", attemptId: "handoff-loser", reason: "retry loser fixture" },
      { phase: "REJECTED", attemptId: "handoff-loser", reason: "retry loser fixture" },
      { phase: "RETRYING", reason: "retry winner fixture" },
      { phase: "GENERATED", attemptId: "handoff-winner", reason: "retry winner fixture" },
      { phase: "VALIDATED", attemptId: "handoff-winner", reason: "retry winner fixture" },
    ],
    attempts: [
      {
        attemptId: "handoff-loser",
        phase: "REJECTED",
        validation: {
          passed: false,
          failureReasons: ["retry_loser"],
          checkedPlanId: committedHandoffPlan.planId,
          planChanged: false,
        },
      },
      {
        attemptId: "handoff-winner",
        phase: "VALIDATED",
        validation: {
          passed: true,
          failureReasons: [],
          checkedPlanId: committedHandoffPlan.planId,
          planChanged: false,
        },
      },
    ],
    failure: undefined,
  };
  const handoffMessage = await commitValidatedAssistantMessage({
    userId: fixtureUser.id,
    sessionId: proactiveSession.id,
    content: handoffReplyText,
    status: MessageStatus.SAVED,
    aiGenerationId: handoffGeneration.id,
    replyToMessageId: handoffTurn.id,
    interactionMetadata: {
      purpose: ["continue_established_thread"],
      claims: [],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: handoffTurn.id,
      evidence: ["handoff commit fixture"],
    },
    execution: handoffExecution,
    responsePlan: committedHandoffPlan,
  });
  assert(handoffMessage.interactionMoveEnvelope);
  assert.deepEqual(handoffMessage.interactionMoveEnvelope.handoff, {
    kind: "proactive_greeting",
    edge: "fulfills",
    sourceAssistantMoveId: proactiveEnvelope.assistantMoveId,
    realizedFunction: "complete_reciprocal_contact",
  });
  assert.equal(handoffCompleted(proactiveEnvelope.assistantMoveId, [
    proactiveEnvelope,
    handoffMessage.interactionMoveEnvelope,
  ]), true);
  const storedHandoffTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: handoffGeneration.id },
    select: { executionTrace: true },
  });
  assert.deepEqual(
    extractCommittedAssistantMoveEnvelope(storedHandoffTrace.executionTrace),
    handoffMessage.interactionMoveEnvelope
  );

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
        sourceTurnId: rolledBackTurn.id,
      },
      execution: {
        ...failedExecution,
        requestId: "rollback-request",
        turnId: rolledBackTurn.id,
        planId: committedHandoffPlan.planId,
        phase: "VALIDATED",
        transitions: [
          { phase: "PLANNED", reason: "atomic rollback fixture" },
          { phase: "VALIDATED", reason: "atomic rollback fixture" },
        ],
        attempts: handoffExecution.attempts,
        failure: undefined,
      },
      responsePlan: committedHandoffPlan,
    }),
    /Invalid validated interaction move handoff commit evidence/
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

  const safetyHandoffSession = await prisma.chatSession.create({
    data: { userId: fixtureUser.id },
  });
  const safetyGreetingGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      sourceType: AiSourceType.CHAT,
      sourceId: safetyHandoffSession.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: "proactive greeting",
      outputText: "你好。",
      status: AiGenerationStatus.GENERATED,
    },
  });
  const safetyGreetingMessage = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      role: MessageRole.ASSISTANT,
      content: "你好。",
      status: MessageStatus.SAVED,
      aiGenerationId: safetyGreetingGeneration.id,
    },
  });
  const safetyGreetingEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
    assistantMoveId: safetyGreetingMessage.id,
    generationId: safetyGreetingGeneration.id,
    intent: {
      move: "simple_greeting",
      requiredFunction: "initiate_reciprocal_contact",
      realization: { kind: "reciprocal_contact" },
      expectedUserContribution: "none",
      userBurden: "none",
    },
  });
  await prisma.aiGeneration.update({
    where: { id: safetyGreetingGeneration.id },
    data: {
      executionTrace: attachCommittedAssistantMoveEnvelope(
        { phase: "COMMITTED" },
        safetyGreetingEnvelope
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  const activeSafetyTurn = await prisma.chatMessage.create({
    data: {
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      role: MessageRole.USER,
      content: "active safety supersession fixture",
      status: MessageStatus.SAVED,
    },
  });
  assert.equal(activeHandoff(safetyGreetingMessage.id, activeSafetyTurn.id, [
    {
      id: safetyGreetingMessage.id,
      role: "assistant",
      status: "saved",
      interactionMoveEnvelope: safetyGreetingEnvelope,
    },
    { id: activeSafetyTurn.id, role: "user", status: "saved" },
  ]), true);
  const activeSafetyGeneration = await prisma.aiGeneration.create({
    data: {
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      sourceType: AiSourceType.CHAT,
      sourceId: activeSafetyTurn.id,
      model: "deterministic-test",
      promptVersion: CHAT_PROMPT_VERSION,
      inputText: activeSafetyTurn.content,
      outputText: "safety response",
      status: AiGenerationStatus.GENERATED,
    },
  });
  await assert.rejects(
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      content: "mismatched safety response",
      status: MessageStatus.SAVED,
      aiGenerationId: activeSafetyGeneration.id,
      replyToMessageId: activeSafetyTurn.id,
      interactionMetadata: { ...metadata, sourceTurnId: activeSafetyTurn.id },
      execution: {
        ...failedExecution,
        requestId: "mismatched-active-safety-request",
        turnId: "different-user-turn",
        phase: "VALIDATED",
        transitions: [{ phase: "VALIDATED", reason: "mismatched safety fixture" }],
        failure: undefined,
      },
      envelopeOrigin: "safety_override",
    }),
    /execution turn does not match/
  );
  assert.equal(await prisma.chatMessage.count({
    where: {
      replyToMessageId: activeSafetyTurn.id,
      role: MessageRole.ASSISTANT,
    },
  }), 0);
  const mismatchedSafetyTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: activeSafetyGeneration.id },
    select: { executionTrace: true },
  });
  assert.equal(extractCommittedAssistantMoveEnvelope(mismatchedSafetyTrace.executionTrace), null);
  await assert.rejects(
    commitValidatedAssistantMessage({
      userId: fixtureUser.id,
      sessionId: safetyHandoffSession.id,
      content: "rolled back safety response",
      status: MessageStatus.SAVED,
      aiGenerationId: activeSafetyGeneration.id,
      replyToMessageId: activeSafetyTurn.id,
      interactionMetadata: { ...metadata, sourceTurnId: activeSafetyTurn.id },
      execution: {
        ...failedExecution,
        requestId: " ",
        turnId: activeSafetyTurn.id,
        phase: "VALIDATED",
        transitions: [{ phase: "VALIDATED", reason: "safety rollback fixture" }],
        failure: undefined,
      },
      envelopeOrigin: "safety_override",
    }),
    /missing_safety_trace_id/
  );
  assert.equal(await prisma.chatMessage.count({
    where: {
      replyToMessageId: activeSafetyTurn.id,
      role: MessageRole.ASSISTANT,
    },
  }), 0);
  const rolledBackSafetyTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: activeSafetyGeneration.id },
    select: { executionTrace: true },
  });
  assert.equal(extractCommittedAssistantMoveEnvelope(rolledBackSafetyTrace.executionTrace), null);
  const activeSafetyMessage = await commitValidatedAssistantMessage({
    userId: fixtureUser.id,
    sessionId: safetyHandoffSession.id,
    content: "safety response",
    status: MessageStatus.SAVED,
    aiGenerationId: activeSafetyGeneration.id,
    replyToMessageId: activeSafetyTurn.id,
    interactionMetadata: { ...metadata, sourceTurnId: activeSafetyTurn.id },
    execution: {
      ...failedExecution,
      requestId: "active-safety-request",
      turnId: activeSafetyTurn.id,
      phase: "VALIDATED",
      transitions: [
        { phase: "GENERATED", attemptId: "safety-loser", reason: "retry loser fixture" },
        { phase: "REJECTED", attemptId: "safety-loser", reason: "retry loser fixture" },
        { phase: "RETRYING", reason: "retry winner fixture" },
        { phase: "GENERATED", attemptId: "safety-winner", reason: "retry winner fixture" },
        { phase: "VALIDATED", attemptId: "safety-winner", reason: "retry winner fixture" },
      ],
      attempts: [
        {
          attemptId: "safety-loser",
          phase: "REJECTED",
        },
        {
          attemptId: "safety-winner",
          phase: "VALIDATED",
        },
      ],
      failure: undefined,
    },
    envelopeOrigin: "safety_override",
  });
  assert(activeSafetyMessage.interactionMoveEnvelope);
  assert.equal(handoffSuperseded(safetyGreetingMessage.id, [
    activeSafetyMessage.interactionMoveEnvelope,
  ]), true);
  assert.equal(handoffResolved(safetyGreetingMessage.id, [
    activeSafetyMessage.interactionMoveEnvelope,
  ]), true);
  const storedActiveSafetyTrace = await prisma.aiGeneration.findUniqueOrThrow({
    where: { id: activeSafetyGeneration.id },
    select: { executionTrace: true },
  });
  assert.deepEqual(
    extractCommittedAssistantMoveEnvelope(storedActiveSafetyTrace.executionTrace),
    activeSafetyMessage.interactionMoveEnvelope
  );

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
    envelopeOrigin: "safety_override",
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
