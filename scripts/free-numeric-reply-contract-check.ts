import assert from "node:assert/strict";

import {
  applyFreeNumericReplyContract,
  shouldApplyFreeNumericReplyContract,
} from "../services/ai/lowInformationReplyGuard";
import type { AiConversationMessage, AiGenerationResult } from "../services/ai/types";
import type { ClinicalPlan } from "../services/clinical/clinicalTypes";

const clinicalPlan: ClinicalPlan = {
  responseGoal: "clarify",
  responseIntent: "clarify",
  primaryStrategy: "rogers",
  secondaryStrategies: [],
  questionFunction: "clarify_meaning",
  toneConstraint: [
    "clarify unestablished meaning without assigning one.",
    "keep a low-pressure continuation entry; do not require immediate explanation.",
  ],
  interventionBoundary: [
    "do not convert ambiguity into an emotion, score, activity, or conversational purpose.",
    "do not close the conversation unless the user asks to pause.",
  ],
  safetyNotes: [],
  rationale: [],
};

const modelGeneration: AiGenerationResult = {
  text: "1。像是还在刚才那个松口气的瞬间里。",
  model: "test-model",
  promptVersion: "test-prompt",
  latencyMs: 1,
  rawLLMOutput: "1。像是还在刚才那个松口气的瞬间里。",
  postProcessSteps: [],
  finalReplySource: "llm",
};

const apply = (userMessage: string, recentMessages: AiConversationMessage[] = []) =>
  applyFreeNumericReplyContract({ userMessage, recentMessages, clinicalPlan, generation: modelGeneration });

const freeSingle = apply("1");
assert.equal(freeSingle.text, "这个“1”有什么含义吗？");
assert.equal(freeSingle.finalReplySource, "guard_rewrite");
assert.equal(freeSingle.rawLLMOutput, modelGeneration.text);
assert.equal(freeSingle.postProcessSteps?.[0]?.layer, "free_numeric_reply_contract");

const freeSequenceHistory: AiConversationMessage[] = [
  { role: "user", content: "1" },
  { role: "assistant", content: "这个“1”有什么含义吗？" },
  { role: "user", content: "2" },
  { role: "assistant", content: "你是在测试我怎么回应这些数字吗？" },
];
const freeSequence = apply("3", freeSequenceHistory);
assert.equal(freeSequence.text, "看起来像是在测试我对连续数字的回应。我先这样理解；不是的话，你随时纠正我。");
assert(!freeSequence.text.includes("3"));
assert(!freeSequence.text.includes("松口气"));
assert(!freeSequence.text.includes("停在这里"));

const changedAfterSequenceHistory: AiConversationMessage[] = [
  ...freeSequenceHistory,
  { role: "user", content: "3" },
  { role: "assistant", content: freeSequence.text },
];
const changedAfterSequence = apply("1", changedAfterSequenceHistory);
assert.equal(changedAfterSequence.text, "现在是“1”。继续吧，我会按数字本身回应。");

const repeatedAfterSequenceHistory: AiConversationMessage[] = [
  ...changedAfterSequenceHistory,
  { role: "user", content: "1" },
  { role: "assistant", content: changedAfterSequence.text },
];
const repeatedAfterSequence = apply("1", repeatedAfterSequenceHistory);
assert.equal(repeatedAfterSequence.text, "还是“1”。继续吧。");
assert.equal(new Set([freeSequence.text, changedAfterSequence.text, repeatedAfterSequence.text]).size, 3);
for (const reply of [freeSequence.text, changedAfterSequence.text, repeatedAfterSequence.text]) {
  assert(!reply.includes("松口气"));
  assert(!reply.includes("停在这里"));
  assert(!reply.includes("我还不确定是不是在测试；你可以继续发"));
}

const scaleHistory: AiConversationMessage[] = [
  { role: "assistant", content: "可以用 1–10 给现在的紧张打个分，1 是很轻，10 是很强。" },
];
assert.equal(shouldApplyFreeNumericReplyContract({ userMessage: "3", recentMessages: scaleHistory, clinicalPlan }), false);
assert.strictEqual(apply("3", scaleHistory), modelGeneration);

const choiceHistory: AiConversationMessage[] = [
  { role: "assistant", content: "你可以选一个：1. 想先说说；2. 想先安静一会儿。" },
];
assert.equal(shouldApplyFreeNumericReplyContract({ userMessage: "2", recentMessages: choiceHistory, clinicalPlan }), false);
assert.strictEqual(apply("2", choiceHistory), modelGeneration);

assert.equal(shouldApplyFreeNumericReplyContract({ userMessage: "我这周做了 3 次", recentMessages: [], clinicalPlan }), false);
assert.strictEqual(apply("我这周做了 3 次"), modelGeneration);

const countQuestionHistory: AiConversationMessage[] = [
  { role: "assistant", content: "这周大概做了几次？" },
];
assert.equal(shouldApplyFreeNumericReplyContract({ userMessage: "3", recentMessages: countQuestionHistory, clinicalPlan }), false);

const guessedHistory: AiConversationMessage[] = [
  { role: "user", content: "1" },
  { role: "assistant", content: "1。像是还在刚才那个松口气的瞬间里。" },
];
const afterAssistantGuess = apply("2", guessedHistory);
assert.equal(afterAssistantGuess.text, "你是在测试我怎么回应这些数字吗？");
assert(!afterAssistantGuess.text.includes("松口气"));

const staleNumericHistory: AiConversationMessage[] = [
  { role: "user", content: "1", createdAt: "2000-01-01T00:00:00.000Z" },
  { role: "assistant", content: "你是在测试我怎么回应这些数字吗？", createdAt: "2000-01-01T00:00:01.000Z" },
];
const newConversationAfterGap = apply("1", staleNumericHistory);
assert.equal(newConversationAfterGap.text, "这个“1”有什么含义吗？");

const now = Date.now();
const oldAndFreshNumericHistory: AiConversationMessage[] = [
  { role: "user", content: "8", createdAt: "2000-01-01T00:00:00.000Z" },
  { role: "assistant", content: "还是“8”。继续吧。", createdAt: "2000-01-01T00:00:01.000Z" },
  { role: "user", content: "1", createdAt: new Date(now - 30_000).toISOString() },
  { role: "assistant", content: "这个“1”有什么含义吗？", createdAt: new Date(now - 20_000).toISOString() },
];
const secondTurnAfterInternalGap = apply("2", oldAndFreshNumericHistory);
assert.equal(secondTurnAfterInternalGap.text, "你是在测试我怎么回应这些数字吗？");

const staleScaleHistory: AiConversationMessage[] = [
  {
    role: "assistant",
    content: "可以用 1–10 给现在的紧张打个分。",
    createdAt: "2000-01-01T00:00:00.000Z",
  },
];
assert.equal(shouldApplyFreeNumericReplyContract({ userMessage: "1", recentMessages: staleScaleHistory, clinicalPlan }), true);
assert.equal(apply("1", staleScaleHistory).text, "这个“1”有什么含义吗？");

console.log(
  JSON.stringify(
    {
      freeSingle: "pass",
      freeSequence: "pass",
      changedAndRepeatedNumericFollowUps: "pass",
      establishedScale: "pass",
      establishedChoice: "pass",
      explicitCount: "pass",
      assistantGuessHistory: "pass",
      newConversationAfterGap: "pass",
      internalConversationGapReset: "pass",
      staleEstablishedFrameReset: "pass",
      doubleContract: "unsupportedMeaning=false && conversationMovement=true",
    },
    null,
    2
  )
);
