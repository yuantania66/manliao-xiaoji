import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  createResponsePlanPreflightAuthoritySnapshot,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  type RelationalInterpretationCandidate,
} from "../conversation-os/control";
import { MOVE_FIT_REPAIR_ADOPTION_EVIDENCE } from "../conversation-os/control/turnInterpreter";
import { determineConversationState } from "../conversation-os/state";
import type { ConversationMessage } from "../conversation-os/types";
import { preflightResponsePlan } from "../services/ai/chatExecutionLifecycle";
import { enforceResponsePlan, validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import { validatePlannedFunctionSemanticOutput, type PlannedFunctionSemanticProvider } from "../services/ai/plannedFunctionSemanticValidator";
import { loadPreservationDataset, type PreservationScenario } from "./hill-helping-batch1-5-preservation-lib";
import {
  derivePreservationV2Dataset,
  loadPreservationV1Source,
  PRESERVATION_V1_SHA256,
  PRESERVATION_V2_DATASET_PATH,
  PRESERVATION_V2_DATASET_VERSION,
  serializePreservationV2Dataset,
} from "./hill-helping-batch1-5-preservation-v2-lib";

const { source, sha256: v1Sha256 } = loadPreservationV1Source();
assert.equal(v1Sha256, PRESERVATION_V1_SHA256, "Preservation v1 must stay byte-identical.");
const { dataset: v1 } = loadPreservationDataset();
const { dataset: v2 } = loadPreservationDataset(PRESERVATION_V2_DATASET_PATH);

const historicalV2Text = readFileSync(PRESERVATION_V2_DATASET_PATH, "utf8");
const historicalV2 = JSON.parse(historicalV2Text) as ReturnType<typeof derivePreservationV2Dataset>;
const currentDerivation = derivePreservationV2Dataset({ source, sourceSha256: v1Sha256 });
// These historical diagnostics used the retired category-equality guard, not the semantic gate.
// Preserve the frozen dataset and every input/threshold; verify only these two known diagnostic changes.
for (const scenarioId of ["repair-intensity-exaggeration", "repair-repeated-claim"]) {
  const historical = historicalV2.derivation.provenance.find((item) => item.scenarioId === scenarioId);
  const current = currentDerivation.derivation.provenance.find((item) => item.scenarioId === scenarioId);
  assert(historical && current);
  assert.equal(historical.derivations.length, 1);
  assert.equal(current.derivations.length, 1);
  const previous = historical.derivations[0];
  const now = current.derivations[0];
  assert(previous.outcome === "explicit_empty_claims" && now.outcome === "explicit_empty_claims");
  assert.equal(previous.assistantTurnId, "a1");
  assert.equal(now.assistantTurnId, "a1");
  assert.equal(previous.sourceUserTurnId, "u1");
  assert.equal(now.sourceUserTurnId, "u1");
  assert.equal(previous.assistantTextValidatesUnderDerivedPlan, false, `${scenarioId}: frozen old guard result`);
  assert.equal(now.assistantTextValidatesUnderDerivedPlan, true, `${scenarioId}: deterministic preflight only`);
  now.assistantTextValidatesUnderDerivedPlan = previous.assistantTextValidatesUnderDerivedPlan;
}
// The topic-switch diagnostic also moved from a word heuristic to a mandatory
// semantic stage. Keep the historical snapshot and every label byte-identical.
const topicScenario = v1.scenarios.find((scenario) => scenario.id === "repair-topic-switch");
assert(topicScenario, "Frozen topic-switch scenario remains present");
const topicUser = topicScenario.recentMessages.find((message) => message.id === "u1");
const topicAssistant = topicScenario.recentMessages.find((message) => message.id === "a1");
assert(topicUser && topicAssistant, "Frozen topic-switch history is complete");
assert.equal(topicUser.content, "我刚和妈妈吵了一架");
assert.equal(topicAssistant.content, "要不要先做个呼吸练习放松一下？");
const topicContext = assembleConversationControlContext({
  conversationId: "preservation-v2:repair-topic-switch", currentTurnId: "u1",
  userMessage: topicUser.content, recentMessages: [],
  conversationState: determineConversationState({ currentUserMessage: topicUser.content, recentMessages: [] }),
});
const topicInterpretation = interpretTurnDeterministically(topicContext);
const topicPlan = createResponsePlan({ context: topicContext, interpretation: topicInterpretation,
  dialogueState: buildDialogueState(topicContext, topicInterpretation), clinicalAdviceProvider: () => null });
const topicContract = topicPlan.positiveFunctionContract;
assert(topicContract?.action === "acknowledge_without_psychologizing", "Ordinary semantic contract owns this candidate");
assert.equal(validateResponsePlanOutput({ plan: topicPlan, reply: topicAssistant.content }).passed, true);
const legacyTopicPlan = structuredClone(topicPlan);
legacyTopicPlan.positiveFunctionContract = null;
assert(validateResponsePlanOutput({ plan: legacyTopicPlan, reply: topicAssistant.content }).failureReasons
  .includes("ordinary_acknowledgement:unsupported_evaluation:放松"), "Legacy word guard still rejects the historical phrase");
const oldTopic = historicalV2.derivation.provenance.find((item) => item.scenarioId === topicScenario.id);
const newTopic = currentDerivation.derivation.provenance.find((item) => item.scenarioId === topicScenario.id);
assert(oldTopic && newTopic, "Both diagnostic versions retain this source");
assert.equal(oldTopic.derivations.length, 1);
assert.equal(newTopic.derivations.length, 1);
assert(oldTopic.derivations[0].outcome === "explicit_empty_claims" && newTopic.derivations[0].outcome === "explicit_empty_claims", "Both versions retain explicit empty claims");
assert.equal(newTopic.derivations[0].assistantTurnId, "a1");
assert.equal(newTopic.derivations[0].sourceUserTurnId, "u1");
assert.equal(oldTopic.derivations[0].assistantTextValidatesUnderDerivedPlan, false);
assert.equal(newTopic.derivations[0].assistantTextValidatesUnderDerivedPlan, true);
newTopic.derivations[0].assistantTextValidatesUnderDerivedPlan = false; // Comparison copy only.
const rejectingTopicProvider: PlannedFunctionSemanticProvider = async (input) => ({
  schemaVersion: 1, planId: input.planId, handoff: null, semanticQuestionCount: 1,
  positiveFunction: {
    binding: { action: topicContract.action, sourceTurnId: topicContract.sourceTurnId,
      allowIdle: topicContract.allowIdle, responseFunction: topicContract.responseFunction },
    status: "not_satisfied", realizedAction: null,
    targetAddressed: false, contractRealized: false, containsContradictoryMove: false,
    evidence: [{ start: 0, end: topicAssistant.content.length, text: topicAssistant.content,
      reason: "Fixed local observation of unrequested advice; not a real model judgment" }],
    ordinaryUseObservation: { contentRelation: "other_response", repetitionPurpose: "not_applicable",
      purposeEvidence: [{ source: "current_user", messageIndex: null, start: 0, end: topicUser.content.length, text: topicUser.content }],
      useComparison: { userMeaning: "User reports an argument", candidateAct: "Unrequested breathing exercise",
        candidateEvidenceIndices: [0], relation: "no_supported_act" } },
  },
});
const verifyTopicSemanticStage = async () => {
  const context = { currentUserText: topicUser.content, handoffTargetAssistantText: null, ordinaryRecentMessages: [] };
  const result = await enforceResponsePlan({ plan: topicPlan,
    generate: async () => ({ text: topicAssistant.content, model: "local-fixed-fixture", promptVersion: "local-only", latencyMs: 0 }),
    plannedFunctionSemanticContext: context, plannedFunctionSemanticProvider: rejectingTopicProvider });
  assert.equal(result.outcome, "failed", "Deterministic acceptance cannot bypass semantic rejection");
  assert.equal(result.validations.length, 2, "Only the existing bounded local regeneration is exercised");
  assert(result.validations.every((item) => (item.hardFailureReasons ?? []).includes("planned_function_semantic:positive_function_not_satisfied")),
    `Both complete-schema semantic rejections are consumed: ${JSON.stringify(result.validations)}`);
  assert(result.semanticDiagnostics.every((item) => item.providerFailure === null), "Schema errors cannot stand in for semantic rejection");
  const malformed = await validatePlannedFunctionSemanticOutput({ plan: topicPlan, reply: topicAssistant.content,
    semanticContext: context, provider: async (input) => {
      const value = await rejectingTopicProvider(input);
      assert(value && typeof value === "object" && "positiveFunction" in value, "Authored fixture is an object");
      const branch = value.positiveFunction;
      assert(branch && typeof branch === "object", "Authored positive function is an object");
      return { ...value, positiveFunction: { ...branch, evidence: [{ start: 0, end: topicAssistant.content.length, text: "deliberately mismatched local evidence", reason: "Structural negative control" }] } };
    } });
  assert(malformed.failureReasons.includes("planned_function_semantic:evidence_mismatch"),
    "Malformed evidence is a separate structural rejection, not the semantic proof");
  assert.equal(readFileSync(PRESERVATION_V2_DATASET_PATH, "utf8"), historicalV2Text, "Frozen dataset was never rewritten");
};
assert.equal(
  historicalV2Text,
  serializePreservationV2Dataset(currentDerivation),
  "All v2 content must remain exactly reproducible except the three explicitly verified historical deterministic diagnostics."
);
assert.equal(v2.datasetVersion, PRESERVATION_V2_DATASET_VERSION);
assert.notEqual(v2.datasetVersion, v1.datasetVersion);
assert.deepEqual(v2.gate, v1.gate, "Acceptance thresholds must not change.");

const assistantTurnsWithEmptyClaims: string[] = [];
v1.scenarios.forEach((original, index) => {
  const derived = v2.scenarios[index];
  assert.deepEqual(
    { id: derived.id, kind: derived.kind, userMessage: derived.userMessage, expectedAction: derived.expectedAction },
    { id: original.id, kind: original.kind, userMessage: original.userMessage, expectedAction: original.expectedAction }
  );
  assert.equal(derived.recentMessages.length, original.recentMessages.length);
  original.recentMessages.forEach((message, messageIndex) => {
    const next = derived.recentMessages[messageIndex];
    if (message.role === "user") {
      assert.deepEqual(next, message, `${original.id} User history must be unchanged.`);
      return;
    }
    const { status, replyToMessageId, committedAssistantMove, ...rest } = next;
    assert.deepEqual(rest, message, `${original.id} Assistant content and id must be unchanged.`);
    assert.equal(status, "saved");
    assert.equal(replyToMessageId, original.recentMessages[messageIndex - 1]?.id);
    assert(committedAssistantMove, `${original.id} Assistant turn must carry its committed move.`);
    assert.deepEqual(committedAssistantMove.claims, []);
    assert.equal(next.interactionMoveEnvelope, undefined, "No envelope may be forged.");
    assistantTurnsWithEmptyClaims.push(`${original.id}:${message.id}`);
  });
});

const plan = (scenario: PreservationScenario, candidates: RelationalInterpretationCandidate[]) => {
  const context = assembleConversationControlContext({
    conversationId: `preservation-v2-check-${scenario.id}`,
    currentTurnId: `${scenario.id}-turn`,
    userMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
    conversationState: determineConversationState({
      currentUserMessage: scenario.userMessage,
      recentMessages: scenario.recentMessages,
    }),
  });
  const deterministic = interpretTurnDeterministically(context);
  const interpretation = mergeModelInterpretation(deterministic, {
    responseRelation: { candidates, ambiguous: false },
  }, context);
  const dialogueState = buildDialogueState(context, interpretation);
  const responsePlan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => ({
      strategy: "test-legacy-compat",
      intent: "support",
      questionFunction: "clarify_or_reflect",
      toneConstraints: [],
      interventionBoundaries: [],
      evidence: ["Preservation v2 structure check."],
    }),
  });
  const preflight = preflightResponsePlan(
    responsePlan,
    createResponsePlanPreflightAuthoritySnapshot({ context, interpretation, dialogueState })
  );
  return { dialogueState, responsePlan, preflight };
};
const repairSummary = (result: ReturnType<typeof plan>) => {
  const contract = result.responsePlan.positiveFunctionContract;
  return {
    actions: result.responsePlan.responseActions,
    repairMode: contract?.action === "repair_previous_wording" ? contract.repairMode : null,
    subtype: contract?.action === "repair_previous_wording" ? contract.interactionMoveSubtype : null,
    preflight: result.preflight.failureReasons,
  };
};

