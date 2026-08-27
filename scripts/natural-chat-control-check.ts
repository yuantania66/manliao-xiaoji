import assert from "node:assert/strict";

import { buildProactiveGreetingAssistantMoveEnvelope } from "../conversation-os";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type DialogueAct,
  type RelationalInterpretationCandidate,
  type ResponseRelationKind,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import {
  classifyResponseValidationReasons,
  enforceResponsePlan,
  formatResponsePlanRegenerateConstraint,
  isNeutralConversationLightChoice,
  validateResponsePlanOutput,
} from "../services/ai/responsePlanValidator";
import { isCrisisInput } from "../services/ai/chatSafety";
import { buildInterpretationMessages } from "../services/ai/turnInterpretationAdapter";
import type { AiConversationMessage } from "../services/ai/types";
import { PROACTIVE_GREETING_PROMPT_VERSION } from "../lib/proactive-greeting";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";

const build = ({
  userMessage,
  recentMessages,
  modelPrimary,
  modelConfidence = 0.95,
  modelSecondary = [],
  modelCandidates,
}: {
  userMessage: string;
  recentMessages: AiConversationMessage[];
  modelPrimary?: DialogueAct;
  modelConfidence?: number;
  modelSecondary?: DialogueAct[];
  modelCandidates?: RelationalInterpretationCandidate[];
}) => {
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: "natural-chat-control-check",
    userMessage,
    recentMessages,
    conversationState,
  });
  const deterministic = interpretTurnDeterministically(context);
  const modelRelationByAct: Partial<Record<DialogueAct, ResponseRelationKind>> = {
    answer: "answers_previous_move",
    correct_assistant: "repairs_previous_move",
    share: "continues_active_thread",
    yield_initiative: "yields_initiative",
    request_pause: "requests_pause",
    end_conversation: "requests_pause",
    seek_emotional_support: "shares_distress",
    request_action_support: "requests_action_support",
  };
  const modelRelation = modelPrimary ? modelRelationByAct[modelPrimary] : undefined;
  const lastAssistantTurn = [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant");
  const suppliedModelCandidates = modelCandidates ?? (modelRelation
    ? [{
        relation: modelRelation,
        confidence: modelConfidence,
        ...(lastAssistantTurn?.id ? { targetTurnId: lastAssistantTurn.id } : {}),
        evidence: ["test model relational interpretation"],
      }]
    : []);
  const interpretation = modelPrimary || suppliedModelCandidates.length > 0
    ? mergeModelInterpretation(deterministic, {
        primaryDialogueAct: modelPrimary,
        secondarySignals: modelSecondary,
        ...(suppliedModelCandidates.length > 0
          ? {
              responseRelation: {
                candidates: suppliedModelCandidates,
                ambiguous: false,
              },
            }
          : {}),
        confidence: modelConfidence,
        notes: ["test model interpretation"],
      }, context)
    : deterministic;
  const dialogueState = buildDialogueState(context, interpretation);
  let clinicalCalls = 0;
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => {
      clinicalCalls += 1;
      return null;
    },
  });
  return {
    context,
    deterministic,
    interpretation,
    dialogueState,
    responsePlan,
    clinicalCalls,
  };
};

const initialAssistant: AiConversationMessage = {
  role: "assistant",
  content: "夜深了，有什么想慢慢说的都可以留在这里。",
};
const noTopicAssistant: AiConversationMessage = {
  role: "assistant",
  content: "没关系，不用特意找话题。最近有没有什么小事让你觉得还不错的？",
};
const exampleAssistant: AiConversationMessage = {
  role: "assistant",
  content: "比如喝到一杯温度刚好的茶，或者下班路上刚好看到很美的晚霞。",
};
const correctionAssistant: AiConversationMessage = {
  role: "assistant",
  content: "那也可以是睡到自然醒，或者安静地发会儿呆。不用上班的日子里，有没有哪个瞬间让你觉得挺舒服的？",
};

