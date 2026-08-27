import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProactiveGreetingAssistantMoveEnvelope,
} from "../conversation-os";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type ClinicalStrategyAdvice,
  type OrdinaryPostureProposal,
  type RelationalInterpretationCandidate,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import type { AiConversationMessage } from "../services/ai/types";

const clinicalAdvice: ClinicalStrategyAdvice = {
  strategy: "test-only",
  intent: "support",
  questionFunction: "none",
  toneConstraints: [],
  interventionBoundaries: [],
  evidence: ["Relational-state check provider."],
};

const build = ({
  userMessage,
  recentMessages = [],
  modelCandidates = [],
  unconfirmedHypotheses = [],
  postureProposal = null,
}: {
  userMessage: string;
  recentMessages?: AiConversationMessage[];
  modelCandidates?: RelationalInterpretationCandidate[];
  unconfirmedHypotheses?: string[];
  postureProposal?: OrdinaryPostureProposal | null;
}) => {
  const conversationState = determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: "relational-state-check",
    currentTurnId: `relational-state-check:turn-${recentMessages.length + 1}`,
    userMessage,
    recentMessages,
    conversationState,
  });
  context.unconfirmedHypotheses.push(...unconfirmedHypotheses);
  const deterministic = interpretTurnDeterministically(context);
  const interpretation = modelCandidates.length > 0 || postureProposal
    ? mergeModelInterpretation(deterministic, {
        responseRelation: {
          candidates: modelCandidates,
          ambiguous: modelCandidates.length > 1,
        },
        confidence: Math.max(...modelCandidates.map((item) => item.confidence)),
        ordinaryPostureProposal: postureProposal,
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
      return clinicalAdvice;
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

const relations = (result: ReturnType<typeof build>) =>
  result.interpretation.responseRelation.candidates.map((candidate) => candidate.relation);

const activities = (result: ReturnType<typeof build>) => [
  result.dialogueState.currentActivity.primary,
  ...result.dialogueState.currentActivity.concurrent,
];

const assertPlanProvenance = (result: ReturnType<typeof build>) => {
  for (const action of result.responsePlan.responseActions) {
    const provenance = result.responsePlan.relevanceProvenance.find(
      (item) => item.planElement === `responseAction:${action}`
    );
    assert(provenance, `Missing relevance provenance for ${action}`);
    assert(provenance.evidence.length > 0, `Empty relevance provenance for ${action}`);
  }
  for (const obligation of result.responsePlan.answerObligations) {
    assert(
      result.responsePlan.relevanceProvenance.some(
        (item) =>
          item.planElement === `answerObligation:${obligation.id}` &&
          item.sourceTurnId === obligation.sourceTurnId
      ),
      `Missing scoped provenance for ${obligation.id}`
    );
  }
};

const inviteHistory: AiConversationMessage[] = [
  {
    id: "assistant-invite",
    role: "assistant",
    content: "这会儿你想从哪里开始？",
  },
];

// Screenshot-derived wording is only a regression sample.
const screenshotRegression = build({
  userMessage: "我想不到说什么耶",
  recentMessages: inviteHistory,
});
assert(relations(screenshotRegression).includes("yields_initiative"));
assert(relations(screenshotRegression).includes("continues_active_thread"));
assert.equal(screenshotRegression.interpretation.responseRelation.ambiguous, false);
assert.equal(screenshotRegression.dialogueState.initiativeOwner, "assistant");
assert(activities(screenshotRegression).includes("opening_thread"));
assert(screenshotRegression.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert(!screenshotRegression.responsePlan.responseActions.includes("respect_pause"));
assertPlanProvenance(screenshotRegression);

// Same text, different adjacent structures: the relational state must differ.
const afterRepeatedQuestions = build({
  userMessage: "不知道聊什么",
  recentMessages: [
    { id: "assistant-q1", role: "assistant", content: "你想聊哪一件？" },
    { id: "user-a1", role: "user", content: "还没想到。" },
    { id: "assistant-q2", role: "assistant", content: "那你现在脑子里有什么？" },
  ],
});
assert(relations(afterRepeatedQuestions).includes("shares_initiative"));
assert.equal(afterRepeatedQuestions.dialogueState.initiativeOwner, "shared");
assert.equal(afterRepeatedQuestions.responsePlan.questionPolicy.mode, "none");

const atNewConversation = build({ userMessage: "不知道聊什么" });
assert(relations(atNewConversation).includes("yields_initiative"));
assert.equal(atNewConversation.dialogueState.initiativeOwner, "assistant");
assert.equal(atNewConversation.responsePlan.ordinaryPosture?.mode, "accompany");
assert.equal(atNewConversation.responsePlan.ordinaryPosture?.sourceSpans[0]?.text, "不知道聊什么");

const selfExploration = build({
  userMessage: "我为什么总会这样",
});
assert.equal(selfExploration.interpretation.directQuestions.length, 1);
assert.equal(selfExploration.responsePlan.answerObligations.length, 1);
assert.equal(selfExploration.responsePlan.ordinaryPosture, null);

for (const externalWhy of ["为什么会下雨", "这个接口为什么报错"]) {
  const directExternal = build({ userMessage: externalWhy });
  assert.equal(directExternal.interpretation.directQuestions[0]?.subjectOwnership, undefined);
  assert.equal(directExternal.responsePlan.answerObligations.length, 1);
  assert.equal(directExternal.responsePlan.ordinaryPosture, null);
}

const externalModelCannotOverrideDirect = build({
  userMessage: "为什么会下雨",
  postureProposal: {
    mode: "explore",
    sourceSpans: [{
      source: "current_user_turn",
      sourceTurnId: "relational-state-check:turn-1",
      start: 0,
      end: 6,
      text: "为什么会下雨",
    }],
    proposedContribution: { targetSpanIndexes: [0], instruction: "把外部问题改成自我探索。" },
    evidence: ["malicious or mistaken model proposal"],
  },
});
assert.equal(externalModelCannotOverrideDirect.responsePlan.answerObligations.length, 1);
assert.equal(externalModelCannotOverrideDirect.responsePlan.ordinaryPosture, null);

const invalidProposalFallsBack = build({
  userMessage: "今天事情不少",
  postureProposal: {
    mode: "explore",
    sourceSpans: [{
      source: "current_user_turn",
      sourceTurnId: "wrong-turn",
      start: 0,
      end: 6,
      text: "今天事情不少",
    }],
    proposedContribution: { targetSpanIndexes: [0], instruction: "推断隐藏原因。" },
    evidence: ["invalid fixture"],
  },
});
assert.equal(invalidProposalFallsBack.responsePlan.ordinaryPosture?.mode, "accompany");
assert(invalidProposalFallsBack.responsePlan.ordinaryPosture?.evidence.includes("interpreter_proposal_rejected"));

const strictProposalBase = build({ userMessage: "今天事情不少" });
const strictRejected = mergeModelInterpretation(strictProposalBase.deterministic, {
  ordinaryPostureProposal: {
    mode: "explore",
    sourceSpans: [{
      source: "current_user_turn",
      sourceTurnId: "relational-state-check:turn-1",
      start: 0,
      end: 6,
      text: "今天事情不少",
      extra: "must reject the whole proposal",
    }],
    proposedContribution: { targetSpanIndexes: [0, "bad"], instruction: "整理已有材料。" },
    evidence: ["strict fixture"],
  } as unknown as OrdinaryPostureProposal,
}, strictProposalBase.context);
assert.equal(strictRejected.ordinaryPostureProposal, null);

const adjacentCommittedProposal = build({
  userMessage: "还是这个",
  recentMessages: [
    { id: "prior-user", role: "user", content: "一边想休息，一边又怕落下", status: "saved" },
    { id: "prior-assistant", role: "assistant", content: "我听见这两边都在拉你。", status: "saved" },
  ],
  postureProposal: {
    mode: "explore",
    sourceSpans: [{
      source: "adjacent_committed_user_turn",
      sourceTurnId: "prior-user",
      start: 0,
      end: 12,
      text: "一边想休息，一边又怕落下",
    }],
    proposedContribution: {
      targetSpanIndexes: [0],
      instruction: "整理用户已表达的两边拉扯，让用户可以确认或修正。",
    },
    evidence: ["The current turn explicitly returns to adjacent committed User material."],
  },
});
assert.equal(adjacentCommittedProposal.responsePlan.ordinaryPosture?.mode, "explore");
assert.equal(
  adjacentCommittedProposal.responsePlan.ordinaryPosture?.sourceSpans[0]?.source,
  "adjacent_committed_user_turn"
);

for (const status of [undefined, "blocked"] as const) {
  const excludedAdjacent = build({
    userMessage: "还是这个",
    recentMessages: [
      { id: `excluded-${status ?? "undefined"}`, role: "user", content: "一边想休息，一边又怕落下", status },
      { id: "excluded-assistant", role: "assistant", content: "明白。", status: "saved" },
    ],
    postureProposal: {
      ...adjacentCommittedProposal.interpretation.ordinaryPostureProposal!,
      sourceSpans: [{
        source: "adjacent_committed_user_turn",
        sourceTurnId: `excluded-${status ?? "undefined"}`,
        start: 0,
        end: 12,
        text: "一边想休息，一边又怕落下",
      }],
    },
  });
  assert.equal(excludedAdjacent.responsePlan.ordinaryPosture?.mode, "accompany");
}

const afterPause = build({
  userMessage: "不知道聊什么",
  recentMessages: [
    { id: "user-pause", role: "user", content: "让我安静一会儿" },
    { id: "assistant-pause", role: "assistant", content: "好。" },
  ],
});
assert(relations(afterPause).includes("requests_pause"));
assert.equal(afterPause.dialogueState.initiativeOwner, "paused");
assert.deepEqual(afterPause.responsePlan.responseActions, ["respect_pause"]);

// Multiple plausible relations survive; a model candidate adds evidence but cannot
// directly select a ResponseAction.
const ambiguous = build({
  userMessage: "这会儿我也说不上来",
  recentMessages: inviteHistory,
  modelCandidates: [
    {
      relation: "yields_initiative",
      confidence: 0.84,
      targetTurnId: "assistant-invite",
      evidence: ["The turn can return initiative to the assistant."],
    },
    {
      relation: "continues_active_thread",
      confidence: 0.78,
      targetTurnId: "assistant-invite",
      evidence: ["The turn also answers the adjacent invitation."],
    },
  ],
});
assert.equal(ambiguous.interpretation.responseRelation.ambiguous, true);
assert(relations(ambiguous).includes("yields_initiative"));
assert(relations(ambiguous).includes("continues_active_thread"));
assert.equal(ambiguous.dialogueState.initiativeOwner, "assistant");
assert(ambiguous.responsePlan.responseActions.includes("take_light_topic_initiative"));

// A user rejection withdraws the targeted proposition from common ground.
const correction = build({
  userMessage: "我刚才问的不是这个",
  recentMessages: [
    { id: "user-original", role: "user", content: "那接下来呢？" },
    { id: "assistant-wrong", role: "assistant", content: "你是在担心明天上班。" },
  ],
});
assert(relations(correction).includes("repairs_previous_move"));
assert.equal(correction.dialogueState.repairState.status, "active");
assert(correction.dialogueState.commonGround.rejected.length > 0);
for (const rejected of correction.dialogueState.commonGround.rejected) {
  assert(!correction.dialogueState.commonGround.confirmed.some((item) => item.text === rejected.text));
  assert(!correction.dialogueState.commonGround.hypothesized.some((item) => item.text === rejected.text));
}
assert(correction.responsePlan.responseActions.includes("repair_previous_wording"));
assert(correction.responsePlan.prohibitedClaims.some((claim) => claim.includes("rejected proposition")));
assertPlanProvenance(correction);

// Assistant or retrieved hypotheses never become confirmed common ground.
const hypothesis = "Selected observed context: 用户现在可能没有工作。";
const withHypothesis = build({
  userMessage: "最近就随便看看",
  unconfirmedHypotheses: [hypothesis],
});
assert(withHypothesis.dialogueState.commonGround.hypothesized.some((item) => item.text === hypothesis));
assert(!withHypothesis.dialogueState.commonGround.confirmed.some((item) => item.text === hypothesis));
assert(!withHypothesis.responsePlan.groundingFacts.includes(hypothesis));

// Direct answer and distress can coexist without collapsing the turn to one intent.
const answerAndDistress = build({ userMessage: "我心里很慌，你能听见我吗？" });
assert(relations(answerAndDistress).includes("requests_answer"));
assert(relations(answerAndDistress).includes("shares_distress"));
assert(activities(answerAndDistress).includes("answering_obligation"));
assert(activities(answerAndDistress).includes("supporting_emotion"));
assert(answerAndDistress.responsePlan.responseActions.includes("answer_directly"));
assert(answerAndDistress.responsePlan.responseActions.includes("offer_emotional_support"));
assert.equal(answerAndDistress.clinicalCalls, 1);
assertPlanProvenance(answerAndDistress);

// Twenty blind counterexamples. None of these exact strings is used by production
// classification logic added in this migration; the test supplies relational
// evidence as the model interpreter would for previously unseen paraphrases.
type BlindCase = {
  text: string;
  relation: RelationalInterpretationCandidate["relation"];
  expectedActivity: ReturnType<typeof activities>[number];
  expectedAction: ReturnType<typeof build>["responsePlan"]["responseActions"][number];
};
const blindTuples: Array<[
  BlindCase["text"],
  BlindCase["relation"],
  BlindCase["expectedActivity"],
  BlindCase["expectedAction"],
]> = [
  ["一时没想到能展开哪一块", "yields_initiative", "opening_thread", "take_light_topic_initiative"],
  ["脑袋里暂时没有话头", "yields_initiative", "opening_thread", "take_light_topic_initiative"],
  ["这会儿没有特别想展开的内容", "yields_initiative", "opening_thread", "take_light_topic_initiative"],
  ["要不由你先抛个方向", "yields_initiative", "opening_thread", "take_light_topic_initiative"],
  ["我先听你起个头", "yields_initiative", "opening_thread", "take_light_topic_initiative"],
  ["我们到这儿就好", "requests_pause", "pausing", "respect_pause"],
  ["我想先离开一阵", "requests_pause", "pausing", "respect_pause"],
  ["这一轮先收住吧", "requests_pause", "pausing", "respect_pause"],
  ["先别往下接了", "requests_pause", "pausing", "respect_pause"],
  ["我需要暂时断开对话", "requests_pause", "pausing", "respect_pause"],
  ["心里像压着一块东西", "shares_distress", "supporting_emotion", "offer_emotional_support"],
  ["整个人都绷得很紧", "shares_distress", "supporting_emotion", "offer_emotional_support"],
  ["我现在有点撑不住这个节奏", "shares_distress", "supporting_emotion", "offer_emotional_support"],
  ["这件事让我一直发抖", "shares_distress", "supporting_emotion", "offer_emotional_support"],
  ["胸口像堵住了一样", "shares_distress", "supporting_emotion", "offer_emotional_support"],
  ["能不能帮我排一下先后", "requests_action_support", "supporting_action", "offer_action_support"],
  ["我需要一个可执行的起点", "requests_action_support", "supporting_action", "offer_action_support"],
  ["帮我看看先处理哪部分", "requests_action_support", "supporting_action", "offer_action_support"],
  ["我该从哪一步动手比较合适", "requests_action_support", "supporting_action", "offer_action_support"],
  ["可以一起把选择理清吗", "requests_action_support", "supporting_action", "offer_action_support"],
];
const blindCases: BlindCase[] = blindTuples.map(([text, relation, expectedActivity, expectedAction]) => ({
  text,
  relation,
  expectedActivity,
  expectedAction,
}));

for (const item of blindCases) {
  const result = build({
    userMessage: item.text,
    recentMessages: inviteHistory,
    modelCandidates: [{
      relation: item.relation,
      confidence: 0.93,
      targetTurnId: "assistant-invite",
      evidence: [`Blind relational evidence for ${item.relation}; not a response action.`],
    }],
  });
  assert(relations(result).includes(item.relation), item.text);
  assert(activities(result).includes(item.expectedActivity), item.text);
  assert(result.responsePlan.responseActions.includes(item.expectedAction), item.text);
  if (item.relation === "requests_pause") {
    assert.equal(result.dialogueState.activeThread?.status, "paused", item.text);
  }
  assertPlanProvenance(result);
}
assert.equal(blindCases.length, 20);

// Dynamic planning depth and idle are state-derived, not fixed conversational steps.
assert.equal(screenshotRegression.responsePlan.planningDepth, "minimal");
assert.equal(correction.responsePlan.planningDepth, "deep");
const explicitQuestion = build({ userMessage: "你是什么？" });
assert.equal(explicitQuestion.responsePlan.planningDepth, "standard");
const naturalIdle = build({
  userMessage: "好，知道了",
  recentMessages: [{
    id: "assistant-complete",
    role: "assistant",
    content: "已经说明完了。",
    committedAssistantMove: {
      purpose: ["answer_directly"],
      claims: [],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: "user-before-complete",
      evidence: ["committed test move"],
    },
  }],
  modelCandidates: [{
    relation: "acknowledges_previous_move",
    confidence: 0.95,
    targetTurnId: "assistant-complete",
    evidence: ["The user acknowledges a completed committed move."],
  }],
});
assert.equal(naturalIdle.dialogueState.currentActivity.primary, "idle");
assert.equal(naturalIdle.dialogueState.activeThread?.status, "closed");
assert.equal(naturalIdle.responsePlan.closurePolicy.mode, "allow_idle");
assert.equal(naturalIdle.responsePlan.questionPolicy.mode, "none");
assert(!naturalIdle.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert(naturalIdle.responsePlan.responseActions.includes("acknowledge_without_psychologizing"));
assert.equal(validateResponsePlanOutput({
  plan: naturalIdle.responsePlan,
  reply: "嗯，好。",
}).passed, true);

// A completed acknowledgement may carry a generic initiative hedge from the
// interpreter, but allow_idle arbitrates it away before Surface.
const idleWithInitiativeHedge = build({
  userMessage: "好的吧",
  recentMessages: naturalIdle.context.adjacentTurns.map((turn) => ({
    ...turn,
    role: turn.role,
  })),
  modelCandidates: [
    {
      relation: "acknowledges_previous_move",
      confidence: 0.96,
      targetTurnId: "assistant-complete",
      evidence: ["The User only acknowledges the completed move."],
    },
    {
      relation: "yields_initiative",
      confidence: 0.88,
      targetTurnId: "assistant-complete",
      evidence: ["A lower-confidence initiative hedge."],
    },
  ],
});
assert.equal(idleWithInitiativeHedge.responsePlan.closurePolicy.mode, "allow_idle");
assert(!idleWithInitiativeHedge.responsePlan.responseActions.includes("take_light_topic_initiative"));
assert.equal(validateResponsePlanOutput({
  plan: idleWithInitiativeHedge.responsePlan,
  reply: "嗯，好。",
}).passed, true);

const committedClaim = "雨点落在窗上，像把匆忙的一天调成了慢速播放。";
const committedClaimEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "assistant-committed-claim",
  generationId: "generation-committed-claim",
  intent: {
    move: "open_statement",
    requiredFunction: "offer_self_contained_conversation_entry",
    realization: {
      kind: "self_contained_entry",
      topic: "雨声带来的节奏变化",
      proposition: committedClaim,
    },
    expectedUserContribution: "none",
    userBurden: "none",
  },
});
const committedClaimHistory: AiConversationMessage[] = [{
  id: committedClaimEnvelope.assistantMoveId,
  role: "assistant",
  content: committedClaim,
  status: "saved",
  interactionMoveEnvelope: committedClaimEnvelope,
}];
const activeHandoffAcknowledgement = build({
  userMessage: "好的吧",
  recentMessages: committedClaimHistory,
  modelCandidates: [{
    relation: "acknowledges_previous_move",
    confidence: 0.96,
    targetTurnId: committedClaimEnvelope.assistantMoveId,
    evidence: ["The User acknowledges an active proactive move."],
  }],
});
assert(activeHandoffAcknowledgement.responsePlan.interactionMoveHandoffPlan);
assert.equal(activeHandoffAcknowledgement.responsePlan.closurePolicy.mode, "forbid_closure");

const clarification = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: committedClaimHistory,
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: committedClaimEnvelope.assistantMoveId,
    targetProposition: committedClaim,
    targetOperation: "explain",
    evidence: ["The User asks for the meaning of the exact committed claim."],
  }],
});
assert.equal(clarification.responsePlan.answerObligations.length, 1);
assert.equal(
  clarification.responsePlan.answerObligations[0]?.targetProposition,
  committedClaim
);
assert.notEqual(
  clarification.responsePlan.answerObligations[0]?.targetProposition,
  clarification.responsePlan.answerObligations[0]?.question
);
assert(clarification.responsePlan.responseActions.includes("answer_directly"));
assert(clarification.responsePlan.responseActions.includes("explain_plainly"));
assert.equal(
  clarification.responsePlan.interactionMoveHandoffPlan?.requiredFunction,
  "answer_current_obligation"
);
assert.equal(validateResponsePlanOutput({
  plan: clarification.responsePlan,
  reply: "我刚才的意思是，雨声会让忙乱的节奏显得慢下来。",
}).passed, true);

