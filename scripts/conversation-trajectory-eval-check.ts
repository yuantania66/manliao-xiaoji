import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  TRAJECTORY_REPORT_PATH,
  TRAJECTORY_RUNNER_VERSION,
  buildCommittedHistoryEntry,
  buildTrajectoryChecks,
  buildTurnResult,
  checkOrdinaryPlan,
  collectForensicsRecords,
  computeRelevantSourceFingerprint,
  extractTurnForensics,
  getCurrentCommit,
  loadTrajectoryDataset,
  renderTrajectoryReport,
  summarizeForensics,
  trajectoryGateExitCode,
  type TrajectoryRunResult,
} from "./conversation-trajectory-eval-lib";
import type { ChatReplyResult } from "../services/ai/chatOrchestrationService";

const gate = (overrides: Partial<Parameters<typeof trajectoryGateExitCode>[0]> = {}) =>
  trajectoryGateExitCode({ mode: "real", experiment: "canonical", deterministicErrorCount: 0, safetyFailClosedCount: 0, ...overrides });
assert.equal(gate(), 0, "Clean canonical real run passes.");
assert.equal(gate({ deterministicErrorCount: 2 }), 1, "Deterministic errors fail the gate.");
assert.equal(gate({ safetyFailClosedCount: 1 }), 1, "Safety fail-closed blocks fail the gate.");
assert.equal(gate({ mode: "replay", deterministicErrorCount: 3 }), 0, "Replay is a diagnostic, not the gate.");
assert.equal(gate({ experiment: "exp-bl-012a", deterministicErrorCount: 3 }), 0, "Experiments are diagnostics, not the gate.");

const dataset = loadTrajectoryDataset();
assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.datasetVersion, "conversation-trajectories-v1");
assert(dataset.trajectories.length >= 5);

const ground = dataset.trajectories.find((item) => item.id === "TRJ-GROUND-001");
assert(ground);
assert.equal(ground.turns.length, 3);
assert(ground.turns.every((turn) => turn.fixtureStatus === "captured"));

const rutRepro = dataset.trajectories.find((item) => item.id === "TRJ-RUT-REPRO-001");
assert(rutRepro);
assert(rutRepro.turns.length >= 3);
assert(rutRepro.turns.every((turn) => turn.fixtureStatus === "pending_reproduction"));

const syntheticRutTurns = rutRepro.turns.slice(0, 3).map((turn) =>
  buildTurnResult({ turn, assistant: `听到你说${turn.user}。`, mode: "real" })
);
assert(
  buildTrajectoryChecks(syntheticRutTurns).trajectoryHeuristicFlags.some(
    (flag) => flag.rule === "repeated_literal_skeleton_locator" && flag.matchedText.includes("听到你说")
  ),
  "three repeated recorder-style openings must be located for human review"
);

const replayResults: TrajectoryRunResult[] = dataset.trajectories.map((trajectory) => {
  const turns = trajectory.turns.map((turn) =>
    buildTurnResult({ turn, assistant: turn.observedAssistant ?? null, mode: "replay" })
  );
  return { trajectory, runIndex: 1, turns, ...buildTrajectoryChecks(turns) };
});

const groundReplay = replayResults.find((item) => item.trajectory.id === "TRJ-GROUND-001");
assert(groundReplay);
assert(groundReplay.turns[0].machineCheckErrors.some((error) => error.includes("松口气")));
assert(groundReplay.turns[1].machineCheckErrors.some((error) => error.includes("松口气")));

assert(replayResults.every((result) => result.turns.every((turn) => turn.forensics === undefined)));

const groundTurn = ground.turns[0];
const makeResult = (partial: Record<string, unknown>) =>
  ({
    generation: { text: "", model: "m", promptVersion: "p", latencyMs: 0, postProcessSteps: [], finalReplySource: "constraint_failure" },
    finalSource: "constraint_failure",
    clinicalTrace: { skippedBySafety: false },
    ...partial,
  }) as unknown as ChatReplyResult;
