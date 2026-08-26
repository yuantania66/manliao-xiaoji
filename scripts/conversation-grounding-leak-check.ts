import assert from "node:assert/strict";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import {
  buildChatPrompt,
  CHAT_PROMPT_VERSION,
  sanitizeChatHistory,
} from "../services/ai/promptBuilder";
import {
  enforceResponsePlan,
  validateResponsePlanOutput,
} from "../services/ai/responsePlanValidator";
import type { AiConversationMessage, AiGenerationResult } from "../services/ai/types";

const main = async () => {
const buildControl = ({
  userMessage,
  recentMessages = [],
  conversationId = "conversation-a",
  currentTurnId = "turn-current",
}: {
  userMessage: string;
  recentMessages?: AiConversationMessage[];
  conversationId?: string;
  currentTurnId?: string;
}) => {
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId,
    currentTurnId,
    userMessage,
    recentMessages,
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
  return { conversationState, context, interpretation, dialogueState, responsePlan };
};

const noTopicCases = [
  "不知道聊什么",
  "不知道聊啥",
  "我想不到说什么耶",
  "不知道说啥哈哈",
  "没话题",
  "没有什么可说的",
  "随便聊点什么都行",
  "随便聊啥都行",
  "你来问吧",
  "你先说，我不知道聊啥",
];

for (const [index, userMessage] of noTopicCases.entries()) {
  const result = buildControl({ userMessage, currentTurnId: `no-topic-${index + 1}` });
  assert.equal(result.context.interaction.contentAvailability, "no_topic", userMessage);
  assert.equal(result.interpretation.primaryDialogueAct, "yield_initiative", userMessage);
  assert(result.responsePlan.responseActions.includes("take_light_topic_initiative"), userMessage);
  assert.equal(result.responsePlan.questionPolicy.mode, "one_low_pressure_question", userMessage);
  assert.deepEqual(result.responsePlan.requiredDisclosure, [], userMessage);
}

const stopCases = ["算了，不想说了", "别问了", "让我安静一会儿", "我先不聊了"];
for (const [index, userMessage] of stopCases.entries()) {
  const result = buildControl({ userMessage, currentTurnId: `stop-${index + 1}` });
  assert.equal(result.context.interaction.stopIntent, true, userMessage);
  assert(result.responsePlan.responseActions.includes("respect_pause"), userMessage);
  assert(!result.responsePlan.responseActions.includes("take_light_topic_initiative"), userMessage);
}

const distressedNoTopicCases = [
  "我很难受，但不知道聊啥",
  "太累了，不想组织语言",
  "脑子一片空白，什么也不想说",
];
for (const [index, userMessage] of distressedNoTopicCases.entries()) {
  const result = buildControl({ userMessage, currentTurnId: `distressed-${index + 1}` });
  assert.equal(result.context.interaction.affect, "negative", userMessage);
  assert(!result.responsePlan.responseActions.includes("take_light_topic_initiative"), userMessage);
}

const currentPair: AiConversationMessage[] = [
  { id: "u-current", role: "user", content: "你是谁", promptVersion: null },
  {
    id: "a-current",
    role: "assistant",
    content: "我是慢聊小记，一个 AI 聊天助手。",
    promptVersion: CHAT_PROMPT_VERSION,
  },
];
const legacyPair: AiConversationMessage[] = [
  { id: "u-legacy", role: "user", content: "你会坐吗", promptVersion: null },
  {
    id: "a-legacy",
    role: "assistant",
    content: "我没有身体，不能真的坐。",
    promptVersion: "chat-response-plan-v13",
  },
];

const sanitizedLegacy = sanitizeChatHistory({
  userMessage: "不知道聊啥",
  recentMessages: legacyPair,
});
assert.deepEqual(
  sanitizedLegacy.included.map((item) => item.content),
  legacyPair.map((item) => item.content)
);
assert.equal(sanitizedLegacy.filteredHistory.length, 0);

const sanitizedCurrent = sanitizeChatHistory({
  userMessage: "不知道聊啥",
  recentMessages: currentPair,
});
assert.deepEqual(
  sanitizedCurrent.included.map((item) => item.content),
  currentPair.map((item) => item.content)
);

const templatePair = sanitizeChatHistory({
  userMessage: "不知道聊啥",
  recentMessages: [
    { id: "u-template", role: "user", content: "今天呢" },
    {
      id: "a-template",
      role: "assistant",
      content: "我刚刚在想窗外的树影。",
      promptVersion: CHAT_PROMPT_VERSION,
    },
  ],
});
assert.deepEqual(
  templatePair.included.map((item) => item.content),
  ["今天呢", "我刚刚在想窗外的树影。"]
);

const correctionHistory: AiConversationMessage[] = [
  { id: "u-no-topic", role: "user", content: "不知道聊啥" },
  {
    id: "a-irrelevant",
    role: "assistant",
    content: "我是慢聊小记，我没有身体。",
    promptVersion: CHAT_PROMPT_VERSION,
  },
];
const correctionCases = [
  "我没问会不会坐",
  "我也没问你是谁",
  "我并未要求你解释天气",
  "我没说我要建议",
  "你理解错了",
  "我说的不是这个",
];

for (const [index, userMessage] of correctionCases.entries()) {
  const result = buildControl({
    userMessage,
    recentMessages: correctionHistory,
    currentTurnId: `correction-${index + 1}`,
  });
  assert.equal(result.interpretation.primaryDialogueAct, "correct_assistant", userMessage);
  assert.equal(result.interpretation.directQuestions.length, 0, userMessage);
  assert.equal(result.interpretation.correction?.targetTurnId, "a-irrelevant", userMessage);
  assert.equal(result.interpretation.correction?.stillOpenUserIntent?.sourceTurnId, "u-no-topic", userMessage);
  assert(result.responsePlan.responseActions.includes("repair_previous_wording"), userMessage);
  assert(result.responsePlan.responseActions.includes("take_light_topic_initiative"), userMessage);
  assert.deepEqual(result.responsePlan.requiredDisclosure, [], userMessage);
  assert.equal(result.responsePlan.questionPolicy.mode, "one_low_pressure_question", userMessage);
}

const bodyCorrection = buildControl({
  userMessage: "我没问会不会坐",
  recentMessages: correctionHistory,
  currentTurnId: "body-correction",
});
assert.equal(
  bodyCorrection.interpretation.correction?.challengedPropositions[0]?.groundingReference,
  "body"
);

const identityCorrection = buildControl({
  userMessage: "我也没问你是谁",
  recentMessages: correctionHistory,
  currentTurnId: "identity-correction",
});
assert.equal(
  identityCorrection.interpretation.correction?.challengedPropositions[0]?.groundingReference,
  "identity"
);
assert.equal(
  validateResponsePlanOutput({
    plan: identityCorrection.responsePlan,
    reply: "是我多说了，我是慢聊小记，一个 AI 聊天助手。",
  }).passed,
  false
);

for (const userMessage of ["我没问他天气", "我没有让他们解释", "不是在说你理解错了"]) {
  const result = buildControl({
    userMessage,
    recentMessages: correctionHistory,
    currentTurnId: `non-correction-${userMessage.length}`,
  });
  assert.equal(result.context.correction, null, userMessage);
  assert.notEqual(result.interpretation.primaryDialogueAct, "correct_assistant", userMessage);
}
assert.equal(
  validateResponsePlanOutput({
    plan: bodyCorrection.responsePlan,
    reply: "抱歉，刚才多说了。我其实没有身体，不能真的坐。",
  }).passed,
  false
);
assert.equal(
  validateResponsePlanOutput({
    plan: bodyCorrection.responsePlan,
    reply: "是我多说了，我收回刚才那段说法。最近有没有哪首歌你听了不止一遍？",
  }).passed,
  true
);

const directQuestions = [
  ["你是谁", "identity"],
  ["你是AI吗", "ai_identity"],
  ["你是心理医生吗", "clinician_identity"],
  ["你会坐吗", "body_capability"],
] as const;
for (const [index, [userMessage, kind]] of directQuestions.entries()) {
  const result = buildControl({ userMessage, currentTurnId: `question-${index + 1}` });
  assert.equal(result.dialogueState.answerObligations[0]?.kind, kind, userMessage);
  assert.equal(result.dialogueState.answerObligations[0]?.sourceTurnId, `question-${index + 1}`);
  assert(result.responsePlan.requiredDisclosure.length > 0, userMessage);
  assert.equal(result.responsePlan.disclosureScope.turnId, `question-${index + 1}`);
}

const ordinaryPlan = buildControl({
  userMessage: "不知道聊啥",
  recentMessages: legacyPair,
  currentTurnId: "surface-no-topic",
}).responsePlan;
const ordinaryPrompt = buildChatPrompt({
  userMessage: "不知道聊啥",
  recentMessages: legacyPair,
  responsePlan: ordinaryPlan,
});
const ordinaryPromptText = ordinaryPrompt.messages.map((message) => message.content).join("\n");
assert(!ordinaryPromptText.includes("availableFacts"));
assert(!ordinaryPromptText.includes("hasBody=false"));
assert(ordinaryPromptText.includes("你会坐吗"));
assert(ordinaryPromptText.includes("我没有身体，不能真的坐"));
assert.deepEqual(ordinaryPlan.requiredDisclosure, []);
assert(!ordinaryPlan.responseActions.includes("answer_directly"));

const bodyPlan = buildControl({
  userMessage: "你会坐吗",
  currentTurnId: "surface-body-question",
}).responsePlan;
const bodyPromptText = buildChatPrompt({
  userMessage: "你会坐吗",
  recentMessages: [],
  responsePlan: bodyPlan,
}).messages.map((message) => message.content).join("\n");
assert(bodyPromptText.includes(bodyPlan.requiredDisclosure[0]));
assert.equal(bodyPlan.disclosureScope.turnId, "surface-body-question");
assert(!bodyPromptText.includes("disclosureScope"));

const isolatedA = buildControl({
  userMessage: "不知道聊啥",
  recentMessages: legacyPair,
  conversationId: "isolated-a",
  currentTurnId: "same-request",
});
const isolatedB = buildControl({
  userMessage: "不知道聊啥",
  recentMessages: currentPair,
  conversationId: "isolated-b",
  currentTurnId: "same-request",
});
assert.notEqual(isolatedA.responsePlan.planId, isolatedB.responsePlan.planId);
assert.notEqual(
  isolatedA.responsePlan.disclosureScope.conversationId,
  isolatedB.responsePlan.disclosureScope.conversationId
);
assert.deepEqual(isolatedA.responsePlan.requiredDisclosure, []);
assert.deepEqual(isolatedB.responsePlan.requiredDisclosure, []);

const retryA = buildControl({
  userMessage: "你是谁",
  conversationId: "retry-conversation",
  currentTurnId: "retry-turn",
});
const retryB = buildControl({
  userMessage: "你是谁",
  conversationId: "retry-conversation",
  currentTurnId: "retry-turn",
});
assert.equal(retryA.responsePlan.planId, retryB.responsePlan.planId);
assert.equal(
  retryA.responsePlan.answerObligations[0]?.id,
  retryB.responsePlan.answerObligations[0]?.id
);

const concurrency = await Promise.all(
  Array.from({ length: 4 }, (_, index) =>
    Promise.resolve(buildControl({
      userMessage: index % 2 === 0 ? "你是谁" : "不知道聊啥",
      conversationId: `concurrent-${index + 1}`,
      currentTurnId: "turn-1",
    }))
  )
);
assert.equal(new Set(concurrency.map((item) => item.responsePlan.planId)).size, 4);
assert.equal(concurrency.filter((item) => item.responsePlan.requiredDisclosure.length > 0).length, 2);

const generation = (text: string): AiGenerationResult => ({
  text,
  rawLLMOutput: text,
  model: "test-model",
  promptVersion: CHAT_PROMPT_VERSION,
  latencyMs: 0,
  finalReplySource: "llm",
});
const beforePlan = JSON.stringify(ordinaryPlan);
let callCount = 0;
const regenerated = await enforceResponsePlan({
  plan: ordinaryPlan,
  generate: async () => {
    callCount += 1;
    return generation(callCount === 1 ? "没话题也没关系。" : "最近有没有哪首歌让你循环过几遍？");
  },
});
assert.equal(regenerated.regenerateAttempted, true);
assert.equal(regenerated.generation.finalReplySource, "llm_regenerate");
assert(regenerated.validations.every((item) => item.checkedPlanId === ordinaryPlan.planId));
assert.equal(JSON.stringify(ordinaryPlan), beforePlan);

const pausedThenNoTopic = buildControl({
  userMessage: "不知道聊啥",
  recentMessages: [
    { id: "u-pause", role: "user", content: "让我安静一会儿" },
    { id: "a-pause", role: "assistant", content: "好。", promptVersion: CHAT_PROMPT_VERSION },
  ],
  currentTurnId: "pause-followup",
});
assert.equal(pausedThenNoTopic.context.interaction.stopIntent, true);
assert(!pausedThenNoTopic.responsePlan.responseActions.includes("take_light_topic_initiative"));

const counterexampleCount =
  noTopicCases.length +
  stopCases.length +
  distressedNoTopicCases.length +
  correctionCases.length +
  directQuestions.length +
  9;
assert(counterexampleCount >= 20);

console.log(`conversation grounding leak checks passed (${counterexampleCount} counterexamples + isolation/retry/concurrency/regenerate invariants)`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
