import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLAIMLESS_VERIFICATION_IDS,
  buildClaimlessVerificationScenarios,
  buildDiagnosticScenarios,
  classifyRepairStage,
  classifyTargetId,
  extractModelObject,
  projectDiagnosticCell,
  projectRawCandidates,
  sanitizeReasonTokens,
  scenarioInputFingerprint,
  summarizeDiagnosticCells,
} from "./repair-recognition-diagnostic-lib";

const SECRET_TEXT = "你其实是害怕被大家否定。";
const context = {
  currentTurnId: "t-current",
  adjacentTurns: [
    { id: "u1", role: "user", content: "我今天开会一直没说话" },
    { id: "a1", role: "assistant", content: SECRET_TEXT },
  ],
  interactionMoveHandoffTarget: null,
};

assert.deepEqual(extractModelObject("```json\n{\"a\":1}\n```"), { a: 1 });
assert.equal(extractModelObject("not json"), null);
assert.equal(extractModelObject(undefined), null);

assert.equal(classifyTargetId("a1", context), "legal_assistant_turn");
assert.equal(classifyTargetId("u1", context), "user_turn");
assert.equal(classifyTargetId("t-current", context), "current_turn");
assert.equal(classifyTargetId("zzz", context), "unknown_id");
assert.equal(classifyTargetId(undefined, context), "absent");

assert.deepEqual(sanitizeReasonTokens(["planned_function_semantic:positive_function_not_satisfied", "原始文本"]), [
  "planned_function_semantic:positive_function_not_satisfied",
  "unrecognized",
]);

const deterministic = { responseRelation: { candidates: [] }, stateUpdate: {} };
// Fake side merge: accepts only candidates without a targetProposition, like a strict filter would.
const fakeMerge = (_det: unknown, model: unknown) => {
  const candidates = ((model as { responseRelation: { candidates: Array<Record<string, unknown>> } })
    .responseRelation.candidates).filter((candidate) => !candidate.targetProposition);
  return { responseRelation: { candidates } };
};
const raw = JSON.stringify({
  primaryDialogueAct: "correct_assistant",
  responseRelation: {
    candidates: [
      { relation: "repairs_previous_move", confidence: 0.96, targetTurnId: "a1", evidence: [SECRET_TEXT] },
      {
        relation: "repairs_previous_move",
        confidence: 0.97,
        targetTurnId: "a1",
        targetProposition: SECRET_TEXT,
        targetOperation: "repair_or_withdraw",
        evidence: [SECRET_TEXT],
      },
      { relation: "made_up_relation", confidence: 0.9 },
    ],
  },
});
const projection = projectRawCandidates({ rawOutput: raw, context, deterministic, merge: fakeMerge });
assert.equal(projection.parsed, true);
assert.equal(projection.primaryDialogueAct, "correct_assistant");
assert.equal(projection.candidates[0].acceptedBySideMerge, true);
assert.equal(projection.candidates[0].target, "legal_assistant_turn");
assert.equal(projection.candidates[1].acceptedBySideMerge, false);
assert.equal(projection.candidates[1].rejectionReason, "target_proposition_not_committed_claim");
assert.equal(projection.candidates[1].targetPropositionEqualsTargetTurnText, true);
assert.equal(projection.candidates[1].targetPropositionMatchesCommittedClaim, false);
assert.equal(projection.candidates[2].relation, "unrecognized");
assert.equal(JSON.stringify(projection).includes(SECRET_TEXT), false, "no text may leak into projections");

const absorbingMerge = () => ({
  responseRelation: { candidates: [{ relation: "repairs_previous_move", targetTurnId: "a1", confidence: 0.99, evidence: [] }] },
});
const absorbed = projectRawCandidates({
  rawOutput: JSON.stringify({ responseRelation: { candidates: [{ relation: "repairs_previous_move", confidence: 0.95, targetTurnId: "a1" }] } }),
  context,
  deterministic: { responseRelation: { candidates: [{ relation: "repairs_previous_move", targetTurnId: "a1", confidence: 0.99 }] } },
  merge: absorbingMerge,
});
assert.equal(absorbed.candidates[0].rejectionReason, "absorbed_by_deterministic_candidate");
assert.equal(absorbed.candidates[0].acceptedBySideMerge, true);