const blockedResult = (reason: unknown, failureType: string | null) =>
  makeResult({
    clinicalTrace: { skippedBySafety: true },
    execution: {
      turnId: "turn-synthetic",
      phase: "FAILED",
      transitions: failureType ? [{ phase: "FAILED", reason: `Safety semantic triage failed closed (${failureType}).` }] : [],
      attempts: [],
      ...(reason === undefined ? {} : { failure: { code: "SAFETY_BLOCKED", reason, retryable: false } }),
    },
  });

for (const [category, failureType] of [
  ["invalid_output", "invalid_output"],
  ["timeout", "provider_error"],
  ["rate_limited", "provider_error"],
  ["provider_5xx", "provider_error"],
  ["provider_4xx", "provider_error"],
  ["provider_error", "provider_error"],
  ["provider_unconfigured", "provider_unconfigured"],
] as const) {
  const forensics = extractTurnForensics(blockedResult(`safety_semantic_${category}`, failureType));
  assert.equal(forensics.safety.outcome, "blocked_fail_closed");
  assert.equal(forensics.safety.failureCategory, category, `${category} must be preserved`);
  assert.equal(forensics.safety.failureType, failureType);
  assert.equal(forensics.executionFailureCode, "SAFETY_BLOCKED");
  assert.equal(forensics.safety.attemptTrace, "not_exposed_by_chat_reply_result");
}

const missingSafetyInfo = extractTurnForensics(blockedResult("", null));
assert.equal(missingSafetyInfo.safety.outcome, "blocked_fail_closed");
assert.equal(missingSafetyInfo.safety.failureCategory, "unknown");
assert.equal(missingSafetyInfo.safety.failureType, "unknown");

const rawProviderText = "Error: 401 Unauthorized sk-synthetic-key upstream body";
const rawProviderForensics = extractTurnForensics(blockedResult(rawProviderText, "network_glitch"));
assert.equal(rawProviderForensics.safety.failureCategory, "unknown", "unparsed reasons must not be guessed");
assert.equal(rawProviderForensics.safety.failureType, "unknown", "unregistered failure types must not be guessed");
assert.equal(extractTurnForensics(blockedResult("safety_semantic_network_glitch", "provider_error")).safety.failureCategory, "unknown");
const failureObjectMissing = extractTurnForensics(blockedResult(undefined, "invalid_output"));
assert.equal(failureObjectMissing.safety.outcome, "blocked_fail_closed", "a failed-closed transition alone still marks the block");
assert.equal(failureObjectMissing.safety.failureCategory, "unknown");
assert.equal(failureObjectMissing.safety.failureType, "invalid_output");
assert.equal(failureObjectMissing.executionFailureCode, "unknown");

const routedForensics = extractTurnForensics(
  makeResult({
    finalSource: "safety",
    clinicalTrace: { skippedBySafety: true },
    execution: {
      turnId: "turn-routed",
      phase: "VALIDATED",
      attempts: [],
      transitions: [{
        phase: "PLANNED",
        reason: "Safety pre-gate selected the safety-owned response path (channel=semantic, risk=concern, categories=self_harm|suicide, currentness=current).",
      }],
    },
  })
);
assert.equal(routedForensics.safety.outcome, "routed_safety_response");
assert.equal(routedForensics.safety.failureCategory, "none");
assert.equal(routedForensics.safety.routedDecision, "channel=semantic risk=concern categories=self_harm|suicide currentness=current");
assert.equal(routedForensics.executionFailureCode, "none");
function routedResultForPlanCheck() {
  return makeResult({
    finalSource: "safety",
    clinicalTrace: { skippedBySafety: true },
    execution: { turnId: "turn-routed", phase: "VALIDATED", attempts: [], transitions: [] },
  });
}

