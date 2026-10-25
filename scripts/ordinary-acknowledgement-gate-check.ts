import { cleanObservationFor } from "./semantic-observation-fixture";
import assert from "node:assert/strict";

import {
  assembleConversationControlContext,
  CONTEXTUAL_ACCEPTANCE_STANCE,
  buildDialogueState,
  createResponsePlan,
  createResponsePlanPreflightAuthoritySnapshot,
  interpretTurnDeterministically,
  type ResponsePlan,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { prisma } from "../lib/prisma";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import { commitValidatedAssistantMessage } from "../services/ai/chatReplyService";
import {
  plannedFunctionSemanticDeveloperContentFor,
  validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticProviderInput,
  type PlannedFunctionSemanticVerdict,
} from "../services/ai/plannedFunctionSemanticValidator";
import { buildChatPrompt, sanitizeChatHistory, scopeHistoryForResponsePlan } from "../services/ai/promptBuilder";
import { formatResponsePlanRegenerateConstraint, validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import type { AiConversationMessage } from "../services/ai/types";

// Synthetic conversation. These local fixed verdicts prove wiring and failure handling,
// never the model's ability to distinguish the proposed product boundaries.
const userMessage = "他说的那个问题确实是我疏忽了，但当着那么多人说，我还是觉得很难堪。";
const recentMessages: AiConversationMessage[] = [
  { id: "synthetic-carryover:t1", role: "user", content: "今天被领导当众批评了，有点不太高兴。" },
  { id: "synthetic-carryover:t2", role: "assistant", content: "被当众说确实容易让人不舒服，想聊聊的话随时可以说说。" },
];
const turnId = "synthetic-carryover:t3";
const context = assembleConversationControlContext({
  conversationId: "ordinary-ack-offline",
  currentTurnId: turnId,
  userMessage,
  recentMessages,
  conversationState: determineConversationState({ currentUserMessage: userMessage, recentMessages }),
});
const interpretation = interpretTurnDeterministically(context);
const dialogueState = buildDialogueState(context, interpretation);
const plan = createResponsePlan({ context, interpretation, dialogueState,
  clinicalAdviceProvider: () => { throw new Error("Ordinary fixture must not invoke clinical advice"); } });
const authority = createResponsePlanPreflightAuthoritySnapshot({ context, interpretation, dialogueState });
const semanticContext = {
  currentUserText: userMessage,
  handoffTargetAssistantText: null,
  ordinaryRecentMessages: sanitizeChatHistory({ userMessage, recentMessages }).included,
};

const verdictFor = (
  input: PlannedFunctionSemanticProviderInput,
  status: "satisfied" | "not_satisfied" | "uncertain",
  semanticQuestionCount = 0
): PlannedFunctionSemanticVerdict => {
  const contract = input.positiveFunctionBinding;
  assert.equal(contract?.action, "acknowledge_without_psychologizing");
  assert(contract?.action === "acknowledge_without_psychologizing");
  return {
    schemaVersion: 1,
    planId: input.planId,
    handoff: null,
    positiveFunction: {
      ...cleanObservationFor(input),
      binding: { action: contract.action, sourceTurnId: contract.sourceTurnId, allowIdle: contract.allowIdle, ...(contract.responseFunction ? {responseFunction: contract.responseFunction} : {}) },
      status,
      realizedAction: status === "satisfied" ? contract.action : null,
      targetAddressed: status === "satisfied",
      contractRealized: status === "satisfied",
      containsContradictoryMove: false,
      evidence: [{ start: 0, end: input.candidateReply.length, text: input.candidateReply,
        reason: "Offline fixed verdict for gate control only; not an independent quality judgment." }],
    },
    semanticQuestionCount,
  };
};

const main = async () => {
  assert.deepEqual(plan.responseActions, ["acknowledge_without_psychologizing"]);
  assert.equal(plan.positiveFunctionContract?.action, "acknowledge_without_psychologizing");
  assert.equal(preflightResponsePlan(plan, authority).passed, true);
  assert(plan.stance.includes(CONTEXTUAL_ACCEPTANCE_STANCE));
  const prompt = buildChatPrompt({ userMessage, recentMessages, responsePlan: plan }).messages;
  const promptText = prompt.map((message) => message.content).join("\n");
  assert.equal(promptText.split(CONTEXTUAL_ACCEPTANCE_STANCE).length - 1, 1);
  assert(!promptText.includes("不得增添计划中没有、且无 relevanceProvenance 的命题"));
  assert(!promptText.includes("Realize only propositions and actions present"));
  assert(promptText.includes("不得新增无依据的事实性断言"));
  assert(promptText.includes("计划已允许的接纳"));
  assert(promptText.includes("Contextual acceptance already permitted by the plan"));
  assert(promptText.includes("不得据此推断隐藏动机或心理状态"));
  assert(promptText.includes("不得编造事件、动机或心理状态"));
  assert(promptText.includes("Do not promote hypotheses into common ground."));
  assert(promptText.includes("Do not restate propositions rejected by the user."));
  assert(promptText.includes("Usually one or two concise sentences."));
  assert(!promptText.includes("Do not add generic causal mechanisms, inferred benefits, positive reframing, or praise not expressed by the user."));
  assert(promptText.includes("Do not invent causes, infer benefits the user has not expressed, offer unsupported praise, or portray the user's distress as a good thing."));

  assert.deepEqual(prompt.filter((message) => message.role === "user" || message.role === "assistant"),
    [...recentMessages.map(({ role, content }) => ({ role, content })), { role: "user", content: userMessage }]);
  assert(promptText.includes("当前用户消息中明确表达且可对应到本轮 relevanceProvenance"));
  assert(!promptText.includes("neutral-friendly without reassurance"));

  // Exercise real Planner + Surface assembly for support and a non-emotional direct obligation.
  const planned = (text: string) => {
    const ctx = assembleConversationControlContext({ conversationId: "calm-local", currentTurnId: "calm:t1",
      userMessage: text, recentMessages: [], conversationState: determineConversationState({ currentUserMessage: text, recentMessages: [] }) });
    const turn = interpretTurnDeterministically(ctx);
    return createResponsePlan({ context: ctx, interpretation: turn, dialogueState: buildDialogueState(ctx, turn), clinicalAdviceProvider: () => null });
  };
  const emotionalPlan = planned("今天被领导当众批评了，我有点难过。");
  assert.equal(emotionalPlan.positiveFunctionContract?.action, "offer_emotional_support");
  assert(emotionalPlan.stance.includes(CONTEXTUAL_ACCEPTANCE_STANCE));
  const emotionalContract = emotionalPlan.positiveFunctionContract;
  assert(emotionalContract?.action === "offer_emotional_support");
  for (const supportFunction of ["reduce_expression_burden", "return_focus_control", "return_amount_control",
    "acknowledge_current_relational_impact", "invite_optional_sharing", "respect_declined_sharing"] as const) {
    const branch: ResponsePlan = { ...emotionalPlan, positiveFunctionContract: { ...emotionalContract, supportFunction } };
    const branchPrompt = buildChatPrompt({ userMessage: emotionalContract.sourceText, recentMessages: [], responsePlan: branch })
      .messages.map((message) => message.content).join("\n");
    assert.equal(branchPrompt.split(CONTEXTUAL_ACCEPTANCE_STANCE).length - 1, 1, supportFunction);
    assert(!branchPrompt.includes("without judging it as okay"), supportFunction);
    assert(!branchPrompt.includes("never the feeling itself"), supportFunction);
    assert(!branchPrompt.includes("Keep the feeling acknowledgement descriptive"), supportFunction);
    const scoped = plannedFunctionSemanticDeveloperContentFor({ planId: branch.planId, handoffBinding: null,
      positiveFunctionBinding: branch.positiveFunctionContract, currentUserText: emotionalContract.sourceText,
      handoffTargetAssistantText: null, candidateReply: "local-only", ordinaryQuestionIndependentlySupported: true }).scoped;
    assert.equal(scoped.split(CONTEXTUAL_ACCEPTANCE_STANCE).length - 1, 1, supportFunction);
    assert(!scoped.includes("drift, reassurance, advice"), supportFunction);
  }
  const identity = planned("你叫什么名字？");
  assert(!identity.stance.includes(CONTEXTUAL_ACCEPTANCE_STANCE), "Direct identity obligation must not acquire emotional work");
  const identityRules = plannedFunctionSemanticDeveloperContentFor({ planId: identity.planId, handoffBinding: null,
    positiveFunctionBinding: identity.positiveFunctionContract, currentUserText: "你叫什么名字？",
    handoffTargetAssistantText: null, candidateReply: "我叫小慢。", ordinaryQuestionIndependentlySupported: false }).scoped;
  assert(!identityRules.includes(CONTEXTUAL_ACCEPTANCE_STANCE), "Acceptance must not leak into unrelated judge branches");

  // A separate local regression: 舒服 inside 不舒服 must not override the required semantic decision.
  const contextualReply = "这种当众被批评的处境让人不舒服。";
  assert(validateResponsePlanOutput({ plan, reply: contextualReply }).passed);
  const legacy = validateResponsePlanOutput({ plan: { ...plan, positiveFunctionContract: null }, reply: contextualReply });
  assert(legacy.failureReasons.includes("ordinary_acknowledgement:generic_causal_mechanism"));
  assert(legacy.failureReasons.includes("ordinary_acknowledgement:unsupported_evaluation:舒服"));
  const contract = plan.positiveFunctionContract;
  assert(contract?.action === "acknowledge_without_psychologizing");
  for (const mutation of [
    { sourceTurnId: "other-turn" }, { sourceText: "another user" }, { allowIdle: true }, { evidence: [] },
  ]) {
    const invalid = { ...plan, positiveFunctionContract: { ...contract, ...mutation } };
    assert(preflightResponsePlan(invalid, authority).failureReasons.includes("invalid_ordinary_acknowledgement_contract"));
  }
  assert.equal(preflightResponsePlan({ ...plan, positiveFunctionContract: null }, authority).passed, false);

  const cases = [
    // Human-labelled synthetic boundaries, not model samples or demonstrated semantic accuracy.
    { id: "contextual-acceptance", user: userMessage, reply: "承认这处疏忽，不意味着你就得接受被当众批评的方式。", status: "satisfied", questions: 0 },
    { id: "contextual-affect-not-keyword", user: userMessage, reply: contextualReply, status: "not_satisfied", questions: 0 },
    { id: "generic-normalization-alone", user: userMessage, reply: "没关系，这很正常。", status: "not_satisfied", questions: 0 },
    { id: "acceptance-is-not-absolution", user: userMessage, reply: "你没有任何错，都是领导的问题。", status: "not_satisfied", questions: 0 },
    { id: "acceptance-is-not-motive", user: userMessage, reply: "领导就是故意让你难堪。", status: "not_satisfied", questions: 0 },
    { id: "direct-natural-invitation", user: "今天回家一路都没说话，我想找人聊聊。", reply: "想从哪儿聊起都可以。", status: "satisfied", questions: 1 },
    { id: "useful-confirmation", user: "我不是不愿意改，只是希望私下说。", reply: "你说的是反馈的方式，而不是不改这个问题，对吗？", status: "satisfied", questions: 1 },
    { id: "relation-paraphrase-without-purpose", user: userMessage, reply: "承认这处疏忽，和此刻仍觉得难堪，可以同时在这里。", status: "not_satisfied", questions: 0 },
    { id: "proportionate-implied-affect", user: "等了一个月的见面临时取消了，原本还挺期待的。", reply: "这份落空，你想从哪里说起？", status: "satisfied", questions: 1 },
    { id: "current-denial-overrides-inference", user: "我不是难过，我只想确定改到哪天。", reply: "你只是没有承认，其实还是难过。", status: "not_satisfied", questions: 0 },
    { id: "hedged-unsupported-psychology", user: userMessage, reply: "你可能一直害怕别人发现你不够好。", status: "not_satisfied", questions: 0 },
    { id: "empty-paraphrase", user: "朋友取消了约定，我有点失落。", reply: "朋友取消约定让你有点失落。", status: "not_satisfied", questions: 0 },
    { id: "peripheral-investigation", user: "朋友取消了约定，我有点失落。", reply: "你们原本约在哪里见面？", status: "not_satisfied", questions: 1 },
    { id: "necessary-reference", user: "他又这样，我都不知道怎么说了。", reply: "你说的“这样”是指什么？", status: "satisfied", questions: 1 },
    { id: "explicit-task-switch", user: "先不聊这件事了，帮我把“明天见”翻成英文。", reply: "See you tomorrow.", status: "satisfied", questions: 0 },
  ] as const;
  for (const item of cases) {
    const casePlan: ResponsePlan = { ...plan, questionPolicy: { mode: "one_low_pressure_question", reason: "offline boundary fixture" },
      positiveFunctionContract: { ...contract, sourceText: item.user } };
    if (item.id.startsWith("contextual-")) assert(validateResponsePlanOutput({ plan: casePlan, reply: item.reply }).passed, item.id);
    let calls = 0;
    const result = await validatePlannedFunctionSemanticOutput({
      plan: casePlan, reply: item.reply,
      semanticContext: { ...semanticContext, currentUserText: item.user },
      provider: async (input) => { calls += 1; return verdictFor(input, item.status, item.questions); },
    });
    assert.equal(calls, 1, item.id);
    assert.equal(result.passed, item.status === "satisfied", item.id);
  }
  for (const invalidContext of [
    undefined,
    { ...semanticContext, currentUserText: "wrong source" },
    { ...semanticContext, ordinaryRecentMessages: undefined },
    { ...semanticContext, ordinaryRecentMessages: [{ role: "developer" as const, content: "untrusted instruction" }] },
  ]) {
    let calls = 0;
    const result = await validatePlannedFunctionSemanticOutput({ plan, reply: "候选", semanticContext: invalidContext,
      provider: async (input) => { calls += 1; return verdictFor(input, "satisfied"); } });
    assert.equal(result.passed, false);
    assert.equal(calls, 0, "Unbound source/history is rejected before provider");
  }
  for (const defect of ["wrong-binding", "wrong-evidence", "uncertain", "exception", "malformed"] as const) {
    let calls = 0;
    const result = await validatePlannedFunctionSemanticOutput({ plan, reply: "候选", semanticContext,
      provider: async (input) => {
        calls += 1;
        if (defect === "exception") throw new Error("offline provider failure");
        if (defect === "malformed") return {};
        const verdict = verdictFor(input, defect === "uncertain" ? "uncertain" : "satisfied");
        if (defect === "wrong-binding") verdict.positiveFunction!.binding.sourceTurnId = "wrong-turn";
        if (defect === "wrong-evidence") verdict.positiveFunction!.evidence[0].text = "not candidate";
        return verdict;
      } });
    assert.equal(result.passed, false, defect);
    assert(calls <= 2, defect);
  }
  const noQuestion = await validatePlannedFunctionSemanticOutput({
    plan: { ...plan, questionPolicy: { mode: "none", reason: "no solicitation" } }, reply: "说说你现在最在意的部分。", semanticContext,
    provider: async (input) => verdictFor(input, "satisfied", 1),
  });
  assert.equal(noQuestion.passed, false, "Semantic solicitation without a question mark remains a hard gate");
  const idlePlan: ResponsePlan = { ...plan, closurePolicy: { mode: "allow_idle", reason: "existing planner idle fixture" },
    questionPolicy: { mode: "none", reason: "idle" }, positiveFunctionContract: { ...contract, allowIdle: true } };
  assert.equal((await validatePlannedFunctionSemanticOutput({ plan: idlePlan, reply: "嗯，好。", semanticContext,
    provider: async (input) => verdictFor(input, "satisfied") })).passed, true);

  const rubric = plannedFunctionSemanticDeveloperContentFor({ planId: plan.planId, handoffBinding: null,
    positiveFunctionBinding: contract, currentUserText: userMessage, handoffTargetAssistantText: null,
    candidateReply: "候选", ordinaryQuestionIndependentlySupported: true }).scoped;
  for (const text of ["ordinaryRecentMessages", "Useful confirmation", "ordinaryUseObservation", "unsupported", "peripheral", "allowIdle",
    "proportionate feeling reasonably implied", "correction or denial takes precedence"]) {
    assert(rubric.includes(text), `ordinary rubric includes ${text}`);
  }
  const retryInstruction = formatResponsePlanRegenerateConstraint(plan, ["planned_function_semantic:positive_function_not_satisfied"]);
  assert(retryInstruction.includes("当前体验"));
  assert(retryInstruction.includes(CONTEXTUAL_ACCEPTANCE_STANCE));
  assert(rubric.includes(CONTEXTUAL_ACCEPTANCE_STANCE));
  assert(rubric.includes("unsupported factual evaluation or causal mechanism"));
  assert(formatResponsePlanRegenerateConstraint(emotionalPlan, ["planned_function_semantic:positive_function_not_satisfied"]).includes(CONTEXTUAL_ACCEPTANCE_STANCE));

  // Surface and judge must share the existing handoff history boundary, including explicit resumption.
  const history: AiConversationMessage[] = [
    { id: "old-user", role: "user", content: "之前的话题是加班。" },
    { id: "greeting", role: "assistant", content: "今天想从哪里聊起？", promptVersion: "proactive-greeting-v1" },
  ];
  const handoffPlan: ResponsePlan = { ...plan, interactionMoveHandoffPlan: {
    sourceAssistantMoveId: "greeting", sourceUserTurnId: turnId, sourceGreetingFunction: "initiate_reciprocal_contact",
    selectedRelation: "opens_or_redirects_thread", requiredFunction: "continue_user_introduced_content",
    completionIntent: "fulfill", questionPolicy: "none", evidence: [],
  } };
  for (const current of ["今天聊电影。", "接着上次的话题说，我又加班了。"] ) {
    const projected = sanitizeChatHistory({ userMessage: current,
      recentMessages: scopeHistoryForResponsePlan({ userMessage: current, recentMessages: history, responsePlan: handoffPlan }) }).included;
    const surface = buildChatPrompt({ userMessage: current, recentMessages: history, responsePlan: handoffPlan }).messages;
    const surfaceHistory = surface.filter((message) => message.role === "user" || message.role === "assistant").slice(0, -1);
    assert.deepEqual(projected, surfaceHistory);
    assert.equal(projected.length, current.startsWith("接着") ? 2 : 1);
  }

  const envNames = ["AI_PROVIDER", "AI_MAIN_MODEL", "QWEN_API_KEY", "CONVERSATION_OS_INTERPRETER_MODEL_ENABLED"] as const;
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalTransaction = prisma.$transaction;
  let transactions = 0;
  prisma.$transaction = (async () => { transactions += 1; throw new Error("No database is allowed in this offline check"); }) as typeof prisma.$transaction;
  try {
    Object.assign(process.env, { AI_PROVIDER: "qwen", AI_MAIN_MODEL: "qwen3.7-max", QWEN_API_KEY: "offline-only",
      CONVERSATION_OS_INTERPRETER_MODEL_ENABLED: "false" });
    for (const scenario of ["second-wins", "two-bad", "malformed-judge", "unsupported-meaning", "uncertain-judge", "reported-repeat"] as const) {
      let surfaceCalls = 0;
      let judgeCalls = 0;
      const bad = scenario === "reported-repeat" ? "明明自己也知道有疏忽，可被当众点出来，那种难堪确实不好受。"
        : scenario === "unsupported-meaning" ? "这种场合让人放松，你其实很开心。"
        : "问题归问题，但当众被说确实让人难堪。当时具体是什么场合呀？";
      // Illustrative acceptance by a fixed provider, not demonstrated model quality or a required reply.
      const acceptedFixture = "承认这处疏忽，不意味着你就得接受被当众批评的方式。";
      globalThis.fetch = async () => {
        surfaceCalls += 1;
        assert(surfaceCalls <= 2, "No third surface attempt");
        return new Response(JSON.stringify({ choices: [{ message: {
          content: scenario === "second-wins" && surfaceCalls === 2 ? acceptedFixture : bad,
        } }] }), { status: 200 });
      };
      const reply = await createChatReply({ conversationId: `ordinary-ack-offline:${scenario}`, currentTurnId: turnId,
        userMessage, recentMessages, helpingShadowEnabled: false, helpingOrdinaryHandoffEnabled: true,
        safetySemanticProvider: async () => JSON.stringify({ schemaVersion: 1, riskLevel: "none", categories: [],
          currentness: "current", evidence: [], requiresSafetyResponse: false }),
        plannedFunctionSemanticProvider: async (input) => {
          judgeCalls += 1;
          assert.deepEqual(input.ordinaryRecentMessages, semanticContext.ordinaryRecentMessages);
          if (scenario === "reported-repeat") {
            const v = verdictFor(input, "satisfied");
            v.positiveFunction!.ordinaryUseObservation = { contentRelation: "repeats_or_normalizes_only",
              repetitionPurpose: "none", purposeEvidence: [] };
            return v; // A satisfied model label must not override the observed defect.
          }
          return scenario === "malformed-judge" ? {} : verdictFor(input, scenario === "uncertain-judge" ? "uncertain"
            : input.candidateReply === acceptedFixture ? "satisfied" : "not_satisfied");
        },
      });
      assert.equal(reply.controlTrace?.responsePlan.positiveFunctionContract?.action, "acknowledge_without_psychologizing");
      assert.equal(surfaceCalls, 2, scenario);
      assert.equal(judgeCalls, 2, scenario); // Custom provider seam has no schema-repair retry.
      assert.equal(reply.execution.attempts[0].phase, "REJECTED", scenario);
      if (scenario === "second-wins") {
        assert.equal(reply.execution.phase, "VALIDATED");
        assert.equal(reply.generation.text, acceptedFixture);
        assert.equal(reply.execution.attempts[1].phase, "VALIDATED");
      } else {
        assert.equal(reply.execution.phase, "FAILED");
        assert(reply.execution.attempts.every((attempt) => attempt.phase === "REJECTED"));
        assert.equal(reply.finalSource, "constraint_failure");
        // The failed draft remains internal diagnostic data; production only returns a system status.
        assert.equal(reply.generation.finalReplySource, "constraint_failure");
        await assert.rejects(commitValidatedAssistantMessage({ userId: "offline-user", sessionId: "offline-session",
          content: bad, status: "SAVED", aiGenerationId: "offline-generation", replyToMessageId: turnId,
          interactionMetadata: {} as never, execution: reply.execution }), /Only a validated execution/);
        assert.equal(transactions, 0, "Rejected candidates cannot reach the database transaction");
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    prisma.$transaction = originalTransaction;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
  console.log(JSON.stringify({ passed: true, evidenceType: "offline-fixed-provider-control-flow", externalCalls: 0,
    modelQualityEstablished: false, boundaryFixtures: cases.length, maxSurfaceAttempts: 2, customJudgeCallsPerScenario: 2,
    failedCommitTransactions: transactions }));
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