const challengedClaim = build({
  userMessage: "这个说法没有明确意思，请撤回。",
  recentMessages: committedClaimHistory,
  modelCandidates: [{
    relation: "repairs_previous_move",
    confidence: 0.97,
    targetTurnId: committedClaimEnvelope.assistantMoveId,
    targetProposition: committedClaim,
    targetOperation: "repair_or_withdraw",
    evidence: ["The User disputes and asks to withdraw the exact committed claim."],
  }],
});
assert.equal(challengedClaim.dialogueState.repairState.status, "active");
assert.equal(
  challengedClaim.responsePlan.positiveFunctionContract?.action === "repair_previous_wording"
    ? challengedClaim.responsePlan.positiveFunctionContract.targetText
    : null,
  committedClaim
);

const mismatchedClaimBinding = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: committedClaimHistory,
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: committedClaimEnvelope.assistantMoveId,
    targetProposition: "并未提交的另一条主张",
    targetOperation: "explain",
    evidence: ["An invalid model-supplied target."],
  }],
});
assert(!mismatchedClaimBinding.interpretation.responseRelation.candidates.some((candidate) =>
  candidate.targetProposition === "并未提交的另一条主张"
));
assert.equal(mismatchedClaimBinding.responsePlan.answerObligations.length, 0);
assert(!mismatchedClaimBinding.interpretation.responseRelation.candidates.some((candidate) =>
  candidate.relation === "requests_answer"
));
assert.notEqual(
  mismatchedClaimBinding.responsePlan.interactionMoveHandoffPlan?.requiredFunction,
  "answer_current_obligation"
);