const plannedResult = makeResult({
  finalSource: "llm",
  generation: { text: "synthetic reply", model: "m", promptVersion: "p", latencyMs: 0, postProcessSteps: [], finalReplySource: "llm" },
  clinicalTrace: { skippedBySafety: false, invokedByPlanner: false },
  controlTrace: {
    clinicalInvoked: false,
    responsePlan: {
      planId: "plan-synthetic",
      behaviorSource: "ordinary_conversation",
      planningDepth: "minimal",
      responseActions: ["acknowledge_without_psychologizing", "invite_low_pressure_calibration"],
      questionPolicy: { mode: "one_low_pressure_question", reason: "synthetic" },
      closurePolicy: { mode: "forbid_closure", reason: "synthetic" },
      clinicalStrategy: null,
      positiveFunctionContract: null,
      interactionMoveHandoffPlan: null,
    },
  },
  execution: { turnId: "turn-planned", phase: "VALIDATED", transitions: [], attempts: [] },
});
const plannedTurn = buildTurnResult({ turn: groundTurn, assistant: "synthetic reply", result: plannedResult, mode: "real" });
assert(plannedTurn.forensics);
assert.equal(plannedTurn.forensics.safety.outcome, "passed_to_planner");
assert.equal(plannedTurn.forensics.plan.evaluatorSelectedPlanPresent, false);
assert.equal(plannedTurn.forensics.plan.plannerSource, "controlTrace.responsePlan");
assert.equal(plannedTurn.forensics.plan.clinicalInvokedByPlanner, false);
assert.deepEqual(plannedTurn.forensics.plan.responseActions, ["acknowledge_without_psychologizing", "invite_low_pressure_calibration"]);
assert.equal(plannedTurn.forensics.plan.questionPolicy, "one_low_pressure_question");
assert.equal(plannedTurn.selectedResponseGoal, "missing", "evaluator field must stay unmapped");
assert(
  !plannedTurn.machineCheckErrors.some((error) => error.startsWith("responseGoal mismatch")),
  "GROUND-001 ordinary turns no longer read the legacy clinical structure"
);
assert(
  plannedTurn.machineCheckErrors.includes("ordinaryPlan reply question count mismatch: expected=1, actual=0"),
  "a plan that only permits a question does not complete calibration"
);

const ordinaryPlanResult = (overrides: {
  responseActions: string[];
  questionPolicy: string;
  phase?: string;
  failure?: { code: string; reason: string; retryable: boolean };
}) =>
  makeResult({
    finalSource: overrides.phase === "FAILED" ? "constraint_failure" : "llm",
    controlTrace: {
      clinicalInvoked: false,
      responsePlan: {
        planId: "plan-ordinary",
        behaviorSource: "ordinary_conversation",
        planningDepth: "standard",
        responseActions: overrides.responseActions,
        questionPolicy: { mode: overrides.questionPolicy, reason: "synthetic" },
        closurePolicy: { mode: "forbid_closure", reason: "synthetic" },
        clinicalStrategy: null,
        positiveFunctionContract: null,
        interactionMoveHandoffPlan: null,
        groundingFacts: [],
        requiredDisclosure: [],
        relevanceProvenance: [],
      },
    },
    execution: {
      requestId: "req-ordinary",
      planId: "plan-ordinary",
      turnId: "turn-ordinary",
      phase: overrides.phase ?? "VALIDATED",
      transitions: [],
      attempts: [],
      ...(overrides.failure ? { failure: overrides.failure } : {}),
    },
  });