const turn1 = build({
  userMessage: "我想不到说什么耶",
  recentMessages: [initialAssistant],
});
assert.equal(turn1.interpretation.primaryDialogueAct, "yield_initiative");
assert(turn1.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert.equal(turn1.responsePlan.ordinaryPosture?.mode, "accompany");
assert.equal(turn1.responsePlan.questionPolicy.mode, "one_low_pressure_question");
assert(turn1.responsePlan.tone.includes("neutral-friendly without reassurance"));
assert.equal(turn1.responsePlan.lengthGuidance, "Usually one or two concise sentences.");
assert.equal(turn1.clinicalCalls, 0);

const turn2History: AiConversationMessage[] = [
  initialAssistant,
  { role: "user", content: "我想不到说什么耶" },
  noTopicAssistant,
];
const turn2 = build({
  userMessage: "比如呢",
  recentMessages: turn2History,
});
assert.equal(turn2.deterministic.primaryDialogueAct, "ask_information");
assert(turn2.responsePlan.responseActions.includes("answer_directly"));
assert.equal(turn2.responsePlan.ordinaryPosture, null);
assert.equal(turn2.responsePlan.questionPolicy.mode, "none");

const turn3History: AiConversationMessage[] = [
  ...turn2History,
  { role: "user", content: "比如呢" },
  exampleAssistant,
];
const turn3 = build({
  userMessage: "我最近没上班",
  recentMessages: turn3History,
  modelPrimary: "correct_assistant",
});
assert.equal(turn3.interpretation.primaryDialogueAct, "correct_assistant");
assert.equal(turn3.dialogueState.repairState.status, "active");
assert(turn3.responsePlan.responseActions.includes("repair_previous_wording"));
assert.equal(turn3.responsePlan.ordinaryPosture, null);
assert.equal(turn3.responsePlan.questionPolicy.mode, "none");
assert(turn3.dialogueState.confirmedFacts.includes("Current user message: 我最近没上班"));

const turn4History: AiConversationMessage[] = [
  ...turn3History,
  { role: "user", content: "我最近没上班" },
  correctionAssistant,
];
const turn4 = build({
  userMessage: "睡到自然醒吧",
  recentMessages: turn4History,
  modelPrimary: "answer",
});
assert.equal(turn4.interpretation.primaryDialogueAct, "answer");
assert(turn4.context.interaction.evidence.some((item) => item.includes("repeated questions")));
assert.equal(turn4.responsePlan.questionPolicy.mode, "none");
assert.equal(turn4.responsePlan.ordinaryPosture?.mode, "accompany");
assert(!turn4.responsePlan.responseActions.includes("repair_previous_wording"));
assert.equal(
  turn4.responsePlan.lengthGuidance,
  "Usually one or two concise sentences."
);

const prompt = buildChatPrompt({
  userMessage: "睡到自然醒吧",
  recentMessages: turn4History,
  responsePlan: turn4.responsePlan,
});
const productInstruction = prompt.messages[0]?.content ?? "";
const planInstruction = prompt.messages[1]?.content ?? "";
assert(productInstruction.includes("ResponsePlan 是本轮唯一的非安全回复决策"));
assert(productInstruction.includes("不得增添计划中没有、且无 relevanceProvenance 的命题"));
assert(productInstruction.includes("hypothesis 或被用户否定的命题不得作为事实表达"));
assert(!productInstruction.includes("温度刚好的茶"));
assert(!productInstruction.includes("晚霞"));
assert(!planInstruction.includes("responseActionSurfaceContract"));
assert(!planInstruction.includes("surfaceFormConstraint"));
assert(!planInstruction.includes("planEvidence"));
assert(planInstruction.includes("relevanceProvenance:"));
assert(planInstruction.includes(`planningDepth: ${turn4.responsePlan.planningDepth}`));
assert(!planInstruction.includes("温度刚好的茶"));
assert(!planInstruction.includes("晚霞"));

const noTopicPrompt = buildChatPrompt({
  userMessage: "我想不到说什么耶",
  recentMessages: [initialAssistant],
  responsePlan: turn1.responsePlan,
});
assert(noTopicPrompt.messages[1]?.content.includes("responseActions: take_light_topic_initiative"));
assert(noTopicPrompt.messages[1]?.content.includes("questionPolicy:"));

const correctionPrompt = buildChatPrompt({
  userMessage: "我最近没上班",
  recentMessages: turn3History,
  responsePlan: turn3.responsePlan,
});
assert(correctionPrompt.messages[1]?.content.includes("responseActions: repair_previous_wording"));

const interpretationInstruction = buildInterpretationMessages(turn4.context)[0]?.content ?? "";
assert(interpretationInstruction.includes("preserve multiple plausible response relations"));
assert(interpretationInstruction.includes("Do not force one primary intent"));
assert(
  interpretationInstruction.includes(
    "Use opens_new_thread only when the current User turn contains concrete content"
  )
);
assert(
  interpretationInstruction.includes(
    "A greeting, phatic acknowledgment, receipt, lack of topic content, or generic willingness to chat is not by itself opens_new_thread."
  )
);
assert(
  interpretationInstruction.includes(
    "Use continues_active_thread only when the current User turn contains concrete content"
  )
);
assert(
  interpretationInstruction.includes(
    "Mere adjacency, reciprocal contact, a receipt, or a generic greeting is not by itself continues_active_thread."
  )
);
assert(
  interpretationInstruction.includes(
    "Use acknowledges_previous_move when the current User turn only acknowledges"
  )
);
assert(
  interpretationInstruction.includes(
    "Preserve multiple candidates only when each distinct semantic reading independently satisfies its own typed preconditions"
  )
);
assert(!interpretationInstruction.includes("regex"));
assert(!interpretationInstruction.includes("keyword"));

const lowConfidenceCorrection = build({
  userMessage: "睡到自然醒吧",
  recentMessages: [{ role: "assistant", content: "有空看看剧也挺合适的。" }],
  modelPrimary: "correct_assistant",
  modelConfidence: 0.9,
  modelSecondary: ["correct_assistant"],
});
assert.equal(lowConfidenceCorrection.interpretation.primaryDialogueAct, "share");
assert(!lowConfidenceCorrection.interpretation.secondarySignals.includes("correct_assistant"));
assert(!lowConfidenceCorrection.responsePlan.responseActions.includes("repair_previous_wording"));

const correctionCounterexamples: Array<[string, string]> = [
  ["你可以问问你同事", "我现在没有同事"],
  ["放学路上也可以看看", "我早就不是学生了"],
  ["回家陪陪你的猫", "我没有养猫"],
  ["开车时听点音乐", "我不会开车"],
  ["周末和伴侣出去走走", "我没有伴侣"],
  ["和室友聊聊也行", "我一个人住"],
  ["上班间隙休息一下", "我最近没上班"],
  ["带孩子出去晒太阳", "我没有孩子"],
  ["去附近公园走走", "我这里没有公园"],
  ["喝杯茶缓一缓", "我不喝茶"],
];
for (const [assistantAssumption, userCorrection] of correctionCounterexamples) {
  const result = build({
    userMessage: userCorrection,
    recentMessages: [{ role: "assistant", content: assistantAssumption }],
    modelPrimary: "correct_assistant",
  });
  assert(result.responsePlan.responseActions.includes("repair_previous_wording"), userCorrection);
  assert.equal(result.responsePlan.questionPolicy.mode, "none", userCorrection);
  assert.equal(result.clinicalCalls, 0, userCorrection);
}

const repeatedQuestionCounterexamples: Array<[string, string, string]> = [
  ["最近在看什么？", "更喜欢哪一类？", "科幻吧"],
  ["今天吃了什么？", "味道怎么样？", "还可以"],
  ["周末去哪儿了？", "那里人多吗？", "没去哪"],
  ["最近睡得好吗？", "几点睡的？", "十二点"],
  ["平时听歌吗？", "最常听谁的？", "随便听听"],
];
for (const [question1, question2, userAnswer] of repeatedQuestionCounterexamples) {
  const result = build({
    userMessage: userAnswer,
    recentMessages: [
      { role: "assistant", content: question1 },
      { role: "user", content: "嗯" },
      { role: "assistant", content: question2 },
    ],
    modelPrimary: "answer",
  });
  assert.equal(result.responsePlan.questionPolicy.mode, "none", userAnswer);
  assert(!result.responsePlan.responseActions.includes("repair_previous_wording"), userAnswer);
}

const ordinaryCounterexamples = [
  "今天吃了面",
  "我在看一部老电影",
  "刚刚收拾完房间",
  "外面有点热",
  "这首歌还挺好听",
];
for (const userMessage of ordinaryCounterexamples) {
  const result = build({
    userMessage,
    recentMessages: [{ role: "assistant", content: "你今天做了什么？" }],
    modelPrimary: "share",
  });
  assert(!result.responsePlan.responseActions.includes("repair_previous_wording"), userMessage);
  assert.equal(result.clinicalCalls, 0, userMessage);
  assert.equal(result.responsePlan.decisionOwner, "conversation_os.response_planner");
}

const screenshotGreeting: AiConversationMessage = {
  role: "assistant",
  content: "随时可以在这儿说点什么，或者只是待一会儿。",
};
const screenshotNoTopicReply: AiConversationMessage = {
  role: "assistant",
  content: "没关系，不想说就不说。最近有碰到什么让你觉得还行的事吗？",
};
const screenshotFestivalReply: AiConversationMessage = {
  role: "assistant",
  content: "音乐节挺热闹的，现场感觉怎么样？",
};
const screenshotNoTopic = build({
  userMessage: "我不知道说什么",
  recentMessages: [screenshotGreeting],
});
const screenshotFestival = build({
  userMessage: "去看了一场音乐节",
  recentMessages: [
    screenshotGreeting,
    { role: "user", content: "我不知道说什么" },
    screenshotNoTopicReply,
  ],
});
const screenshotHyped = build({
  userMessage: "挺嗨的",
  recentMessages: [
    screenshotGreeting,
    { role: "user", content: "我不知道说什么" },
    screenshotNoTopicReply,
    { role: "user", content: "去看了一场音乐节" },
    screenshotFestivalReply,
  ],
});
assert.equal(screenshotNoTopic.responsePlan.questionPolicy.mode, "one_low_pressure_question");
assert.equal(
  screenshotFestival.responsePlan.questionPolicy.mode,
  "none",
  "An answer to the assistant's question must not open a second interview question by default."
);
assert.equal(screenshotHyped.responsePlan.questionPolicy.mode, "none");
for (const [plan, reply, label] of [
  [screenshotNoTopic.responsePlan, screenshotNoTopicReply.content, "topic initiative"],
  [screenshotFestival.responsePlan, screenshotFestivalReply.content, "ordinary interview"],
  [screenshotFestival.responsePlan, "现场感觉怎么样？听起来你去看了音乐节。", "question punctuation"],
  [screenshotHyped.responsePlan, "那挺棒的，现场氛围好确实容易让人投入。", "unsupported evaluation"],
] as const) {
  const validation = validateResponsePlanOutput({ plan, reply });
  assert.equal(validation.passed, false, label);
  assert((validation.hardFailureReasons?.length ?? 0) > 0, label);
  assert.equal(validation.rewriteRequired, false, label);
  assert.equal(validation.advisoryFailureReasons?.length, 0, label);
}
assert.equal(
  validateResponsePlanOutput({
    plan: screenshotFestival.responsePlan,
    reply: "你去看了一场音乐节。",
  }).passed,
  true,
  "A literal acknowledgement of the current user message remains allowed."
);
assert.equal(
  validateResponsePlanOutput({
    plan: screenshotHyped.responsePlan,
    reply: "挺嗨的。",
  }).passed,
  true,
  "An evaluation explicitly supplied by the user remains allowed."
);

const screenshotIdle = build({
  userMessage: "发呆",
  recentMessages: [{
    role: "assistant",
    content: "那平时喜欢做点什么打发时间？",
  }],
  modelPrimary: "answer",
});
assert.equal(screenshotIdle.responsePlan.questionPolicy.mode, "none");
const unsupportedIdleEvaluationCounterexamples = [
  "发呆也挺好。",
  "发呆很好。",
  "发呆还不错。",
  "发呆挺舒服的。",
  "发呆很放松。",
  "发呆挺开心的。",
  "发呆也挺有趣。",
  "发呆挺好玩的。",
  "发呆能让人投入。",
  "偶尔发呆挺好。",
  "有时候发呆很好。",
  "这样发呆不错。",
  "安静发呆很舒服。",
  "一个人发呆很放松。",
  "发会儿呆也挺开心。",
  "原来你觉得发呆有趣。",
  "看来发呆挺好玩。",
  "发呆也是很棒的消遣。",
  "发呆的时间很珍贵。",
  "能发呆挺难得的。",
];
for (const reply of unsupportedIdleEvaluationCounterexamples) {
  const validation = validateResponsePlanOutput({
    plan: screenshotIdle.responsePlan,
    reply,
  });
  assert.equal(validation.passed, false, reply);
  assert.equal(validation.rewriteRequired, false, reply);
  assert((validation.hardFailureReasons?.length ?? 0) > 0, reply);
  const constraint = formatResponsePlanRegenerateConstraint(
    screenshotIdle.responsePlan,
    validation.failureReasons
  );
  assert(constraint.includes("删掉助手自行添加的评价词"), reply);
  assert(constraint.includes("只承接用户明确说出的内容"), reply);
  assert(constraint.includes("不要换一个话题继续采访用户"), reply);
}
assert.equal(unsupportedIdleEvaluationCounterexamples.length, 20);
assert.equal(
  validateResponsePlanOutput({
    plan: screenshotIdle.responsePlan,
    reply: "原来是发呆。",
  }).passed,
  true,
  "A concise acknowledgement without added evaluation remains valid."
);

const completedMove: AiConversationMessage = {
  id: "natural-chat-completed-move",
  role: "assistant",
  content: "已经解释清楚了。",
  status: "saved",
  committedAssistantMove: {
    purpose: ["answer_directly"],
    claims: [],
    assumptions: [],
    questionOrRequest: null,
    expectedUserContribution: "none",
    userBurden: "none",
    sourceTurnId: "natural-chat-prior-user",
    evidence: ["Committed completed move fixture."],
  },
};
const completedMoveAcknowledgement = build({
  userMessage: "好的吧",
  recentMessages: [completedMove],
  modelCandidates: [
    {
      relation: "acknowledges_previous_move",
      confidence: 0.96,
      targetTurnId: completedMove.id,
      evidence: ["The User only acknowledges the completed move."],
    },
    {
      relation: "yields_initiative",
      confidence: 0.88,
      targetTurnId: completedMove.id,
      evidence: ["Lower-confidence initiative hedge."],
    },
  ],
});
assert.equal(completedMoveAcknowledgement.responsePlan.closurePolicy.mode, "allow_idle");
assert.equal(completedMoveAcknowledgement.responsePlan.questionPolicy.mode, "none");
assert(!completedMoveAcknowledgement.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert.equal(validateResponsePlanOutput({
  plan: completedMoveAcknowledgement.responsePlan,
  reply: "嗯，好。",
}).passed, true);

const screenshotPrompt = buildChatPrompt({
  userMessage: "挺嗨的",
  recentMessages: [
    screenshotGreeting,
    { role: "user", content: "我不知道说什么" },
    screenshotNoTopicReply,
    { role: "user", content: "去看了一场音乐节" },
    screenshotFestivalReply,
  ],
  responsePlan: screenshotHyped.responsePlan,
});
const screenshotPlanInstruction = screenshotPrompt.messages[1]?.content ?? "";
assert(screenshotPlanInstruction.includes("relevanceProvenance:"));
assert(screenshotPlanInstruction.includes("surfaceConstraints:"));
assert(screenshotPlanInstruction.includes("Do not add generic causal mechanisms"));

const interviewTopics = [
  "去看了展览",
  "看了场电影",
  "吃了顿火锅",
  "去健身了",
  "周末去郊外了",
  "见了个朋友",
  "玩了会儿游戏",
  "逛了公园",
  "看完一本书",
  "做了顿饭",
];
const shortPositiveAnswers = [
  "挺热闹的",
  "挺开心的",
  "还不错",
  "挺有意思的",
  "气氛很好",
  "人很多",
  "挺放松的",
  "还可以",
  "蛮好玩的",
  "挺尽兴的",
];
for (const [index, userMessage] of interviewTopics.entries()) {
  const result = build({
    userMessage,
    recentMessages: [{ role: "assistant", content: "最近做了什么让你觉得还行的事吗？" }],
    modelPrimary: "answer",
  });
  assert.equal(result.responsePlan.questionPolicy.mode, "none", userMessage);
  assert.equal(
    validateResponsePlanOutput({
      plan: result.responsePlan,
      reply: `${userMessage}听起来挺不错的，现场感觉怎么样？`,
    }).passed,
    false,
    `interview-counterexample-${index + 1}`
  );
}
for (const [index, userMessage] of shortPositiveAnswers.entries()) {
  const result = build({
    userMessage,
    recentMessages: [
      { role: "assistant", content: "最近做了什么？" },
      { role: "user", content: "去参加了一个活动" },
      { role: "assistant", content: "现场怎么样？" },
    ],
    modelPrimary: "answer",
  });
  assert.equal(result.responsePlan.questionPolicy.mode, "none", userMessage);
  assert.equal(
    validateResponsePlanOutput({
      plan: result.responsePlan,
      reply: "那挺好的，这种氛围确实容易让人投入。",
    }).passed,
    false,
    `generic-evaluation-counterexample-${index + 1}`
  );
}

const firstContactText = "你好，我是小慢，一个AI聊天助手。你可以在这里随便聊，也可以和我一起慢慢理清一些事情；不用先想好完整话题，想到什么就从什么开始。";
const firstContactEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "natural-chat-first-contact",
  generationId: "natural-chat-first-contact-generation",
  intent: {
    move: "open_statement",
    requiredFunction: "offer_self_contained_conversation_entry",
    realization: {
      kind: "self_contained_entry",
      topic: "assistant first-contact identity and low-pressure entry",
      proposition: firstContactText,
    },
    expectedUserContribution: "none",
    userBurden: "none",
  },
});
const firstContactHello = build({
  userMessage: "你好",
  recentMessages: [{
    id: firstContactEnvelope.assistantMoveId,
    role: "assistant",
    content: firstContactText,
    status: "saved",
    interactionMoveEnvelope: firstContactEnvelope,
  }],
  modelCandidates: [{
    relation: "acknowledges_previous_move",
    confidence: 0.98,
    targetTurnId: firstContactEnvelope.assistantMoveId,
    evidence: ["The user reciprocates the committed first-contact greeting."],
  }],
});
assert.equal(
  firstContactHello.responsePlan.interactionMoveHandoffPlan?.requiredFunction,
  "complete_reciprocal_contact"
);
assert.deepEqual(firstContactHello.responsePlan.responseActions, [
  "offer_neutral_conversation_entry",
]);
assert.notEqual(
  firstContactHello.responsePlan.positiveFunctionContract?.action === "establish_assistant_identity"
    ? firstContactHello.responsePlan.positiveFunctionContract.mode
    : null,
  "first_contact"
);
assert(!firstContactHello.responsePlan.requiredDisclosure.includes("助手称呼是小慢。"));
assert(!firstContactHello.responsePlan.requiredDisclosure.includes("助手是AI聊天助手。"));
assert.equal(firstContactHello.responsePlan.questionPolicy.mode, "optional_after_answer");
const firstContactHelloPrompt = buildChatPrompt({
  userMessage: "你好",
  recentMessages: [{
    id: firstContactEnvelope.assistantMoveId,
    role: "assistant",
    content: firstContactText,
    status: "saved",
    interactionMoveEnvelope: firstContactEnvelope,
  }],
  responsePlan: firstContactHello.responsePlan,
});
assert(firstContactHelloPrompt.messages[1]?.content.includes("complete_reciprocal_contact"));
assert(firstContactHelloPrompt.messages[1]?.content.includes(
  "responseActions: offer_neutral_conversation_entry"
));
assert(firstContactHelloPrompt.messages[1]?.content.includes("questionPolicy: optional_after_answer"));
assert(firstContactHelloPrompt.messages[1]?.content.includes("surfaceConstraints:"));
assert(firstContactHelloPrompt.messages[1]?.content.includes("offer_neutral_conversation_entry"));
assert(!firstContactHelloPrompt.messages[1]?.content.includes("establish_assistant_identity"));
const naturalFirstContactContinuation = "那我们就随意一点。";
assert(!naturalFirstContactContinuation.includes("你好"));
assert(!naturalFirstContactContinuation.includes("小慢"));
assert(!naturalFirstContactContinuation.includes("AI聊天助手"));
assert.equal((naturalFirstContactContinuation.match(/[？?]/gu) ?? []).length, 0);
assert.equal(validateResponsePlanOutput({
  plan: firstContactHello.responsePlan,
  reply: naturalFirstContactContinuation,
}).passed, true);
const missingNeutralEntryPreflight = preflightResponsePlan({
  ...firstContactHello.responsePlan,
  responseActions: firstContactHello.responsePlan.responseActions.filter(
    (action) => action !== "offer_neutral_conversation_entry"
  ),
});
assert(missingNeutralEntryPreflight.failureReasons.includes(
  "reciprocal_handoff_missing_neutral_conversation_entry"
));
assert.equal(validateResponsePlanOutput({
  plan: firstContactHello.responsePlan,
  reply: "那我们就随意一点。今天想聊点轻松的，还是聊聊此刻在意的事？",
}).passed, true);
assert(isNeutralConversationLightChoice(
  "那我们就随意一点。今天想聊点轻松的，还是聊聊此刻在意的事？"
));
for (const burdensomeEntry of [
  "那我们开始吧。今天想聊点什么？",
  "那我们开始吧。为什么现在来找我？具体发生了什么？",
  "那我们开始吧。你想聊什么？为什么？",
  "那我们开始吧。今天想聊什么？也可以。",
  "那我们开始吧。你想聊什么，也可以？",
  "那我们开始吧。最近有什么开心的事，还是？",
  "那我们开始吧。随便聊聊，或者？",
]) {
  assert.equal(validateResponsePlanOutput({
    plan: firstContactHello.responsePlan,
    reply: burdensomeEntry,
  }).passed, false, burdensomeEntry);
}
for (const mechanicalReply of [
  "你好呀，收到你的消息啦。",
  "嗯嗯，收到。",
  "收到，我记下了。",
  "你好呀，我在呢。",
  "你好呀，小慢在呢。",
  "在等你找我聊天呀。",
  "嗯，随时都在。",
  "嗯，收到啦。",
]) {
  const validation = validateResponsePlanOutput({
    plan: firstContactHello.responsePlan,
    reply: mechanicalReply,
  });
  assert.equal(validation.passed, false, mechanicalReply);
  assert(validation.failureReasons.some((reason) =>
    reason === "assistant_voice:mechanical_receipt_or_presence" ||
    reason === "assistant_grounding:invented_waiting_activity"
  ), mechanicalReply);
}