const missingActiveHandoffClaimBinding = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: committedClaimHistory,
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: committedClaimEnvelope.assistantMoveId,
    evidence: ["The model omitted the required committed-claim binding."],
  }],
});
assert.equal(missingActiveHandoffClaimBinding.responsePlan.answerObligations.length, 0);
assert(!missingActiveHandoffClaimBinding.interpretation.directQuestions.some((question) =>
  question.targetProposition === question.text
));

const ordinaryCommittedClaimTurnId = "assistant-ordinary-committed-claim";
const missingOrdinaryClaimBinding = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: [{
    id: ordinaryCommittedClaimTurnId,
    role: "assistant",
    content: committedClaim,
    status: "saved",
    committedAssistantMove: {
      purpose: ["offer_self_contained_conversation_entry"],
      claims: [{
        text: committedClaim,
        subject: "conversation",
        source: "adjacent_turn",
        provenance: ["ordinary committed claim fixture"],
      }],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: "user-before-ordinary-claim",
      evidence: ["ordinary committed claim fixture"],
    },
  }],
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: ordinaryCommittedClaimTurnId,
    evidence: ["The model omitted the required ordinary committed-claim binding."],
  }],
});
assert.equal(missingOrdinaryClaimBinding.context.interactionMoveHandoffTarget, null);
assert.equal(missingOrdinaryClaimBinding.responsePlan.answerObligations.length, 0);
assert(!missingOrdinaryClaimBinding.interpretation.responseRelation.candidates.some((candidate) =>
  candidate.relation === "requests_answer"
));

