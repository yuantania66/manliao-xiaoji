import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  formatResponsePlanRegenerateConstraint,
  validateResponsePlanOutput,
} from "../services/ai/responsePlanValidator";
import {
  loadPreservationDataset,
  type PreservationScenario,
} from "./hill-helping-batch1-5-preservation-lib";

const main = async () => {
type GateCase = {
  id: string;
  dimension: string;
  scenarioId: string;
  reply: string;
  expectedPass: boolean;
  expectedFailureIncludes: string[];
  rationale: string;
};
type GateDataset = {
  schemaVersion: 1;
  status: "frozen_before_code_change";
  minimumCases: number;
  cases: GateCase[];
};
type Attribution =
  | "planner_contract_failure"
  | "surface_failure"
  | "validator_false_positive"
  | "both"
  | "appropriate_pass"
  | "surface_failure_validator_false_negative";
type Candidate4Audit = {
  sourceArtifactSha256: string;
  datasetSha256: string;
  finalFailures: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    attribution: Attribution;
  }>;
  regenerationAudits: Array<{
    auditId: string;
    scenarioId: string;
    runIndex: number;
    firstAttribution: Attribution;
    secondAttribution: Attribution;
  }>;
};
type Candidate4Artifact = {
  datasetSha256: string;
  rows: Array<{
    scenarioId: string;
    runIndex: number;
    attempts: Array<{ attempt: number; text: string }>;
  }>;
};
type Candidate5Audit = {
  sourceArtifactSha256: string;
  datasetSha256: string;
  scope: { allFinalRowsAudited: number };
  anomalies: Array<{
    id: string;
    scenarioId: string;
    runIndex: number;
    attribution:
      | "surface_failure"
      | "validator_false_positive"
      | "both"
      | "surface_failure_validator_false_negative";
  }>;
};

type ExactNegativeFixture = {
  scenarioId: string;
  action: "offer_emotional_support" | "repair_previous_wording";
  defect: string;
};

type FrozenPositiveContractSignature =
  | {
      action: "offer_emotional_support";
      supportFunction: "return_focus_control" | "reduce_expression_burden";
      sourceTurnId: string;
      sourceText: string;
    }
  | {
      action: "repair_previous_wording";
      repairMode: "interaction_move_withdrawal";
      interactionMoveSubtype: "unsolicited_advice" | "pressure_question" |
        "generic_listening" | "moralizing" | "topic_switch";
      sourceTurnId: string;
      targetTurnId: "a1";
      targetText: string;
    };

