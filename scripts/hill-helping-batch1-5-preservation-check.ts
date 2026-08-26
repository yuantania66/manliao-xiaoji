import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type ResponsePlan,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { loadPreservationDataset } from "./hill-helping-batch1-5-preservation-lib";

const main = async () => {
const { dataset, sha256 } = loadPreservationDataset();
const plansByScenario = new Map<string, ResponsePlan>();
const expectedRepairModeByScenario = new Map<string, string>([
  ["repair-unsupported-fear", "proposition_withdrawal"],
  ["repair-advice-boundary", "interaction_move_withdrawal"],
  ["repair-intensity-exaggeration", "proposition_withdrawal"],
  ["repair-wrong-person", "factual_replacement"],
  ["repair-question-pressure", "interaction_move_withdrawal"],
  ["repair-generic-listening", "interaction_move_withdrawal"],
  ["repair-repeated-claim", "proposition_withdrawal"],
  ["repair-direct-relationship-challenge", "proposition_withdrawal"],
  ["repair-moralizing", "interaction_move_withdrawal"],
  ["repair-topic-switch", "interaction_move_withdrawal"],
]);
const expectedInteractionMoveSubtypeByScenario = new Map<string, string | null>([
  ["repair-unsupported-fear", null],
  ["repair-advice-boundary", "unsolicited_advice"],
  ["repair-intensity-exaggeration", null],
  ["repair-wrong-person", null],
  ["repair-question-pressure", "pressure_question"],
  ["repair-generic-listening", "generic_listening"],
  ["repair-repeated-claim", null],
  ["repair-direct-relationship-challenge", null],
  ["repair-moralizing", "moralizing"],
  ["repair-topic-switch", "topic_switch"],
]);
const actionRows = dataset.scenarios.map((scenario) => {
  const conversationState = determineConversationState({
    currentUserMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: `preservation-${scenario.id}`,
    currentTurnId: `${scenario.id}-turn`,
    userMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
    conversationState,
  });
  const deterministic = interpretTurnDeterministically(context);
  const interpretation = mergeModelInterpretation(deterministic, {
    responseRelation: {
      candidates: scenario.kind === "emotional_support"
        ? [{
            relation: "shares_distress",
            confidence: 0.9,
            evidence: ["Preservation fixture explicitly contains user-stated negative affect."],
          }]
        : [{
            relation: "repairs_previous_move",
            confidence: 0.95,
            targetTurnId: scenario.recentMessages.at(-1)?.id,
            evidence: ["Preservation fixture explicitly rejects the adjacent assistant move."],
          }],
      ambiguous: false,
    },
  }, context);
  const dialogueState = buildDialogueState(context, interpretation);
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: ({ need }) => ({
      strategy: "test-legacy-compat",
      intent: need === "emotional_support" ? "empathic_reflection" : "action_support",
      questionFunction: "clarify_or_reflect",
      toneConstraints: ["warm", "non-directive", "non-diagnostic"],
      interventionBoundaries: ["no diagnosis", "no treatment plan"],
      evidence: ["Preservation structure check."],
    }),
  });
  assert(
    responsePlan.responseActions.includes(scenario.expectedAction),
    `${scenario.id} expected ${scenario.expectedAction}, got ${responsePlan.responseActions.join(",")}`
  );
  const preflight = preflightResponsePlan(responsePlan);
  assert.equal(
    preflight.passed,
    true,
    `${scenario.id} Planner preflight failed: ${preflight.failureReasons.join(",")}`
  );
  plansByScenario.set(scenario.id, responsePlan);
  if (scenario.kind === "ordinary_repair") {
    assert.deepEqual(
      responsePlan.responseActions,
      ["repair_previous_wording"],
      `${scenario.id} repair must remain the only response action.`
    );
    assert.equal(responsePlan.questionPolicy.mode, "none", `${scenario.id} repair must not ask a question.`);
    assert.equal(responsePlan.behaviorSource, "ordinary_conversation");
    assert.equal(responsePlan.clinicalStrategy, null);
    assert.equal(responsePlan.positiveFunctionContract?.action, "repair_previous_wording");
    assert.equal(
      responsePlan.positiveFunctionContract?.action === "repair_previous_wording"
        ? responsePlan.positiveFunctionContract.repairMode
        : null,
      expectedRepairModeByScenario.get(scenario.id),
      `${scenario.id} must select the frozen repair target type before Surface runs.`
    );
    assert.equal(
      responsePlan.positiveFunctionContract?.action === "repair_previous_wording"
        ? responsePlan.positiveFunctionContract.interactionMoveSubtype
        : null,
      expectedInteractionMoveSubtypeByScenario.get(scenario.id),
      `${scenario.id} must select the frozen ordinary interaction-move subtype from adjacent evidence.`
    );
  } else {
    assert.equal(responsePlan.positiveFunctionContract?.action, "offer_emotional_support");
    const contract = responsePlan.positiveFunctionContract;
    assert(contract?.action === "offer_emotional_support");
    assert(contract.affectEvidenceSpans.length > 0, `${scenario.id} must keep current-turn affect spans.`);
    for (const span of contract.affectEvidenceSpans) {
      assert.equal(span.sourceTurnId, `${scenario.id}-turn`);
      assert.equal(contract.sourceText.slice(span.start, span.end), span.text);
      assert(span.category && span.intensity && span.object);
    }
  }
  const prompt = formatResponsePlanForPrompt(responsePlan);
  assert(prompt.includes(`responseActions: ${responsePlan.responseActions.join(" / ")}`));
  return {
    id: scenario.id,
    kind: scenario.kind,
    actions: responsePlan.responseActions,
    questionPolicy: responsePlan.questionPolicy.mode,
    planPreflightPassed: preflight.passed,
    planPreflightFailures: preflight.failureReasons,
  };
});