for (const [label, targetTurnId] of [
  ["wrong target", "wrong-assistant-target"],
  ["targetless", undefined],
] as const) {
  const ordinaryClaimTargetFailure = build({
    userMessage: "你是想表达什么吗？",
    recentMessages: missingOrdinaryClaimBinding.context.adjacentTurns.map((turn) => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      committedAssistantMove: turn.committedAssistantMove,
    })),
    modelCandidates: [{
      relation: "requests_answer",
      confidence: 0.97,
      ...(targetTurnId ? { targetTurnId } : {}),
      targetProposition: committedClaim,
      targetOperation: "explain",
      evidence: [`The model supplied an ordinary committed-claim ${label}.`],
    }],
  });
  assert.equal(ordinaryClaimTargetFailure.responsePlan.answerObligations.length, 0, label);
  assert(!ordinaryClaimTargetFailure.interpretation.responseRelation.candidates.some((candidate) =>
    candidate.relation === "requests_answer"
  ), label);
}

const staleCommittedClaim = "旧主张";
const currentCommittedClaim = "最新主张";
const committedClaimMove = (text: string, sourceTurnId: string) => ({
  purpose: ["offer_self_contained_conversation_entry"],
  claims: [{
    text,
    subject: "conversation" as const,
    source: "adjacent_turn" as const,
    provenance: [`committed claim fixture=${text}`],
  }],
  assumptions: [],
  questionOrRequest: null,
  expectedUserContribution: "none" as const,
  userBurden: "none" as const,
  sourceTurnId,
  evidence: [`committed claim fixture=${text}`],
});
const multipleCommittedClaimHistory: AiConversationMessage[] = [
  {
    id: "assistant-old-claim",
    role: "assistant",
    content: staleCommittedClaim,
    status: "saved",
    committedAssistantMove: committedClaimMove(staleCommittedClaim, "user-before-old-claim"),
  },
  { id: "user-between-claims", role: "user", content: "继续", status: "saved" },
  {
    id: "assistant-current-claim",
    role: "assistant",
    content: currentCommittedClaim,
    status: "saved",
    committedAssistantMove: committedClaimMove(currentCommittedClaim, "user-between-claims"),
  },
];
const staleExactClaimBinding = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: multipleCommittedClaimHistory,
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: "assistant-old-claim",
    targetProposition: staleCommittedClaim,
    targetOperation: "explain",
    evidence: ["The model selected a stale but internally exact claim."],
  }],
});
assert.equal(staleExactClaimBinding.responsePlan.answerObligations.length, 0);
assert(!staleExactClaimBinding.interpretation.responseRelation.candidates.some((candidate) =>
  candidate.targetTurnId === "assistant-old-claim" &&
  candidate.targetProposition === staleCommittedClaim
));

