import assert from "node:assert/strict";

import { AppError } from "../lib/errors";
import {
  classifyExecutionError,
  type ChatExecutionTrace,
} from "../services/ai/chatExecutionLifecycle";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import type { SafetySemanticProvider } from "../services/ai/chatSafety";
import type { PlannedFunctionSemanticVerdict } from "../services/ai/plannedFunctionSemanticValidator";
import { classifyProviderFailureCategory } from "../services/ai/providerFailureCategory";
import { executionFailureKey, executionFailureRecordFor } from "./execution-failure-audit";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

const providerError = (status: number) =>
  new AppError("AI_GENERATION_FAILED", "AI 服务调用失败", 502, { provider: "qwen", status });

// Classifier: category only from provider status evidence; everything else stays unknown.
assert.equal(classifyExecutionError(new AppError("AI_GENERATION_FAILED", "AI 服务调用超时", 504)).category, "timeout");
assert.equal(classifyExecutionError(providerError(429)).category, "rate_limited");
assert.equal(classifyExecutionError(providerError(503)).category, "provider_5xx");
assert.equal(classifyExecutionError(providerError(400)).category, "provider_4xx");
assert.equal(classifyExecutionError(new AppError("AI_GENERATION_FAILED", "AI 回复为空", 502)).category, "unknown");
assert.equal(classifyExecutionError(new AppError("AI_GENERATION_FAILED", "AI 服务暂时不可用", 502)).category, "unknown");
const abortLike = new Error("request timed out");
abortLike.name = "AbortError";
assert.equal(classifyExecutionError(abortLike).code, "TIMEOUT");
assert.equal(classifyExecutionError(abortLike).category, "unknown", "a timeout-looking message without status evidence is not a timeout category");
assert.equal(classifyExecutionError("not an error").category, "unknown");
// The planned-function judge shares the same classifier, so a judge-side failure keeps the same semantics.
for (const error of [
  new AppError("AI_GENERATION_FAILED", "AI 服务调用超时", 504),
  providerError(429),
  providerError(503),
  providerError(400),
  new AppError("AI_GENERATION_FAILED", "AI 回复为空", 502),
  new AppError("AI_GENERATION_FAILED", "AI provider 不支持请求的响应格式", 502, { provider: "qwen", responseFormat: "json_object" }),
  abortLike,
  "not an error",
]) {
  assert.equal(classifyProviderFailureCategory(error), classifyExecutionError(error).category);
}
assert.equal(
  classifyProviderFailureCategory(
    new AppError("AI_GENERATION_FAILED", "AI provider 不支持请求的响应格式", 502, { provider: "qwen", responseFormat: "json_object" })
  ),
  "unknown",
  "a locally wrapped 502 is not evidence of a provider 5xx"
);

const traceWith = (
  failure: ChatExecutionTrace["failure"],
  attempts = 0,
  planPreflightAttempts?: ChatExecutionTrace["planPreflightAttempts"]
): ChatExecutionTrace => ({
  requestId: "r",
  conversationId: "c",
  turnId: "t",
  planId: "p",
  phase: failure ? "FAILED" : "VALIDATED",
  planPreflight: { passed: true, failureReasons: [] },
  ...(planPreflightAttempts ? { planPreflightAttempts } : {}),
  transitions: [],
  attempts: Array.from({ length: attempts }, (_, index) => ({ attemptId: `a${index}`, phase: "FAILED" as const })),
  ...(failure ? { failure } : {}),
});

