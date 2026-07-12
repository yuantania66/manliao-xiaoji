import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  TRAJECTORY_REPORT_PATH,
  TRAJECTORY_RUNNER_VERSION,
  buildTrajectoryChecks,
  buildTurnResult,
  computeRelevantSourceFingerprint,
  getCurrentCommit,
  loadTrajectoryDataset,
  renderTrajectoryReport,
  type TrajectoryRunResult,
} from "./conversation-trajectory-eval-lib";

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

const metadata = {
  datasetVersion: dataset.datasetVersion,
  runnerVersion: TRAJECTORY_RUNNER_VERSION,
  evaluatedCommit: getCurrentCommit(),
  relevantSourceFingerprint: computeRelevantSourceFingerprint(),
  generatedAt: "2026-07-12T00:00:00.000Z",
  runMode: "replay" as const,
  repeatCount: 1,
  variant: "canonical",
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
assert(report.includes("unsupportedMeaning: unreviewed"));
assert(report.includes("heuristicFlags:"));

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
