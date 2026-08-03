import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadChatGateDataset, readChatGateRunArtifact } from "./chat-gate-v0-lib";

type BlindLabel = "X" | "Y";
type ReviewSide = {
  absolutePass: boolean;
  appropriateConversationOutcome: boolean;
  wouldContinue: boolean | null;
  criticalFailures: string[];
};
type BlindReview = {
  episodeId: string;
  runIndex: number;
  X: ReviewSide;
  Y: ReviewSide;
  pairPreference: BlindLabel | "tie";
  clearlyWorseSide: BlindLabel | "none";
  notes: string;
};
type Adjudication = {
  schemaVersion: 1;
  datasetVersion: string;
  reviewedBeforeKeyRead: boolean;
  reviews: BlindReview[];
};
type BlindKey = {
  schemaVersion: 1;
  X: { side: string; sourceId: string };
  Y: { side: string; sourceId: string };
};

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};
const aPath = getArg("a");
const bPath = getArg("b");
const adjudicationPath = getArg("adjudication");
const keyPath = getArg("key");
const outputPath = getArg("output");
for (const [field, value] of [
  ["a", aPath],
  ["b", bPath],
  ["adjudication", adjudicationPath],
  ["key", keyPath],
  ["output", outputPath],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}

const dataset = loadChatGateDataset();
const a = readChatGateRunArtifact(aPath);
const b = readChatGateRunArtifact(bPath);
const adjudication = JSON.parse(readFileSync(adjudicationPath, "utf8")) as Adjudication;
const key = JSON.parse(readFileSync(keyPath, "utf8")) as BlindKey;
if (!adjudication.reviewedBeforeKeyRead) throw new Error("Adjudication was not frozen before key read.");
if (adjudication.datasetVersion !== dataset.datasetVersion) throw new Error("Adjudication dataset mismatch.");
if (adjudication.reviews.length !== dataset.gateContract.episodeRunsPerSide) {
  throw new Error(`Expected ${dataset.gateContract.episodeRunsPerSide} blind reviews.`);
}
if (new Set([key.X.side, key.Y.side]).size !== 2) throw new Error("Blind key must map two distinct sides.");
if (!new Set([a.side, b.side]).has(key.X.side) || !new Set([a.side, b.side]).has(key.Y.side)) {
  throw new Error("Blind key side does not match the A/B artifacts.");
}

const labelForSide = (side: string): BlindLabel => {
  if (key.X.side === side) return "X";
  if (key.Y.side === side) return "Y";
  throw new Error(`Side ${side} is missing from the blind key.`);
};
const baselineLabel = labelForSide(a.side);
const candidateLabel = labelForSide(b.side);

const reviewIndex = new Map<string, BlindReview>();
for (const review of adjudication.reviews) {
  const episode = dataset.episodes.find((item) => item.id === review.episodeId);
  if (!episode) throw new Error(`Unknown episode in adjudication: ${review.episodeId}`);
  if (review.runIndex < 1 || review.runIndex > dataset.gateContract.runsPerSide) {
    throw new Error(`Invalid runIndex: ${review.episodeId}/run-${review.runIndex}`);
  }
  const reviewKey = `${review.episodeId}:run-${review.runIndex}`;
  if (reviewIndex.has(reviewKey)) throw new Error(`Duplicate review: ${reviewKey}`);
  for (const label of ["X", "Y"] as const) {
    for (const failure of review[label].criticalFailures) {
      if (!dataset.gateContract.criticalFailures.includes(failure)) {
        throw new Error(`Unknown critical failure ${failure} in ${reviewKey}/${label}`);
      }
    }
  }
  reviewIndex.set(reviewKey, review);
}

const candidateReviews = dataset.episodes.flatMap((episode) =>
  Array.from({ length: dataset.gateContract.runsPerSide }, (_, offset) => {
    const review = reviewIndex.get(`${episode.id}:run-${offset + 1}`);
    if (!review) throw new Error(`Missing review: ${episode.id}/run-${offset + 1}`);
    return { episode, review, candidate: review[candidateLabel], baseline: review[baselineLabel] };
  })
);

const candidatePasses = candidateReviews.filter((item) => item.candidate.absolutePass).length;
const candidateOutcomes = candidateReviews.filter((item) => item.candidate.appropriateConversationOutcome).length;
const candidateCriticalFailures = candidateReviews.flatMap((item) => item.candidate.criticalFailures).length;
const candidateClearlyWorse = candidateReviews.filter(
  (item) => item.review.clearlyWorseSide === candidateLabel
).length;
const candidatePreferred = candidateReviews.filter(
  (item) => item.review.pairPreference === candidateLabel
).length;
const baselinePreferred = candidateReviews.filter(
  (item) => item.review.pairPreference === baselineLabel
).length;

const episodeRows = dataset.episodes.map((episode) => {
  const rows = candidateReviews.filter((item) => item.episode.id === episode.id);
  return {
    episodeId: episode.id,
    targetStatus: episode.targetStatus,
    candidateAbsolutePasses: rows.filter((item) => item.candidate.absolutePass).length,
    baselineAbsolutePasses: rows.filter((item) => item.baseline.absolutePass).length,
    candidatePreferred: rows.filter((item) => item.review.pairPreference === candidateLabel).length,
    baselinePreferred: rows.filter((item) => item.review.pairPreference === baselineLabel).length,
  };
});

const evidenceAvailable = {
  productionBaselineIdentified: false,
  nonTargetRealEpisode: dataset.episodes.some((episode) => episode.targetStatus === "non_target"),
  heldOutRealEpisode: false,
};
const checks = {
  criticalFailureMaximum:
    candidateCriticalFailures <= dataset.gateContract.criticalFailureMaximum,
  eachEpisodeAbsolutePass:
    episodeRows.every(
      (row) => row.candidateAbsolutePasses >= dataset.gateContract.absolutePassMinimumByEpisode
    ),
  absolutePassMinimumTotal:
    candidatePasses >= dataset.gateContract.absolutePassMinimumTotal,
  appropriateConversationOutcomeMinimum:
    candidateOutcomes >= dataset.gateContract.appropriateConversationOutcomeMinimum,
  clearlyWorseThanBaselineMaximum:
    candidateClearlyWorse <= dataset.gateContract.clearlyWorseThanBaselineMaximum,
  eachTargetBetterThanBaseline:
    episodeRows
      .filter((row) => row.targetStatus === "target")
      .every(
        (row) =>
          row.candidatePreferred >= dataset.gateContract.targetBetterThanBaselineMinimumByEpisode
      ),
};
const applicableChecksPass = Object.values(checks).every(Boolean);
const fullGatePass =
  applicableChecksPass &&
  evidenceAvailable.productionBaselineIdentified &&
  evidenceAvailable.nonTargetRealEpisode &&
  evidenceAvailable.heldOutRealEpisode;

const report = {
  schemaVersion: 1,
  datasetVersion: dataset.datasetVersion,
  baseline: { side: a.side, sourceId: a.sourceId, blindLabel: baselineLabel },
  candidate: { side: b.side, sourceId: b.sourceId, blindLabel: candidateLabel },
  provider: a.provider,
  model: a.model,
  candidateSummary: {
    absolutePasses: candidatePasses,
    appropriateConversationOutcomes: candidateOutcomes,
    criticalFailures: candidateCriticalFailures,
    clearlyWorseThanBaseline: candidateClearlyWorse,
    candidatePreferred,
    baselinePreferred,
  },
  episodeRows,
  evidenceAvailable,
  checks,
  applicableChecksPass,
  fullGatePass,
  conclusion: fullGatePass
    ? "pass"
    : applicableChecksPass
      ? "evidence_incomplete"
      : "candidate_failed_applicable_thresholds",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(report, null, 2));