const currentExactClaimBinding = build({
  userMessage: "你是想表达什么吗？",
  recentMessages: multipleCommittedClaimHistory,
  modelCandidates: [{
    relation: "requests_answer",
    confidence: 0.97,
    targetTurnId: "assistant-current-claim",
    targetProposition: currentCommittedClaim,
    targetOperation: "explain",
    evidence: ["The model selected the current adjacent committed claim."],
  }],
});
assert.equal(
  currentExactClaimBinding.responsePlan.answerObligations[0]?.targetProposition,
  currentCommittedClaim
);

// Explicit new content and direct questions still prevent idle arbitration.
const acknowledgementWithNewContent = build({
  userMessage: "好，我其实想聊聊最近的工作变化。",
  recentMessages: naturalIdle.context.adjacentTurns.map((turn) => ({ ...turn, role: turn.role })),
  modelCandidates: [
    {
      relation: "acknowledges_previous_move",
      confidence: 0.96,
      targetTurnId: "assistant-complete",
      evidence: ["The first clause acknowledges the completed move."],
    },
    {
      relation: "opens_new_thread",
      confidence: 0.94,
      targetTurnId: "assistant-complete",
      evidence: ["The second clause introduces concrete new content."],
    },
  ],
});
assert.equal(acknowledgementWithNewContent.responsePlan.closurePolicy.mode, "forbid_closure");

const acknowledgementWithQuestion = build({
  userMessage: "好，那这个词是什么意思？",
  recentMessages: naturalIdle.context.adjacentTurns.map((turn) => ({ ...turn, role: turn.role })),
  modelCandidates: [{
    relation: "acknowledges_previous_move",
    confidence: 0.96,
    targetTurnId: "assistant-complete",
    evidence: ["The turn includes an acknowledgement."],
  }],
});
assert(acknowledgementWithQuestion.responsePlan.responseActions.includes("answer_directly"));
assert.equal(acknowledgementWithQuestion.responsePlan.closurePolicy.mode, "forbid_closure");

// First-contact identity and product identity remain separate authorities.
const assistantNameQuestion = build({ userMessage: "你叫什么名字？" });
assert.equal(assistantNameQuestion.deterministic.directQuestions[0]?.kind, "assistant_name");
assert.deepEqual(assistantNameQuestion.responsePlan.requiredDisclosure, ["助手称呼是小慢。"]);
assert.equal(assistantNameQuestion.responsePlan.questionPolicy.mode, "none");
assert.equal(
  validateResponsePlanOutput({ plan: assistantNameQuestion.responsePlan, reply: "我叫小慢。" }).passed,
  true
);
assert.equal(
  validateResponsePlanOutput({ plan: assistantNameQuestion.responsePlan, reply: "我叫慢聊小记。" }).passed,
  false
);

const assistantIdentityQuestion = build({ userMessage: "你是谁？" });
assert(assistantIdentityQuestion.responsePlan.requiredDisclosure.includes("助手称呼是小慢。"));
assert(assistantIdentityQuestion.responsePlan.requiredDisclosure.includes("助手是AI聊天助手。"));
assert.equal(
  validateResponsePlanOutput({
    plan: assistantIdentityQuestion.responsePlan,
    reply: "我是小慢，一个AI聊天助手。",
  }).passed,
  true
);

const firstGreetingText = "你好，我是小慢，一个AI聊天助手。你可以在这里随便聊，也可以和我一起慢慢理清一些事情；不用先想好完整话题，想到什么就从什么开始。";
const firstGreetingEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "first-contact-greeting",
  generationId: "first-contact-generation",
  intent: {
    move: "open_statement",
    requiredFunction: "offer_self_contained_conversation_entry",
    realization: {
      kind: "self_contained_entry",
      topic: "assistant first-contact identity and low-pressure entry",
      proposition: firstGreetingText,
    },
    expectedUserContribution: "none",
    userBurden: "none",
  },
});
const firstGreetingReply = build({
  userMessage: "你好",
  recentMessages: [{
    id: "first-contact-greeting",
    role: "assistant",
    content: firstGreetingText,
    interactionMoveEnvelope: firstGreetingEnvelope,
  }],
  modelCandidates: [{
    relation: "acknowledges_previous_move",
    confidence: 0.98,
    targetTurnId: "first-contact-greeting",
    evidence: ["The user reciprocates the targeted first-contact greeting."],
  }],
});
const assertNoFirstContactIdentityAuthority = (
  plan: ReturnType<typeof build>["responsePlan"]
) => {
  assert(!plan.responseActions.includes("establish_assistant_identity"));
  assert.notEqual(
    plan.positiveFunctionContract?.action === "establish_assistant_identity"
      ? plan.positiveFunctionContract.mode
      : null,
    "first_contact"
  );
  assert(!plan.requiredDisclosure.includes("助手称呼是小慢。"));
  assert(!plan.requiredDisclosure.includes("助手是AI聊天助手。"));
  assert(!plan.relevanceProvenance.some((item) =>
    item.planElement === "responseAction:establish_assistant_identity" ||
    item.evidence.some((evidence) =>
      evidence.includes("authority=first_contact") ||
      evidence.includes("firstContactIntent=")
    )
  ));
};