const vagueBlockedPreflightReplay = Array.from({ length: dataset.gate.runsPerScenario }, (_, index) => {
  const plan = plansByScenario.get("emotion-vague-blocked");
  assert(plan, "emotion-vague-blocked plan is missing.");
  const preflight = preflightResponsePlan(plan);
  assert.equal(
    preflight.passed,
    true,
    `emotion-vague-blocked run ${index + 1} must no longer fail before generation.`
  );
  return { runIndex: index + 1, ...preflight };
});

type FrozenAttribution = {
  reviews: Array<{
    reviewId: string;
    scenarioId: string;
    firstReply: string;
    attribution: "surface_failure" | "validator_false_positive" | "both";
  }>;
};

const attribution = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate2-first-failure-attribution-20260802.json",
  "utf8"
)) as FrozenAttribution;
const freezePreMinimalFixSurfacePlan = (plan: ResponsePlan): ResponsePlan =>
  plan.positiveFunctionContract?.action === "offer_emotional_support" &&
  plan.positiveFunctionContract.supportFunction === "return_amount_control"
    ? {
        ...plan,
        positiveFunctionContract: {
          ...plan.positiveFunctionContract,
          supportFunction: "return_focus_control",
        },
      }
    : plan;

// M0 wiring fixture only: this fixed negative verdict proves exact PHM-C binding and
// fail-closed rejection. It is not evidence that a real model understood this reply.
const validateC202ThroughCanonicalSemanticBoundary = async ({
  plan,
  reply,
  currentUserText,
}: {
  plan: ResponsePlan;
  reply: string;
  currentUserText: string;
}) => {
  const contract = plan.positiveFunctionContract;
  assert.equal(plan.interactionMoveHandoffPlan, null, "C2-02 fixture must remain positive-function-only.");
  assert(contract?.action === "offer_emotional_support", "C2-02 must bind emotional support.");
  assert.equal(contract.supportFunction, "return_focus_control");
  const result = await validatePlannedFunctionSemanticOutput({
    plan,
    reply,
    semanticContext: { currentUserText, handoffTargetAssistantText: null },
    provider: async (input) => {
      assert.equal(input.planId, plan.planId);
      assert.equal(input.candidateReply, reply);
      assert.equal(input.currentUserText, currentUserText);
      assert.equal(input.handoffBinding, null);
      assert.deepEqual(input.positiveFunctionBinding, contract);
      return {
        schemaVersion: 1,
        planId: plan.planId,
        handoff: null,
        positiveFunction: {
          binding: {
            action: contract.action,
            supportFunction: contract.supportFunction,
            sourceTurnId: contract.sourceTurnId,
          },
          status: "not_satisfied",
          realizedAction: null,
          targetAddressed: false,
          contractRealized: false,
          containsContradictoryMove: false,
          evidence: [],
        },
        semanticQuestionCount: 0,
      };
    },
  });
  assert.deepEqual(
    result.failureReasons,
    ["planned_function_semantic:positive_function_not_satisfied"]
  );
  return result;
};

