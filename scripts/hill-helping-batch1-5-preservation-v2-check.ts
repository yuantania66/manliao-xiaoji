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

assert.equal(
  readFileSync(PRESERVATION_V2_DATASET_PATH, "utf8"),
  serializePreservationV2Dataset(derivePreservationV2Dataset({ source, sourceSha256: v1Sha256 })),
  "v2 must be exactly reproducible from v1 by the production-protocol generator."
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

console.log(JSON.stringify({
  v1Sha256,
  v2DatasetVersion: v2.datasetVersion,
  gateUnchanged: true,
  assistantTurnsWithEmptyClaims: assistantTurnsWithEmptyClaims.length,
  explicitRepairPlansUnchanged: 10,
  moveFitResults,
  wrongTargetRejected: true,
  emotionalScenariosInputIdentical: unchangedEmotional,
}, null, 2));
