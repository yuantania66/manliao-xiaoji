import assert from "node:assert/strict";

import { determineConversationState } from "../conversation-os/state";
import { createClinicalMemoryContext } from "../services/ai/clinicalMemoryAdapter";
import { buildClinicalContext } from "../services/clinical/clinicalContextBuilder";
import { createClinicalPlan } from "../services/clinical/clinicalPlanService";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import type { AiConversationMessage } from "../services/ai/types";

const memoryContext = createClinicalMemoryContext({
  recentMemories: [],
  similarMemories: [],
  coreEvents: [],
  activeHypotheses: [],
  counterEvidence: [],
  professionalGuidance: [],
  userFeedback: [],
  retrievalReason: "conversation_interaction_decision_check",
});

const assistantInvite: AiConversationMessage[] = [
  { role: "assistant", content: "夜深了，有什么想慢慢说的都可以留在这里。" },
];

const buildDecision = (userTurn: string, recentTurns: AiConversationMessage[] = []) => {
  const stateResult = determineConversationState({
    currentUserMessage: userTurn,
    recentMessages: recentTurns,
  });
  const context = buildClinicalContext({
    conversationId: "conversation-interaction-decision-check",
    userId: "check-user",
    userTurn,
    recentTurns,
    memoryContext,
    conversationState: stateResult.state,
    conversationStateResult: stateResult,
  });
  const plan = createClinicalPlan(context);
  const prompt = buildChatPrompt({ userMessage: userTurn, recentMessages: recentTurns, clinicalPlan: plan });

  return { stateResult, context, plan, promptText: JSON.stringify(prompt.messages) };
};

const originalClinicalPlanFlag = process.env.CLINICAL_PLAN_PROMPT_ENABLED;
process.env.CLINICAL_PLAN_PROMPT_ENABLED = "false";

const noTopicCases = ["不知道聊什么", "我想不到说什么耶", "不知道说啥哈哈", "没话题，你来问吧", "随便聊点什么都行"];

const noTopicResults = noTopicCases.map((input) => {
  const result = buildDecision(input, assistantInvite);
  assert.equal(result.context.signals.interaction.contentAvailability, "no_topic", `${input}: content must be no_topic.`);
  assert.equal(result.context.signals.interaction.engagement, "engaged", `${input}: replying to an assistant remains engaged.`);
  assert.equal(result.context.signals.interaction.stopIntent, false, `${input}: no topic is not a stop request.`);
  assert.equal(result.plan.responseGoal, "help_continue_expression", `${input}: no topic must continue the conversation.`);
  assert.equal(result.plan.responseIntent, "initiate_topic", `${input}: assistant must take light initiative.`);
  assert.notEqual(result.plan.responseGoal, "hold_space", `${input}: must not enter quiet companionship.`);
  assert(result.promptText.includes("initiativeDirection: assistant_invited"), `${input}: model must receive initiative direction.`);
  assert(result.promptText.includes("stopIntent: false"), `${input}: model must receive stop evidence.`);
  return { input, interaction: result.context.signals.interaction, plan: result.plan };
});

assert.equal(noTopicResults[1].interaction.affect, "neutral_or_light", "A light cue is supporting tone evidence, not sadness.");

const stopCases = ["算了，不想说了", "别问了", "让我安静一会儿", "我先不聊了"];
const stopResults = stopCases.map((input) => {
  const result = buildDecision(input, assistantInvite);
  assert.equal(result.context.signals.interaction.stopIntent, true, `${input}: explicit stop must be preserved.`);
  assert.equal(result.context.signals.interaction.engagement, "stop_requested", `${input}: engagement must record the stop request.`);
  assert.equal(result.context.signals.interaction.initiativeDirection, "pause", `${input}: initiative must be pause.`);
  assert.equal(result.plan.responseGoal, "hold_space", `${input}: must respect the stop request.`);
  assert.equal(result.plan.questionFunction, "none", `${input}: no follow-up question after a stop request.`);
  assert(result.promptText.includes("stopIntent: true"), `${input}: model must receive the stop evidence.`);
  return { input, interaction: result.context.signals.interaction, plan: result.plan };
});