type RepairNegativeWiring = {
  scenarioId: string;
  reply: string;
  defectLabel: string;
  repairMode: "proposition_withdrawal" | "interaction_move_withdrawal";
  interactionMoveSubtype: "topic_switch" | null;
  targetTurnId: string;
  targetText: string;
  targetAddressed: boolean;
  containsContradictoryMove: boolean;
};

type EmotionalNegativeWiring = {
  scenarioId: string;
  reply: string;
  planId: string;
  supportFunction: "return_focus_control";
  sourceTurnId: string;
  sourceText: string;
  defectLabel: string;
  containsContradictoryMove: boolean;
};

const emotionalNegativeWiringByReviewId = new Map<string, EmotionalNegativeWiring>([
  ["C2-01", {
    scenarioId: "emotion-mild-unhappy",
    reply: "心情低落的时候确实挺难熬的。如果想聊聊或者只是想随便说点什么，都可以按你的节奏来。",
    planId: "preservation-emotion-mild-unhappy:emotion-mild-unhappy-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-mild-unhappy-turn",
    sourceText: "我今天有点不太高兴",
    defectLabel: "unsupported_affect_relabel_and_intensity_amplification",
    containsContradictoryMove: true,
  }],
  ["C2-03", {
    scenarioId: "emotion-mixed-anger",
    reply: "委屈和生气搅在一起确实特别难受。如果想说说，随时可以按你的节奏来。",
    planId: "preservation-emotion-mixed-anger:emotion-mixed-anger-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-mixed-anger-turn",
    sourceText: "我现在又委屈又生气",
    defectLabel: "unsupported_distress_intensification",
    containsContradictoryMove: false,
  }],
  ["C2-05", {
    scenarioId: "emotion-being-ignored",
    reply: "被忽略确实让人心里不好受，这种失落感很真实。如果你想说说当时的感受，或者只是想待一会儿，都可以按你的节奏来。",
    planId: "preservation-emotion-being-ignored:emotion-being-ignored-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-being-ignored-turn",
    sourceText: "刚才被忽略的时候挺难受的",
    defectLabel: "unsupported_affect_relabel_and_unrequested_pause",
    containsContradictoryMove: true,
  }],
  ["C2-07", {
    scenarioId: "emotion-being-ignored",
    reply: "被忽略的感觉确实很不好受，这种失落感是真实的。如果想聊聊刚才的事，或者只想说说现在的感受，都可以按你的节奏来。",
    planId: "preservation-emotion-being-ignored:emotion-being-ignored-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-being-ignored-turn",
    sourceText: "刚才被忽略的时候挺难受的",
    defectLabel: "unsupported_affect_relabel",
    containsContradictoryMove: true,
  }],
  ["C2-10", {
    scenarioId: "emotion-lonely",
    reply: "这种没来由的孤单感确实挺磨人的。要是想随便说点什么，或者只是想找个地方待会儿，都可以按你的节奏来。",
    planId: "preservation-emotion-lonely:emotion-lonely-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-lonely-turn",
    sourceText: "今晚莫名有点孤单",
    defectLabel: "unsupported_intensity_and_unrequested_pause",
    containsContradictoryMove: true,
  }],
  ["C2-11", {
    scenarioId: "emotion-lonely",
    reply: "这种没来由的孤单感确实挺磨人的。要是想随便说点什么，或者只是想有个回应，都可以按你的节奏来。",
    planId: "preservation-emotion-lonely:emotion-lonely-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-lonely-turn",
    sourceText: "今晚莫名有点孤单",
    defectLabel: "unsupported_intensity_amplification",
    containsContradictoryMove: false,
  }],
  ["C2-12", {
    scenarioId: "emotion-lonely",
    reply: "这种没来由的孤单感确实挺磨人的。要是想随便说点什么或者聊点别的分散下注意力，我都陪你。",
    planId: "preservation-emotion-lonely:emotion-lonely-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-lonely-turn",
    sourceText: "今晚莫名有点孤单",
    defectLabel: "unsupported_intensity_topic_switch_and_presence_claim",
    containsContradictoryMove: true,
  }],
  ["C2-13", {
    scenarioId: "emotion-irritated",
    reply: "烦的时候确实很难熬，不用急着理清头绪。如果想说点什么，按你觉得舒服的节奏来就好。",
    planId: "preservation-emotion-irritated:emotion-irritated-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-irritated-turn",
    sourceText: "我现在真的很烦",
    defectLabel: "unsupported_suffering_and_analysis_task_inference",
    containsContradictoryMove: false,
  }],
  ["C2-14", {
    scenarioId: "emotion-irritated",
    reply: "烦的时候确实挺难熬的。如果想说点什么，随时可以按你的节奏来。",
    planId: "preservation-emotion-irritated:emotion-irritated-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-irritated-turn",
    sourceText: "我现在真的很烦",
    defectLabel: "unsupported_suffering_inference",
    containsContradictoryMove: false,
  }],
  ["C2-15", {
    scenarioId: "emotion-irritated",
    reply: "烦的时候确实很难熬。如果想说点什么，随时可以按你的节奏来。",
    planId: "preservation-emotion-irritated:emotion-irritated-turn:response-plan",
    supportFunction: "return_focus_control",
    sourceTurnId: "emotion-irritated-turn",
    sourceText: "我现在真的很烦",
    defectLabel: "repeated_unsupported_suffering_inference",
    containsContradictoryMove: false,
  }],
]);

