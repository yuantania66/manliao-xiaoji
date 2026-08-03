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
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { loadPreservationDataset } from "./hill-helping-batch1-5-preservation-lib";

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
const attributionReplay = attribution.reviews.map((review) => {
  const plan = plansByScenario.get(review.scenarioId);
  assert(plan, `${review.reviewId} is missing its frozen scenario plan.`);
  const validation = validateResponsePlanOutput({
    plan: freezePreMinimalFixSurfacePlan(plan),
    reply: review.firstReply,
  });
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
  return { reviewId: review.reviewId, attribution: review.attribution, validation };
});

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
    rejectedBoth: attributionReplay.filter((row) => row.attribution === "both").length,
  },
  gate: dataset.gate,
}, null, 2));
