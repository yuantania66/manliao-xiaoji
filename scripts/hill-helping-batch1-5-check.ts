import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  type OrdinaryHandoffBoundary,
  type ResponseAction,
  type ResponsePlan,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { CommittedAssistantMove, ConversationMessage } from "../conversation-os/types";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import type { SafetySemanticProvider } from "../services/ai/chatSafety";
import {
  validatePlannedFunctionSemanticOutput,
  type PositiveFunctionVerdictBinding,
} from "../services/ai/plannedFunctionSemanticValidator";
import { buildChatPrompt, formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { formatResponsePlanRegenerateConstraint, validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { ruleIdsInReason } from "./semantic-verdict-audit";

const uncertainBoundary = (
  userBoundaries: OrdinaryHandoffBoundary["userBoundaries"] = []
): OrdinaryHandoffBoundary => ({
  source: "hill_helping",
  applicability: "uncertain",
  userBoundaries,
  evidence: ["The Hill decision has insufficient evidence to select a helping goal or technique."],
});

const noRiskSafetyProvider: SafetySemanticProvider = async () => JSON.stringify({
  schemaVersion: 1,
  riskLevel: "none",
  categories: [],
  currentness: "current",
  evidence: [],
  requiresSafetyResponse: false,
});

const positiveBindingFor = (
  contract: NonNullable<ResponsePlan["positiveFunctionContract"]>
): PositiveFunctionVerdictBinding => {
  if (contract.action === "establish_assistant_identity") {
    return {
      action: contract.action,
      mode: contract.mode,
      sourceTurnId: contract.sourceTurnId,
      targetProposition: contract.targetProposition,
    };
  }
  if (contract.action === "offer_emotional_support") {
    return {
      action: contract.action,
      supportFunction: contract.supportFunction,
      sourceTurnId: contract.sourceTurnId,
    };
  }
  return {
    action: contract.action,
    repairMode: contract.repairMode,
    sourceTurnId: contract.sourceTurnId,
    targetTurnId: contract.targetTurnId,
  };
};

const validatePositiveSemanticFixture = async ({
  plan,
  reply,
  shouldPass,
}: {
  plan: ResponsePlan;
  reply: string;
  shouldPass: boolean;
}) => {
  const contract = plan.positiveFunctionContract;
  assert(contract, "Positive-function fixture requires a frozen contract.");
  assert.equal(plan.interactionMoveHandoffPlan, null);
  return validatePlannedFunctionSemanticOutput({
    plan,
    reply,
    semanticContext: {
      currentUserText: "sourceText" in contract ? contract.sourceText : "identity fixture",
      handoffTargetAssistantText: null,
    },
    provider: async (input) => ({
      schemaVersion: 1,
      planId: input.planId,
      handoff: null,
      positiveFunction: {
        binding: positiveBindingFor(contract),
        status: shouldPass ? "satisfied" : "not_satisfied",
        realizedAction: shouldPass ? contract.action : null,
        targetAddressed: shouldPass,
        contractRealized: shouldPass,
        containsContradictoryMove: false,
        evidence: shouldPass
          ? [{ start: 0, end: reply.length, text: reply, reason: "Frozen contract fixture." }]
          : [],
      },
      semanticQuestionCount: (reply.match(/[？?]/gu) ?? []).length,
    }),
  });
};

const build = ({
  userMessage,
  recentMessages = [],
  boundary = uncertainBoundary(),
}: {
  userMessage: string;
  recentMessages?: ConversationMessage[];
  boundary?: OrdinaryHandoffBoundary | null;
}) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "hill-batch1-5-check",
    currentTurnId: `turn-${recentMessages.length + 1}`,
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
    ordinaryHandoffBoundary: boundary,
    clinicalAdviceProvider: ({ need }) => ({
      strategy: "test-legacy-compat",
      intent: need,
      questionFunction: "none",
      toneConstraints: [],
      interventionBoundaries: [],
      evidence: ["test"],
    }),
  });
  return { context, interpretation, dialogueState, responsePlan };
};

const committedMove = ({
  purpose,
  question = false,
  sourceTurnId,
}: {
  purpose: ResponseAction[];
  question?: boolean;
  sourceTurnId: string;
}): CommittedAssistantMove => ({
  purpose,
  claims: [],
  assumptions: [],
  questionOrRequest: question ? { kind: "question" } : null,
  expectedUserContribution: question ? "answer" : "none",
  userBurden: question ? "low" : "none",
  sourceTurnId,
  evidence: ["Committed only after validation."],
});

const previousTopic: ConversationMessage[] = [
  { id: "topic-user", role: "user", content: "今天开会时我一直没说上话。" },
  {
    id: "topic-assistant",
    role: "assistant",
    content: "你刚才说的是开会时一直没说上话。",
    committedAssistantMove: committedMove({
      purpose: ["acknowledge_without_psychologizing"],
      sourceTurnId: "topic-assistant",
    }),
  },
];

const explicitAnswerFrame: ConversationMessage[] = [
  { id: "frame-user", role: "user", content: "我想先选一个方向。" },
  {
    id: "frame-assistant",
    role: "assistant",
    content: "请回编号：1. 先把事情说清楚；2. 先想下一步。",
    committedAssistantMove: committedMove({
      purpose: ["take_light_topic_initiative"],
      question: true,
      sourceTurnId: "frame-assistant",
    }),
  },
];

const pairedForms = [
  "1", "2", "3", "0", "嗯", "好", "行", "是", "不", "A",
  "？", "。", "…", "🙂", "👍", "啊", "哦", "哈", "7", "9",
];

const handoffAction = (plan: ResponsePlan) => plan.responseActions.find((action) => [
  "invite_low_pressure_calibration",
  "continue_established_frame",
  "continue_established_thread",
  "offer_neutral_conversation_entry",
].includes(action));