const seenEmotionalNegativeWiringReviewIds = new Set<string>();

const repairNegativeWiringByReviewId = new Map<string, RepairNegativeWiring>([
  ["C2-16", {
    scenarioId: "repair-intensity-exaggeration",
    reply: "是我刚才用词太重了，抱歉。今天累了就好好歇着吧。",
    defectLabel: "missing_exact_proposition_withdrawal_and_unsolicited_advice",
    repairMode: "proposition_withdrawal",
    interactionMoveSubtype: null,
    targetTurnId: "a1",
    targetText: "听起来你已经快撑不住了。",
    targetAddressed: true,
    containsContradictoryMove: true,
  }],
  ["C2-17", {
    scenarioId: "repair-intensity-exaggeration",
    reply: "是我刚才用词太重了，抱歉。今天累了就好好歇歇。",
    defectLabel: "missing_exact_proposition_withdrawal_and_unsolicited_rest_advice",
    repairMode: "proposition_withdrawal",
    interactionMoveSubtype: null,
    targetTurnId: "a1",
    targetText: "听起来你已经快撑不住了。",
    targetAddressed: true,
    containsContradictoryMove: true,
  }],
  ["C2-23", {
    scenarioId: "repair-topic-switch",
    reply: "抱歉，我刚才理解偏了。",
    defectLabel: "generic_apology_without_topic_switch_withdrawal",
    repairMode: "interaction_move_withdrawal",
    interactionMoveSubtype: "topic_switch",
    targetTurnId: "a1",
    targetText: "要不要先做个呼吸练习放松一下？",
    targetAddressed: false,
    containsContradictoryMove: false,
  }],
  ["C2-24", {
    scenarioId: "repair-topic-switch",
    reply: "抱歉，是我理解偏了。",
    defectLabel: "ownership_without_exact_topic_switch_withdrawal",
    repairMode: "interaction_move_withdrawal",
    interactionMoveSubtype: "topic_switch",
    targetTurnId: "a1",
    targetText: "要不要先做个呼吸练习放松一下？",
    targetAddressed: false,
    containsContradictoryMove: false,
  }],
  ["C2-25", {
    scenarioId: "repair-topic-switch",
    reply: "抱歉，是我理解偏了。",
    defectLabel: "repeated_ownership_without_exact_topic_switch_withdrawal",
    repairMode: "interaction_move_withdrawal",
    interactionMoveSubtype: "topic_switch",
    targetTurnId: "a1",
    targetText: "要不要先做个呼吸练习放松一下？",
    targetAddressed: false,
    containsContradictoryMove: false,
  }],
]);

