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
assert.equal(freeSingle.text, "我先不猜。你想继续发就继续，想说点别的也行。");
assert.equal(freeSingle.finalReplySource, "guard_rewrite");
assert.equal(freeSingle.rawLLMOutput, modelGeneration.text);
assert.equal(freeSingle.postProcessSteps?.[0]?.layer, "free_numeric_reply_contract");

const freeSequenceHistory: AiConversationMessage[] = [
  { role: "user", content: "1" },
  { role: "assistant", content: "我先不猜。你想继续发就继续，想说点别的也行。" },
  { role: "user", content: "2" },
  { role: "assistant", content: "我还是先不猜。你可以接着发，也可以随时换成想说的话。" },
];
const freeSequence = apply("3", freeSequenceHistory);
assert.equal(freeSequence.text, "继续发也可以；什么时候想说点别的，直接说就行。");
assert(!freeSequence.text.includes("3"));
assert(!freeSequence.text.includes("松口气"));
assert(!freeSequence.text.includes("停在这里"));

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
assert.equal(afterAssistantGuess.text, "我还是先不猜。你可以接着发，也可以随时换成想说的话。");
assert(!afterAssistantGuess.text.includes("松口气"));

console.log(
  JSON.stringify(
    {
      freeSingle: "pass",
      freeSequence: "pass",
      establishedScale: "pass",
      establishedChoice: "pass",
      explicitCount: "pass",
      assistantGuessHistory: "pass",
      doubleContract: "unsupportedMeaning=false && conversationMovement=true",
    },
    null,
    2
  )
);
