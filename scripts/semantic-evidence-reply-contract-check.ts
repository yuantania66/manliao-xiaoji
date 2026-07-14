import assert from "node:assert/strict";

import { determineConversationState } from "../conversation-os/state";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import {
  applySemanticEvidenceReplyContract,
  shouldApplySemanticEvidenceReplyContract,
} from "../services/ai/semanticEvidenceReplyGuard";
import type { AiConversationMessage, AiGenerationResult } from "../services/ai/types";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";

const memoryContext = createClinicalMemoryContext(null);

const createPlan = (userMessage: string, recentMessages: AiConversationMessage[] = []) => {
  const context = buildClinicalContext({
    conversationId: "semantic-evidence-contract-check",
    userTurn: userMessage,
    recentTurns: recentMessages,
    memoryContext,
    conversationState: determineConversationState({
      currentUserMessage: userMessage,
      recentMessages,
    }).state,
  });

  return createClinicalPlan(context);
};

const apply = ({
  userMessage = "1",
  text,
  recentMessages = [],
}: {
  userMessage?: string;
  text: string;
  recentMessages?: AiConversationMessage[];
}) => {
  const clinicalPlan = createPlan(userMessage, recentMessages);
  const generation: AiGenerationResult = {
    text,
    model: "test-model",
    promptVersion: "test-prompt",
    latencyMs: 1,
    rawLLMOutput: text,
    postProcessSteps: [],
    finalReplySource: "llm",
  };

  return {
    clinicalPlan,
    inputGeneration: generation,
    outputGeneration: applySemanticEvidenceReplyContract({
      userMessage,
      clinicalPlan,
      generation,
    }),
  };
};

const naturalReplyA = "这个“1”是指什么？如果愿意，可以多说一点。";
const naturalResult = apply({ text: naturalReplyA });
assert.equal(shouldApplySemanticEvidenceReplyContract({ clinicalPlan: naturalResult.clinicalPlan }), true);
assert.strictEqual(
  naturalResult.outputGeneration,
  naturalResult.inputGeneration,
  "The guard must preserve model reply A when it contains no unsupported meaning."
);
assert.equal(naturalResult.outputGeneration.text, naturalReplyA);
assert.equal(naturalResult.outputGeneration.finalReplySource, "llm");

const unsupportedReplyB = "看起来你是在测试我怎么回应这些数字。";
const unsupportedResult = apply({ text: unsupportedReplyB });
assert.notStrictEqual(
  unsupportedResult.outputGeneration,
  unsupportedResult.inputGeneration,
  "The guard may rewrite model reply B only when it contains unsupported meaning."
);
assert.equal(unsupportedResult.outputGeneration.text, "你发的“1”是指什么？");
assert.equal(unsupportedResult.outputGeneration.finalReplySource, "guard_rewrite");
assert.equal(
  unsupportedResult.outputGeneration.postProcessSteps?.at(-1)?.layer,
  "semantic_evidence_reply_contract"
);
assert.equal(unsupportedResult.outputGeneration.rawLLMOutput, unsupportedReplyB);

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

for (const text of unsupportedCounterexamples) {
  const result = apply({ text }).outputGeneration;
  assert.equal(result.finalReplySource, "guard_rewrite", `unsupported meaning must be blocked: ${text}`);
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
  const result = apply({ text });
  assert.strictEqual(
    result.outputGeneration,
    result.inputGeneration,
    `constraint-compliant model reply must remain visible: ${text}`
  );
}

const sufficientMeaningResult = apply({
  userMessage: "我今天很累",
  text: "你肯定已经累得撑不住了。",
});
assert.equal(
  shouldApplySemanticEvidenceReplyContract({ clinicalPlan: sufficientMeaningResult.clinicalPlan }),
  false
);
assert.strictEqual(sufficientMeaningResult.outputGeneration, sufficientMeaningResult.inputGeneration);

console.log(
  JSON.stringify(
    {
      explicitSameInputComparison: {
        userMessage: "1",
        replyA: "preserved_llm",
        replyB: "guard_rewrite",
      },
      naturalRepliesPreserved: naturalCounterexamples.length + 1,
      unsupportedMeaningRepliesBlocked: unsupportedCounterexamples.length + 1,
      safetyPriority: "verified_by_check:ai-orchestration",
    },
    null,
    2
  )
);