const approvedExactNegativeWiringReviewIds = new Set([
  "C2-02",
  ...emotionalNegativeWiringByReviewId.keys(),
  ...repairNegativeWiringByReviewId.keys(),
]);
const seenExactNegativeWiringReviewIds = new Set<string>();

const acceptedWithoutNegativeFixtureReviewIds = new Set([
  "C2-08",
  "C2-09",
  "C2-18",
  "C2-19",
  "C2-20",
]);

const activeQuestionGuardOwnedReviewIds = new Set(["C2-21", "C2-22"]);

const deferredBothReview = {
  reviewId: "C2-04",
  scenarioId: "emotion-future-worry",
  reply: "担心明天的事确实挺熬人的。如果想聊聊，随时可以说说你在意的点，不想细讲也没关系。",
  reason: "D-deferred: intensity amplification and valid low-burden permission cannot be separated by the current check-only boundary.",
} as const;

// M0 wiring fixture only: fixed verdicts prove exact canonical binding and fail-closed
// routing. They do not claim that a real model independently understood the repairs.
const validateRepairNegativeThroughCanonicalSemanticBoundary = async ({
  reviewId,
  wiring,
  plan,
  reply,
  currentUserText,
}: {
  reviewId: string;
  wiring: RepairNegativeWiring;
  plan: ResponsePlan;
  reply: string;
  currentUserText: string;
}) => {
  assert.equal(reviewId.startsWith("C2-"), true);
  assert.equal(reply, wiring.reply, `${reviewId} must keep its exact frozen reply.`);
  assert.equal(plan.interactionMoveHandoffPlan, null, `${reviewId} must remain positive-function-only.`);
  const contract = plan.positiveFunctionContract;
  assert(contract?.action === "repair_previous_wording", `${reviewId} must bind ordinary repair.`);
  assert.equal(contract.repairMode, wiring.repairMode);
  assert.equal(contract.interactionMoveSubtype, wiring.interactionMoveSubtype);
  assert.equal(contract.sourceText, currentUserText);
  assert.equal(contract.targetTurnId, wiring.targetTurnId);
  assert.equal(contract.targetText, wiring.targetText);
  assert.equal(contract.replacementFact, null);
  const result = await validatePlannedFunctionSemanticOutput({
    plan,
    reply,
    semanticContext: { currentUserText, handoffTargetAssistantText: null },
    provider: async (input) => {
      assert.equal(input.planId, plan.planId);
      assert.equal(input.candidateReply, wiring.reply);
      assert.equal(input.currentUserText, currentUserText);
      assert.equal(input.handoffBinding, null);
      assert.deepEqual(input.positiveFunctionBinding, contract);
      return {
        schemaVersion: 1,
        planId: plan.planId,
        handoff: null,
        positiveFunction: {
          binding: {
            action: contract.action,
            repairMode: contract.repairMode,
            sourceTurnId: contract.sourceTurnId,
            targetTurnId: contract.targetTurnId,
          },
          status: "not_satisfied" as const,
          realizedAction: null,
          targetAddressed: wiring.targetAddressed,
          contractRealized: false,
          containsContradictoryMove: wiring.containsContradictoryMove,
          evidence: [],
        },
        semanticQuestionCount: 0,
      };
    },
  });
  assert.deepEqual(
    result.failureReasons,
    ["planned_function_semantic:positive_function_not_satisfied"],
    `${reviewId}:${wiring.defectLabel}`
  );
  return { result, defectLabel: wiring.defectLabel };
};