// Same stub interpretation as the v1 structure check: committed history must not move the
// frozen repair target type selected for an explicit repairs_previous_move.
for (const [index, original] of v1.scenarios.entries()) {
  if (original.kind !== "ordinary_repair") continue;
  const candidate: RelationalInterpretationCandidate = {
    relation: "repairs_previous_move",
    confidence: 0.95,
    targetTurnId: original.recentMessages.at(-1)?.id,
    evidence: ["Preservation fixture explicitly rejects the adjacent assistant move."],
  };
  assert.deepEqual(
    repairSummary(plan(v2.scenarios[index], [candidate])),
    repairSummary(plan(original, [candidate])),
    `${original.id} repair plan changed between v1 and v2 history.`
  );
}

const moveFitScenarios = new Map<string, string>([
  ["repair-advice-boundary", "unsolicited_advice"],
  ["repair-question-pressure", "pressure_question"],
  ["repair-generic-listening", "generic_listening"],
]);
const moveFitResults = [...moveFitScenarios].map(([scenarioId, subtype]) => {
  const original = v1.scenarios.find((scenario) => scenario.id === scenarioId);
  const derived = v2.scenarios.find((scenario) => scenario.id === scenarioId);
  assert(original && derived);
  const candidate: RelationalInterpretationCandidate = {
    relation: "challenges_move_fit",
    confidence: 0.95,
    targetTurnId: "a1",
    evidence: ["The User says the previous Assistant way of helping did not fit."],
  };
  const unavailable = plan(original, [candidate]);
  assert.equal(unavailable.dialogueState.repairState.status, "none", `${scenarioId} v1 history must stay rejected.`);
  assert(!unavailable.responsePlan.responseActions.includes("repair_previous_wording"));
  const committed = plan(derived, [candidate]);
  assert.equal(committed.dialogueState.repairState.sourceRelation, "challenges_move_fit");
  assert(committed.dialogueState.repairState.evidence.includes(MOVE_FIT_REPAIR_ADOPTION_EVIDENCE));
  assert.deepEqual(repairSummary(committed), {
    actions: ["repair_previous_wording"],
    repairMode: "interaction_move_withdrawal",
    subtype,
    preflight: [],
  }, scenarioId);
  return { scenarioId, subtype, historyUnavailableRejected: true, committedHistoryAdopted: true };
});