assert.equal(
  firstGreetingReply.responsePlan.interactionMoveHandoffPlan?.requiredFunction,
  "complete_reciprocal_contact"
);
assertNoFirstContactIdentityAuthority(firstGreetingReply.responsePlan);
assert.deepEqual(firstGreetingReply.responsePlan.responseActions, [
  "offer_neutral_conversation_entry",
]);
assert.equal(firstGreetingReply.responsePlan.questionPolicy.mode, "optional_after_answer");
assert.equal(
  validateResponsePlanOutput({
    plan: firstGreetingReply.responsePlan,
    reply: "那我们就随意一点。今天想聊点轻松的，还是聊聊此刻在意的事？",
  }).passed,
  true,
  "A reciprocal continuation can let the user choose a topic without reopening identity."
);

const firstContactOrdinaryReply = build({
  userMessage: "我今天吃了碗面",
  recentMessages: [{
    id: firstGreetingEnvelope.assistantMoveId,
    role: "assistant",
    content: firstGreetingText,
    interactionMoveEnvelope: firstGreetingEnvelope,
  }],
  modelCandidates: [{
    relation: "opens_new_thread",
    confidence: 0.98,
    targetTurnId: firstGreetingEnvelope.assistantMoveId,
    evidence: ["The user starts an ordinary concrete topic after first contact."],
  }],
});
assertNoFirstContactIdentityAuthority(firstContactOrdinaryReply.responsePlan);
assert(firstContactOrdinaryReply.interpretation.responseRelation.candidates.some((candidate) =>
  candidate.relation === "opens_new_thread"
));

const identityClaim = "助手称呼是小慢。";
const identityContinuation = build({
  userMessage: "你可以有自己的名字的",
  recentMessages: [{
    id: "assistant-identity-claim",
    role: "assistant",
    content: "我叫小慢。",
    committedAssistantMove: {
      purpose: ["answer_directly"],
      claims: [{
        text: identityClaim,
        subject: "assistant",
        source: "system_truth",
        provenance: ["requiredDisclosure:assistant_name"],
      }],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: "user-name-question",
      evidence: ["committed identity fixture"],
    },
  }],
  modelCandidates: [{
    relation: "continues_active_thread",
    confidence: 0.97,
    targetTurnId: "assistant-identity-claim",
    targetProposition: identityClaim,
    targetOperation: "affirm",
    evidence: ["The user explicitly permits and continues the exact committed name claim."],
  }],
});
assert(identityContinuation.responsePlan.responseActions.includes("establish_assistant_identity"));
assert.equal(
  identityContinuation.responsePlan.positiveFunctionContract?.action,
  "establish_assistant_identity"
);
assert.equal(
  validateResponsePlanOutput({
    plan: identityContinuation.responsePlan,
    reply: "那就叫我小慢吧。你觉得这个称呼怎么样？",
  }).passed,
  true
);
assert.equal(
  validateResponsePlanOutput({
    plan: identityContinuation.responsePlan,
    reply: "这个称呼听起来顺口吗？",
  }).passed,
  false,
  "Identity continuation keeps canonical display-name grounding without a text phrase classifier."
);

const replanFirstContactProbe = ({
  result,
  relation,
  preserveResponseRelation = false,
}: {
  result: ReturnType<typeof build>;
  relation: ReturnType<typeof build>["interpretation"]["userMoveRelation"];
  preserveResponseRelation?: boolean;
}) => {
  const interpretation = {
    ...result.interpretation,
    responseRelation: preserveResponseRelation
      ? result.interpretation.responseRelation
      : { candidates: [], ambiguous: false },
    userMoveRelation: relation,
  };
  const dialogueState = buildDialogueState(result.context, interpretation);
  return createResponsePlan({
    context: result.context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
};

assert.equal(firstGreetingReply.context.interaction.contentAvailability, "fragmentary");
const firstContactNoModelPlan = replanFirstContactProbe({
  result: firstGreetingReply,
  relation: null,
});
assert.equal(firstContactNoModelPlan.interactionMoveHandoffPlan, null);
assertNoFirstContactIdentityAuthority(firstContactNoModelPlan);

const firstContactUnclearPlan = replanFirstContactProbe({
  result: firstGreetingReply,
  relation: {
    sourceUserTurnId: firstGreetingReply.context.currentTurnId,
    targetAssistantMoveId: firstGreetingEnvelope.assistantMoveId,
    targetFunction: firstGreetingEnvelope.handoff.greetingFunction,
    candidates: [{
      kind: "unclear",
      confidence: 1,
      evidence: [{
        source: "current_user_turn",
        sourceUserTurnId: firstGreetingReply.context.currentTurnId,
        start: 0,
        end: 2,
        text: "你好",
      }],
    }],
    ambiguous: false,
  },
});
assert.equal(firstContactUnclearPlan.interactionMoveHandoffPlan?.requiredFunction,
  "defer_handoff_completion");
assertNoFirstContactIdentityAuthority(firstContactUnclearPlan);
assert.equal(firstContactUnclearPlan.questionPolicy.mode, "none");

const firstContactNoTopic = build({
  userMessage: "没话题",
  recentMessages: [{
    id: firstGreetingEnvelope.assistantMoveId,
    role: "assistant",
    content: firstGreetingText,
    interactionMoveEnvelope: firstGreetingEnvelope,
  }],
});
assert.equal(firstContactNoTopic.context.interaction.contentAvailability, "no_topic");
const firstContactNoTopicPlan = replanFirstContactProbe({
  result: firstContactNoTopic,
  relation: null,
});
assertNoFirstContactIdentityAuthority(firstContactNoTopicPlan);

const returnGreetingEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "return-greeting",
  generationId: "return-generation",
  intent: {
    move: "open_statement",
    requiredFunction: "offer_self_contained_conversation_entry",
    realization: {
      kind: "self_contained_entry",
      topic: "a return-only neutral observation",
      proposition: "窗边的光线每天都有一点不同。",
    },
    expectedUserContribution: "none",
    userBurden: "none",
  },
});
const returnNoTopic = build({
  userMessage: "没话题",
  recentMessages: [{
    id: returnGreetingEnvelope.assistantMoveId,
    role: "assistant",
    content: "窗边的光线每天都有一点不同。",
    interactionMoveEnvelope: returnGreetingEnvelope,
  }],
});
assert(!replanFirstContactProbe({
  result: returnNoTopic,
  relation: null,
}).responseActions.includes("establish_assistant_identity"));