const calibrationExpectation = ground.turns[0].expectedPlan!;
const entryExpectation = ground.turns[1].expectedPlan!;
assert.deepEqual(calibrationExpectation, {
  responseAction: "invite_low_pressure_calibration",
  questionPolicy: "one_low_pressure_question",
  replyQuestionCount: 1,
});
assert.deepEqual(entryExpectation, { responseAction: "offer_neutral_conversation_entry", questionPolicy: "none", replyQuestionCount: 0 });
assert.deepEqual(ground.turns[2].expectedPlan, entryExpectation);
const calibrationPlan = ordinaryPlanResult({ responseActions: ["invite_low_pressure_calibration"], questionPolicy: "one_low_pressure_question" });
assert.deepEqual(
  checkOrdinaryPlan(calibrationExpectation, calibrationPlan, "我还不确定该怎么接；你希望我先等你继续，还是给一个轻一点的开头？"),
  []
);
assert(
  checkOrdinaryPlan(calibrationExpectation, calibrationPlan, "嗯，看到了。").includes(
    "ordinaryPlan reply question count mismatch: expected=1, actual=0"
  )
);
assert(
  checkOrdinaryPlan(
    calibrationExpectation,
    ordinaryPlanResult({ responseActions: ["acknowledge_without_psychologizing"], questionPolicy: "optional_after_answer" }),
    "嗯，看到了？"
  ).some((error) => error.startsWith("ordinaryPlan responseAction mismatch")),
  "acknowledge must never be mapped onto calibration"
);
assert(
  checkOrdinaryPlan(
    calibrationExpectation,
    ordinaryPlanResult({
      responseActions: ["invite_low_pressure_calibration"],
      questionPolicy: "one_low_pressure_question",
      phase: "FAILED",
      failure: { code: "GENERATION_NONCONFORMANT", reason: "ordinary_handoff:no_new_conversation_function", retryable: false },
    }),
    "你希望我怎么接？"
  ).includes("ordinaryPlan not committed: phase=FAILED, failure=GENERATION_NONCONFORMANT")
);
assert(checkOrdinaryPlan(entryExpectation, routedResultForPlanCheck(), "")[0]!.startsWith("ordinaryPlan missing: source=safety"));

assert.equal(
  buildCommittedHistoryEntry(
    ordinaryPlanResult({ responseActions: ["invite_low_pressure_calibration"], questionPolicy: "one_low_pressure_question", phase: "FAILED" }),
    "assistant-failed"
  ),
  null,
  "failed generations never enter history"
);
const committedCalibration = buildCommittedHistoryEntry(
  makeResult({
    ...calibrationPlan,
    generation: { text: "你希望我先等你继续，还是给一个轻一点的开头？", model: "m", promptVersion: "p", latencyMs: 0, postProcessSteps: [], finalReplySource: "llm" },
  }),
  "assistant-committed"
);
assert(committedCalibration?.committedAssistantMove);
assert(committedCalibration.committedAssistantMove.purpose.includes("invite_low_pressure_calibration"));
assert.equal(committedCalibration.committedAssistantMove.questionOrRequest?.kind, "question");
assert.equal(committedCalibration.id, "assistant-committed");

const planInvalid = extractTurnForensics(
  makeResult({
    execution: {
      turnId: "turn-plan-invalid",
      phase: "FAILED",
      transitions: [],
      attempts: [],
      failure: { code: "PLAN_INVALID", reason: "question_policy_conflict, 用户原文片段", retryable: false },
    },
  })
);
assert.equal(planInvalid.safety.outcome, "passed_to_planner");
assert.equal(planInvalid.executionFailureCode, "PLAN_INVALID");
assert.deepEqual(planInvalid.executionFailureReasonCodes, ["question_policy_conflict", "unrecognized"]);

const thrown = buildTurnResult({ turn: groundTurn, assistant: null, mode: "real", error: "synthetic failure" });
assert(thrown.forensics);
assert.equal(thrown.forensics.safety.outcome, "unknown");
assert.equal(thrown.forensics.safety.failureCategory, "unknown");
assert.equal(thrown.forensics.plan.plannerSource, "absent");
assert.equal(thrown.forensics.executionFailureCode, "unknown");

const forensicTurns = [
  buildTurnResult({ turn: groundTurn, assistant: null, result: blockedResult("safety_semantic_timeout", "provider_error"), mode: "real" }),
  buildTurnResult({ turn: ground.turns[1], assistant: null, result: blockedResult(rawProviderText, "network_glitch"), mode: "real" }),
  plannedTurn,
];
const forensicResults: TrajectoryRunResult[] = [
  { trajectory: ground, runIndex: 3, turns: forensicTurns, ...buildTrajectoryChecks(forensicTurns) },
];
const forensicSummary = summarizeForensics(collectForensicsRecords(forensicResults));
assert.deepEqual(forensicSummary.safetyBlockedByCategory, { timeout: 1, unknown: 1 });
assert.deepEqual(forensicSummary.safetyBlocked[0], {
  caseId: "TRJ-GROUND-001",
  runIndex: 3,
  turnId: groundTurn.turnId,
  failureType: "provider_error",
  failureCategory: "timeout",
});
assert.equal(forensicSummary.structureCheckedTurnsWithoutEvaluatorPlan.length, 0);

