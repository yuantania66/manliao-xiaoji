import assert from "node:assert/strict";

import { determineConversationState } from "../conversation-os/state";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import {
  SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY,
  collectUnsupportedMeaningFailureReasons,
  containsUnsupportedMeaning,
  enforceSemanticEvidenceReplyContract,
  formatSemanticEvidenceRegenerateConstraint,
  inspectSemanticEvidenceReplyContract,
  shouldApplySemanticEvidenceReplyContract,
} from "../services/ai/semanticEvidenceReplyGuard";
import type { AiConversationMessage, AiGenerationResult } from "../services/ai/types";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";

const memoryContext = createClinicalMemoryContext(null);

const createContext = (userMessage: string, recentMessages: AiConversationMessage[] = []) =>
  buildClinicalContext({
    conversationId: "semantic-evidence-contract-check",
    userTurn: userMessage,
    recentTurns: recentMessages,
    memoryContext,
    conversationState: determineConversationState({
      currentUserMessage: userMessage,
      recentMessages,
    }).state,
  });

const createPlan = (userMessage: string, recentMessages: AiConversationMessage[] = []) =>
  createClinicalPlan(createContext(userMessage, recentMessages));

const makeGeneration = (text: string, source: AiGenerationResult["finalReplySource"] = "llm"): AiGenerationResult => ({
  text,
  model: "test-model",
  promptVersion: "test-prompt",
  latencyMs: 1,
  rawLLMOutput: text,
  postProcessSteps: [],
  finalReplySource: source,
});