// Product-approved A10 wiring. Each fixed verdict is bound to one exact frozen
// review, reply and emotional-support plan signature; it is never derived from
// the attribution label or the legacy expected result.
const validateEmotionalNegativeThroughCanonicalSemanticBoundary = async ({
  reviewId,
  wiring,
  plan,
  reply,
  currentUserText,
}: {
  reviewId: string;
  wiring: EmotionalNegativeWiring;
  plan: ResponsePlan;
  reply: string;
  currentUserText: string;
}) => {
  assert.equal(reply, wiring.reply, `${reviewId} must keep its exact frozen reply.`);
  assert.equal(currentUserText, wiring.sourceText, `${reviewId} frozen source text changed.`);
  assert.equal(plan.planId, wiring.planId, `${reviewId} frozen planId changed.`);
  assert.equal(plan.interactionMoveHandoffPlan, null, `${reviewId} must remain positive-function-only.`);
  assert(!seenEmotionalNegativeWiringReviewIds.has(reviewId), `${reviewId} A10 wiring ran more than once.`);
  seenEmotionalNegativeWiringReviewIds.add(reviewId);
  const contract = plan.positiveFunctionContract;
  assert(contract?.action === "offer_emotional_support", `${reviewId} must bind emotional support.`);
  assert.deepEqual(
    {
      supportFunction: contract.supportFunction,
      sourceTurnId: contract.sourceTurnId,
      sourceText: contract.sourceText,
    },
    {
      supportFunction: wiring.supportFunction,
      sourceTurnId: wiring.sourceTurnId,
      sourceText: wiring.sourceText,
    },
    `${reviewId} frozen emotional-support contract changed.`
  );
  assert(wiring.defectLabel.length > 0, `${reviewId} must keep its case-specific defect label.`);
  const result = await validatePlannedFunctionSemanticOutput({
    plan,
    reply,
    semanticContext: { currentUserText, handoffTargetAssistantText: null },
    provider: async (input) => {
      assert.equal(input.planId, wiring.planId);
      assert.equal(input.candidateReply, wiring.reply);
      assert.equal(input.currentUserText, wiring.sourceText);
      assert.equal(input.handoffBinding, null);
      assert.deepEqual(input.positiveFunctionBinding, contract);
      return {
        schemaVersion: 1,
        planId: plan.planId,
        handoff: null,
        positiveFunction: {
          binding: {
            action: contract.action,
            supportFunction: contract.supportFunction,
            sourceTurnId: contract.sourceTurnId,
          },
          status: "not_satisfied" as const,
          realizedAction: null,
          targetAddressed: true,
          contractRealized: false,
          containsContradictoryMove: wiring.containsContradictoryMove,
          evidence: [],
        },
        semanticQuestionCount: 0,
      };
    },
  });
  assert.deepEqual(
    result.failureReasons,
    ["planned_function_semantic:positive_function_not_satisfied"],
    `${reviewId}:${wiring.defectLabel}`
  );
  return { result, defectLabel: wiring.defectLabel };
};