const metadata = {
  datasetVersion: dataset.datasetVersion,
  runnerVersion: TRAJECTORY_RUNNER_VERSION,
  evaluatedCommit: getCurrentCommit(),
  relevantSourceFingerprint: computeRelevantSourceFingerprint(),
  generatedAt: "2026-07-12T00:00:00.000Z",
  runMode: "replay" as const,
  repeatCount: 1,
  variant: "canonical",
  promptAdapter: "none",
  historyAdapter: "canonical",
  provider: "captured-replay",
  model: "captured-replay",
  promptVersion: "captured-replay",
  freshness: "current" as const,
  staleReason: "",
};
const report = renderTrajectoryReport(metadata, replayResults);
assert(report.includes("## Runtime Metadata"));
assert(report.includes("relevantSourceFingerprint: sha256:"));
assert(report.includes("pending reproduction"));
assert(report.includes("repeatCount: 1"));
assert(report.includes("variant: canonical"));
assert(report.includes("promptAdapter: none"));
assert(report.includes("historyAdapter: canonical"));
assert(report.includes("unsupportedMeaning: unreviewed"));
assert(report.includes("heuristicFlags:"));
assert(!report.includes("## Forensics Summary"), "replay reports carry no runtime forensics");

const forensicReport = renderTrajectoryReport(
  {
    ...metadata,
    runMode: "real",
    productUnderTest: "56bf5d4",
    productSourceFingerprint: "sha256:product",
    evalToolFingerprint: "sha256:tool",
  },
  forensicResults
);
assert(forensicReport.includes("## Forensics Summary"));
assert(forensicReport.includes("- productUnderTest: 56bf5d4"));
assert(forensicReport.includes("- evalToolFingerprint: sha256:tool"));
assert(forensicReport.includes(`- safetyBlocked: TRJ-GROUND-001 / run-3 / ${groundTurn.turnId}: type=provider_error category=timeout`));
assert(forensicReport.includes("- safetyFailureCategory: unknown"));
assert(forensicReport.includes("- evaluatorPlanSource: clinicalTrace.selectedPlan (absent)"));
assert(forensicReport.includes("- plannerPlanSource: controlTrace.responsePlan"));
assert(!forensicReport.includes("sk-synthetic-key"), "raw provider text must not reach the report");
assert(!forensicReport.includes("用户原文片段"));

if (existsSync(TRAJECTORY_REPORT_PATH) && readFileSync(TRAJECTORY_REPORT_PATH, "utf8").trim()) {
  const committedReport = readFileSync(TRAJECTORY_REPORT_PATH, "utf8");
  const fingerprintLine = committedReport.match(/^- relevantSourceFingerprint: (.+)$/m)?.[1];
  const freshnessLine = committedReport.match(/^- freshness: (current|stale)$/m)?.[1];
  const staleReasonLine = committedReport.match(/^- staleReason: (.+)$/m)?.[1];
  assert(fingerprintLine, "trajectory report must record relevantSourceFingerprint");
  assert(freshnessLine, "trajectory report must record freshness");
  if (fingerprintLine !== computeRelevantSourceFingerprint()) {
    assert.equal(freshnessLine, "stale", "changed relevant sources require a stale report marker");
    assert(staleReasonLine && staleReasonLine !== "none", "stale trajectory report requires staleReason");
  }
}

console.log(
  JSON.stringify(
    {
      schemaVersion: dataset.schemaVersion,
      trajectories: dataset.trajectories.length,
      capturedTurns: dataset.trajectories.flatMap((item) => item.turns).filter((turn) => turn.fixtureStatus === "captured").length,
      pendingReproductionTurns: dataset.trajectories
        .flatMap((item) => item.turns)
        .filter((turn) => turn.fixtureStatus === "pending_reproduction").length,
      replayDetectedKnownFailures: groundReplay.turns.flatMap((turn) => turn.machineCheckErrors).length,
      machineChecksSeparatedFromReviewerFields: true,
      realModelCallsInCheck: false,
    },
    null,
    2
  )
);