const firstContactPause = build({
  userMessage: "先别问了",
  recentMessages: [{
    id: firstGreetingEnvelope.assistantMoveId,
    role: "assistant",
    content: firstGreetingText,
    interactionMoveEnvelope: firstGreetingEnvelope,
  }],
});
const firstContactPausePlan = replanFirstContactProbe({
  result: firstContactPause,
  relation: null,
  preserveResponseRelation: true,
});
assert.deepEqual(firstContactPausePlan.responseActions, ["respect_pause"]);
assert.equal(firstContactPausePlan.questionPolicy.mode, "none");

const identityWithoutExactAffirm = build({
  userMessage: "我想说另一件事",
  recentMessages: identityContinuation.context.adjacentTurns.map((turn) => ({
    ...turn,
    role: turn.role,
  })),
  modelCandidates: [{
    relation: "opens_new_thread",
    confidence: 0.96,
    targetTurnId: "assistant-identity-claim",
    evidence: ["The user introduces unrelated content without affirming the identity claim."],
  }],
});
assert(!identityWithoutExactAffirm.responsePlan.responseActions.includes("establish_assistant_identity"));

const identityThenPause = build({
  userMessage: "先别问了",
  recentMessages: identityContinuation.context.adjacentTurns.map((turn) => ({
    ...turn,
    role: turn.role,
  })),
});
assert.deepEqual(identityThenPause.responsePlan.responseActions, ["respect_pause"]);
assert.equal(identityThenPause.responsePlan.questionPolicy.mode, "none");

const productNameCorrection = build({
  userMessage: "慢聊小记是产品名字",
  recentMessages: [{
    id: "assistant-wrong-product-name",
    role: "assistant",
    content: "我叫慢聊小记。",
    committedAssistantMove: {
      purpose: ["answer_directly"],
      claims: [{
        text: "助手称呼是慢聊小记。",
        subject: "assistant",
        source: "system_truth",
        provenance: ["legacy requiredDisclosure:identity"],
      }],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: "legacy-name-question",
      evidence: ["legacy committed identity fixture"],
    },
  }],
  modelCandidates: [{
    relation: "repairs_previous_move",
    confidence: 0.98,
    targetTurnId: "assistant-wrong-product-name",
    targetProposition: "助手称呼是慢聊小记。",
    targetOperation: "repair_or_withdraw",
    evidence: ["The user corrects the exact committed assistant-name claim."],
  }],
});
assert(productNameCorrection.responsePlan.responseActions.includes("repair_previous_wording"));
assert(!productNameCorrection.responsePlan.responseActions.includes("establish_assistant_identity"));
assert(productNameCorrection.responsePlan.requiredDisclosure.includes("助手称呼是小慢。"));
assert.equal(productNameCorrection.responsePlan.questionPolicy.mode, "none");
assert.equal(
  validateResponsePlanOutput({
    plan: productNameCorrection.responsePlan,
    reply: "是我刚才说错了：慢聊小记是产品名，不是我的名字；我叫小慢。",
  }).passed,
  true
);