assert.equal(executionFailureRecordFor(traceWith(undefined, 1)), null);
assert.equal(executionFailureKey(null), null);
const legacyUncategorized = executionFailureRecordFor(traceWith({ code: "PROVIDER_ERROR", reason: "raw", retryable: true }));
assert.deepEqual(legacyUncategorized, {
  code: "PROVIDER_ERROR",
  category: "unknown",
  failedPhase: "before_surface_attempt",
  surfaceAttemptsStarted: 0,
  planPreflightAttempts: 1,
  infrastructureRerunEligible: false,
});
const timedOutMidAttempt = executionFailureRecordFor(traceWith(
  { code: "TIMEOUT", reason: "raw", retryable: true, category: "timeout" },
  2,
  [
    { attempt: 0, planId: "p0", passed: false, failureReasons: ["x"] },
    { attempt: 1, planId: "p1", passed: true, failureReasons: [] },
  ]
));
assert.equal(timedOutMidAttempt?.failedPhase, "after_surface_attempt_started");
assert.equal(timedOutMidAttempt?.surfaceAttemptsStarted, 2);
assert.equal(timedOutMidAttempt?.planPreflightAttempts, 2);
assert.equal(timedOutMidAttempt?.infrastructureRerunEligible, true);
for (const [code, phase] of [
  ["PLAN_INVALID", "plan_preflight"],
  ["SAFETY_BLOCKED", "safety"],
  ["GENERATION_NONCONFORMANT", "validation"],
  ["PERSISTENCE_ERROR", "persistence"],
] as const) {
  const record = executionFailureRecordFor(traceWith({ code, reason: "raw", retryable: false, category: "provider_5xx" }, 2));
  assert.equal(record?.failedPhase, phase);
  assert.equal(record?.category, null, `${code} is not a provider failure and carries no provider category`);
  assert.equal(record?.infrastructureRerunEligible, false, `${code} is never infrastructure-exempt`);
}
for (const category of ["provider_4xx", "unknown"] as const) {
  const record = executionFailureRecordFor(traceWith({ code: "PROVIDER_ERROR", reason: "raw", retryable: true, category }, 1));
  assert.equal(record?.infrastructureRerunEligible, false, `${category} is not infrastructure-exempt`);
}

// End to end through createChatReply: the runner record reflects the real provider failure path.
const noRiskSafetyProvider: SafetySemanticProvider = async () => JSON.stringify({
  schemaVersion: 1,
  riskLevel: "none",
  categories: [],
  currentness: "current",
  evidence: [],
  requiresSafetyResponse: false,
});
const envNames = ["AI_PROVIDER", "AI_MAIN_MODEL", "QWEN_API_KEY", "AI_TIMEOUT_MS", "CONVERSATION_OS_INTERPRETER_MODEL_ENABLED"] as const;
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const RAW_REASON = "MUST_NOT_APPEAR_IN_RECORD";

type FetchBehavior = (init?: RequestInit) => Promise<Response>;
const scenarios: Array<{
  id: string;
  behavior: FetchBehavior;
  expected: { code: string; category: string; infrastructureRerunEligible: boolean };
}> = [
  {
    id: "http-429",
    behavior: async () => new Response(RAW_REASON, { status: 429 }),
    expected: { code: "PROVIDER_ERROR", category: "rate_limited", infrastructureRerunEligible: true },
  },
  {
    id: "http-503",
    behavior: async () => new Response(RAW_REASON, { status: 503 }),
    expected: { code: "PROVIDER_ERROR", category: "provider_5xx", infrastructureRerunEligible: true },
  },
  {
    id: "http-400",
    behavior: async () => new Response(RAW_REASON, { status: 400 }),
    expected: { code: "PROVIDER_ERROR", category: "provider_4xx", infrastructureRerunEligible: false },
  },
  {
    id: "empty-reply",
    behavior: async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    expected: { code: "PROVIDER_ERROR", category: "unknown", infrastructureRerunEligible: false },
  },
  {
    id: "network-error",
    behavior: async () => {
      throw new TypeError(RAW_REASON);
    },
    expected: { code: "PROVIDER_ERROR", category: "unknown", infrastructureRerunEligible: false },
  },
  {
    id: "abort-timeout",
    behavior: (init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException(RAW_REASON, "AbortError")));
    }),
    expected: { code: "TIMEOUT", category: "timeout", infrastructureRerunEligible: true },
  },
];