const coldRelationalComplaint = build({
  userMessage: "你怎么那么冷漠",
  recentMessages: [{ role: "assistant", content: "嗯嗯，收到。" }],
  modelPrimary: "correct_assistant",
});
assert.equal(coldRelationalComplaint.context.repairSignal, true);
assert(coldRelationalComplaint.responsePlan.responseActions.includes("repair_previous_wording"));
for (const failedRepair of [
  "抱歉让你有这种感觉，我其实一直在认真听你说。",
  "收到，我记下了。",
]) {
  const validation = validateResponsePlanOutput({
    plan: coldRelationalComplaint.responsePlan,
    reply: failedRepair,
  });
  assert.equal(validation.passed, false, failedRepair);
}

const proactiveGreetingTurn = build({
  userMessage: "吃了个炒饭",
  recentMessages: [{
    role: "assistant",
    content: "今天有没有吃到什么还不错的东西？",
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  }],
  modelPrimary: "answer",
});
assert(
  proactiveGreetingTurn.responsePlan.responseActions.includes(
    "respond_to_proactive_greeting"
  )
);
assert.equal(
  proactiveGreetingTurn.responsePlan.questionPolicy.mode,
  "none"
);
const proactiveFollowUpQuality = validateResponsePlanOutput({
  plan: proactiveGreetingTurn.responsePlan,
  reply: "什么炒饭？",
});
assert.equal(proactiveFollowUpQuality.passed, false);
assert.equal(proactiveFollowUpQuality.rewriteRequired, false);
assert((proactiveFollowUpQuality.hardFailureReasons?.length ?? 0) > 0);
assert.equal(proactiveFollowUpQuality.advisoryFailureReasons?.length, 0);