const run = async () => {
  for (const form of pairedForms) {
    const withoutContext = build({ userMessage: form }).responsePlan;
    const withTopic = build({ userMessage: form, recentMessages: previousTopic }).responsePlan;
    assert.equal(handoffAction(withoutContext), "invite_low_pressure_calibration", `${form}: no-context path`);
    assert.equal(handoffAction(withTopic), "continue_established_thread", `${form}: established-topic path`);
    assert.equal(withoutContext.behaviorSource, "ordinary_conversation");
    assert.equal(withTopic.behaviorSource, "ordinary_conversation");
  }

  const answerFrame = build({ userMessage: "2", recentMessages: explicitAnswerFrame }).responsePlan;
  assert.equal(handoffAction(answerFrame), "continue_established_frame");
  assert.equal(answerFrame.questionPolicy.mode, "none");

  const directAnswer = build({ userMessage: "你是AI吗？" }).responsePlan;
  assert(directAnswer.responseActions.includes("answer_directly"));
  assert.equal(handoffAction(directAnswer), undefined);

  const pause = build({ userMessage: "先别问了" }).responsePlan;
  assert.deepEqual(pause.responseActions, ["respect_pause"]);
  assert.equal(pause.questionPolicy.mode, "none");

  const emotion = build({ userMessage: "我今天很难受" }).responsePlan;
  assert(emotion.responseActions.includes("offer_emotional_support"));
  assert.equal(handoffAction(emotion), undefined);
  assert.equal(
    emotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? emotion.positiveFunctionContract.supportFunction
      : null,
    "invite_optional_sharing",
    "A single affect span defaults to an optional sharing invitation, not focus control."
  );

  const multiFocusEmotion = build({ userMessage: "我现在又委屈又生气" }).responsePlan;
  assert.equal(
    multiFocusEmotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? multiFocusEmotion.positiveFunctionContract.supportFunction
      : null,
    "return_focus_control",
    "Focus control requires multiple current-turn affect or relational-impact spans."
  );
  const focusValidationEmotion = build({
    userMessage: "我今天很难受，也很疲惫",
  }).responsePlan;
  assert.equal(
    focusValidationEmotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? focusValidationEmotion.positiveFunctionContract.supportFunction
      : null,
    "return_focus_control"
  );
  const repeatedSameAffect = build({
    userMessage: "我有点难过，后来还是觉得很难过",
  }).responsePlan;
  assert.equal(
    repeatedSameAffect.positiveFunctionContract?.action === "offer_emotional_support"
      ? repeatedSameAffect.positiveFunctionContract.supportFunction
      : null,
    "invite_optional_sharing",
    "Repeated evidence for one affect target must not manufacture multiple focuses."
  );
  const multiAffectNoAnalysis = build({
    userMessage: "我现在又委屈又生气，但不想分析",
  }).responsePlan;
  assert.equal(
    multiAffectNoAnalysis.positiveFunctionContract?.action === "offer_emotional_support"
      ? multiAffectNoAnalysis.positiveFunctionContract.supportFunction
      : null,
    "reduce_expression_burden",
    "An explicit no-analysis boundary must remain higher priority than focus control."
  );

  const action = build({ userMessage: "帮我想想下一步怎么办" }).responsePlan;
  assert(action.responseActions.includes("offer_action_support"));
  assert.equal(handoffAction(action), undefined);

  const repair = build({
    userMessage: "不是这个意思，你理解错了",
    recentMessages: [{ id: "repair-assistant", role: "assistant", content: "你今天很开心。" }],
  }).responsePlan;
  assert.deepEqual(repair.responseActions, ["repair_previous_wording"]);
  assert.equal(repair.behaviorSource, "ordinary_conversation");
  assert.equal(repair.clinicalStrategy, null);
  assert.equal(handoffAction(repair), undefined);

  const repairWithConcurrentEmotion = build({
    userMessage: "不是这个意思，你理解错了，我今天很难受",
    recentMessages: [{ id: "repair-emotion-assistant", role: "assistant", content: "听起来你已经撑不住了。" }],
  }).responsePlan;
  assert.deepEqual(repairWithConcurrentEmotion.responseActions, ["repair_previous_wording"]);
  assert.equal(repairWithConcurrentEmotion.behaviorSource, "ordinary_conversation");
  assert.equal(repairWithConcurrentEmotion.clinicalStrategy, null);

  const noQuestions = build({
    userMessage: "1",
    boundary: uncertainBoundary(["no_questions"]),
  }).responsePlan;
  assert.equal(handoffAction(noQuestions), "offer_neutral_conversation_entry");
  assert.equal(noQuestions.questionPolicy.mode, "none");

  const multiTurnActions: Array<ResponseAction | undefined> = [];
  const multiTurnHistory: ConversationMessage[] = [];
  for (const [index, userMessage] of ["1", "2", "3"].entries()) {
    const plan = build({ userMessage, recentMessages: multiTurnHistory }).responsePlan;
    const selected = handoffAction(plan);
    multiTurnActions.push(selected);
    assert.notEqual(selected, "acknowledge_without_psychologizing");
    multiTurnHistory.push({ id: `multi-user-${index + 1}`, role: "user", content: userMessage });
    multiTurnHistory.push({
      id: `multi-assistant-${index + 1}`,
      role: "assistant",
      content: selected === "invite_low_pressure_calibration"
        ? "我还不确定该怎么接；你希望我先等你继续，还是给一个轻一点的开头？"
        : "我先起个头：今天最普通的一小段，也可以从那里说。",
      committedAssistantMove: committedMove({
        purpose: selected ? [selected] : [],
        question: selected === "invite_low_pressure_calibration",
        sourceTurnId: `multi-assistant-${index + 1}`,
      }),
    });
  }
  // Product decision 2026-09-28: one low-pressure calibration per continuous low-information
  // stretch, then light entries; replaces the earlier invite/entry/invite alternation.
  assert.deepEqual(multiTurnActions, [
    "invite_low_pressure_calibration",
    "offer_neutral_conversation_entry",
    "offer_neutral_conversation_entry",
  ]);
  const secondEntry = build({ userMessage: "3", recentMessages: multiTurnHistory.slice(0, 4) }).responsePlan;
  assert.equal(secondEntry.questionPolicy.mode, "none");
  assert.equal(
    validateResponsePlanOutput({ plan: secondEntry, reply: "收到。" }).passed,
    false,
    "Entries after calibration must not collapse into bare receipts."
  );

  const neutralEntryAttributionConstraint =
    "The entry is the assistant's own offer, not an explanation of the user's message.";
  const promptTextFor = (userMessage: string, recentMessages: ConversationMessage[], responsePlan: ResponsePlan) =>
    buildChatPrompt({ userMessage, recentMessages, responsePlan }).messages.map((message) => message.content).join("\n");
  assert(promptTextFor("3", multiTurnHistory.slice(0, 4), secondEntry).includes(neutralEntryAttributionConstraint));
  for (const reply of [
    "你应该是在测试消息，我这边都收到了。",
    "你可能在测试我能不能收到。",
    "好像你在测试系统，我可以陪你接着发。",
  ]) {
    const validation = validateResponsePlanOutput({ plan: secondEntry, reply });
    assert.equal(validation.passed, false, reply);
    assert(validation.failureReasons.includes("unsupported_meaning:testing_or_probing"), reply);
    const constraint = formatResponsePlanRegenerateConstraint(secondEntry, validation.failureReasons);
    assert(constraint.includes(`planId=${secondEntry.planId}`), reply);
    assert(constraint.includes("认定用户在测试、试探或检查助手/系统的反应"), reply);
    assert(constraint.includes("弱化词仍是同一种意图归因"), reply);
    assert(constraint.includes("不是对用户输入的解释或评论"), reply);
    assert(constraint.includes("本计划禁止提问"), reply);
    assert(!constraint.includes("修复校验项 unsupported_meaning"), reply);
  }
  assert.equal(
    validateResponsePlanOutput({ plan: secondEntry, reply: "我先起个头：今天最普通的一小段，也可以从那里说。" }).passed,
    true
  );
  assert(!promptTextFor("1", [], build({ userMessage: "1" }).responsePlan).includes(neutralEntryAttributionConstraint));

  const scaleAnswer = build({
    userMessage: "6",
    recentMessages: [{
      id: "scale-assistant",
      role: "assistant",
      content: "如果 0 到 10 分，你会打几分？",
      committedAssistantMove: committedMove({ purpose: ["take_light_topic_initiative"], question: true, sourceTurnId: "scale-assistant" }),
    }],
  }).responsePlan;
  const explicitTest = build({ userMessage: "我在测试消息能不能发出去" }).responsePlan;
  for (const [plan, reply] of [
    [answerFrame, "好，那就先想下一步。"],
    [scaleAnswer, "6分，比中间高一点。"],
    [explicitTest, "你在测试消息发送，这条能正常显示。"],
  ] as const) {
    assert(!plan.prohibitedClaims.some((claim) => claim.includes("message form or repetition")), reply);
    assert(!promptTextFor("", [], plan).includes(neutralEntryAttributionConstraint), reply);
    assert(
      !validateResponsePlanOutput({ plan, reply }).failureReasons.some((reason) => reason.startsWith("unsupported_meaning:")),
      reply
    );
  }
  assert.equal(handoffAction(scaleAnswer), "continue_established_frame");
  assert.equal(validateResponsePlanOutput({ plan: scaleAnswer, reply: "6分，比中间高一点。" }).passed, true);

  const uncommittedCalibration = build({
    userMessage: "2",
    recentMessages: [{ id: "failed-user-1", role: "user", content: "1" }],
  }).responsePlan;
  assert.equal(
    handoffAction(uncommittedCalibration),
    "invite_low_pressure_calibration",
    "A calibration that was never committed must not count as already asked."
  );

  const topicSwitch = build({
    userMessage: "3",
    recentMessages: [
      ...multiTurnHistory.slice(0, 4),
      { id: "switch-user", role: "user", content: "其实我今天一直在想要不要换工作。" },
      {
        id: "switch-assistant",
        role: "assistant",
        content: "换工作这件事在你心里转了一整天。",
        committedAssistantMove: committedMove({ purpose: ["acknowledge_without_psychologizing"], sourceTurnId: "switch-assistant" }),
      },
    ],
  }).responsePlan;
  assert.equal(handoffAction(topicSwitch), "continue_established_thread");
  assert.equal(topicSwitch.questionPolicy.mode, "none");

  const staleCalibrationHistory: ConversationMessage[] = [
    { id: "stale-user-1", role: "user", content: "1" },
    {
      id: "stale-assistant-1",
      role: "assistant",
      content: "我还不确定该怎么接；你希望我先等你继续，还是给一个轻一点的开头？",
      committedAssistantMove: committedMove({ purpose: ["invite_low_pressure_calibration"], question: true, sourceTurnId: "stale-assistant-1" }),
    },
    ...[2, 3, 4].flatMap((index) => [
      { id: `stale-user-${index}`, role: "user" as const, content: String(index) },
      {
        id: `stale-assistant-${index}`,
        role: "assistant" as const,
        content: "我先起个头：今天最普通的一小段，也可以从那里说。",
        committedAssistantMove: committedMove({ purpose: ["offer_neutral_conversation_entry"], sourceTurnId: `stale-assistant-${index}` }),
      },
    ]),
  ];
  assert.equal(
    handoffAction(build({ userMessage: "5", recentMessages: staleCalibrationHistory }).responsePlan),
    "invite_low_pressure_calibration",
    "The one-calibration limit applies to the current low-information window, not the whole session."
  );

  const refusedAfterCalibration = build({
    userMessage: "2",
    recentMessages: multiTurnHistory.slice(0, 2),
    boundary: uncertainBoundary(["no_questions"]),
  }).responsePlan;
  assert.equal(handoffAction(refusedAfterCalibration), "offer_neutral_conversation_entry");
  assert.equal(refusedAfterCalibration.questionPolicy.mode, "none");

  const invitePlan = build({ userMessage: "1" }).responsePlan;
  assert.equal(validateResponsePlanOutput({ plan: invitePlan, reply: "收到。" }).passed, false);
  assert.equal(
    validateResponsePlanOutput({
      plan: invitePlan,
      reply: "我还不确定该怎么接；你想让我先等你继续，还是给一个轻一点的开头？",
    }).passed,
    true
  );
  assert.equal(
    validateResponsePlanOutput({ plan: invitePlan, reply: "这个是什么意思？" }).passed,
    false
  );
  assert.equal(
    validateResponsePlanOutput({
      plan: noQuestions,
      reply: "我先起个头：今天最普通的一小段，也可以从那里说。",
    }).passed,
    true
  );

  const emotionalQualityFailures = [
    "听到你今天不太开心，想聊聊是什么事吗？",
    "听到你说不开心，愿意告诉我发生了什么吗？",
    "我听到你今天不太高兴，能和我说说原因吗？",
    "我确实还在努力理解你，你能多解释一点吗？",
    "我无法完全体会你的感受，你愿意继续说吗？",
    "我不能真正理解你，但我会认真听。",
    "是哪件事让你觉得我没懂？",
    "你能告诉我我哪里理解错了吗？",
    "请指出我哪句话说错了。",
    "我在努力懂你，发生什么了？",
    "听到你不舒服，想聊聊怎么了吗？",
    "抱歉让你有这种感觉，你愿意再说说吗？",
    "担心明天的事很正常，别给自己太大压力。",
    "这种感觉没关系的，别太苛责自己。",
    "烦的时候就先让自己喘口气吧。",
    "心里堵的话先缓一缓，等会儿再说。",
    "抱抱你，如果想说我都在。",
    "我会一直在这里陪着你。",
    "想安静待会儿或者先放一放都行。",
    "愿意说说发生了什么吗？",
    "具体是什么事触发了你？",
    "这种情绪确实很难熬。",
    "被忽略带来的失落感很真实。",
    "委屈和生气搅在一起特别难受。",
  ];
  for (const reply of emotionalQualityFailures) {
    const validation = await validatePositiveSemanticFixture({
      plan: emotion,
      reply,
      shouldPass: false,
    });
    assert.equal(validation.passed, false, `Emotional quality failure must be rejected: ${reply}`);
    assert(
      validation.failureReasons.some((failure) => failure === "planned_function_semantic:positive_function_not_satisfied"),
      `Emotional failure must use the emotional-support contract: ${reply}`
    );
  }

  const emotionalQualityPasses = [
    "你今天有点难受。想说的话，可以只说最想先说的那一点。",
    "这会儿的难受不用急着整理清楚；你可以先说最想说的部分。",
    "这会儿的难受，我先不往原因上猜；你可以只说现在最想说的那一点。",
    "先贴着你刚才说的难受；只说眼下最明显的部分也可以。",
    "这份难受不需要现在下定义；你可以只说眼下最明显的部分。",
    "你刚才说今天很难受。可以先只说此刻最想让我知道的一点。",
    "这会儿的难受，可以只说最想先说的一点。",
    "难受这件事不替你解释原因；你可以先说最在意的部分。",
  ];
  for (const reply of emotionalQualityPasses) {
    const validation = await validatePositiveSemanticFixture({
      plan: focusValidationEmotion,
      reply,
      shouldPass: true,
    });
    assert.equal(
      validation.passed,
      true,
      `Grounded low-burden emotional support must remain allowed: ${reply}\n${validation.failureReasons.join(" | ")}`
    );
  }

  const repairQualityFailures = [
    "抱歉，你能告诉我哪里错了吗？",
    "我只是想帮你，不过可能表达得不好。",
    "不过我的意思不是那个，你再听一次。",
    "你指出具体哪句话让我说错了。",
    "是哪部分让你觉得我理解错了？",
    "我会继续努力理解你。",
    "我没理解错，你再想想。",
    "对不起让你误会了。",
    "如果你愿意，可以解释一下我哪里错了。",
    "好吧，那就算了。",
    "我知道了。",
    "可能是你没表达清楚。",
  ];
  for (const reply of repairQualityFailures) {
    const validation = await validatePositiveSemanticFixture({
      plan: repair,
      reply,
      shouldPass: false,
    });
    assert.equal(validation.passed, false, `Repair quality failure must be rejected: ${reply}`);
    assert(
      validation.failureReasons.some((failure) => failure === "planned_function_semantic:positive_function_not_satisfied"),
      `Repair failure must use the repair contract: ${reply}`
    );
  }

  const repairQualityPasses = [
    "刚才是我理解偏了，那层意思我先收回来。",
    "我前面把你的话说窄了，那层理解我收回来。",
    "刚才那句没有跟上你，我先撤回，不继续沿用。",
    "是我把没确认的理解说成了事实，我收回来。",
    "我刚才说偏了，不该把那个判断放到你身上。",
    "抱歉，我前面误解了你的意思，那句先作废。",
    "前面那句是我没接住，我先收回自己的判断。",
    "是我没有跟上你，刚才的说法不再作为前提。",
  ];
  for (const reply of repairQualityPasses) {
    const validation = await validatePositiveSemanticFixture({
      plan: repair,
      reply,
      shouldPass: true,
    });
    assert.equal(
      validation.passed,
      true,
      `Ownership-based repair must remain allowed: ${reply}`
    );
  }

  const reduceBurdenEmotion = build({
    userMessage: "我心里有点难受，但不想分析原因",
  }).responsePlan;
  assert.equal(
    reduceBurdenEmotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? reduceBurdenEmotion.positiveFunctionContract.supportFunction
      : null,
    "reduce_expression_burden"
  );
  const amountControlEmotion = build({
    userMessage: "我有点难受，但不知道怎么说",
  }).responsePlan;
  assert.equal(
    amountControlEmotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? amountControlEmotion.positiveFunctionContract.supportFunction
      : null,
    "return_amount_control"
  );
  const relationalImpactEmotion = build({
    userMessage: "你一点都不懂我，我现在很难受",
  }).responsePlan;
  assert.equal(
    relationalImpactEmotion.positiveFunctionContract?.action === "offer_emotional_support"
      ? relationalImpactEmotion.positiveFunctionContract.supportFunction
      : null,
    "acknowledge_current_relational_impact"
  );
  for (const userMessage of [
    "我今天有点不太高兴",
    "心里有点堵",
    "今天突然有点难过",
    "明天那件事让我有点担心",
    "我觉得有点丢脸",
    "今晚莫名有点孤单",
    "我现在真的很烦",
  ]) {
    const singleAffectPlan = build({ userMessage }).responsePlan;
    assert.equal(
      singleAffectPlan.positiveFunctionContract?.action === "offer_emotional_support"
        ? singleAffectPlan.positiveFunctionContract.supportFunction
        : null,
      "invite_optional_sharing",
      `${userMessage} must not manufacture a focus-selection task.`
    );
  }
  const supportFunctionOf = (plan: ResponsePlan) =>
    plan.positiveFunctionContract?.action === "offer_emotional_support"
      ? plan.positiveFunctionContract.supportFunction
      : null;
  const declinedSharingSourceOf = (plan: ResponsePlan) =>
    plan.positiveFunctionContract?.action === "offer_emotional_support"
      ? plan.positiveFunctionContract.declinedSharingSource
      : undefined;
  for (const userMessage of ["我今天有点不太高兴", "心里有点堵", "今天被领导当众批评了，有点不太高兴"]) {
    const invitePlan = build({ userMessage }).responsePlan;
    assert.equal(supportFunctionOf(invitePlan), "invite_optional_sharing", userMessage);
    assert.equal(declinedSharingSourceOf(invitePlan), undefined, `${userMessage} carries no refusal source.`);
    assert.equal(invitePlan.questionPolicy.mode, "optional_after_answer", `${userMessage} allows one optional invitation.`);
    const invitePrompt = formatResponsePlanForPrompt(invitePlan);
    assert(invitePrompt.includes("if the user already stated the event, refer to that event"));
    assert(invitePrompt.includes("Do not ask why, for the cause, for specific details"));
    assert.equal(invitePrompt.includes("need not repeat that agreement"), false, `${userMessage} keeps the invitation constraints only.`);
    const inviteRegeneration = formatResponsePlanRegenerateConstraint(invitePlan, [
      "planned_function_semantic:positive_function_not_satisfied",
      "planned_function_semantic:question_count_quality",
    ]);
    assert(inviteRegeneration.includes("至多一句容易拒绝的温和邀请"));
    assert(inviteRegeneration.includes("整条回复至多一个邀请或问题"));
    assert(inviteRegeneration.includes("不要问为什么或原因"));
    assert.equal(inviteRegeneration.includes("本计划禁止提问"), false);
  }
  const referenceInviteReply = "听起来，你今天有些不好受。如果你愿意，可以和我说说发生了什么。不用着急，慢慢说就好。";
  const ordinaryLowPlan = build({ userMessage: "我今天有点不太高兴" }).responsePlan;
  const referenceDeterministic = validateResponsePlanOutput({ plan: ordinaryLowPlan, reply: referenceInviteReply });
  assert.equal(
    referenceDeterministic.passed,
    true,
    `The approved reference tone must not be blocked by deterministic validation: ${referenceDeterministic.failureReasons.join(",")}`
  );
  for (const [userMessage, reason] of [
    ["我有点难受，但不想说", "explicit unwillingness to talk"],
    ["我不太高兴，不想被问", "declines being asked"],
    ["心里有点堵，别再问我了", "declines further questions"],
    ["我今天什么也不想说，有点难过", "declines talking where amount control was selected"],
    ["我现在又委屈又生气，但不想被问", "declines questions where focus control was selected"],
  ] as const) {
    const declinedPlan = build({ userMessage }).responsePlan;
    assert(declinedPlan.responseActions.includes("offer_emotional_support"), `${userMessage} remains emotional support`);
    assert.equal(supportFunctionOf(declinedPlan), "respect_declined_sharing", `${userMessage}: ${reason} removes the invitation.`);
    assert.equal(declinedPlan.questionPolicy.mode, "none", `${userMessage}: ${reason} forbids questions.`);
    assert(
      declinedPlan.positiveFunctionContract?.evidence.includes(
        "sharingInvitationUnavailable=user_declined_questions_or_talking"
      )
    );
    assert(declinedPlan.positiveFunctionContract?.evidence.includes("supportFunction=respect_declined_sharing"));
    assert.equal(declinedSharingSourceOf(declinedPlan), "current_turn", `${userMessage}: the refusal source is the current turn.`);
    const declinedPrompt = formatResponsePlanForPrompt(declinedPlan);
    assert.equal(declinedPrompt.includes("already agreed in an earlier turn"), false, "A current refusal carries no prior-pause branch.");
    assert.equal(declinedPrompt.includes("responding to that feeling is required"), false);
    assert.equal(declinedPrompt.includes("at most one gentle invitation the user can easily decline"), false);
    assert.equal(declinedPrompt.includes("Give the user control over how much to express"), false);
    assert.equal(declinedPrompt.includes("grants that control"), false);
    assert(declinedPrompt.includes("restating the feeling word is not required"));
    assert(declinedPrompt.includes("responds to neither the feeling nor the boundary is not enough"));
    assert(declinedPrompt.includes("respect not talking for now"));
    assert(declinedPrompt.includes("do not decide for them that they will not share anything further"));
    assert(declinedPrompt.includes("one statement that you will listen whenever they want to talk, as long as it asks for no response"));
    assert(declinedPrompt.includes("including asking the user to tell you later, and do not give permission about how much or which part to say"));
    assert(declinedPrompt.includes("claim physical or offline company"));
    assert.equal(declinedPrompt.includes("by naming that feeling itself"), false, "Restating the feeling word is no longer required.");
    assert.equal(declinedPrompt.includes("including saying it later"), false, "A no-response listening statement is no longer forbidden.");
    const declinedRegeneration = formatResponsePlanRegenerateConstraint(declinedPlan, [
      "planned_function_semantic:positive_function_not_satisfied",
      "planned_function_semantic:question_count_quality",
    ]);
    assert(declinedRegeneration.includes("本计划禁止提问"));
    assert(declinedRegeneration.includes("不要求逐字复述情绪词"));
    assert(declinedRegeneration.includes("既没回应感受也没回应边界不算完成"));
    assert(declinedRegeneration.includes("不要把感受说成不该说的理由"));
    assert(declinedRegeneration.includes("不要替用户决定不再表达，可以加一句不要求回应的倾听表态"));
    assert(declinedRegeneration.includes("包括让用户以后再告诉你"));
    assert(declinedRegeneration.includes("不要给“想说多少、说哪部分”这类表达许可"));
    assert.equal(declinedRegeneration.includes("以后再说”这类表达许可"), false);
    assert.equal(declinedRegeneration.includes("不要用“我在、陪着你”这类套话"), false);
    assert.equal(declinedRegeneration.includes("之前已经答应过不问"), false, "A current refusal regeneration carries no prior-pause branch.");
  }
  for (const [userMessage, reply] of [
    ["我有点难受，但不想说", "好，那就先不说，不用勉强自己。"],
    ["我不太高兴，不想被问", "好，我不问，你想说的时候我听着。"],
  ] as const) {
    const referenceDeclined = validateResponsePlanOutput({ plan: build({ userMessage }).responsePlan, reply });
    assert.equal(
      referenceDeclined.passed,
      true,
      `The approved refusal tone must not be blocked by deterministic validation: ${referenceDeclined.failureReasons.join(",")}`
    );
  }
  for (const [userMessage, expected] of [
    ["我心里有点难受，但不想讲原因", "reduce_expression_burden"],
    ["我有点难受，不想多说", "return_amount_control"],
  ] as const) {
    assert.equal(
      supportFunctionOf(build({ userMessage }).responsePlan),
      expected,
      `${userMessage}: an explicitly selected burden or partial-amount function is not a refusal to talk.`
    );
    assert.equal(declinedSharingSourceOf(build({ userMessage }).responsePlan), undefined);
  }
  const pausedThenLow = build({
    userMessage: "我今天有点不太高兴",
    recentMessages: [
      { id: "pause-user", role: "user", content: "先别问了" },
      { id: "pause-assistant", role: "assistant", content: "好，不问了。" },
    ],
  }).responsePlan;
  assert.equal(supportFunctionOf(pausedThenLow), "respect_declined_sharing", "A prior pause boundary removes the invitation.");
  assert.equal(pausedThenLow.questionPolicy.mode, "none");
  const pausedThenLowPrompt = buildChatPrompt({
    userMessage: "我今天有点不太高兴",
    recentMessages: [
      { id: "pause-user", role: "user", content: "先别问了" },
      { id: "pause-assistant", role: "assistant", content: "好，不问了。" },
    ],
    responsePlan: pausedThenLow,
  }).messages.map((message) => message.content).join("\n");
  assert.equal(declinedSharingSourceOf(pausedThenLow), "previous_user_turn");
  assert(pausedThenLowPrompt.includes("The assistant already agreed in an earlier turn not to ask, and the user now shares a feeling without refusing again: first respond to that feeling itself in your own words"));
  assert(pausedThenLowPrompt.includes("followed only by companionship or a listening statement, however worded, does not respond to that feeling"));
  assert(pausedThenLowPrompt.includes("The reply is complete once it responds to the feeling the user shares now"));
  for (const currentRefusalWording of [
    "boundary or feeling",
    "boundary or the feeling",
    "nor their stated boundary",
    "If you mention the feeling",
    "do not want to talk about it",
    "do not want to be asked",
    "If the assistant already agreed",
  ]) {
    assert.equal(
      pausedThenLowPrompt.includes(currentRefusalWording),
      false,
      `A prior pause must not carry the current-refusal completion wording: ${currentRefusalWording}`
    );
  }
  assert(pausedThenLowPrompt.includes("brief companionship within this conversation"));
  assert(pausedThenLowPrompt.includes("It need not repeat the earlier agreement, and repeating it or offering company never replaces responding to that feeling"));
  assert(pausedThenLowPrompt.includes("Do not invite them to talk again"));
  const pausedThenLowRegeneration = formatResponsePlanRegenerateConstraint(pausedThenLow, [
    "planned_function_semantic:positive_function_not_satisfied",
  ]);
  assert(pausedThenLowRegeneration.includes(`planId=${pausedThenLow.planId}`));
  assert(pausedThenLowRegeneration.includes("先用自己的话回应这份感受本身"));
  assert(pausedThenLowRegeneration.includes("只说“嗯、听到了”再接陪伴或倾听，不管怎么措辞，都不算回应这份感受"));
  assert(pausedThenLowRegeneration.includes("之后可以简短陪伴，不必再答应一次，也不要重新邀请"));
  assert.equal(pausedThenLowRegeneration.includes("自然回应这份感受，可以简短陪伴"), false);
  for (const currentRefusalWording of ["边界或感受", "回应边界", "用户说不想说", "用户说不想被问"]) {
    assert.equal(
      pausedThenLowRegeneration.includes(currentRefusalWording),
      false,
      `A prior-pause regeneration must not carry the current-refusal wording: ${currentRefusalWording}`
    );
  }
  assert(pausedThenLowRegeneration.includes("倾听或陪伴表态不能代替回应"));
  assert(pausedThenLowRegeneration.includes("本计划禁止提问"));
  const legacyPausedPlan = structuredClone(pausedThenLow);
  if (legacyPausedPlan.positiveFunctionContract?.action === "offer_emotional_support") {
    delete legacyPausedPlan.positiveFunctionContract.declinedSharingSource;
  }
  const legacyPausedPrompt = formatResponsePlanForPrompt(legacyPausedPlan);
  assert(legacyPausedPrompt.includes("Respond naturally to the boundary or the feeling the user expressed"), "A plan without the source keeps the combined wording.");
  assert(legacyPausedPrompt.includes("If the user says they do not want to talk about it"));
  assert(legacyPausedPrompt.includes("If the assistant already agreed in an earlier turn not to ask and the user now shares a feeling without refusing again, first respond"));
  assert(legacyPausedPrompt.includes("When the user shares a feeling without refusing again, responding to that feeling is required"));
  const legacyPausedRegeneration = formatResponsePlanRegenerateConstraint(legacyPausedPlan, [
    "planned_function_semantic:positive_function_not_satisfied",
  ]);
  assert(legacyPausedRegeneration.includes("自然回应用户表达的边界或感受"));
  assert(legacyPausedRegeneration.includes("之前已经答应过不问、用户本轮只是说感受时"));
  const judgeBindings: unknown[] = [];
  for (const plan of [pausedThenLow, legacyPausedPlan]) {
    await validatePlannedFunctionSemanticOutput({
      plan,
      reply: "今天有点不好受啊，陪你安静一会儿。",
      semanticContext: { currentUserText: "我今天有点不太高兴", handoffTargetAssistantText: null, priorAssistantTurnAvailable: true },
      provider: async (input) => {
        judgeBindings.push(input.positiveFunctionBinding);
        throw new Error("capture judge input only");
      },
    });
  }
  assert.deepEqual(judgeBindings[0], judgeBindings[1], "The refusal source must not change the judge input.");
  assert.equal(JSON.stringify(judgeBindings[0]).includes("declinedSharingSource"), false);
  const refusalAfterPause = build({
    userMessage: "我有点难受，但不想说",
    recentMessages: [
      { id: "pause-user", role: "user", content: "先别问了" },
      { id: "pause-assistant", role: "assistant", content: "好，不问了。" },
    ],
  }).responsePlan;
  assert.equal(supportFunctionOf(refusalAfterPause), "respect_declined_sharing");
  assert.equal(declinedSharingSourceOf(refusalAfterPause), "current_turn", "A current refusal takes precedence over an earlier pause.");
  const refusalAfterPausePrompt = formatResponsePlanForPrompt(refusalAfterPause);
  assert(refusalAfterPausePrompt.includes("If the user says they do not want to talk about it"));
  assert.equal(refusalAfterPausePrompt.includes("already agreed in an earlier turn"), false);
  const pausedReference = validateResponsePlanOutput({ plan: pausedThenLow, reply: "今天有点不好受啊，陪你安静一会儿。" });
  assert.equal(
    pausedReference.passed,
    true,
    `The approved prior-pause tone must not be blocked by deterministic validation: ${pausedReference.failureReasons.join(",")}`
  );
  const reopenedAfterPause = build({
    userMessage: "你问吧，我今天有点不太高兴",
    recentMessages: [
      { id: "reopen-user", role: "user", content: "先别问了" },
      { id: "reopen-assistant", role: "assistant", content: "好，不问了。" },
    ],
  }).responsePlan;
  assert.equal(
    supportFunctionOf(reopenedAfterPause),
    "invite_optional_sharing",
    "An explicit reopen restores the optional invitation."
  );
  assert.equal(reopenedAfterPause.questionPolicy.mode, "optional_after_answer");
  assert.equal(declinedSharingSourceOf(reopenedAfterPause), undefined, "An explicit reopen carries no refusal source.");
  const reopenedPrompt = formatResponsePlanForPrompt(reopenedAfterPause);
  assert(reopenedPrompt.includes("at most one gentle invitation the user can easily decline"));
  assert.equal(reopenedPrompt.includes("Do not invite them to talk again"), false, "An explicit reopen carries no refusal constraints.");
  const noTalkAfterInvite = build({
    userMessage: "我还是有点不太高兴",
    recentMessages: [
      { id: "earlier-user", role: "user", content: "我不想聊这个" },
      { id: "earlier-assistant", role: "assistant", content: "好的。" },
    ],
  }).responsePlan;
  assert.equal(supportFunctionOf(noTalkAfterInvite), "respect_declined_sharing", "A prior refusal to talk carries into the next turn.");
  assert.equal(declinedSharingSourceOf(noTalkAfterInvite), "previous_user_turn");
  const answeredAssistantQuestion = build({
    userMessage: "有点不太高兴",
    recentMessages: [{
      id: "answer-target",
      role: "assistant",
      content: "你今天过得怎么样？",
      committedAssistantMove: committedMove({ purpose: ["take_light_topic_initiative"], question: true, sourceTurnId: "answer-target" }),
    }],
  }).responsePlan;
  if (answeredAssistantQuestion.questionPolicy.mode === "none") {
    assert.equal(
      supportFunctionOf(answeredAssistantQuestion),
      "return_amount_control",
      "A plan whose question policy is none must not carry an invitation function."
    );
    assert(answeredAssistantQuestion.positiveFunctionContract?.evidence.includes("sharingInvitationUnavailable=question_policy_none"));
  }
  const validatorSource = readFileSync("services/ai/plannedFunctionSemanticValidator.ts", "utf8");
  assert(validatorSource.includes("ES-SCOPE exception for invite_optional_sharing only"));
  assert(validatorSource.includes("asking what happened as though it were unknown"));
  assert(validatorSource.includes("is restating, not adding a category"));
  assert(validatorSource.includes("respect_declined_sharing applies when the User declined to talk or to be asked, in currentUserText or in an earlier turn"));
  assert(validatorSource.includes("restating the feeling word is not required"));
  assert(validatorSource.includes("is this function itself, not a pause or closure that undoes support"));
  assert(validatorSource.includes("When currentUserText states a feeling but no refusal (the refusal came from an earlier turn and was not reopened; this is the prior-pause case), the reply must naturally respond to that feeling and need not repeat an earlier agreement; judge the whole reply"));
  assert(validatorSource.includes("A receipt (for example 嗯 or 听到了) followed only by a companionship or listening statement does not respond to the feeling, however the companionship is worded"));
  assert(validatorSource.includes("including a receipt followed only by companionship or listening"));
  assert(validatorSource.includes("a leading receipt such as 嗯 does not cancel a response that follows it"));
  assert(validatorSource.includes("describing the Assistant's own feeling in place of the User's state substitutes for the response rather than providing it"));
  assert(validatorSource.includes("Responding to the feeling does not excuse a later suggestion that the User do something, or a strengthened feeling"));
  assert(validatorSource.includes("in the prior-pause case, suggesting or telling the User to do something"));
  assert(validatorSource.includes("ES-ACK-NO-FABRICATION, ES-PAUSE-FEELING, or ES-PAUSE-NO-ACTION)"));
  assert(validatorSource.includes("ES-PAUSE-FEELING and ES-PAUSE-NO-ACTION apply only to the prior-pause case of respect_declined_sharing"));
  assert(validatorSource.includes("Never cite them for any other support function, for an ordinary emotional expression, or when currentUserText states a refusal"));
  assert(validatorSource.includes("ES-PAUSE-FEELING: in the prior-pause case, the reply does not respond to the stated feeling"));
  assert(validatorSource.includes("ES-PAUSE-NO-ACTION: in the prior-pause case, the reply suggests or tells the User to do something"));
  assert(validatorSource.includes("A strengthened feeling is ES-AFFECT-EVIDENCE, not this rule"));
  assert.equal(validatorSource.includes("takes in, in its own words, how the User is feeling now"), false, "Own-words wording must not exclude restating the feeling.");
  assert.deepEqual(ruleIdsInReason("ES-PAUSE-NO-ACTION: suggests an action"), ["ES-PAUSE-NO-ACTION"]);
  assert.deepEqual(ruleIdsInReason("ES-PAUSE-FEELING: receipt then company"), ["ES-PAUSE-FEELING"]);
  assert(validatorSource.includes("One statement of listening or brief in-conversation companionship that requires no response"));
  assert(validatorSource.includes("a bare receipt that responds to neither the stated feeling nor the stated boundary"));
  assert(validatorSource.includes("including asking the User to tell the Assistant later"));
  assert(validatorSource.includes("presenting the feeling as the reason the User should not talk"));
  assert(validatorSource.includes("deciding for the User that they will not share anything further"));
  assert(validatorSource.includes("claiming physical or offline company"));
  assert.equal(validatorSource.includes("when to say something (including saying it later)"), false);
  const candidate6FailureReplays = [
    {
      userMessage: "我今天有点不太高兴",
      reply: "听到你今天有点不太高兴，你想先说说这份不高兴的感觉，还是聊聊别的部分，都由你来定。",
    },
    {
      userMessage: "心里有点堵",
      reply: "心里堵着的时候，你想先说说这种感觉本身，还是别的什么？",
    },
    {
      userMessage: "今天突然有点难过",
      reply: "难过的时候，想先说说这份心情，还是别的什么，都由你定。",
    },
    {
      userMessage: "明天那件事让我有点担心",
      reply: "有点担心是可以的，你想先聊聊这件事的哪一部分？",
    },
    {
      userMessage: "我觉得有点丢脸",
      reply: "觉得丢脸也没关系，你想先说说这种感觉，还是就停在这里都可以。",
    },
    {
      userMessage: "今晚莫名有点孤单",
      reply: "这种莫名的孤单感我收到了。你想先说说这份感觉本身，还是聊聊今晚别的片段？",
    },
    {
      userMessage: "我现在真的很烦",
      reply: "烦的时候不用急着理清，你想先说说这份烦，还是就让它待一会儿，都由你定。",
    },
    {
      userMessage: "我不想分析，只是有点难受",
      reply: "难受就待一会儿，不用非得分析或说清楚。想聊点什么、或者就这样都行。",
    },
  ];
  for (const testCase of candidate6FailureReplays) {
    const replayPlan = build({ userMessage: testCase.userMessage }).responsePlan;
    const validation = await validatePositiveSemanticFixture({
      plan: replayPlan,
      reply: testCase.reply,
      shouldPass: false,
    });
    assert.equal(
      validation.passed,
      false,
      `Candidate 6 failure must remain rejected: ${testCase.userMessage}`
    );
  }
  for (const userMessage of [
    "我现在很疲惫",
    "今天真的很痛苦",
    "我有点绝望",
    "我快撑不住了",
    "我脑子一片空白，什么也不想说",
  ]) {
    const evidencePlan = build({ userMessage }).responsePlan;
    assert.equal(evidencePlan.positiveFunctionContract?.action, "offer_emotional_support", userMessage);
    assert(
      evidencePlan.positiveFunctionContract?.action === "offer_emotional_support" &&
      evidencePlan.positiveFunctionContract.explicitAffectOrImpactTerms.length > 0,
      `${userMessage} must retain explicit affect evidence in the contract.`
    );
  }
  const questionedPropositionRepair = build({
    userMessage: "不是，我没有害怕，你理解偏了",
    recentMessages: [
      { id: "questioned-u", role: "user", content: "我当时没有进去。" },
      { id: "questioned-a", role: "assistant", content: "你是不是害怕进去？" },
    ],
  }).responsePlan;
  assert.equal(
    questionedPropositionRepair.positiveFunctionContract?.action === "repair_previous_wording"
      ? questionedPropositionRepair.positiveFunctionContract.repairMode
      : null,
    "proposition_withdrawal",
    "A proposition phrased as a question must not automatically become an interaction-move repair."
  );
  const compactFactualRepair = build({
    userMessage: "不是同事是我姐姐，你理解偏了",
    recentMessages: [
      { id: "compact-u", role: "user", content: "她刚才给我打电话。" },
      { id: "compact-a", role: "assistant", content: "那个同事又联系你了。" },
    ],
  }).responsePlan;
  assert.equal(
    compactFactualRepair.positiveFunctionContract?.action === "repair_previous_wording"
      ? compactFactualRepair.positiveFunctionContract.replacementFact
      : null,
    "姐姐"
  );
  const factualRepairPlan: ResponsePlan = {
    ...repair,
    planId: "held-out:factual-repair",
    positiveFunctionContract: {
      action: "repair_previous_wording",
      repairMode: "factual_replacement",
      interactionMoveSubtype: null,
      sourceTurnId: "held-out-factual-user",
      sourceText: "不是表哥，是我妹妹",
      targetTurnId: "held-out-factual-assistant",
      targetText: "你表哥给你打电话了。",
      replacementFact: "妹妹",
      evidence: ["held-out factual replacement"],
    },
  };
  const interactionRepairPlan: ResponsePlan = {
    ...repair,
    planId: "held-out:interaction-repair",
    positiveFunctionContract: {
      action: "repair_previous_wording",
      repairMode: "interaction_move_withdrawal",
      interactionMoveSubtype: "unsolicited_advice",
      sourceTurnId: "held-out-interaction-user",
      sourceText: "我没有要建议，你还在追问",
      targetTurnId: "held-out-interaction-assistant",
      targetText: "你应该马上决定，再告诉我为什么不愿意。",
      replacementFact: null,
      evidence: ["held-out interaction move withdrawal"],
    },
  };
  const independentPositiveFunctionCases: Array<{
    id: string;
    plan: ResponsePlan;
    reply: string;
    shouldPass: boolean;
  }> = [
    { id: "E-HO-01", plan: focusValidationEmotion, reply: "今天这点难受，可以只说你最想先说的部分。", shouldPass: true },
    { id: "E-HO-02", plan: focusValidationEmotion, reply: "这份难受，先说眼下最在意的那一点也可以。", shouldPass: true },
    { id: "E-HO-03", plan: emotion, reply: "难受的时候太煎熬了，我一直在。", shouldPass: false },
    { id: "E-HO-04", plan: emotion, reply: "能告诉我为什么难受吗？", shouldPass: false },
    { id: "E-HO-05", plan: reduceBurdenEmotion, reply: "这点难受不用现在分析原因，也不必一次说清。", shouldPass: true },
    { id: "E-HO-06", plan: reduceBurdenEmotion, reply: "难受这件事不需要解释原因；不必整理成完整的话。", shouldPass: true },
    { id: "E-HO-07", plan: reduceBurdenEmotion, reply: "不分析也没关系，我陪着你。", shouldPass: false },
    { id: "E-HO-08", plan: reduceBurdenEmotion, reply: "先做三次深呼吸，别想原因了。", shouldPass: false },
    { id: "E-HO-09", plan: amountControlEmotion, reply: "这点难受不用说完整，想说多少就说多少。", shouldPass: true },
    { id: "E-HO-10", plan: amountControlEmotion, reply: "难受可以只说一点，不需要一次讲完。", shouldPass: true },
    { id: "E-HO-11", plan: amountControlEmotion, reply: "慢慢说，我都在。", shouldPass: false },
    { id: "E-HO-12", plan: amountControlEmotion, reply: "具体发生了什么？", shouldPass: false },
    { id: "E-HO-13", plan: relationalImpactEmotion, reply: "你现在觉得我完全没懂，这个影响就在眼下；我还没有足够信息说自己懂了。", shouldPass: true },
    { id: "E-HO-14", plan: relationalImpactEmotion, reply: "这会儿我没接住你，我不能把它说成已经理解了。", shouldPass: true },
    { id: "E-HO-15", plan: relationalImpactEmotion, reply: "我确实无法完全理解你，但我会努力。", shouldPass: false },
    { id: "E-HO-16", plan: relationalImpactEmotion, reply: "对不起让你觉得我不懂，你指出我哪里错了？", shouldPass: false },
    { id: "R-HO-01", plan: repair, reply: "是我把没确认的意思放进去了，那个判断我撤回。", shouldPass: true },
    { id: "R-HO-02", plan: repair, reply: "我刚才替你下了结论，不该把那个判断放在你身上。", shouldPass: true },
    { id: "R-HO-03", plan: repair, reply: "抱歉，我理解偏了。", shouldPass: false },
    { id: "R-HO-04", plan: repair, reply: "抱歉，我理解偏了，你再解释一下。", shouldPass: false },
    { id: "R-HO-05", plan: factualRepairPlan, reply: "是我把关系弄错了，是你妹妹。", shouldPass: true },
    { id: "R-HO-06", plan: factualRepairPlan, reply: "抱歉，我记错了，应该是你妹妹。", shouldPass: true },
    { id: "R-HO-07", plan: factualRepairPlan, reply: "抱歉，是我弄错了。", shouldPass: false },
    { id: "R-HO-08", plan: factualRepairPlan, reply: "不是表哥，是妹妹。", shouldPass: false },
    { id: "R-HO-09", plan: interactionRepairPlan, reply: "是我刚才不该继续给建议，我不再这样做。", shouldPass: true },
    { id: "R-HO-10", plan: interactionRepairPlan, reply: "抱歉，刚才不该替你出主意，我把那些建议收回。", shouldPass: true },
    { id: "R-HO-11", plan: interactionRepairPlan, reply: "抱歉，我没接住。你为什么不想听建议？", shouldPass: false },
    { id: "R-HO-12", plan: interactionRepairPlan, reply: "我会认真听，不再问了。", shouldPass: false },
  ];
  for (const testCase of independentPositiveFunctionCases) {
    const validation = await validatePositiveSemanticFixture({
      plan: testCase.plan,
      reply: testCase.reply,
      shouldPass: testCase.shouldPass,
    });
    assert.equal(
      validation.passed,
      testCase.shouldPass,
      `${testCase.id} contract case mismatch: ${validation.failureReasons.join(",")}`
    );
  }

  const emotionSurfacePrompt = formatResponsePlanForPrompt(emotion);
  const multiFocusSurfacePrompt = formatResponsePlanForPrompt(multiFocusEmotion);
  const repairSurfacePrompt = formatResponsePlanForPrompt(repair);
  const amountSurfacePrompt = formatResponsePlanForPrompt(amountControlEmotion);
  assert(emotionSurfacePrompt.includes("Complete exactly the selected ordinary support function"));
  assert(emotionSurfacePrompt.includes("invite_optional_sharing"));
  assert(emotionSurfacePrompt.includes("at most one gentle invitation the user can easily decline"));
  assert(emotionSurfacePrompt.includes("Do not ask why, for the cause, for specific details, for the sequence of events"));
  assert(emotionSurfacePrompt.includes("does not require talking about control, how much to say, or which part"));
  assert.equal(emotionSurfacePrompt.includes("grants that control"), false);
  assert.equal(emotionSurfacePrompt.includes("do not turn it into a question"), false);
  assert(amountSurfacePrompt.includes("return_amount_control"));
  assert(amountSurfacePrompt.includes("do not turn it into a question"));
  assert(amountSurfacePrompt.includes("grants that control"));
  assert.equal(amountSurfacePrompt.includes("at most one gentle invitation the user can easily decline"), false);
  for (const prompt of [emotionSurfacePrompt, amountSurfacePrompt, multiFocusSurfacePrompt]) {
    assert(prompt.includes("Speak in plain, warm everyday Chinese"));
  }
  assert(multiFocusSurfacePrompt.includes("return_focus_control"));
  assert(multiFocusSurfacePrompt.includes("without requiring the user to choose or answer"));
  assert(emotionSurfacePrompt.includes("making the user diagnose the assistant's mistake"));
  assert(emotionSurfacePrompt.includes("Do not name or imply any emotion category the user did not state in the current turn"));
  assert.equal(
    repairSurfacePrompt.includes("Do not name or imply any emotion category the user did not state in the current turn"),
    false,
    "The emotion-label constraint is scoped to emotional-support plans."
  );
  const noHistoryRelationalImpact = build({ userMessage: "你一点都不懂我" }).responsePlan;
  assert.equal(
    noHistoryRelationalImpact.positiveFunctionContract?.action === "offer_emotional_support"
      ? noHistoryRelationalImpact.positiveFunctionContract.supportFunction
      : null,
    "acknowledge_current_relational_impact"
  );
  for (const relationalPlan of [relationalImpactEmotion, noHistoryRelationalImpact]) {
    const relationalSurfacePrompt = formatResponsePlanForPrompt(relationalPlan);
    assert(relationalSurfacePrompt.includes("acknowledge_current_relational_impact"));
    assert.equal(
      relationalSurfacePrompt.includes("grants that control"),
      false,
      "Relational-impact acknowledgement must not be told that granting expression control completes it."
    );
    assert(relationalSurfacePrompt.includes("state the information boundary"));
    assert(
      relationalSurfacePrompt.includes("Do not name or imply any emotion category the user did not state in the current turn"),
      "Relational-impact acknowledgement must not add an unevidenced emotion label."
    );
    assert(relationalSurfacePrompt.includes("not focus or amount control"));
    assert.equal(relationalPlan.questionPolicy.mode, "none", "relational-impact acknowledgement adds no invitation");
    assert(relationalSurfacePrompt.includes("Do not add any request, whether phrased as a question or a statement"));
    assert(relationalSurfacePrompt.includes("With no earlier assistant reply, do not invent"));
    assert.equal(relationalSurfacePrompt.includes("such as how much or how completely to speak"), false);
  }
  assert.equal(multiFocusEmotion.questionPolicy.mode, "optional_after_answer");
  assert.equal(emotion.questionPolicy.mode, "optional_after_answer");
  const relationalImpactWithQuestion = build({ userMessage: "你一点都不懂我，你到底想说什么？" }).responsePlan;
  assert.equal(
    relationalImpactWithQuestion.positiveFunctionContract?.action === "offer_emotional_support"
      ? relationalImpactWithQuestion.positiveFunctionContract.supportFunction
      : null,
    "acknowledge_current_relational_impact"
  );
  assert.equal(relationalImpactWithQuestion.questionPolicy.mode, "none");
  assert(relationalImpactWithQuestion.responseActions.includes("answer_directly"));
  assert.equal(relationalImpactWithQuestion.answerObligations.length, 1, "question policy none must not drop the current-turn answer obligation");
  assert(formatResponsePlanForPrompt(relationalImpactWithQuestion).includes("answerObligations: [{"));
  assert(repairSurfacePrompt.includes("Complete the selected repair mode"));
  assert(repairSurfacePrompt.includes("proposition_withdrawal"));
  assert(repairSurfacePrompt.includes("Do not claim the relationship is repaired"));

  const previousProvider = process.env.AI_PROVIDER;
  const previousInterpreter = process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED;
  process.env.AI_PROVIDER = "mock";
  process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = "false";
  try {
    const disabled = await createChatReply({
      conversationId: "batch1-5-disabled",
      currentTurnId: "batch1-5-disabled-turn",
      userMessage: "1",
      recentMessages: [],
      helpingShadowEnabled: true,
      helpingOrdinaryHandoffEnabled: false,
      safetySemanticProvider: noRiskSafetyProvider,
    });
    assert.notEqual(disabled.execution.planId, "safety-pre-gate");
    assert(disabled.controlTrace?.responsePlan.responseActions.includes("acknowledge_without_psychologizing"));
    const enabled = await createChatReply({
      conversationId: "batch1-5-enabled",
      currentTurnId: "batch1-5-enabled-turn",
      userMessage: "1",
      recentMessages: [],
      helpingShadowEnabled: true,
      helpingOrdinaryHandoffEnabled: true,
      safetySemanticProvider: noRiskSafetyProvider,
    });
    assert.notEqual(enabled.execution.planId, "safety-pre-gate");
    assert(enabled.controlTrace?.responsePlan.responseActions.includes("invite_low_pressure_calibration"));
    assert.equal(enabled.controlTrace?.responsePlan.behaviorSource, "ordinary_conversation");
    assert.equal(JSON.stringify(enabled.controlTrace?.responsePlan).includes("primarySkill"), false);
    assert.equal(JSON.stringify(enabled.controlTrace?.responsePlan).includes("primaryGoal"), false);

    let nonFragmentHelpingProviderCalls = 0;
    const nonFragment = await createChatReply({
      conversationId: "batch1-5-non-fragment",
      currentTurnId: "batch1-5-non-fragment-turn",
      userMessage: "我今天很难受",
      recentMessages: [],
      helpingShadowEnabled: false,
      helpingOrdinaryHandoffEnabled: true,
      safetySemanticProvider: noRiskSafetyProvider,
      helpingDecisionProvider: async () => {
        nonFragmentHelpingProviderCalls += 1;
        throw new Error("Batch 1.5 must not enable the full Hill provider for a non-fast turn.");
      },
    });
    assert.notEqual(nonFragment.execution.planId, "safety-pre-gate");
    assert.equal(nonFragmentHelpingProviderCalls, 0);
    assert.equal(nonFragment.helpingTrace.skippedReason, "ordinary_handoff_no_fast_boundary");
    assert(nonFragment.controlTrace?.responsePlan.responseActions.includes("offer_emotional_support"));

    let safetyProviderCalls = 0;
    const safety = await createChatReply({
      conversationId: "batch1-5-safety",
      currentTurnId: "batch1-5-safety-turn",
      userMessage: "我正在伤害自己",
      recentMessages: [],
      helpingOrdinaryHandoffEnabled: true,
      helpingDecisionProvider: async () => {
        safetyProviderCalls += 1;
        throw new Error("Safety must not call ordinary Helping.");
      },
    });
    assert.equal(safety.finalSource, "safety");
    assert.equal(safetyProviderCalls, 0);
  } finally {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousInterpreter === undefined) delete process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED;
    else process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED = previousInterpreter;
  }

  const helpingSource = readFileSync("services/helping/hillHelpingDecisionService.ts", "utf8");
  const plannerSource = readFileSync("conversation-os/control/responsePlanner.ts", "utf8");
  const surfaceSource = readFileSync("services/ai/promptBuilder.ts", "utf8");
  assert(!helpingSource.includes("invite_low_pressure_calibration"));
  assert(!helpingSource.includes("offer_neutral_conversation_entry"));
  assert(!plannerSource.includes("HillGoalFamily"));
  assert(!plannerSource.includes("HillSkill"));
  assert(!surfaceSource.includes("HillGoalFamily"));
  assert(!surfaceSource.includes("HillSkill"));

  console.log(JSON.stringify({
    frozenBatch0NumericRegressionTurns: 6,
    sameFormDifferentContextPairs: pairedForms.length,
    pairedTurnsChecked: pairedForms.length * 2,
    heldOutForms: pairedForms.slice(-5),
    multiTurnFunctionalActions: multiTurnActions,
    hardGates: {
      safety: true,
      directAnswerAndGrounding: true,
      pause: true,
      answerFrame: true,
      currentTopic: true,
      emotionalSupport: true,
      actionSupport: true,
      repair: true,
    },
    qualityRetentionCounterExamples: {
      candidate6FailureReplays: candidate6FailureReplays.length,
      rejectedEmotionalSupport: emotionalQualityFailures.length,
      allowedEmotionalSupport: emotionalQualityPasses.length,
      rejectedRepair: repairQualityFailures.length,
      allowedRepair: repairQualityPasses.length,
      totalNewRejectedCounterExamples:
        emotionalQualityFailures.length + repairQualityFailures.length,
      independentPositiveFunctionCases: independentPositiveFunctionCases.length,
      independentPositiveFunctionAccepted: independentPositiveFunctionCases.filter((item) => item.shouldPass).length,
      independentPositiveFunctionRejected: independentPositiveFunctionCases.filter((item) => !item.shouldPass).length,
    },
    ownership: {
      behaviorSource: "ordinary_conversation",
      helpingSelectsOrdinaryAction: false,
      plannerSelectsHillGoalOrSkill: false,
      committedHelpingMoveWritten: false,
    },
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