const frozenPositiveContractSignatureByScenarioId = new Map<string, FrozenPositiveContractSignature>([
  ["emotion-vague-blocked", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-vague-blocked-turn", sourceText: "心里有点堵" }],
  ["emotion-sudden-sadness", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-sudden-sadness-turn", sourceText: "今天突然有点难过" }],
  ["emotion-future-worry", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-future-worry-turn", sourceText: "明天那件事让我有点担心" }],
  ["emotion-embarrassed", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-embarrassed-turn", sourceText: "我觉得有点丢脸" }],
  ["emotion-lonely", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-lonely-turn", sourceText: "今晚莫名有点孤单" }],
  ["emotion-irritated", { action: "offer_emotional_support", supportFunction: "return_focus_control", sourceTurnId: "emotion-irritated-turn", sourceText: "我现在真的很烦" }],
  ["emotion-no-analysis", { action: "offer_emotional_support", supportFunction: "reduce_expression_burden", sourceTurnId: "emotion-no-analysis-turn", sourceText: "我不想分析，只是有点难受" }],
  ["repair-advice-boundary", { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", interactionMoveSubtype: "unsolicited_advice", sourceTurnId: "repair-advice-boundary-turn", targetTurnId: "a1", targetText: "你可以先列三个方案，再决定怎么做。" }],
  ["repair-question-pressure", { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", interactionMoveSubtype: "pressure_question", sourceTurnId: "repair-question-pressure-turn", targetTurnId: "a1", targetText: "具体什么时候、在哪里、还有谁在场？" }],
  ["repair-generic-listening", { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", interactionMoveSubtype: "generic_listening", sourceTurnId: "repair-generic-listening-turn", targetTurnId: "a1", targetText: "我在，我会认真听你说。" }],
  ["repair-moralizing", { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", interactionMoveSubtype: "moralizing", sourceTurnId: "repair-moralizing-turn", targetTurnId: "a1", targetText: "你应该勇敢一点，不能总躲着。" }],
  ["repair-topic-switch", { action: "repair_previous_wording", repairMode: "interaction_move_withdrawal", interactionMoveSubtype: "topic_switch", sourceTurnId: "repair-topic-switch-turn", targetTurnId: "a1", targetText: "要不要先做个呼吸练习放松一下？" }],
]);

const exactNegativeFixtures = new Map<string, ExactNegativeFixture>([
  ["PC4-RAD-03", { scenarioId: "repair-advice-boundary", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["PC4-RAD-04", { scenarioId: "repair-advice-boundary", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["PC4-RPQ-03", { scenarioId: "repair-question-pressure", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["PC4-RPQ-04", { scenarioId: "repair-question-pressure", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["PC4-RGL-03", { scenarioId: "repair-generic-listening", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["PC4-RGL-04", { scenarioId: "repair-generic-listening", action: "repair_previous_wording", defect: "future_promise_without_withdrawal" }],
  ["PC4-RMO-03", { scenarioId: "repair-moralizing", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["PC4-RMO-04", { scenarioId: "repair-moralizing", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["PC4-RTS-03", { scenarioId: "repair-topic-switch", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["PC4-RTS-04", { scenarioId: "repair-topic-switch", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["PC4-AFF-08", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unsupported_affect_relabel" }],
  ["PC4-SCP-05", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["PC4-SCP-06", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["PC4-SCP-07", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["PC4-SCP-08", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "distraction_topic_switch" }],
  ["PC4-SCP-09", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unsupported_cause_or_event" }],
  ["PC4-SCP-10", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event_detail" }],
  ["PC4-SCP-11", { scenarioId: "emotion-future-worry", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["PC4-SCP-12", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "topic_switch" }],
  ["PC4-SRF-05", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["PC4-SRF-06", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_silence" }],
  ["PC4-SRF-09", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event" }],
  ["PC4-SRF-10", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "topic_switch" }],
  ["FRESH-RAD-N", { scenarioId: "repair-advice-boundary", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["FRESH-RPQ-N", { scenarioId: "repair-question-pressure", action: "repair_previous_wording", defect: "promise_without_withdrawal" }],
  ["FRESH-RGL-N", { scenarioId: "repair-generic-listening", action: "repair_previous_wording", defect: "repeats_rejected_promise" }],
  ["FRESH-RMO-N", { scenarioId: "repair-moralizing", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["FRESH-RTS-N", { scenarioId: "repair-topic-switch", action: "repair_previous_wording", defect: "wrong_repair_subtype" }],
  ["FRESH-SCOPE-UNRELATED-N", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["FRESH-SCOPE-CAUSE-N", { scenarioId: "emotion-future-worry", action: "offer_emotional_support", defect: "unsupported_cause_or_event" }],
  ["FRESH-SCOPE-DISTRACT-N", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "topic_switch" }],
  ["FRESH-SURFACE-PAUSE-N", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-F03", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-F04", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-F05", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-F06", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-F07", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-F08", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-F09", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-R01-1", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R02-1", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R04-1", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R05-1", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R07-1", { scenarioId: "emotion-future-worry", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R09-1", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event_detail" }],
  ["C4-R09-2", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R10-1", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event" }],
  ["C4-R10-2", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R11-1", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event_and_unknown_content" }],
  ["C4-R11-2", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R12-1", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "distraction_topic_switch" }],
  ["C4-R12-2", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C4-R13-1", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "missing_known_focus_and_topic_switch" }],
  ["C4-R13-2", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "topic_switch" }],
  ["C4-R14-1", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "missing_known_focus_and_distraction" }],
  ["C4-R14-2", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C4-R15-2", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C4-R16-2", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C4-R17-2", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unsupported_cause_or_event" }],
  ["C4-R18-1", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "pause_and_unknown_content" }],
  ["C4-R18-2", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-R19-1", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-R19-2", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-R20-1", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "missing_grounding_and_pause" }],
  ["C4-R20-2", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C4-R24-1", { scenarioId: "repair-generic-listening", action: "repair_previous_wording", defect: "missing_repair_target" }],
  ["C5-FN-01", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C5-FN-02", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C5-FN-03", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C5-FN-04", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "unsupported_event" }],
  ["C5-FN-05", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "unsupported_event" }],
  ["C5-FN-06", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C5-FN-07", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unrequested_pause" }],
  ["C5-FN-08", { scenarioId: "emotion-lonely", action: "offer_emotional_support", defect: "unsupported_cause_or_event" }],
  ["C5-FN-09", { scenarioId: "emotion-irritated", action: "offer_emotional_support", defect: "unknown_content_alternative" }],
  ["C5-FN-10", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unknown_content_and_deferral" }],
  ["C5-SF-02", { scenarioId: "emotion-sudden-sadness", action: "offer_emotional_support", defect: "unsupported_event" }],
  ["C5-SF-03", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event_or_cause" }],
  ["C5-SF-04", { scenarioId: "emotion-embarrassed", action: "offer_emotional_support", defect: "unsupported_event_and_topic_switch" }],
  ["C5-SF-05", { scenarioId: "emotion-no-analysis", action: "offer_emotional_support", defect: "unrequested_pause" }],
]);

const staleAcceptedCaseIds = new Set([
  "PC4-SRF-07",
  "FRESH-SURFACE-NORMALIZE-N",
  "C4-F02",
  "C4-R06-1",
  "C4-R08-1",
  "C4-R08-2",
]);

const deferredCases = new Map([
  ["PC4-SRF-08", { scenarioId: "emotion-future-worry", action: "offer_emotional_support", reply: "这点担心，你想先说哪部分，也可以做个呼吸练习。", category: "C", reason: "Unsolicited regulation advice needs a product boundary decision." }],
  ["FRESH-SURFACE-BREATH-N", { scenarioId: "emotion-future-worry", action: "offer_emotional_support", reply: "这点担心，你想先说哪部分，也可以做几次腹式呼吸。", category: "C", reason: "Unsolicited regulation advice needs a product boundary decision." }],
  ["C4-F01", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", reply: "心里堵着确实不好受。你想先说说这股堵的感觉，还是聊点别的透透气，都看你的节奏。", category: "D", reason: "True topic switch and false missing-grounding reason must be separated." }],
  ["C4-R03-2", { scenarioId: "emotion-vague-blocked", action: "offer_emotional_support", reply: "心里堵着确实不好受。你想先说说这股堵的感觉，还是聊点别的透透气，都看你的节奏。", category: "D", reason: "True topic switch and false missing-grounding reason must be separated." }],
]);

const activeDeterministicCaseIds = new Set([
  "PC4-AFF-06", "PC4-AFF-07", "PC4-AFF-09", "PC4-AFF-10",
  "FRESH-AFF-FEAR-N", "FRESH-AFF-INTENSE-N",
  "C4-R15-1", "C4-R16-1", "C4-R17-1", "C5-SF-01",
]);

const seenExactNegativeFixtures = new Set<string>();
const seenStaleAcceptedCases = new Set<string>();
const seenDeferredCases = new Set<string>();
const seenActiveDeterministicCases = new Set<string>();
const seenApprovedLegacyNegativeCases = new Set<string>();

const { dataset, sha256 } = loadPreservationDataset();
const buildPlan = (scenario: PreservationScenario): ResponsePlan => {
  const conversationState = determineConversationState({
    currentUserMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
  });
  const context = assembleConversationControlContext({
    conversationId: `post-candidate4-${scenario.id}`,
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
            evidence: ["Post-candidate-4 fixture contains current-turn affect."],
          }]
        : [{
            relation: "repairs_previous_move",
            confidence: 0.95,
            targetTurnId: scenario.recentMessages.at(-1)?.id,
            evidence: ["Post-candidate-4 fixture rejects the adjacent assistant move."],
          }],
      ambiguous: false,
    },
  }, context);
  const dialogueState = buildDialogueState(context, interpretation);
  const plan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
  assert(plan.responseActions.includes(scenario.expectedAction), `${scenario.id} action mismatch.`);
  const preflight = preflightResponsePlan(plan);
  assert.equal(preflight.passed, true, `${scenario.id} preflight: ${preflight.failureReasons.join(",")}`);
  return plan;
};

const plans = new Map(dataset.scenarios.map((scenario) => [scenario.id, buildPlan(scenario)]));
const planFor = (scenarioId: string) => {
  const plan = plans.get(scenarioId);
  assert(plan, `Missing plan for ${scenarioId}.`);
  return plan;
};
const planForFrozenSurfaceReplay = (scenarioId: string): ResponsePlan => {
  const plan = planFor(scenarioId);
  return plan.positiveFunctionContract?.action === "offer_emotional_support" &&
    plan.positiveFunctionContract.supportFunction === "return_amount_control"
    ? {
        ...plan,
        positiveFunctionContract: {
          ...plan.positiveFunctionContract,
          supportFunction: "return_focus_control",
        },
      }
    : plan;
};

const gateSource = readFileSync("clinical-evals/hill-helping-batch1-5-post-candidate4-gate.json");
const gate = JSON.parse(gateSource.toString("utf8")) as GateDataset;
assert.equal(gate.schemaVersion, 1);
assert.equal(gate.status, "frozen_before_code_change");
assert(gate.cases.length >= gate.minimumCases);
assert(gate.cases.filter((item) => item.expectedPass).length >= 20);
assert(gate.cases.filter((item) => !item.expectedPass).length >= 20);

const contractSignatureFor = (
  contract: NonNullable<ResponsePlan["positiveFunctionContract"]>
): FrozenPositiveContractSignature | null => {
  if (contract.action === "offer_emotional_support") {
    if (contract.supportFunction !== "return_focus_control" &&
        contract.supportFunction !== "reduce_expression_burden") return null;
    return {
      action: contract.action,
      supportFunction: contract.supportFunction,
      sourceTurnId: contract.sourceTurnId,
      sourceText: contract.sourceText,
    };
  }
  if (contract.action === "repair_previous_wording" &&
      contract.repairMode === "interaction_move_withdrawal" &&
      contract.interactionMoveSubtype !== null) {
    return {
      action: contract.action,
      repairMode: contract.repairMode,
      interactionMoveSubtype: contract.interactionMoveSubtype,
      sourceTurnId: contract.sourceTurnId,
      targetTurnId: contract.targetTurnId as "a1",
      targetText: contract.targetText,
    };
  }
  return null;
};

const assertExactFrozenPositiveContract = ({
  fixtureId,
  scenarioId,
  plan,
}: {
  fixtureId: string;
  scenarioId: string;
  plan: ResponsePlan;
}) => {
  assert.equal(
    plan.planId,
    `post-candidate4-${scenarioId}:${scenarioId}-turn:response-plan`,
    `${fixtureId} frozen planId changed.`
  );
  const expectedSignature = frozenPositiveContractSignatureByScenarioId.get(scenarioId);
  assert(expectedSignature, `${fixtureId} has no frozen positive-function signature for ${scenarioId}.`);
  const contract = plan.positiveFunctionContract;
  assert(contract, `${fixtureId} must bind a positive function.`);
  assert.deepEqual(
    contractSignatureFor(contract),
    expectedSignature,
    `${fixtureId} frozen positive-function contract changed.`
  );
  return contract;
};

const approvedLegacyNegativeCaseIds = new Set([
  ...exactNegativeFixtures.keys(),
  ...activeDeterministicCaseIds,
  ...staleAcceptedCaseIds,
  ...deferredCases.keys(),
  "C5-BOTH-01",
]);

const recordApprovedLegacyNegative = (fixtureId: string, originalExpectedPass: boolean) => {
  if (originalExpectedPass) return;
  assert(
    approvedLegacyNegativeCaseIds.has(fixtureId),
    `${fixtureId} is an unclassified legacy negative; expected=false must never be a fallback.`
  );
  seenApprovedLegacyNegativeCases.add(fixtureId);
};

// M0 wiring fixtures only: fixed negative verdicts prove exact PHM-C binding and
// fail-closed rejection. They are not evidence that a real model understood a reply.
const validateExactNegativeThroughCanonicalSemanticBoundary = async ({
  fixtureId,
  scenarioId,
  plan,
  reply,
  currentUserText,
}: {
  fixtureId: string;
  scenarioId: string;
  plan: ResponsePlan;
  reply: string;
  currentUserText: string;
}) => {
  const fixture = exactNegativeFixtures.get(fixtureId);
  assert(fixture, `${fixtureId} is not an approved exact negative fixture.`);
  assert.equal(fixture.scenarioId, scenarioId, `${fixtureId} scenario binding changed.`);
  assert(!seenExactNegativeFixtures.has(fixtureId), `${fixtureId} ran more than once.`);
  seenExactNegativeFixtures.add(fixtureId);
  assert.equal(plan.interactionMoveHandoffPlan, null, `${fixtureId} must remain positive-function-only.`);
  const contract = assertExactFrozenPositiveContract({ fixtureId, scenarioId, plan });
  assert.equal(contract.action, fixture.action, `${fixtureId} positive-function action changed.`);
  assert(fixture.defect.length > 0, `${fixtureId} must name its approved defect.`);
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
      const binding = contract.action === "offer_emotional_support"
        ? {
            action: contract.action,
            supportFunction: contract.supportFunction,
            sourceTurnId: contract.sourceTurnId,
          }
        : contract.action === "repair_previous_wording"
          ? {
              action: contract.action,
              repairMode: contract.repairMode,
              sourceTurnId: contract.sourceTurnId,
              targetTurnId: contract.targetTurnId,
            }
          : null;
      assert(binding, `${fixtureId} action is outside this closure slice.`);
      return {
        schemaVersion: 1,
        planId: plan.planId,
        handoff: null,
        positiveFunction: {
          binding,
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

const recordDeferredCase = ({
  fixtureId,
  scenarioId,
  plan,
  reply,
}: {
  fixtureId: string;
  scenarioId: string;
  plan: ResponsePlan;
  reply: string;
}) => {
  const deferred = deferredCases.get(fixtureId);
  assert(deferred, `${fixtureId} is not an approved deferred fixture.`);
  assert.equal(deferred.scenarioId, scenarioId, `${fixtureId} deferred scenario binding changed.`);
  assert.equal(deferred.reply, reply, `${fixtureId} deferred reply binding changed.`);
  const contract = assertExactFrozenPositiveContract({ fixtureId, scenarioId, plan });
  assert.equal(
    contract.action,
    deferred.action,
    `${fixtureId} deferred positive-function binding changed.`
  );
  assert(!seenDeferredCases.has(fixtureId), `${fixtureId} deferred fixture ran more than once.`);
  seenDeferredCases.add(fixtureId);
  return deferred;
};

const expectedPassAfterStaleRetirement = (fixtureId: string, originalExpectedPass: boolean) => {
  if (!staleAcceptedCaseIds.has(fixtureId)) return originalExpectedPass;
  assert.equal(originalExpectedPass, false, `${fixtureId} is no longer a stale negative expectation.`);
  assert(!seenStaleAcceptedCases.has(fixtureId), `${fixtureId} stale acceptance ran more than once.`);
  seenStaleAcceptedCases.add(fixtureId);
  return true;
};

const recordActiveDeterministicCase = (fixtureId: string, validation: { passed: boolean }) => {
  if (!activeDeterministicCaseIds.has(fixtureId)) return;
  assert.equal(validation.passed, false, `${fixtureId} active deterministic guard no longer rejects.`);
  assert(!seenActiveDeterministicCases.has(fixtureId), `${fixtureId} active guard ran more than once.`);
  seenActiveDeterministicCases.add(fixtureId);
};

for (const testCase of gate.cases) {
  recordApprovedLegacyNegative(testCase.id, testCase.expectedPass);
  const frozenPlan = planForFrozenSurfaceReplay(testCase.scenarioId);
  const deterministicValidation = validateResponsePlanOutput({
    plan: frozenPlan,
    reply: testCase.reply,
  });
  const scenario = dataset.scenarios.find((item) => item.id === testCase.scenarioId);
  assert(scenario, `${testCase.id} is missing its frozen scenario input.`);
  if (deferredCases.has(testCase.id)) {
    recordDeferredCase({
      fixtureId: testCase.id,
      scenarioId: testCase.scenarioId,
      plan: frozenPlan,
      reply: testCase.reply,
    });
    continue;
  }
  const semanticValidation = exactNegativeFixtures.has(testCase.id)
    ? await validateExactNegativeThroughCanonicalSemanticBoundary({
        fixtureId: testCase.id,
        scenarioId: testCase.scenarioId,
        plan: frozenPlan,
        reply: testCase.reply,
        currentUserText: scenario.userMessage,
      })
    : null;
  const validation = semanticValidation
    ? {
        passed: deterministicValidation.passed && semanticValidation.passed,
        failureReasons: Array.from(new Set([
          ...deterministicValidation.failureReasons,
          ...semanticValidation.failureReasons,
        ])),
      }
    : deterministicValidation;
  recordActiveDeterministicCase(testCase.id, validation);
  const expectedPass = expectedPassAfterStaleRetirement(testCase.id, testCase.expectedPass);
  assert.equal(
    validation.passed,
    expectedPass,
    `${testCase.id} mismatch: ${validation.failureReasons.join(",")}`
  );
  const expectedFailures = semanticValidation
    ? ["planned_function_semantic:positive_function_not_satisfied"]
    : expectedPass
      ? []
      : testCase.expectedFailureIncludes;
  for (const failure of expectedFailures) {
    assert(
      validation.failureReasons.includes(failure),
      `${testCase.id} missing ${failure}: ${validation.failureReasons.join(",")}`
    );
  }
}

const freshAdversarialCases: GateCase[] = [
  {
    id: "FRESH-RAD-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-advice-boundary",
    reply: "刚才替你列步骤是在给方案，是我多嘴，这种做法不该。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Advice is identified and disavowed through a new composition.",
  },
  {
    id: "FRESH-RPQ-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-question-pressure",
    reply: "一个问题接一个问题地抛给你，是我在盘问，这样越界了。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Question pressure is owned without copying the frozen forms.",
  },
  {
    id: "FRESH-RGL-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-generic-listening",
    reply: "光顾着说认真听，却没有接你的重点，是我的问题。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Generic listening is rejected by its failed function.",
  },
  {
    id: "FRESH-RMO-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-moralizing",
    reply: "把勇敢一点当成标准来评判你，是我说教越界了。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Moral evaluation target and boundary are explicit.",
  },
  {
    id: "FRESH-RTS-P",
    dimension: "repair_adversarial",
    scenarioId: "repair-topic-switch",
    reply: "刚才扯到放松上，把你原来的话带偏了，是我的问题。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Topic detour is identified by its effect.",
  },
  {
    id: "FRESH-RAD-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-advice-boundary",
    reply: "我刚才追着问细节了，这样越界。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:unsolicited_advice"],
    rationale: "Wrong repair target must remain rejected.",
  },
  {
    id: "FRESH-RPQ-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-question-pressure",
    reply: "我刚才抛了一串问题，下次会注意。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:pressure_question"],
    rationale: "Future promise is not functional disavowal.",
  },
  {
    id: "FRESH-RGL-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-generic-listening",
    reply: "我刚才只是在说会听，以后会更认真听。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:generic_listening"],
    rationale: "Repeating the rejected promise is not repair.",
  },
  {
    id: "FRESH-RMO-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-moralizing",
    reply: "我刚才表达得不好，是我的问题。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:moralizing"],
    rationale: "Vague ownership lacks the rejected moral target.",
  },
  {
    id: "FRESH-RTS-N",
    dimension: "repair_adversarial",
    scenarioId: "repair-topic-switch",
    reply: "我不该继续给你列方案。",
    expectedPass: false,
    expectedFailureIncludes: ["repair:missing_interaction_move_withdrawal:topic_switch"],
    rationale: "Advice withdrawal cannot satisfy a topic-switch repair.",
  },
  {
    id: "FRESH-AFF-BLOCKED-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-vague-blocked",
    reply: "心里那股堵，你愿意先碰哪一块都可以。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Blocked affect survives a new demonstrative form.",
  },
  {
    id: "FRESH-AFF-SAD-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "眼下这阵伤心，你想先说哪一点都行。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "A same-category sadness synonym remains grounded.",
  },
  {
    id: "FRESH-AFF-MIXED-P",
    dimension: "affect_adversarial",
    scenarioId: "emotion-mixed-anger",
    reply: "这份委屈和生气，先说哪部分由你定。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Both user-provided affect categories remain in scope.",
  },
  {
    id: "FRESH-AFF-FEAR-N",
    dimension: "affect_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份害怕，你想先讲哪部分都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsupported_affect_category:fear:害怕"],
    rationale: "Loneliness cannot be relabeled as fear.",
  },
  {
    id: "FRESH-AFF-INTENSE-N",
    dimension: "affect_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "现在非常难过，你想先说哪一点都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsupported_intensification:非常难过"],
    rationale: "A low-intensity source cannot be intensified.",
  },
  {
    id: "FRESH-SCOPE-CURRENT-P",
    dimension: "scope_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份孤单，你想先碰眼下的感觉还是今晚这一刻都可以。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Both choices refer to current evidence.",
  },
  {
    id: "FRESH-SCOPE-ASPECT-P",
    dimension: "scope_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "关于这份难过，先说这种感受的哪一面由你定。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "A new aspect noun remains scoped by current sadness.",
  },
  {
    id: "FRESH-SCOPE-UNRELATED-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-lonely",
    reply: "这份孤单，你也可以聊聊无关的内容。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_unknown_content"],
    rationale: "Unrelated content is outside the current turn.",
  },
  {
    id: "FRESH-SCOPE-CAUSE-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-future-worry",
    reply: "这点担心，你想先说还有哪些事情使你担心都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_unsupported_cause_or_event"],
    rationale: "Unmentioned additional causes must be rejected.",
  },
  {
    id: "FRESH-SCOPE-DISTRACT-N",
    dimension: "scope_adversarial",
    scenarioId: "emotion-irritated",
    reply: "这股烦，你也可以先谈点轻松的把注意力挪开。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:out_of_scope_topic_switch"],
    rationale: "A synonymous distraction move remains out of scope.",
  },
  {
    id: "FRESH-SURFACE-BURDEN-P",
    dimension: "surface_adversarial",
    scenarioId: "emotion-no-analysis",
    reply: "这点难受不必分析来龙去脉，也不用讲完整。",
    expectedPass: true,
    expectedFailureIncludes: [],
    rationale: "Burden reduction does not add another action.",
  },
  {
    id: "FRESH-SURFACE-PAUSE-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-no-analysis",
    reply: "这点难受不用分析，先搁一搁。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unrequested_pause_or_closure"],
    rationale: "A synonymous pause must not be smuggled into burden reduction.",
  },
  {
    id: "FRESH-SURFACE-BREATH-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-future-worry",
    reply: "这点担心，你想先说哪部分，也可以做几次腹式呼吸。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:unsolicited_regulation_advice"],
    rationale: "A new breathing-exercise wording is still regulation advice.",
  },
  {
    id: "FRESH-SURFACE-NORMALIZE-N",
    dimension: "surface_adversarial",
    scenarioId: "emotion-sudden-sadness",
    reply: "这份难过是人之常情，你想先说哪部分都可以。",
    expectedPass: false,
    expectedFailureIncludes: ["emotional_support:generic_normalization_or_reassurance"],
    rationale: "A synonymous normalization remains prohibited.",
  },
];

for (const testCase of freshAdversarialCases) {
  recordApprovedLegacyNegative(testCase.id, testCase.expectedPass);
  const frozenPlan = planForFrozenSurfaceReplay(testCase.scenarioId);
  const deterministicValidation = validateResponsePlanOutput({
    plan: frozenPlan,
    reply: testCase.reply,
  });
  const scenario = dataset.scenarios.find((item) => item.id === testCase.scenarioId);
  assert(scenario, `${testCase.id} is missing its frozen scenario input.`);
  if (deferredCases.has(testCase.id)) {
    recordDeferredCase({
      fixtureId: testCase.id,
      scenarioId: testCase.scenarioId,
      plan: frozenPlan,
      reply: testCase.reply,
    });
    continue;
  }
  const semanticValidation = exactNegativeFixtures.has(testCase.id)
    ? await validateExactNegativeThroughCanonicalSemanticBoundary({
        fixtureId: testCase.id,
        scenarioId: testCase.scenarioId,
        plan: frozenPlan,
        reply: testCase.reply,
        currentUserText: scenario.userMessage,
      })
    : null;
  const validation = semanticValidation
    ? {
        passed: deterministicValidation.passed && semanticValidation.passed,
        failureReasons: Array.from(new Set([
          ...deterministicValidation.failureReasons,
          ...semanticValidation.failureReasons,
        ])),
      }
    : deterministicValidation;
  recordActiveDeterministicCase(testCase.id, validation);
  const expectedPass = expectedPassAfterStaleRetirement(testCase.id, testCase.expectedPass);
  assert.equal(
    validation.passed,
    expectedPass,
    `${testCase.id} mismatch: ${validation.failureReasons.join(",")}`
  );
  const expectedFailures = semanticValidation
    ? ["planned_function_semantic:positive_function_not_satisfied"]
    : expectedPass
      ? []
      : testCase.expectedFailureIncludes;
  for (const failure of expectedFailures) {
    assert(
      validation.failureReasons.includes(failure),
      `${testCase.id} missing ${failure}: ${validation.failureReasons.join(",")}`
    );
  }
}

const audit = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate4-layered-attribution-20260803.json",
  "utf8"
)) as Candidate4Audit;
const artifactSource = readFileSync(
  "docs/evals/hill-helping-batch1-5-preservation-candidate4-20260803.json"
);
const artifact = JSON.parse(artifactSource.toString("utf8")) as Candidate4Artifact;
assert.equal(audit.datasetSha256, sha256);
assert.equal(artifact.datasetSha256, sha256);
assert.equal(createHash("sha256").update(artifactSource).digest("hex"), audit.sourceArtifactSha256);
assert.equal(audit.finalFailures.length, 16);
assert.equal(audit.regenerationAudits.length, 30);

const shouldPass = (attribution: Attribution) =>
  attribution === "validator_false_positive" || attribution === "appropriate_pass";
const finalReplay = await Promise.all(audit.finalFailures.map(async (entry) => {
  recordApprovedLegacyNegative(entry.auditId, shouldPass(entry.attribution));
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} row missing.`);
  const attempt = row.attempts.at(-1);
  assert(attempt, `${entry.auditId} final attempt missing.`);
  const frozenPlan = planForFrozenSurfaceReplay(entry.scenarioId);
  const deterministicValidation = validateResponsePlanOutput({
    plan: frozenPlan,
    reply: attempt.text,
  });
  if (deferredCases.has(entry.auditId)) {
    const deferred = recordDeferredCase({
      fixtureId: entry.auditId,
      scenarioId: entry.scenarioId,
      plan: frozenPlan,
      reply: attempt.text,
    });
    return { ...entry, validation: deterministicValidation, deferred };
  }
  const scenario = dataset.scenarios.find((item) => item.id === entry.scenarioId);
  assert(scenario, `${entry.auditId} is missing its frozen scenario input.`);
  const semanticValidation = exactNegativeFixtures.has(entry.auditId)
    ? await validateExactNegativeThroughCanonicalSemanticBoundary({
        fixtureId: entry.auditId,
        scenarioId: entry.scenarioId,
        plan: frozenPlan,
        reply: attempt.text,
        currentUserText: scenario.userMessage,
      })
    : null;
  const validation = semanticValidation
    ? {
        passed: deterministicValidation.passed && semanticValidation.passed,
        failureReasons: Array.from(new Set([
          ...deterministicValidation.failureReasons,
          ...semanticValidation.failureReasons,
        ])),
      }
    : deterministicValidation;
  const expectedPass = expectedPassAfterStaleRetirement(
    entry.auditId,
    shouldPass(entry.attribution)
  );
  assert.equal(
    validation.passed,
    expectedPass,
    `${entry.auditId} ${entry.attribution}: ${validation.failureReasons.join(",")}`
  );
  if (entry.attribution === "both") {
    assert(
      !validation.failureReasons.includes("emotional_support:missing_grounded_affect_or_impact"),
      `${entry.auditId} must remove the false grounding reason.`
    );
  }
  return { ...entry, validation };
}));

const regenerationReplay = (await Promise.all(audit.regenerationAudits.map(async (entry) => {
  const row = artifact.rows.find((candidate) =>
    candidate.scenarioId === entry.scenarioId && candidate.runIndex === entry.runIndex
  );
  assert(row, `${entry.auditId} row missing.`);
  return Promise.all([entry.firstAttribution, entry.secondAttribution].map(async (attribution, index) => {
    const fixtureId = `${entry.auditId}-${index + 1}`;
    recordApprovedLegacyNegative(fixtureId, shouldPass(attribution));
    const attempt = row.attempts[index];
    assert(attempt, `${entry.auditId} attempt ${index + 1} missing.`);
    const frozenPlan = planForFrozenSurfaceReplay(entry.scenarioId);
    const deterministicValidation = validateResponsePlanOutput({
      plan: frozenPlan,
      reply: attempt.text,
    });
    if (deferredCases.has(fixtureId)) {
      const deferred = recordDeferredCase({
        fixtureId,
        scenarioId: entry.scenarioId,
        plan: frozenPlan,
        reply: attempt.text,
      });
      return {
        auditId: entry.auditId,
        attempt: index + 1,
        attribution,
        validation: deterministicValidation,
        deferred,
      };
    }
    const scenario = dataset.scenarios.find((item) => item.id === entry.scenarioId);
    assert(scenario, `${fixtureId} is missing its frozen scenario input.`);
    const semanticValidation = exactNegativeFixtures.has(fixtureId)
      ? await validateExactNegativeThroughCanonicalSemanticBoundary({
          fixtureId,
          scenarioId: entry.scenarioId,
          plan: frozenPlan,
          reply: attempt.text,
          currentUserText: scenario.userMessage,
        })
      : null;
    const validation = semanticValidation
      ? {
          passed: deterministicValidation.passed && semanticValidation.passed,
          failureReasons: Array.from(new Set([
            ...deterministicValidation.failureReasons,
            ...semanticValidation.failureReasons,
          ])),
        }
      : deterministicValidation;
    recordActiveDeterministicCase(fixtureId, validation);
    const expectedPass = expectedPassAfterStaleRetirement(fixtureId, shouldPass(attribution));
    assert.equal(
      validation.passed,
      expectedPass,
      `${entry.auditId} attempt ${index + 1} ${attribution}: ${validation.failureReasons.join(",")}`
    );
    if (attribution === "surface_failure_validator_false_negative") {
      assert(validation.failureReasons.length > 0, `${entry.auditId} false negative must now reject.`);
    }
    return { auditId: entry.auditId, attempt: index + 1, attribution, validation };
  }));
}))).flat();

const candidate5Audit = JSON.parse(readFileSync(
  "docs/evals/hill-helping-batch1-5-candidate5-full-final-attribution-20260803.json",
  "utf8"
)) as Candidate5Audit;
const candidate5ArtifactSource = readFileSync(
  "docs/evals/hill-helping-batch1-5-preservation-candidate5-20260803.json"
);
const candidate5Artifact = JSON.parse(candidate5ArtifactSource.toString("utf8")) as Candidate4Artifact;
assert.equal(candidate5Audit.datasetSha256, sha256);
assert.equal(candidate5Artifact.datasetSha256, sha256);
assert.equal(
  createHash("sha256").update(candidate5ArtifactSource).digest("hex"),
  candidate5Audit.sourceArtifactSha256
);
assert.equal(candidate5Artifact.rows.length, candidate5Audit.scope.allFinalRowsAudited);
const candidate5Anomalies = new Map(candidate5Audit.anomalies.map((item) => [
  `${item.scenarioId}:${item.runIndex}`,
  item,
]));
const candidate5FinalReplay = await Promise.all(candidate5Artifact.rows.map(async (row) => {
  const finalAttempt = row.attempts.at(-1);
  assert(finalAttempt, `${row.scenarioId}:${row.runIndex} final attempt missing.`);
  const frozenPlan = planForFrozenSurfaceReplay(row.scenarioId);
  const deterministicValidation = validateResponsePlanOutput({
    plan: frozenPlan,
    reply: finalAttempt.text,
  });
  const anomaly = candidate5Anomalies.get(`${row.scenarioId}:${row.runIndex}`);
  const expectedPass = !anomaly || anomaly.attribution === "validator_false_positive";
  if (anomaly) recordApprovedLegacyNegative(anomaly.id, expectedPass);
  const scenario = dataset.scenarios.find((item) => item.id === row.scenarioId);
  assert(scenario, `candidate5 ${row.scenarioId}:${row.runIndex} is missing its frozen scenario input.`);
  const semanticValidation = anomaly && exactNegativeFixtures.has(anomaly.id)
    ? await validateExactNegativeThroughCanonicalSemanticBoundary({
        fixtureId: anomaly.id,
        scenarioId: row.scenarioId,
        plan: frozenPlan,
        reply: finalAttempt.text,
        currentUserText: scenario.userMessage,
      })
    : null;
  const validation = semanticValidation
    ? {
        passed: deterministicValidation.passed && semanticValidation.passed,
        failureReasons: Array.from(new Set([
          ...deterministicValidation.failureReasons,
          ...semanticValidation.failureReasons,
        ])),
      }
    : deterministicValidation;
  if (anomaly) recordActiveDeterministicCase(anomaly.id, validation);
  assert.equal(
    validation.passed,
    expectedPass,
    `candidate5 ${row.scenarioId}:${row.runIndex} ${anomaly?.attribution ?? "appropriate_pass"}: ${validation.failureReasons.join(",")}`
  );
  if (anomaly?.attribution === "both") {
    assert(
      validation.failureReasons.includes("question_not_allowed_by_plan"),
      `candidate5 ${row.scenarioId}:${row.runIndex} must reject continued pressure questioning.`
    );
    assert(
      !validation.failureReasons.includes("repair:missing_interaction_move_withdrawal:pressure_question"),
      `candidate5 ${row.scenarioId}:${row.runIndex} must accept the completed repair relation.`
    );
  }
  return { row, anomaly, validation };
}));
assert(
  !planFor("repair-question-pressure").responseActions.includes("take_light_topic_initiative"),
  "Repair must not concurrently start a light topic."
);

const emotionalPrompt = formatResponsePlanForPrompt(
  planForFrozenSurfaceReplay("emotion-lonely")
);
assert(emotionalPrompt.includes("unspecified 'something else'"));
assert(emotionalPrompt.includes("content already evidenced in the current user turn"));
assert(emotionalPrompt.includes("Do not manufacture an A-or-B choice"));
const repairPlan = planFor("repair-topic-switch");
const repairPrompt = formatResponsePlanForPrompt(repairPlan);
assert(repairPrompt.includes("要不要先做个呼吸练习放松一下？"));
assert(repairPrompt.includes("do not mechanically repeat the internal subtype name"));
const scopeRegeneration = formatResponsePlanRegenerateConstraint(
  planForFrozenSurfaceReplay("emotion-lonely"),
  ["emotional_support:out_of_scope_unknown_content"]
);
assert(scopeRegeneration.includes("当前用户本轮已经表达的内容"));
const repairRegeneration = formatResponsePlanRegenerateConstraint(
  repairPlan,
  ["repair:missing_interaction_move_withdrawal:topic_switch"]
);
assert(repairRegeneration.includes("要不要先做个呼吸练习放松一下？"));
assert(repairRegeneration.includes("不要求复述内部子类型"));

assert.equal(exactNegativeFixtures.size, 80, "Post-candidate4 closure must wire exactly 80 approved A cases.");
assert.deepEqual(
  [...seenExactNegativeFixtures].sort(),
  [...exactNegativeFixtures.keys()].sort(),
  "Every approved A fixture must run exactly once."
);
assert.deepEqual(
  [...seenStaleAcceptedCases].sort(),
  [...staleAcceptedCaseIds].sort(),
  "Every approved stale normalization expectation must retire exactly once."
);
assert.deepEqual(
  [...seenDeferredCases].sort(),
  [...deferredCases.keys()].sort(),
  "Every approved C/D case must be explicitly deferred exactly once."
);
assert.deepEqual(
  [...seenActiveDeterministicCases].sort(),
  [...activeDeterministicCaseIds].sort(),
  "Every active deterministic A case must remain rejected without a semantic fixture."
);
assert.deepEqual(
  [...seenApprovedLegacyNegativeCases].sort(),
  [...approvedLegacyNegativeCaseIds].sort(),
  "Every legacy negative must have one explicit A/B/C/D/active classification; expected=false is never a fallback."
);

console.log(JSON.stringify({
  stage: "batch1.5-post-candidate4-local-gate",
  datasetSha256: sha256,
  independentGate: {
    sha256: createHash("sha256").update(gateSource).digest("hex"),
    total: gate.cases.length,
    frozenExpectedAccepted: gate.cases.filter((item) => item.expectedPass).length,
    frozenExpectedRejected: gate.cases.filter((item) => !item.expectedPass).length,
    dimensions: Object.fromEntries(Array.from(new Set(gate.cases.map((item) => item.dimension))).map(
      (dimension) => [dimension, gate.cases.filter((item) => item.dimension === dimension).length]
    )),
  },
  candidate4Replay: {
    finalFailures: finalReplay.length,
    deferredFinalFailures: finalReplay.filter((item) => "deferred" in item).length,
    regenerationRuns: audit.regenerationAudits.length,
    attempts: regenerationReplay.length,
    deferredAttempts: regenerationReplay.filter((item) => "deferred" in item).length,
    adjudicatedAccepted: regenerationReplay.filter((item) =>
      !("deferred" in item) && item.validation.passed
    ).length,
    adjudicatedRejected: regenerationReplay.filter((item) =>
      !("deferred" in item) && !item.validation.passed
    ).length,
  },
  candidate5FullFinalReplay: {
    total: candidate5FinalReplay.length,
    accepted: candidate5FinalReplay.filter((item) => item.validation.passed).length,
    rejected: candidate5FinalReplay.filter((item) => !item.validation.passed).length,
    correctedValidatorFalseNegatives: candidate5FinalReplay.filter((item) =>
      item.anomaly?.attribution === "surface_failure_validator_false_negative" && !item.validation.passed
    ).length,
    correctedValidatorFalsePositives: candidate5FinalReplay.filter((item) =>
      item.anomaly?.attribution === "validator_false_positive" && item.validation.passed
    ).length,
  },
  freshAdversarialCases: {
    total: freshAdversarialCases.length,
    frozenExpectedAccepted: freshAdversarialCases.filter((item) => item.expectedPass).length,
    frozenExpectedRejected: freshAdversarialCases.filter((item) => !item.expectedPass).length,
  },
  integrationClosure: {
    exactNegativeSemanticFixtures: seenExactNegativeFixtures.size,
    staleNormalizationExpectationsRetired: seenStaleAcceptedCases.size,
    deferredNonBlocking: {
      total: seenDeferredCases.size,
      categoryC: [...deferredCases.values()].filter((item) => item.category === "C").length,
      categoryD: [...deferredCases.values()].filter((item) => item.category === "D").length,
    },
    activeDeterministicWithoutSemanticFixture: seenActiveDeterministicCases.size,
    realModelSemanticEvidence: false,
  },
  promptProjection: true,
  regenerationProjection: true,
}, null, 2));
};

void main();