const proactiveGreetingUserInputs = [
  "吃了个炒饭",
  "我们的明天",
  "还行",
  "不知道",
  "嗯",
  "哦",
  "🙂",
  "刚下楼",
  "一首老歌",
  "蓝色",
  "看了电影",
  "随便",
  "想不起来",
  "一般吧",
  "一杯咖啡",
  "在路上",
  "没有",
  "忘了",
  "其实我想聊工作",
  "先说另一件事",
];
for (const userMessage of proactiveGreetingUserInputs) {
  const result = build({
    userMessage,
    recentMessages: [{
      role: "assistant",
      content: "今天有没有吃到什么还不错的东西？",
      promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
    }],
    modelPrimary: "answer",
  });
  assert(
    result.responsePlan.responseActions.includes("respond_to_proactive_greeting"),
    userMessage
  );
  assert.equal(
    result.responsePlan.questionPolicy.mode,
    "none",
    userMessage
  );
  assert.equal(result.clinicalCalls, 0, userMessage);
}
assert.equal(proactiveGreetingUserInputs.length, 20);

const proactiveGreetingSecondInterviewCounterexamples = [
  "那平时喜欢做点什么打发时间？",
  "那你平时喜欢看电影吗？",
  "那最近有看什么剧吗？",
  "那平时会出去玩吗？",
  "那有没有喜欢的运动？",
  "那平时怎么放松？",
  "那你喜欢看书吗？",
  "那最近吃了什么好吃的？",
  "那平时喜欢什么颜色？",
  "那你一般几点睡？",
  "那周末通常做什么？",
  "那最近工作忙吗？",
  "那你有什么爱好吗？",
  "那平时喜欢拍照吗？",
  "那最近有去哪里玩吗？",
  "那你喜欢喝咖啡吗？",
  "那你平时听播客吗？",
  "那最近有什么开心的事？",
  "那你想聊点别的吗？",
  "那现在在做什么？",
];
for (const reply of proactiveGreetingSecondInterviewCounterexamples) {
  const validation = validateResponsePlanOutput({
    plan: proactiveGreetingTurn.responsePlan,
    reply,
  });
  assert.equal(validation.passed, false, reply);
  assert.equal(validation.rewriteRequired, false, reply);
  assert((validation.hardFailureReasons?.length ?? 0) > 0, reply);
  assert(
    validation.failureReasons.includes("question_not_allowed_by_plan"),
    reply
  );
}
assert.equal(proactiveGreetingSecondInterviewCounterexamples.length, 20);