const replanIdentityAuthorityProbe = ({
  result,
  candidate,
}: {
  result: ReturnType<typeof build>;
  candidate: RelationalInterpretationCandidate;
}) => {
  const interpretation = {
    ...result.interpretation,
    responseRelation: { candidates: [candidate], ambiguous: false },
    userMoveRelation: null,
  };
  const dialogueState = buildDialogueState(result.context, interpretation);
  return createResponsePlan({
    context: result.context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
};

const fakeIdentityTarget = build({ userMessage: "嗯" });
const nonAdjacentIdentityTarget = build({
  userMessage: "嗯",
  recentMessages: [
    {
      id: "assistant-outside-adjacent-context",
      role: "assistant",
      content: "我叫小慢。",
      committedAssistantMove: {
        purpose: ["answer_directly"],
        claims: [{
          text: identityClaim,
          subject: "assistant",
          source: "system_truth",
          provenance: ["outside adjacent context fixture"],
        }],
        assumptions: [],
        questionOrRequest: null,
        expectedUserContribution: "none",
        userBurden: "none",
        sourceTurnId: "outside-adjacent-user",
        evidence: ["outside adjacent context fixture"],
      },
    },
    { id: "user-adjacent-1", role: "user", content: "一" },
    { id: "assistant-adjacent-1", role: "assistant", content: "一。" },
    { id: "user-adjacent-2", role: "user", content: "二" },
    { id: "assistant-adjacent-2", role: "assistant", content: "二。" },
    { id: "user-adjacent-3", role: "user", content: "三" },
    { id: "assistant-adjacent-3", role: "assistant", content: "三。" },
  ],
});
assert(!nonAdjacentIdentityTarget.context.adjacentTurns.some((turn) =>
  turn.id === "assistant-outside-adjacent-context"
));
const uncommittedIdentityTarget = build({
  userMessage: "嗯",
  recentMessages: [{
    id: "assistant-without-committed-claim",
    role: "assistant",
    content: "我叫慢聊小记。",
  }],
});
const mismatchedIdentityTarget = build({
  userMessage: "嗯",
  recentMessages: [{
    id: "assistant-with-different-committed-claim",
    role: "assistant",
    content: "我叫小慢。",
    committedAssistantMove: {
      purpose: ["answer_directly"],
      claims: [{
        text: identityClaim,
        subject: "assistant",
        source: "system_truth",
        provenance: ["different exact claim fixture"],
      }],
      assumptions: [],
      questionOrRequest: null,
      expectedUserContribution: "none",
      userBurden: "none",
      sourceTurnId: "different-claim-user",
      evidence: ["different exact claim fixture"],
    },
  }],
});

const invalidIdentityAuthorityCases = [
  {
    label: "forged target id",
    result: fakeIdentityTarget,
    targetTurnId: "assistant-forged-target",
  },
  {
    label: "non-adjacent target",
    result: nonAdjacentIdentityTarget,
    targetTurnId: "assistant-outside-adjacent-context",
  },
  {
    label: "target without committed claim",
    result: uncommittedIdentityTarget,
    targetTurnId: "assistant-without-committed-claim",
  },
  {
    label: "mismatched proposition",
    result: mismatchedIdentityTarget,
    targetTurnId: "assistant-with-different-committed-claim",
  },
] as const;

for (const { label, result, targetTurnId } of invalidIdentityAuthorityCases) {
  const continuationProposition = label === "mismatched proposition"
    ? "助手是AI聊天助手。"
    : identityClaim;
  const continuationPlan = replanIdentityAuthorityProbe({
    result,
    candidate: {
      relation: "continues_active_thread",
      confidence: 0.99,
      targetTurnId,
      targetProposition: continuationProposition,
      targetOperation: "affirm",
      evidence: [`Planner authority probe: ${label}.`],
    },
  });
  assert(!continuationPlan.responseActions.includes("establish_assistant_identity"), label);
  assert(!continuationPlan.requiredDisclosure.includes("助手称呼是小慢。"), label);

  const repairPlan = replanIdentityAuthorityProbe({
    result,
    candidate: {
      relation: "repairs_previous_move",
      confidence: 0.99,
      targetTurnId,
      targetProposition: "助手称呼是慢聊小记。",
      targetOperation: "repair_or_withdraw",
      evidence: [`Planner identity-repair authority probe: ${label}.`],
    },
  });
  assert(!repairPlan.requiredDisclosure.includes("助手称呼是小慢。"), label);
  assert(!repairPlan.requiredDisclosure.some((item) =>
    item.includes("是当前产品名称，不是助手称呼")
  ), label);
  assert.notEqual(
    repairPlan.positiveFunctionContract?.action === "repair_previous_wording"
      ? repairPlan.positiveFunctionContract.replacementFact
      : null,
    "小慢",
    label
  );
}

// Interaction State is reconstructible from committed raw events and move metadata.
const reconstructed = build({
  userMessage: "继续",
  recentMessages: [
    { id: "committed-user", role: "user", content: "我周末不安排工作", status: "saved" },
    {
      id: "committed-assistant",
      role: "assistant",
      content: "明白。",
      status: "saved",
      replyToMessageId: "committed-user",
      committedAssistantMove: {
        purpose: ["acknowledge_without_psychologizing"],
        claims: [{
          text: "助手称呼是小慢。",
          subject: "assistant",
          source: "system_truth",
          provenance: ["requiredDisclosure:identity"],
        }],
        assumptions: [{ text: "用户可能想继续这个话题", status: "hypothesized" }],
        questionOrRequest: null,
        expectedUserContribution: "none",
        userBurden: "none",
        sourceTurnId: "committed-user",
        evidence: ["committed move fixture"],
      },
    },
  ],
});
const reconstructedUser = reconstructed.dialogueState.commonGround.confirmed.find(
  (item) => item.sourceTurnId === "committed-user"
);
assert.equal(reconstructedUser?.subject, "user");
assert.equal(reconstructedUser?.speaker, "user");
assert.equal(reconstructedUser?.epistemicStatus, "asserted_by_user");
assert(reconstructed.dialogueState.commonGround.confirmed.some(
  (item) => item.epistemicStatus === "system_truth"
));
assert(reconstructed.dialogueState.commonGround.hypothesized.some(
  (item) => item.epistemicStatus === "assistant_hypothesis"
));
for (const item of [
  ...reconstructed.dialogueState.commonGround.confirmed,
  ...reconstructed.dialogueState.commonGround.hypothesized,
  ...reconstructed.dialogueState.commonGround.rejected,
]) {
  assert(item.subject);
  assert(item.speaker);
  assert(item.epistemicStatus);
  assert(item.sourceTurnId);
  assert(item.evidence.length > 0);
}

// Architectural non-bypass assertions.
const plannerSource = readFileSync("conversation-os/control/responsePlanner.ts", "utf8");
const orchestrationSource = readFileSync("services/ai/chatOrchestrationService.ts", "utf8");
const validatorSource = readFileSync("services/ai/responsePlanValidator.ts", "utf8");
const plannedFunctionValidatorSource = readFileSync(
  "services/ai/plannedFunctionSemanticValidator.ts",
  "utf8"
);
assert(!plannerSource.includes("primaryDialogueAct"));
assert(!plannerSource.includes("secondarySignals"));
assert(!plannerSource.includes("activeInteractionNeeds"));
assert(!plannerSource.includes("stillOpenUserIntent"));
assert(!plannerSource.includes("firstContactIdentityEvidence"));
assert(!plannerSource.includes("authority=first_contact"));
assert(!validatorSource.includes("hasLowPressureConversationEntry"));
assert(!validatorSource.includes("hasLowPressureNameContinuation"));
assert(validatorSource.includes("validatePlannedFunctionSemanticOutput"));
assert(plannedFunctionValidatorSource.includes("if (!handoff && !positiveFunction)"));
assert(plannedFunctionValidatorSource.includes("positiveFunctionBinding"));
assert(plannedFunctionValidatorSource.includes("handoffTargetAssistantText"));
assert.equal((orchestrationSource.match(/createResponsePlan\(/g) ?? []).length, 1);
assert(!validatorSource.includes("createResponsePlan("));

const surfacePrompt = formatResponsePlanForPrompt(screenshotRegression.responsePlan);
assert(!surfacePrompt.includes("responseActionSurfaceContract"));
assert(!surfacePrompt.includes("surfaceFormConstraint"));
assert(!surfacePrompt.includes("planEvidence"));
assert(!surfacePrompt.includes("availableFacts"));
assert(surfacePrompt.includes("relevanceProvenance:"));
assert(surfacePrompt.includes(`planningDepth: ${screenshotRegression.responsePlan.planningDepth}`));

console.log(JSON.stringify({
  screenshotRegressions: 4,
  blindCounterExamples: blindCases.length,
  multipleInterpretationsPreserved: ambiguous.interpretation.responseRelation.candidates.length,
  commonGround: {
    confirmed: withHypothesis.dialogueState.commonGround.confirmed.length,
    hypothesized: withHypothesis.dialogueState.commonGround.hypothesized.length,
    rejected: correction.dialogueState.commonGround.rejected.length,
  },
  architecture: {
    decisionOwner: screenshotRegression.responsePlan.decisionOwner,
    plannerReadsLegacyIntent: false,
    plannerCount: 1,
    surfaceReceivesFullGrounding: false,
    postPlannerReplan: false,
  },
}, null, 2));