const attributionReplay = await Promise.all(attribution.reviews.map(async (review) => {
  const plan = plansByScenario.get(review.scenarioId);
  assert(plan, `${review.reviewId} is missing its frozen scenario plan.`);
  const frozenPlan = freezePreMinimalFixSurfacePlan(plan);
  const deterministicValidation = validateResponsePlanOutput({
    plan: frozenPlan,
    reply: review.firstReply,
  });
  const scenario = dataset.scenarios.find((item) => item.id === review.scenarioId);
  assert(scenario, `${review.reviewId} is missing its frozen scenario input.`);
  const emotionalNegativeWiring = emotionalNegativeWiringByReviewId.get(review.reviewId);
  if (emotionalNegativeWiring) {
    assert.equal(review.scenarioId, emotionalNegativeWiring.scenarioId);
    assert.equal(review.firstReply, emotionalNegativeWiring.reply);
    assert.equal(review.attribution, "surface_failure");
  }
  const repairNegativeWiring = repairNegativeWiringByReviewId.get(review.reviewId);
  if (repairNegativeWiring) {
    assert.equal(review.scenarioId, repairNegativeWiring.scenarioId);
    assert.equal(review.attribution, "surface_failure");
  }
  if (approvedExactNegativeWiringReviewIds.has(review.reviewId)) {
    assert(
      !seenExactNegativeWiringReviewIds.has(review.reviewId),
      `${review.reviewId} exact negative wiring ran more than once.`
    );
    seenExactNegativeWiringReviewIds.add(review.reviewId);
  }
  const semanticRepairValidation = repairNegativeWiring
    ? await validateRepairNegativeThroughCanonicalSemanticBoundary({
        reviewId: review.reviewId,
        wiring: repairNegativeWiring,
        plan: frozenPlan,
        reply: review.firstReply,
        currentUserText: scenario.userMessage,
      })
    : null;
  const semanticEmotionalValidation = emotionalNegativeWiring
    ? await validateEmotionalNegativeThroughCanonicalSemanticBoundary({
        reviewId: review.reviewId,
        wiring: emotionalNegativeWiring,
        plan: frozenPlan,
        reply: review.firstReply,
        currentUserText: scenario.userMessage,
      })
    : null;
  const semanticValidation = review.reviewId === "C2-02"
    ? await validateC202ThroughCanonicalSemanticBoundary({
        plan: frozenPlan,
        reply: review.firstReply,
        currentUserText: scenario.userMessage,
      })
    : semanticEmotionalValidation?.result ?? semanticRepairValidation?.result ?? null;
  const validation = semanticValidation
    ? {
        passed: deterministicValidation.passed && semanticValidation.passed,
        failureReasons: Array.from(new Set([
          ...deterministicValidation.failureReasons,
          ...semanticValidation.failureReasons,
        ])),
      }
    : deterministicValidation;
  if (review.reviewId === deferredBothReview.reviewId) {
    assert.equal(review.scenarioId, deferredBothReview.scenarioId);
    assert.equal(review.firstReply, deferredBothReview.reply);
    assert.equal(review.attribution, "both");
    assert(
      !validation.failureReasons.includes("emotional_support:generic_normalization_or_reassurance"),
      `${review.reviewId} must not restore the retired false-positive reason.`
    );
    return {
      reviewId: review.reviewId,
      attribution: review.attribution,
      validation,
      closureClass: "D-deferred" as const,
      closureReason: deferredBothReview.reason,
      defectLabel: null,
    };
  }
  const shouldPass = review.attribution === "validator_false_positive";
  assert.equal(
    validation.passed,
    shouldPass,
    `${review.reviewId} frozen attribution replay mismatch: ${validation.failureReasons.join(",")}`
  );
  if (review.attribution === "both") {
    assert(
      !validation.failureReasons.includes("emotional_support:generic_normalization_or_reassurance"),
      `${review.reviewId} must not keep the frozen Validator false-positive reason.`
    );
  }
  if (acceptedWithoutNegativeFixtureReviewIds.has(review.reviewId)) {
    assert.equal(review.attribution, "validator_false_positive");
    assert.equal(semanticValidation, null, `${review.reviewId} must not gain a fixed negative fixture.`);
  }
  if (activeQuestionGuardOwnedReviewIds.has(review.reviewId)) {
    assert.equal(semanticValidation, null, `${review.reviewId} remains owned by the active question guard.`);
    assert(validation.failureReasons.includes("question_not_allowed_by_plan"));
  }
  return {
    reviewId: review.reviewId,
    attribution: review.attribution,
    validation,
    closureClass: review.reviewId === "C2-02" || emotionalNegativeWiring || repairNegativeWiring
      ? "A-exact-negative"
      : acceptedWithoutNegativeFixtureReviewIds.has(review.reviewId)
        ? "B-accepted"
        : activeQuestionGuardOwnedReviewIds.has(review.reviewId)
          ? "A-active-question-guard"
          : "unchanged",
    closureReason: null,
    defectLabel: semanticEmotionalValidation?.defectLabel ?? semanticRepairValidation?.defectLabel ?? null,
  };
}));