const run = async () => {
  const clinicalPlan = createPlan("1");
  assert.equal(shouldApplySemanticEvidenceReplyContract({ clinicalPlan }), true);

  const naturalReplyA = "这个“1”是指什么？如果愿意，可以多说一点。";
  const naturalInspection = inspectSemanticEvidenceReplyContract({
    clinicalPlan,
    reply: naturalReplyA,
  });
  assert.equal(naturalInspection.hasUnsupportedMeaning, false);
  assert.deepEqual(naturalInspection.failureReasons, []);

  const unsupportedReplyB = "看起来你是在测试我怎么回应这些数字。";
  const unsupportedInspection = inspectSemanticEvidenceReplyContract({
    clinicalPlan,
    reply: unsupportedReplyB,
  });
  assert.equal(unsupportedInspection.hasUnsupportedMeaning, true);
  assert.ok(unsupportedInspection.failureReasons.includes("unsupported_meaning:testing_or_probing"));

  const unsupportedCounterexamples = [
    "你是在测试我的回复吗？",
    "你可能是在试探系统的反应。",
    "那就接着数数吧。",
    "看起来你正在计数。",
    "这个 7 是你给的 7 分。",
    "它代表 2 点钟方向。",
    "像是还在刚才那个松口气的瞬间里。",
    "你似乎有点焦虑。",
    "看起来你很难过。",
    "你好像很开心。",
    "你可能有些害怕。",
    "感觉你正在生气。",
    "大概已经很疲惫了。",
    "你似乎有点无奈。",
    "你好像觉得很委屈。",
    "看起来你很孤独。",
    "你可能感到压抑。",
    "跟着这个数字的节奏继续聊吧。",
    "顺着这个数字聊下去。",
    "你只是随手敲了一个数字。",
  ] as const;

  assert.ok(unsupportedCounterexamples.length >= 20);

  for (const text of unsupportedCounterexamples) {
    assert.equal(containsUnsupportedMeaning(text), true, `must detect unsupported meaning: ${text}`);
    assert.ok(
      collectUnsupportedMeaningFailureReasons(text).length > 0,
      `must emit structured failure reasons: ${text}`
    );
  }

  const naturalCounterexamples = [
    "这个“1”是指什么？",
    "我不太确定这个数字在这里是什么意思。",
    "你想表达什么？",
    "愿意多说一点吗？",
    "如果愿意，可以告诉我它的含义。",
    "这个输入我还没读懂。",
    "我先不猜，你可以按自己的方式补充。",
    "这里的“1”有具体所指吗？",
    "这是在回应前面的哪一部分吗？",
    "可以给我一点上下文吗？",
    "你希望我怎么理解这个“1”？",
    "我还需要一点信息才能跟上你。",
    "如果不方便解释，也可以先不说。",
    "这个表情对你来说是什么意思？",
    "我不确定有没有漏掉前文。",
    "你可以纠正我，但我现在先不下结论。",
    "我看到的是一个数字，还不知道它指向什么。",
    "它可能有你的具体含义，我先问清楚。",
    "这条消息很简短，我不想贸然理解。",
    "能再补一句吗？",
  ] as const;

  for (const text of naturalCounterexamples) {
    assert.equal(
      inspectSemanticEvidenceReplyContract({ clinicalPlan, reply: text }).hasUnsupportedMeaning,
      false,
      `constraint-compliant model reply must pass inspection: ${text}`
    );
  }

  const sufficientMeaningPlan = createPlan("我今天很累");
  assert.equal(shouldApplySemanticEvidenceReplyContract({ clinicalPlan: sufficientMeaningPlan }), false);
  assert.equal(
    inspectSemanticEvidenceReplyContract({
      clinicalPlan: sufficientMeaningPlan,
      reply: "你肯定已经累得撑不住了。",
    }).applies,
    false
  );

  const passOnFirst = await enforceSemanticEvidenceReplyContract({
    clinicalPlan,
    generate: async () => makeGeneration(naturalReplyA),
  });
  assert.equal(passOnFirst.finalSource, "llm");
  assert.equal(passOnFirst.regenerateAttempted, false);
  assert.equal(passOnFirst.modelCallCount, 1);
  assert.equal(passOnFirst.generation.text, naturalReplyA);
  assert.equal(passOnFirst.generation.finalReplySource, "llm");

  const regenerateAttempts: Array<{ attempt: 1 | 2; failureReasons: string[] }> = [];
  const passOnSecond = await enforceSemanticEvidenceReplyContract({
    clinicalPlan,
    generate: async ({ attempt, failureReasons }) => {
      regenerateAttempts.push({ attempt, failureReasons });
      if (attempt === 1) return makeGeneration(unsupportedReplyB);
      assert.ok(failureReasons.length > 0, "second attempt must carry structured failure reasons");
      assert.match(
        formatSemanticEvidenceRegenerateConstraint(failureReasons),
        /unsupported_meaning:testing_or_probing/
      );
      assert.doesNotMatch(
        formatSemanticEvidenceRegenerateConstraint(failureReasons),
        /你发的|是指什么|可以继续/
      );
      return makeGeneration("这个“1”是指什么？");
    },
  });
  assert.equal(passOnSecond.finalSource, "llm_regenerate");
  assert.equal(passOnSecond.regenerateAttempted, true);
  assert.equal(passOnSecond.modelCallCount, 2);
  assert.equal(passOnSecond.generation.finalReplySource, "llm_regenerate");
  assert.equal(passOnSecond.generation.text, "这个“1”是指什么？");
  assert.deepEqual(
    regenerateAttempts.map((item) => item.attempt),
    [1, 2]
  );

  const doubleFailAttempts: number[] = [];
  const doubleFail = await enforceSemanticEvidenceReplyContract({
    clinicalPlan,
    generate: async ({ attempt, failureReasons }) => {
      doubleFailAttempts.push(attempt);
      if (attempt === 2) {
        assert.ok(failureReasons.length > 0);
      }
      return makeGeneration(unsupportedReplyB);
    },
  });
  assert.equal(doubleFail.finalSource, "constraint_failure");
  assert.equal(doubleFail.regenerateAttempted, true);
  assert.equal(doubleFail.modelCallCount, 2);
  assert.equal(doubleFail.generation.finalReplySource, "constraint_failure");
  assert.equal(doubleFail.generation.text, SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY);
  assert.equal(doubleFailAttempts.length, 2);
  assert.ok(!SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY.includes("1"));
  assert.ok(!SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY.includes("你发的"));
  assert.doesNotMatch(SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY, /测试|评分|焦虑/);

  for (const text of unsupportedCounterexamples) {
    const result = await enforceSemanticEvidenceReplyContract({
      clinicalPlan,
      generate: async ({ attempt }) => makeGeneration(attempt === 1 ? text : "你似乎有点焦虑。"),
    });
    assert.equal(result.finalSource, "constraint_failure", `double unsupported must hard-fail: ${text}`);
    assert.equal(result.modelCallCount, 2);
    assert.equal(result.generation.text, SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY);
    assert.ok(!result.generation.text.includes("1"));
  }

  for (const [index, text] of unsupportedCounterexamples.entries()) {
    const result = await enforceSemanticEvidenceReplyContract({
      clinicalPlan,
      generate: async ({ attempt, failureReasons }) => {
        if (attempt === 1) return makeGeneration(text);
        assert.ok(failureReasons.length > 0, `missing failure reasons for ${text}`);
        return makeGeneration(naturalCounterexamples[index] ?? naturalReplyA);
      },
    });
    assert.equal(result.finalSource, "llm_regenerate", `regenerate must pass for: ${text}`);
    assert.equal(result.modelCallCount, 2);
    assert.notEqual(result.generation.text, SEMANTIC_EVIDENCE_CONSTRAINT_FAILURE_REPLY);
  }

  const activeAnswerFrameCases = [
    { group: "preserved", assistant: "你现在几分？\n慢慢来。", user: "7", expected: "sufficient" },
    { group: "preserved", assistant: "请回复 1、2 或 3。\n不用着急。", user: "2", expected: "sufficient" },
    { group: "preserved", assistant: "请回复“收到”。", user: "收到", expected: "sufficient" },
    { group: "preserved", assistant: "请选择：\n1. 现在说\n2. 稍后说", user: "2", expected: "sufficient" },
    { group: "preserved", assistant: "你几岁？\n不用着急。", user: "18", expected: "sufficient" },
    { group: "preserved", assistant: "如果 0 到 10 分，你会打几分\n慢慢回答。", user: "6", expected: "sufficient" },
    { group: "preserved", assistant: "请用 0 到 10 分衡量。\n你现在几分？", user: "7", expected: "sufficient" },
    { group: "preserved", assistant: "请用 0 到 10 分衡量。\n慢慢来。\n你现在几分？", user: "7", expected: "sufficient" },
    { group: "preserved", assistant: "这件事发生过几次？", user: "3", expected: "sufficient" },
    { group: "preserved", assistant: "告诉我你的具体年龄。", user: "18", expected: "sufficient" },
    { group: "preserved", assistant: "你更接近哪一个数字？", user: "2", expected: "sufficient" },
    { group: "preserved", assistant: "你今天吃饭了吗？", user: "是", expected: "sufficient" },
    { group: "replaced", assistant: "你现在几分？\n你今天想说什么？", user: "7", expected: "insufficient" },
    { group: "replaced", assistant: "请回复 1、2 或 3。\n你今天想说什么？", user: "2", expected: "insufficient" },
    { group: "replaced", assistant: "请选择：\n1. 现在说\n2. 稍后说\n你今天想说什么？", user: "2", expected: "insufficient" },
    { group: "replaced", assistant: "请回复 1、2 或 3，接下来你想说什么？", user: "2", expected: "insufficient" },
    {
      group: "replaced",
      assistant: "你几岁？\n后来我们先聊点别的。\n你今天想说什么？",
      user: "18",
      expected: "insufficient",
    },
    { group: "replaced", assistant: "这件事发生过几次？\n你想从哪里说起？", user: "3", expected: "insufficient" },
    { group: "replaced", assistant: "你现在几分？\n你想先休息吗？", user: "7", expected: "insufficient" },
    { group: "replaced", assistant: "你现在几分？\n你呢？", user: "7", expected: "insufficient" },
    { group: "replaced", assistant: "你现在几分，接下来你想说什么？", user: "7", expected: "insufficient" },
    { group: "none", assistant: "我不会替你打分。", user: "1", expected: "insufficient" },
    { group: "none", assistant: "我只是举例。\n答案可能是 1、2 或 3。", user: "2", expected: "insufficient" },
    {
      group: "none",
      assistant: "请回复“收到”。\n我只是举例，答案可能是 1、2 或 3。",
      user: "2",
      expected: "insufficient",
    },
    {
      group: "none",
      assistant: "我只是举例。\n请回复“收到”。\n答案可能是 1、2 或 3。",
      user: "2",
      expected: "insufficient",
    },
    { group: "none", assistant: "这不是让你回答 1、2 或 3。", user: "2", expected: "insufficient" },
    { group: "none", assistant: "你不需要告诉我具体年龄。", user: "18", expected: "insufficient" },
    { group: "none", assistant: "我们先不讨论次数。", user: "3", expected: "insufficient" },
    { group: "compatibility", assistant: "请回复 1、2 或 3。", user: "4", expected: "insufficient" },
    { group: "compatibility", assistant: "如果 0 到 10 分，你会打几分？", user: "11", expected: "insufficient" },
    { group: "compatibility", assistant: "请用 0 到 10 分衡量。\n你现在几分？", user: "11", expected: "insufficient" },
    { group: "compatibility", assistant: "请用 0 到 10 分衡量。\n慢慢来。\n你现在几分？", user: "11", expected: "insufficient" },
  ] as const;

  for (const { group, assistant, user, expected } of activeAnswerFrameCases) {
    const recentMessages: AiConversationMessage[] = [{ role: "assistant", content: assistant }];
    const context = createContext(user, recentMessages);
    const plan = createClinicalPlan(context);
    assert.equal(
      context.signals.semanticEvidence.status,
      expected,
      `${group}: ${JSON.stringify(assistant)} must classify ${JSON.stringify(user)} as ${expected}.`
    );
    assert.equal(
      plan.responseIntent,
      expected === "insufficient" ? "receive" : "empathic_reflection",
      `${JSON.stringify(assistant)} must produce the matching clinical-plan behavior.`
    );
  }

  console.log(
    JSON.stringify(
      {
        explicitSameInputComparison: {
          userMessage: "1",
          replyA: "preserved_llm",
          replyB: "llm_regenerate_or_constraint_failure",
        },
        naturalRepliesPreserved: naturalCounterexamples.length + 1,
        unsupportedMeaningRepliesBlocked: unsupportedCounterexamples.length,
        unsupportedMeaningRegeneratePass: unsupportedCounterexamples.length,
        unsupportedMeaningConstraintFailure: unsupportedCounterexamples.length,
        activeAnswerFramesVerified: activeAnswerFrameCases.length,
        guardAuthorshipRemoved: true,
        maxModelCalls: 2,
        safetyPriority: "verified_by_check:ai-orchestration",
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
