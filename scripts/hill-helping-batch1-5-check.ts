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
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";

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
    "return_amount_control",
    "A single affect span must not default to focus control."
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
    "return_amount_control",
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
  assert.deepEqual(multiTurnActions, [
    "invite_low_pressure_calibration",
    "offer_neutral_conversation_entry",
    "invite_low_pressure_calibration",
  ]);
  assert.notEqual(multiTurnActions[0], multiTurnActions[1]);
  assert.notEqual(multiTurnActions[1], multiTurnActions[2]);

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
      "return_amount_control",
      `${userMessage} must not manufacture a focus-selection task.`
    );
  }
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
  assert(emotionSurfacePrompt.includes("Complete exactly the selected ordinary support function"));
  assert(emotionSurfacePrompt.includes("return_amount_control"));
  assert(emotionSurfacePrompt.includes("do not turn it into a question"));
  assert(multiFocusSurfacePrompt.includes("return_focus_control"));
  assert(multiFocusSurfacePrompt.includes("without requiring the user to choose or answer"));
  assert(emotionSurfacePrompt.includes("making the user diagnose the assistant's mistake"));
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