const nonQuestionProactiveGreetingTurn = build({
  userMessage: "刚从外面回来",
  recentMessages: [{
    role: "assistant",
    content: "嗨。",
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  }],
  modelPrimary: "share",
});
assert(
  nonQuestionProactiveGreetingTurn.responsePlan.responseActions.includes(
    "respond_to_proactive_greeting"
  )
);
assert.equal(
  nonQuestionProactiveGreetingTurn.responsePlan.questionPolicy.mode,
  "optional_after_answer"
);

const stalePreGreetingTopics = [
  "发呆",
  "听歌",
  "看剧",
  "电影",
  "散步",
  "跑步",
  "看书",
  "画画",
  "做饭",
  "咖啡",
  "工作",
  "睡觉",
  "游戏",
  "旅行",
  "拍照",
  "健身",
  "火锅",
  "音乐节",
  "蓝色",
  "朋友",
];
for (const topic of stalePreGreetingTopics) {
  const recentMessages: AiConversationMessage[] = [
    { role: "user", content: topic },
    { role: "assistant", content: `刚才说到${topic}。` },
    {
      role: "assistant",
      content: "嗨，回来啦。",
      promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
    },
  ];
  const result = build({
    userMessage: "回来了",
    recentMessages,
    modelPrimary: "answer",
  });
  assert(
    result.responsePlan.responseActions.includes("respond_to_proactive_greeting"),
    topic
  );
  const prompt = buildChatPrompt({
    userMessage: "回来了",
    recentMessages,
    responsePlan: result.responsePlan,
  });
  const surfaceConversation = prompt.messages.filter(
    (message) => message.role !== "developer"
  );
  assert.equal(prompt.meta.receivedHistoryCount, 3, topic);
  assert.equal(prompt.meta.includedHistoryCount, 1, topic);
  assert.deepEqual(
    surfaceConversation,
    [
      { role: "assistant", content: "嗨，回来啦。" },
      { role: "user", content: "回来了" },
    ],
    topic
  );
  const validation = validateResponsePlanOutput({
    plan: result.responsePlan,
    reply:
      topic === "发呆"
        ? "欢迎回来，发呆也挺放松的。"
        : `欢迎回来，刚才的${topic}也可以继续。`,
  });
  assert.equal(validation.passed, false, topic);
  assert(
    validation.failureReasons.includes(
      "proactive_greeting_response:stale_pre_greeting_content"
    ),
    topic
  );
  const constraint = formatResponsePlanRegenerateConstraint(
    result.responsePlan,
    validation.failureReasons
  );
  assert(constraint.includes("删除主动欢迎语之前的旧话题"), topic);
}
assert.equal(stalePreGreetingTopics.length, 20);