const wrongTarget = plan(v2.scenarios.find((scenario) => scenario.id === "repair-advice-boundary") as PreservationScenario, [{
  relation: "challenges_move_fit",
  confidence: 0.95,
  targetTurnId: "u1",
  evidence: ["Wrong target."],
}]);
assert.equal(wrongTarget.dialogueState.repairState.status, "none");

const unchangedEmotional = v1.scenarios
  .filter((scenario) => scenario.kind === "emotional_support")
  .every((scenario) => {
    const derived = v2.scenarios.find((item) => item.id === scenario.id);
    return JSON.stringify(derived) === JSON.stringify(scenario);
  });
assert(unchangedEmotional, "Emotional-support scenarios must be input-identical.");

const withoutHistoryMessages = (messages: ConversationMessage[]) => messages.length === 0;
assert(v2.scenarios.filter((scenario) => scenario.kind === "emotional_support").every((scenario) =>
  withoutHistoryMessages(scenario.recentMessages)
));

void verifyTopicSemanticStage().then(() => console.log(JSON.stringify({
  v1Sha256,
  v2DatasetVersion: v2.datasetVersion,
  gateUnchanged: true,
  assistantTurnsWithEmptyClaims: assistantTurnsWithEmptyClaims.length,
  explicitRepairPlansUnchanged: 10,
  moveFitResults,
  wrongTargetRejected: true,
  emotionalScenariosInputIdentical: unchangedEmotional,
}, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