assert.equal(emotionalNegativeWiringByReviewId.size, 10);
assert.deepEqual(
  [...seenEmotionalNegativeWiringReviewIds].sort(),
  [...emotionalNegativeWiringByReviewId.keys()].sort(),
  "Every product-approved A10 emotional fixture must execute exactly once."
);
assert.equal(repairNegativeWiringByReviewId.size, 5);
assert.equal(approvedExactNegativeWiringReviewIds.size, 16);
assert.deepEqual(
  [...seenExactNegativeWiringReviewIds].sort(),
  [...approvedExactNegativeWiringReviewIds].sort(),
  "Every approved exact negative wiring fixture must execute exactly once."
);
assert.equal(acceptedWithoutNegativeFixtureReviewIds.size, 5);
assert.equal(activeQuestionGuardOwnedReviewIds.size, 2);

assert.equal(dataset.gate.requiredValidatedRate, 1);
assert.equal(dataset.gate.requiredExpectedActionRate, 1);
assert.equal(dataset.gate.maximumConstraintFailures, 0);
assert.equal(dataset.gate.maximumHelpingProviderCalls, 0);
assert.equal(dataset.gate.maximumRegenerationRate, 0.2);

console.log(JSON.stringify({
  datasetVersion: dataset.datasetVersion,
  datasetSha256: sha256,
  scenarios: actionRows.length,
  emotionalSupportScenarios: actionRows.filter((row) => row.kind === "emotional_support").length,
  ordinaryRepairScenarios: actionRows.filter((row) => row.kind === "ordinary_repair").length,
  runsPerScenario: dataset.gate.runsPerScenario,
  frozenRealModelTurns: dataset.scenarios.length * dataset.gate.runsPerScenario,
  plannerPreflight: {
    passed: actionRows.filter((row) => row.planPreflightPassed).length,
    total: actionRows.length,
    emotionVagueBlockedReplay: vagueBlockedPreflightReplay,
  },
  frozenAttributionReplay: {
    total: attributionReplay.length,
    rejectedSurfaceFailures: attributionReplay.filter((row) => row.attribution === "surface_failure").length,
    acceptedValidatorFalsePositives: attributionReplay.filter((row) => row.attribution === "validator_false_positive").length,
    deferredBoth: attributionReplay.filter((row) => row.closureClass === "D-deferred").length,
    legacySemanticCheckClosure: {
      aExactNegativeWiring: attributionReplay.filter((row) => row.closureClass === "A-exact-negative").length,
      aActiveQuestionGuardOwned: attributionReplay.filter((row) => row.closureClass === "A-active-question-guard").length,
      bAcceptedWithoutNegativeFixture: attributionReplay.filter((row) => row.closureClass === "B-accepted").length,
      cDeferred: 0,
      dDeferred: attributionReplay.filter((row) => row.closureClass === "D-deferred").length,
    },
  },
  gate: dataset.gate,
}, null, 2));
};

void main();