type StageInput = Parameters<typeof classifyRepairStage>[0];
const baseCell = (overrides: Partial<StageInput>): StageInput => ({
  scenarioId: "s",
  group: "affected_repair",
  runIndex: 1,
  inputFingerprint: "x",
  currentTurnId: "t",
  legalTargets: { assistantTurnIds: ["a1"], userTurnIds: ["u1"], assistantTurnsWithCommittedClaims: [], activeHandoffTargetId: null },
  interpretationModel: { attempted: true, used: true, errored: false },
  deterministic: { repairSignal: false, repairProposal: false },
  rawModel: { parsed: true, primaryDialogueAct: "absent", candidates: [] },
  finalInterpretation: { candidates: [], repairProposal: false, repairTarget: "absent" },
  dialogueState: { primaryActivity: "sharing", repairingCommonGround: false },
  plan: { present: true, responseActions: ["acknowledge_without_psychologizing"], questionPolicy: "none", interactionMoveHandoff: false, positiveFunction: "none" },
  execution: { phase: "VALIDATED", finalSource: "llm", failureCode: "none", failureReasonTokens: [], preflightFailures: [], validationFailures: [] },
  ...overrides,
});
const repairCandidate = (accepted: boolean, confidence: number) => ({
  relation: "repairs_previous_move",
  confidence,
  meetsRepairThreshold: confidence >= 0.93,
  target: "legal_assistant_turn" as const,
  targetTurnId: "a1",
  targetOperation: "absent",
  targetPropositionSupplied: false,
  targetPropositionMatchesCommittedClaim: false,
  targetPropositionEqualsTargetTurnText: false,
  acceptedBySideMerge: accepted,
  claimDroppedAsUnverifiable: false,
  rejectionReason: accepted ? "none" : "target_proposition_not_committed_claim",
});
const withCandidates = (candidates: ReturnType<typeof repairCandidate>[]) =>
  ({ parsed: true, primaryDialogueAct: "absent", candidates });

assert.equal(classifyRepairStage(baseCell({ interpretationModel: { attempted: false, used: false, errored: false } })), "model_not_called");
assert.equal(classifyRepairStage(baseCell({ interpretationModel: { attempted: true, used: false, errored: true } })), "model_unavailable");
assert.equal(classifyRepairStage(baseCell({})), "model_not_proposed");
assert.equal(classifyRepairStage(baseCell({ rawModel: withCandidates([repairCandidate(false, 0.96)]) })), "proposed_rejected_by_validation");
assert.equal(classifyRepairStage(baseCell({ rawModel: withCandidates([repairCandidate(true, 0.9)]) })), "accepted_below_threshold");
assert.equal(classifyRepairStage(baseCell({ rawModel: withCandidates([repairCandidate(true, 0.96)]) })), "accepted_target_unresolved");
assert.equal(classifyRepairStage(baseCell({
  rawModel: withCandidates([repairCandidate(true, 0.96)]),
  finalInterpretation: { candidates: [], repairProposal: true, repairTarget: "legal_assistant_turn" },
})), "accepted_state_not_adopted");
assert.equal(classifyRepairStage(baseCell({
  rawModel: withCandidates([repairCandidate(true, 0.96)]),
  finalInterpretation: { candidates: [], repairProposal: true, repairTarget: "legal_assistant_turn" },
  dialogueState: { primaryActivity: "repairing_common_ground", repairingCommonGround: true },
})), "state_adopted_plan_not_adopted");
assert.equal(classifyRepairStage(baseCell({
  rawModel: withCandidates([repairCandidate(true, 0.96)]),
  finalInterpretation: { candidates: [], repairProposal: true, repairTarget: "legal_assistant_turn" },
  dialogueState: { primaryActivity: "repairing_common_ground", repairingCommonGround: true },
  plan: { present: true, responseActions: ["repair_previous_wording"], questionPolicy: "none", interactionMoveHandoff: false, positiveFunction: "repair_previous_wording" },
})), "repair_planned");
assert.equal(classifyRepairStage(baseCell({ deterministic: { repairSignal: true, repairProposal: true } })), "deterministic_repair");