const runEndToEnd = async () => {
  try {
    process.env.AI_PROVIDER = "qwen";
    process.env.AI_MAIN_MODEL = "qwen3.7-max";
    process.env.QWEN_API_KEY = "execution-failure-audit-test-key";
    process.env.AI_TIMEOUT_MS = "50";
    process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = "false";
    for (const scenario of scenarios) {
      let fetchCalls = 0;
      globalThis.fetch = async (_input, init) => {
        fetchCalls += 1;
        return scenario.behavior(init);
      };
      const reply = await createChatReply({
        conversationId: `execution-failure-audit:${scenario.id}`,
        currentTurnId: `${scenario.id}:t1`,
        userMessage: "今晚莫名有点孤单",
        recentMessages: [],
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
        safetySemanticProvider: noRiskSafetyProvider,
      });
      const record = executionFailureRecordFor(reply.execution);
      assert.equal(reply.finalSource, "constraint_failure", scenario.id);
      assert.equal(reply.generationAttempts.length, 0, `${scenario.id}: legacy runner field cannot distinguish attempts`);
      assert(fetchCalls >= 1, `${scenario.id}: provider was reached`);
      assert.equal(record?.code, scenario.expected.code, scenario.id);
      assert.equal(record?.category, scenario.expected.category, scenario.id);
      assert.equal(record?.failedPhase, "after_surface_attempt_started", scenario.id);
      assert.equal(record?.surfaceAttemptsStarted, 1, scenario.id);
      assert.equal(record?.infrastructureRerunEligible, scenario.expected.infrastructureRerunEligible, scenario.id);
      assert(!JSON.stringify(record).includes(RAW_REASON), `${scenario.id}: record never carries raw provider text`);
      assert(!JSON.stringify(record).includes("AI 服务"), `${scenario.id}: record never carries the raw failure reason`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
};

// Semantic audit: ES-* ids are in scope only for an offer_emotional_support positive-function verdict.
const verdictWith = (
  positiveFunction: PlannedFunctionSemanticVerdict["positiveFunction"],
  handoff: PlannedFunctionSemanticVerdict["handoff"] = null
): PlannedFunctionSemanticVerdict => ({
  schemaVersion: 1,
  planId: "p",
  handoff,
  positiveFunction,
  semanticQuestionCount: 0,
});
const span = (reason: string) => ({ start: 0, end: 2, text: "候选", reason });
const emotionalVerdict = semanticVerdictAuditFor(verdictWith({
  binding: { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "u" },
  status: "not_satisfied",
  realizedAction: null,
  targetAddressed: true,
  contractRealized: false,
  containsContradictoryMove: true,
  evidence: [span("ES-SCOPE: introduces an unstated event")],
}));
assert.deepEqual(emotionalVerdict?.ruleIds, ["ES-SCOPE"]);
assert.deepEqual(emotionalVerdict?.outOfScopeRuleIds, []);
const repairVerdict = semanticVerdictAuditFor(verdictWith({
  binding: { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", sourceTurnId: "u", targetTurnId: "a" },
  status: "not_satisfied",
  realizedAction: null,
  targetAddressed: true,
  contractRealized: false,
  containsContradictoryMove: false,
  evidence: [span("ES-SCOPE: introduces new content from history")],
}));
assert.deepEqual(repairVerdict?.outOfScopeRuleIds, ["ES-SCOPE"]);
const repairWithoutRuleIds = semanticVerdictAuditFor(verdictWith({
  binding: { action: "repair_previous_wording", repairMode: "proposition_withdrawal", sourceTurnId: "u", targetTurnId: "a" },
  status: "not_satisfied",
  realizedAction: null,
  targetAddressed: true,
  contractRealized: false,
  containsContradictoryMove: false,
  evidence: [span("Generic apology without withdrawing the proposition.")],
}));
assert.deepEqual(repairWithoutRuleIds?.outOfScopeRuleIds, []);
const handoffCitation = semanticVerdictAuditFor(verdictWith(null, {
  binding: {
    sourceAssistantMoveId: "m",
    sourceUserTurnId: "u",
    selectedRelation: "reciprocates_move",
    requiredFunction: "complete_reciprocal_contact",
    completionIntent: "fulfill",
    questionPolicy: "none",
  },
  status: "not_satisfied",
  realizedFunction: null,
  targetAddressed: true,
  relationAddressed: true,
  requiredFunctionRealized: false,
  containsContradictoryMove: false,
  handoffCompletionClaimed: false,
  optionalQuestionAfterRequiredFunction: false,
  evidence: [span("ES-ACK-NO-SOLICIT: solicits")],
}));
assert.deepEqual(handoffCitation?.outOfScopeRuleIds, ["ES-ACK-NO-SOLICIT"]);
assert.equal(JSON.stringify(withoutEvidenceText(repairVerdict)).includes("候选"), false);

runEndToEnd()
  .then(() => console.log("execution failure audit checks passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