const explicitlyResumedPreGreetingTopic = build({
  userMessage: "继续刚才那个",
  recentMessages: [
    { role: "user", content: "发呆" },
    {
      role: "assistant",
      content: "嗨，回来啦。",
      promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
    },
  ],
  modelPrimary: "answer",
});
assert.equal(
  validateResponsePlanOutput({
    plan: explicitlyResumedPreGreetingTopic.responsePlan,
    reply: "那继续说发呆。",
  }).passed,
  true,
  "A pre-greeting topic explicitly resumed by the current user must remain available."
);
const explicitlyResumedPrompt = buildChatPrompt({
  userMessage: "继续刚才那个",
  recentMessages: [
    { role: "user", content: "发呆" },
    {
      role: "assistant",
      content: "嗨，回来啦。",
      promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
    },
  ],
  responsePlan: explicitlyResumedPreGreetingTopic.responsePlan,
});
assert.equal(explicitlyResumedPrompt.meta.includedHistoryCount, 2);
assert(
  JSON.stringify(explicitlyResumedPrompt.messages).includes("发呆"),
  "An explicit resume reference must restore pre-greeting Surface history."
);

const directQuestionAfterGreeting = build({
  userMessage: "你是谁？",
  recentMessages: [{
    role: "assistant",
    content: "你好。",
    promptVersion: PROACTIVE_GREETING_PROMPT_VERSION,
  }],
});
assert(
  directQuestionAfterGreeting.responsePlan.responseActions.includes("answer_directly")
);
assert(
  !directQuestionAfterGreeting.responsePlan.responseActions.includes(
    "respond_to_proactive_greeting"
  )
);