const lowMoodCases = ["我很难受，但不知道怎么说", "太累了，不想组织语言", "脑子一片空白，什么也不想说"];
const lowMoodResults = lowMoodCases.map((input) => {
  const result = buildDecision(input, assistantInvite);
  assert.equal(result.context.signals.interaction.affect, "negative", `${input}: explicit distress/fatigue evidence must be retained.`);
  assert.equal(result.plan.responseGoal, "hold_space", `${input}: explicit distress may lower interaction intensity.`);
  assert.notEqual(result.context.signals.interaction.stopIntent, true, `${input}: distress is not silently converted into a stop request.`);
  assert(result.promptText.includes("affect: negative"), `${input}: model must receive affect evidence.`);
  return { input, interaction: result.context.signals.interaction, plan: result.plan };
});

const repeatedQuestionHistory: AiConversationMessage[] = [
  { role: "assistant", content: "你现在最想从哪件事说起？" },
  { role: "user", content: "不知道。" },
  { role: "assistant", content: "那你能不能具体说说是什么卡住了？" },
];
const repeatedQuestionResult = buildDecision("不知道说什么", repeatedQuestionHistory);
assert.equal(repeatedQuestionResult.context.signals.interaction.initiativeDirection, "shared");
assert.equal(repeatedQuestionResult.plan.responseGoal, "help_continue_expression");
assert.equal(repeatedQuestionResult.plan.responseIntent, "initiate_topic");
assert(
  repeatedQuestionResult.plan.toneConstraint.includes(
    "Recent turns already contain repeated assistant questions; do not add another information-gathering question."
  ),
  "Repeated questions must change the interaction constraint rather than trigger silence."
);

const openingResult = buildDecision("不知道说什么");
assert.equal(openingResult.context.signals.interaction.engagement, "engaged");
assert.equal(openingResult.context.signals.interaction.initiativeDirection, "assistant_invited");
assert.equal(openingResult.plan.responseIntent, "initiate_topic");

const priorPauseHistory: AiConversationMessage[] = [
  { role: "user", content: "让我安静一会儿" },
  { role: "assistant", content: "好，我先不追问。" },
];
const priorPauseResult = buildDecision("不知道说什么", priorPauseHistory);
assert.equal(priorPauseResult.context.signals.interaction.stopIntent, true);
assert.equal(priorPauseResult.context.signals.interaction.engagement, "disengaging");
assert.equal(priorPauseResult.plan.responseGoal, "hold_space");

const counterExamples = [
  { input: "我不知道北京今天几度", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "我想不明白他为什么这样做", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "这个梦我说不清", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "脑子很乱，因为这个项目的流程太复杂了", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "我有点累", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "嗯", history: [], expectedGoal: "clarify", expectedStop: false },
  { input: "1", history: [], expectedGoal: "clarify", expectedStop: false },
  { input: "别问了，我真的累", history: [], expectedGoal: "hold_space", expectedStop: true },
  { input: "谢谢", history: [], expectedGoal: "reflect", expectedStop: false },
  { input: "没话题，你来问吧", history: priorPauseHistory, expectedGoal: "help_continue_expression", expectedStop: false },
];

const counterExampleResults = counterExamples.map(({ input, history, expectedGoal, expectedStop }) => {
  const result = buildDecision(input, history);
  assert.equal(result.plan.responseGoal, expectedGoal, `${input}: unexpected response goal.`);
  assert.equal(result.context.signals.interaction.stopIntent, expectedStop, `${input}: unexpected stop intent.`);
  return { input, interaction: result.context.signals.interaction, plan: result.plan };
});

if (originalClinicalPlanFlag === undefined) delete process.env.CLINICAL_PLAN_PROMPT_ENABLED;
else process.env.CLINICAL_PLAN_PROMPT_ENABLED = originalClinicalPlanFlag;

console.log(
  JSON.stringify(
    {
      checked: noTopicResults.length + stopResults.length + lowMoodResults.length + 4 + counterExampleResults.length,
      noTopicResults,
      stopResults,
      lowMoodResults,
      contextResults: {
        assistantInvite: noTopicResults[1],
        repeatedQuestions: {
          interaction: repeatedQuestionResult.context.signals.interaction,
          plan: repeatedQuestionResult.plan,
        },
        opening: { interaction: openingResult.context.signals.interaction, plan: openingResult.plan },
        priorPause: { interaction: priorPauseResult.context.signals.interaction, plan: priorPauseResult.plan },
      },
      counterExampleResults,
    },
    null,
    2
  )
);