const dataset = JSON.parse(readFileSync("clinical-evals/hill-helping-batch1-5-preservation.json", "utf8")) as { scenarios: unknown[] };
const scenarios = buildDiagnosticScenarios(dataset.scenarios);
assert.equal(scenarios.length, 13);
assert.equal(scenarios.filter((item) => item.group === "affected_repair").length, 8);
assert.equal(scenarios.at(-1)?.recentMessages.length, 0);
assert.match(scenarioInputFingerprint(scenarios[0]), /^sha256:[0-9a-f]{16}$/u);

const cell = projectDiagnosticCell({
  scenario: scenarios[0],
  runIndex: 2,
  currentTurnId: "t-current",
  reply: {
    finalSource: "constraint_failure",
    execution: {
      phase: "FAILED",
      failure: { code: "GENERATION_NONCONFORMANT", reason: "planned_function_semantic:positive_function_not_satisfied" },
      planPreflight: { passed: true, failureReasons: [] },
    },
    controlTrace: {
      context,
      interpretation: { responseRelation: { candidates: [] }, stateUpdate: {} },
      interpretationModel: { attempted: true, used: true, rawOutput: raw },
      dialogueState: { currentActivity: { primary: "supporting_emotion", concurrent: [] } },
      responsePlan: { responseActions: ["offer_emotional_support"], questionPolicy: { mode: "optional_after_answer" } },
      validation: [{ failureReasons: ["planned_function_semantic:positive_function_not_satisfied"] }],
    },
  },
  interpretDeterministically: () => deterministic,
  merge: fakeMerge,
});
assert.equal(cell.stage, "accepted_target_unresolved");
assert.equal(cell.probes, null, "probes run only on the first run of a scenario");
assert.equal(cell.execution.failureCode, "GENERATION_NONCONFORMANT");
assert.equal(JSON.stringify(cell).includes(SECRET_TEXT), false);
assert.equal(summarizeDiagnosticCells([cell]).stages.accepted_target_unresolved, 1);

const droppingMerge = (_det: unknown, model: unknown) => ({
  responseRelation: {
    candidates: (model as { responseRelation: { candidates: Array<Record<string, unknown>> } })
      .responseRelation.candidates.map((candidate) => ({
        relation: candidate.relation,
        confidence: candidate.confidence,
        targetTurnId: candidate.targetTurnId,
        evidence: [
          ...(candidate.evidence as string[]),
          "Target Assistant turn has no committed claims; unverifiable target claim text was dropped.",
        ],
      })),
  },
});
const dropped = projectRawCandidates({ rawOutput: raw, context, deterministic, merge: droppingMerge });
assert(dropped.candidates.length > 0);
assert(dropped.candidates.every((candidate) => candidate.claimDroppedAsUnverifiable));
assert.equal(
  summarizeDiagnosticCells([{ ...cell, rawModel: dropped }]).claimDroppedAsUnverifiable,
  dropped.candidates.length
);
assert(!projectRawCandidates({ rawOutput: raw, context, deterministic, merge: fakeMerge }).candidates
  .some((candidate) => candidate.claimDroppedAsUnverifiable));

const verification = buildClaimlessVerificationScenarios(dataset.scenarios);
assert.deepEqual(verification.map((scenario) => scenario.id), [...CLAIMLESS_VERIFICATION_IDS]);
for (const scenario of verification) {
  const original = scenarios.find((item) => item.id === scenario.id);
  assert.equal(scenario.userMessage, original?.userMessage);
  assert.deepEqual(
    scenario.recentMessages.map(({ id, role, content }) => ({ id, role, content })),
    original?.recentMessages
  );
  for (const message of scenario.recentMessages) {
    if (message.role === "assistant") {
      assert.deepEqual(message.committedAssistantMove?.claims, []);
      assert.equal(message.committedAssistantMove?.sourceTurnId, scenario.recentMessages[0]?.id);
    } else {
      assert.equal(message.committedAssistantMove, undefined);
    }
  }
}

console.log(JSON.stringify({ repairRecognitionDiagnosticCheck: "passed", realModelCallsInCheck: false }));