const emptyGreetingResponseCounterexamples = [
  "嗯，吃到了就好。",
  "吃到了就行。",
  "吃了就好。",
  "吃饱就行。",
  "知道了。",
  "嗯，知道了。",
  "收到。",
  "明白了。",
  "哦。",
  "好的。",
  "那挺好的。",
  "很好。",
  "不错。",
  "还行。",
  "吃了个炒饭。",
  "嗯，吃了个炒饭。",
  "炒饭啊。",
  "炒饭。",
  "还有呢？",
  "最近怎么样？",
  "然后呢？",
  "为什么呢？",
  "想再说说吗？",
  "你觉得呢？",
];
for (const reply of emptyGreetingResponseCounterexamples) {
  const validation = validateResponsePlanOutput({
    plan: proactiveGreetingTurn.responsePlan,
    reply,
  });
  assert.equal(validation.passed, false, reply);
  assert.equal(validation.rewriteRequired, false, reply);
  assert((validation.hardFailureReasons?.length ?? 0) > 0, reply);
}
assert.equal(emptyGreetingResponseCounterexamples.length, 24);

assert.deepEqual(
  classifyResponseValidationReasons(["future_unclassified_reason"]),
  {
    hardFailureReasons: ["future_unclassified_reason"],
    advisoryFailureReasons: [],
  }
);
for (const unknownPrefixedReason of [
  "ordinary_handoff:future_unknown_binding_failure",
  "ordinary_acknowledgement:future_unknown_fact_failure",
  "topic_initiative:future_unknown_reason",
]) {
  assert.deepEqual(
    classifyResponseValidationReasons([unknownPrefixedReason]),
    {
      hardFailureReasons: [unknownPrefixedReason],
      advisoryFailureReasons: [],
    }
  );
}

