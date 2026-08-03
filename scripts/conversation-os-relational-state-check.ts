import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type ClinicalStrategyAdvice,
  type RelationalInterpretationCandidate,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
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
}: {
  userMessage: string;
  recentMessages?: AiConversationMessage[];
  modelCandidates?: RelationalInterpretationCandidate[];
  unconfirmedHypotheses?: string[];
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
  const interpretation = modelCandidates.length > 0
    ? mergeModelInterpretation(deterministic, {
        responseRelation: {
          candidates: modelCandidates,
          ambiguous: modelCandidates.length > 1,
        },
        confidence: Math.max(...modelCandidates.map((item) => item.confidence)),
      })
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
          text: "慢聊小记是AI聊天助手。",
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
assert(!plannerSource.includes("primaryDialogueAct"));
assert(!plannerSource.includes("secondarySignals"));
assert(!plannerSource.includes("activeInteractionNeeds"));
assert(!plannerSource.includes("stillOpenUserIntent"));
assert(!plannerSource.includes("contentAvailability"));
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
