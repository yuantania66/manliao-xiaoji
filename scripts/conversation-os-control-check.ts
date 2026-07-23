import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type ClinicalStrategyAdvice,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { AiConversationMessage } from "../services/ai/types";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { createChatReply } from "../services/ai/chatOrchestrationService";

const clinicalAdvice: ClinicalStrategyAdvice = {
  strategy: "rogers",
  intent: "empathic_reflection",
  questionFunction: "clarify_or_reflect",
  toneConstraints: ["warm", "non-directive"],
  interventionBoundaries: ["no diagnosis"],
  evidence: ["test provider called by planner"],
};

const build = (userMessage: string, recentMessages: AiConversationMessage[] = []) => {
  const state = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "conversation-os-control-check",
    userMessage,
    recentMessages,
    conversationState: state,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  let clinicalCalls = 0;
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => {
      clinicalCalls += 1;
      return clinicalAdvice;
    },
  });
  return { context, interpretation, dialogueState, responsePlan, clinicalCalls };
};

const assistantInvite: AiConversationMessage[] = [
  { role: "assistant", content: "夜深了，有什么想慢慢说的都可以留在这里。" },
];

const scenarioA = build("我想不到说什么耶", assistantInvite);
assert.equal(scenarioA.interpretation.primaryDialogueAct, "yield_initiative");
assert.deepEqual(scenarioA.dialogueState.answerObligations, []);
assert(scenarioA.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert.equal(scenarioA.responsePlan.closurePolicy.mode, "forbid_closure");
assert.equal(scenarioA.clinicalCalls, 0);
assert.equal(scenarioA.responsePlan.decisionOwner, "conversation_os.response_planner");
const scenarioAModelConflict = mergeModelInterpretation(scenarioA.interpretation, {
  primaryDialogueAct: "share",
  secondarySignals: ["yield_initiative"],
  confidence: 0.95,
});
assert.equal(
  scenarioAModelConflict.primaryDialogueAct,
  "yield_initiative",
  "Model interpretation must not override deterministic no_topic interaction function."
);

const scenarioBHistory: AiConversationMessage[] = [
  { role: "assistant", content: "凌晨两点多还醒着，这里可以陪你坐一会儿。" },
];
const bodyQuestion = build("你会坐吗", scenarioBHistory);
assert.equal(bodyQuestion.dialogueState.answerObligations[0]?.kind, "body_capability");
assert(bodyQuestion.responsePlan.responseActions.includes("answer_directly"));
assert(bodyQuestion.responsePlan.groundingFacts.some((fact) => fact.includes("没有身体")));
assert.equal(bodyQuestion.clinicalCalls, 0);

const identityQuestion = build("你是谁", scenarioBHistory);
assert.equal(identityQuestion.dialogueState.answerObligations[0]?.kind, "identity");
assert(identityQuestion.responsePlan.groundingFacts.some((fact) => fact.includes("AI聊天助手")));

const clinicianQuestion = build("你是心理医生吗", scenarioBHistory);
assert.equal(clinicianQuestion.dialogueState.answerObligations[0]?.kind, "identity");
assert(clinicianQuestion.responsePlan.groundingFacts.some((fact) => fact.includes("不是人类或临床专业人员")));
assert.equal(clinicianQuestion.clinicalCalls, 0);

const voiceQuestion = build("那你怎么不会说话", [
  ...scenarioBHistory,
  { role: "user", content: "你会坐吗" },
  { role: "assistant", content: "我没有身体，刚才的坐只是文字里的说法。" },
  { role: "user", content: "你是谁" },
  { role: "assistant", content: "我是慢聊小记的 AI 聊天助手。" },
]);
assert.equal(voiceQuestion.dialogueState.answerObligations[0]?.kind, "voice_output");
assert(voiceQuestion.responsePlan.groundingFacts.some((fact) => fact.includes("文字输出")));

const definitionQuestion = build("接住是什么意思", [
  { role: "assistant", content: "刚才我说了接住。" },
]);
assert.equal(definitionQuestion.dialogueState.answerObligations[0]?.kind, "definition");
assert(definitionQuestion.responsePlan.responseActions.includes("explain_plainly"));
assert.equal(definitionQuestion.responsePlan.questionPolicy.mode, "none");

const mixedNeed = build("我现在很难受，你能发语音吗？", []);
assert.equal(mixedNeed.dialogueState.answerObligations[0]?.kind, "voice_output");
assert(mixedNeed.dialogueState.activeInteractionNeeds.includes("emotional_support"));
assert(mixedNeed.responsePlan.responseActions.includes("answer_directly"));
assert(mixedNeed.responsePlan.responseActions.includes("offer_emotional_support"));
assert.equal(mixedNeed.clinicalCalls, 1);

const stopping = ["算了，不想说了", "别问了", "让我安静一会儿", "我先不聊了"];
for (const input of stopping) {
  const result = build(input, assistantInvite);
  assert.equal(result.context.interaction.stopIntent, true, input);
  assert(result.responsePlan.responseActions.includes("respect_pause"), input);
  assert.equal(result.responsePlan.closurePolicy.mode, "allow_pause", input);
  assert.equal(result.responsePlan.questionPolicy.mode, "none", input);
}

const lowMoodNoTopic = build("我很难受，但不知道说什么", assistantInvite);
assert.equal(lowMoodNoTopic.context.interaction.affect, "negative");
assert(!lowMoodNoTopic.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert(lowMoodNoTopic.responsePlan.responseActions.includes("offer_emotional_support"));
assert.equal(lowMoodNoTopic.clinicalCalls, 1);

const repeatedQuestions = build("不知道说什么", [
  { role: "assistant", content: "你想从哪件事说起？" },
  { role: "user", content: "不知道。" },
  { role: "assistant", content: "那是什么让你卡住了？" },
]);
assert.equal(repeatedQuestions.context.interaction.initiativeDirection, "shared");
assert.equal(repeatedQuestions.responsePlan.questionPolicy.mode, "none");
assert.equal(repeatedQuestions.responsePlan.closurePolicy.mode, "forbid_closure");

const priorPause = build("不知道说什么", [
  { role: "user", content: "让我安静一会儿" },
  { role: "assistant", content: "好，我不追问。" },
]);
assert.equal(priorPause.context.interaction.stopIntent, true);
assert(priorPause.responsePlan.responseActions.includes("respect_pause"));

const explicitReopen = build("没话题，你来问吧", [
  { role: "user", content: "让我安静一会儿" },
  { role: "assistant", content: "好，我不追问。" },
]);
assert.equal(explicitReopen.context.interaction.stopIntent, false);
assert(explicitReopen.responsePlan.responseActions.includes("take_light_topic_initiative"));

const correction = build("不是这个意思，你理解错了", [{ role: "assistant", content: "听起来你很生气。" }]);
assert.equal(correction.interpretation.primaryDialogueAct, "correct_assistant");
assert(correction.responsePlan.responseActions.includes("repair_previous_wording"));
assert.equal(correction.clinicalCalls, 0);

const actionSupport = build("这件事我下一步该怎么做？", []);
assert.equal(actionSupport.interpretation.primaryDialogueAct, "request_action_support");
assert(actionSupport.responsePlan.responseActions.includes("offer_action_support"));
assert.equal(actionSupport.clinicalCalls, 1);

const modalityCases = [
  ["你能听见我吗", "voice_input"],
  ["你能看到我吗", "perception_capability"],
  ["你知道现在几点吗", "time_capability"],
  ["你还记得我们之前聊的吗", "memory_capability"],
] as const;
for (const [input, expectedKind] of modalityCases) {
  const result = build(input);
  assert.equal(result.dialogueState.answerObligations[0]?.kind, expectedKind, input);
  assert.equal(result.clinicalCalls, 0, input);
}

const lowInformationCases = ["1", "嗯", "？", "a"];
for (const input of lowInformationCases) {
  const result = build(input);
  assert.equal(result.context.semanticEvidence.status, "insufficient", input);
  assert.equal(result.responsePlan.answerObligations.length, 0, input);
  assert(result.responsePlan.prohibitedClaims.some((claim) => claim.includes("message form")), input);
}

const counterExamples = [
  "我不知道北京今天几度", "我想不明白他为什么这样做", "这个梦我说不清", "脑子很乱，因为项目太复杂",
  "我有点累", "谢谢", "今天吃了面", "她没有回我", "我想聊工作", "随便说点什么",
  "我不是在说你理解错了", "不对", "你是心理医生吗", "你能抱我吗", "你能给我建议吗",
  "我害怕但不知道从哪说", "先这样吧", "我们继续", "你刚才为什么说会陪我坐", "这个词什么意思",
];
const counterResults = counterExamples.map((input) => build(input, assistantInvite));
assert.equal(counterResults.length, 20);
assert(counterResults.every((item) => item.responsePlan.decisionOwner === "conversation_os.response_planner"));
assert(counterResults.every((item) => item.responsePlan.closurePolicy.mode !== "allow_pause" || item.context.interaction.stopIntent));

assert(validateResponsePlanOutput({ plan: bodyQuestion.responsePlan, reply: "我没有身体，不能真的坐；刚才那是文字里的说法。" }).passed);
assert(!validateResponsePlanOutput({ plan: bodyQuestion.responsePlan, reply: "我可以陪你坐一会儿。" }).passed);
assert(validateResponsePlanOutput({ plan: identityQuestion.responsePlan, reply: "我是慢聊小记的 AI 聊天助手。" }).passed);
assert(!validateResponsePlanOutput({ plan: identityQuestion.responsePlan, reply: "你觉得我是谁呢？" }).passed);
assert(validateResponsePlanOutput({ plan: clinicianQuestion.responsePlan, reply: "我是 AI 聊天助手，不是心理医生或治疗师。" }).passed);
assert(!validateResponsePlanOutput({ plan: clinicianQuestion.responsePlan, reply: "我是慢聊小记的心理医生。" }).passed);
assert(!validateResponsePlanOutput({ plan: scenarioA.responsePlan, reply: "没关系，那我们就先这样待着。" }).passed);
assert(!validateResponsePlanOutput({ plan: scenarioA.responsePlan, reply: "没关系，就这样安静待着也挺好。" }).passed);
assert(validateResponsePlanOutput({ plan: scenarioA.responsePlan, reply: "那我来起个轻松的头：今天有没有一件小事让你多看了一眼？" }).passed);
assert(!validateResponsePlanOutput({ plan: scenarioA.responsePlan, reply: "想不到也没关系，你想聊点什么？" }).passed);
assert(validateResponsePlanOutput({ plan: definitionQuestion.responsePlan, reply: "“接住”是指认真回应你的话，不是真的用手去接。" }).passed);
assert(validateResponsePlanOutput({ plan: voiceQuestion.responsePlan, reply: "我现在只能打字，没法发送或播放语音。" }).passed);

// Complete adjacent-turn runs: each next decision receives the prior assistant wording,
// so the check exercises continuity rather than isolated sentence classification.
const runPlannedTurn = (
  history: AiConversationMessage[],
  user: string,
  representativeRealization: string
) => {
  const result = build(user, history);
  history.push({ role: "user", content: user }, { role: "assistant", content: representativeRealization });
  return result;
};

const completeAHistory: AiConversationMessage[] = [...assistantInvite];
const completeA = runPlannedTurn(
  completeAHistory,
  "我想不到说什么耶",
  "那我来起个轻松的头：今天有没有一件小事让你多看了一眼？"
);
assert(completeA.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert.equal(completeA.responsePlan.closurePolicy.mode, "forbid_closure");

const completeBHistory: AiConversationMessage[] = [
  { role: "assistant", content: "凌晨两点多还醒着，这里可以陪你坐一会儿。" },
];
const completeBTurn1 = runPlannedTurn(completeBHistory, "你会坐吗", "我没有身体，不能真的坐；刚才那是文字里的说法。");
const completeBTurn2 = runPlannedTurn(completeBHistory, "你是谁", "我是慢聊小记的 AI 聊天助手。");
const completeBTurn3 = runPlannedTurn(completeBHistory, "那你怎么不会说话", "我只能用文字回复；刚才说“没接住”只是说我没有直接回答。");
const completeBTurn4 = runPlannedTurn(completeBHistory, "接住是什么意思", "这里指的是跟上你问的内容并直接回答，不是字面上用身体接住。");
assert.deepEqual(
  [completeBTurn1, completeBTurn2, completeBTurn3, completeBTurn4].map(
    (turn) => turn.dialogueState.answerObligations[0]?.kind
  ),
  ["body_capability", "identity", "voice_output", "definition"]
);
assert(
  [completeBTurn1, completeBTurn2, completeBTurn3, completeBTurn4].every(
    (turn) => turn.responsePlan.responseActions[0] === "answer_directly" && turn.clinicalCalls === 0
  )
);

const orchestration = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
const generation = readFileSync("services/ai/aiService.ts", "utf8");
const validator = readFileSync("services/ai/responsePlanValidator.ts", "utf8");
const interpretationAdapter = readFileSync("services/ai/turnInterpretationAdapter.ts", "utf8");
const baselineRunner = readFileSync("scripts/conversation-os-control-baseline.ts", "utf8");
assert.equal((orchestration.match(/createResponsePlan\(/g) ?? []).length, 1, "Production orchestration must create exactly one ResponsePlan.");
assert(!orchestration.includes("createClinicalPlan("), "Production orchestration must not let Clinical select a ResponseGoal.");
assert(!orchestration.includes("enforceSemanticEvidenceReplyContract"), "Legacy semantic guard must not own the production output path.");
assert(!orchestration.includes("createFallbackGeneration"), "Ordinary fallback must not create a second chat goal.");
assert(!generation.includes("runConversationPipeline("), "Surface Realization must not run the legacy Engage planner.");
assert(!generation.includes("buildVoiceConstraints("), "Surface Realization must not run the legacy Voice strategy carrier.");
assert(!validator.includes("createResponsePlan("), "Output Validation must never re-plan.");
assert(!validator.includes("selectResponseGoal("), "Output Validation must never select a ResponseGoal.");
assert(
  interpretationAdapter.indexOf("await inspectPromptBeforeExternalCall(") < interpretationAdapter.indexOf("const response = await callModel("),
  "Turn Interpretation must inspect the exact external prompt before the model call."
);
assert(
  generation.indexOf("await inspectPromptBeforeExternalCall(") < generation.indexOf("const response = await callModel("),
  "Surface Realization must inspect the exact external prompt before the model call."
);
assert(
  baselineRunner.includes('--authorized-post') && baselineRunner.includes('restricted to Qwen/DashScope qwen3.7-max'),
  "Post-refactor real-model baseline must remain explicitly locked and provider-scoped."
);

const runAsyncChecks = async () => {
  for (const [stage, userMessage] of [
    ["turn_interpretation", "我想不到说什么耶"],
    ["surface_realization", "你是谁"],
  ] as const) {
    const observedStages: string[] = [];
    await assert.rejects(
      () => createChatReply({
        conversationId: `external-prompt-rejection-${stage}`,
        userMessage,
        recentMessages: assistantInvite,
        inspectExternalPrompt: ({ stage: observedStage }) => {
          observedStages.push(observedStage);
          if (observedStage === stage) throw new Error(`preflight rejected ${stage}`);
        },
      }),
      new RegExp(`preflight rejected ${stage}`)
    );
    assert.deepEqual(observedStages, [stage], `${stage} rejection must terminate the external-call chain immediately.`);
  }
};

runAsyncChecks()
  .then(() => {
    console.log(JSON.stringify({
      scenarios: 15,
      completeMultiTurnRuns: { scenarioA: 1, scenarioB: 4 },
      counterExamples: counterResults.length,
      architecture: {
        responsePlanCount: 1,
        decisionOwner: scenarioA.responsePlan.decisionOwner,
        legacyEngageInSurfaceRealization: false,
        legacyClinicalGoalInProductionOrchestration: false,
        validatorCanReplan: false,
        promptPreflightRejectionTerminatesChain: true,
      },
    }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