const mixedSeverityValidation = validateResponsePlanOutput({
  plan: firstContactHello.responsePlan,
  reply: "我是心理医生，先这样吧。",
});
assert.equal(mixedSeverityValidation.passed, false);
assert((mixedSeverityValidation.hardFailureReasons?.length ?? 0) > 0);

assert.equal(isCrisisInput("我不想活了"), false);
assert.equal(isCrisisInput("我已经吃了很多药。"), true);
assert.equal(isCrisisInput("我正在割腕。"), true);
for (const excludedContext of [
  "电影里的角色说他不想活了",
  "朋友刚对我说“我想自杀”",
  "研究访谈对象说我想自杀",
  "“我正在割腕”，这是小说台词",
  "我已经吃了很多药——这是研究访谈对象的原话",
  "“我正在割腕”",
  "『我已经吃了很多药』",
  "（我已经流血）",
  "“我正在割腕",
  "我正在割腕”",
  "> 我正在割腕",
  "｜我正在割腕｜",
  "我不会伤害自己",
  "以前被打过，现在已经没事了",
]) {
  assert.equal(isCrisisInput(excludedContext), false, excludedContext);
}

const advisoryOnlyPlan = structuredClone(screenshotIdle.responsePlan);
advisoryOnlyPlan.positiveFunctionContract = null;
advisoryOnlyPlan.interactionMoveHandoffPlan = null;
const advisoryRewriteRegression = (async () => {
  let calls = 0;
  const result = await enforceResponsePlan({
    plan: advisoryOnlyPlan,
    generate: async () => {
      calls += 1;
      return {
        text: "发呆也挺好。",
        model: "test-model",
        promptVersion: "test",
        latencyMs: 0,
        finalReplySource: "llm" as const,
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.outcome, "failed");
  assert(result.validations.every((validation) => !validation.passed));
  assert(result.validations.every((validation) => !validation.rewriteRequired));
})();

void advisoryRewriteRegression.catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

console.log(JSON.stringify({
  fixedTrajectoryTurns: 8,
    counterexamples: 1 +
    correctionCounterexamples.length +
    repeatedQuestionCounterexamples.length +
    ordinaryCounterexamples.length +
    interviewTopics.length +
    shortPositiveAnswers.length +
    unsupportedIdleEvaluationCounterexamples.length +
    emptyGreetingResponseCounterexamples.length +
    proactiveGreetingSecondInterviewCounterexamples.length +
    stalePreGreetingTopics.length,
  invariants: {
    onePlanner: true,
    noClinicalForOrdinaryChat: true,
    correctionUsesExistingRepairAction: true,
    repeatedQuestionsUseExistingInteractionEvidence: true,
    answersDoNotOpenInterviewLoops: true,
    ordinaryAcknowledgementSupervisesGenericEvaluation: true,
    ordinaryAcknowledgementRetryInstructions:
      unsupportedIdleEvaluationCounterexamples.length,
    proactiveGreetingResponseHasDedicatedAction: true,
    proactiveGreetingUserInputCases: proactiveGreetingUserInputs.length,
    proactiveGreetingResponseCounterexamples: emptyGreetingResponseCounterexamples.length,
    proactiveGreetingSecondInterviewCounterexamples:
      proactiveGreetingSecondInterviewCounterexamples.length,
    proactiveGreetingHistoryBoundaryCounterexamples:
      stalePreGreetingTopics.length,
    noPostReplyRewriterAdded: true,
  },
}, null, 2));
