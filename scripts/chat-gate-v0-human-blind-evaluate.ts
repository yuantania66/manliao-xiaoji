import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadChatGateDataset, readChatGateRunArtifact } from "./chat-gate-v0-lib";

type BlindLabel = "X" | "Y";
type ReviewSide = {
  absolutePass: boolean;
  appropriateConversationOutcome: boolean;
  wouldContinue: boolean;
  criticalFailures: string[];
};
type HumanReview = {
  reviewId: string;
  X: ReviewSide;
  Y: ReviewSide;
  pairPreference: BlindLabel | "tie";
  clearlyWorseSide: BlindLabel | "none";
  notes: string;
};
type HumanAdjudication = {
  schemaVersion: 1;
  reviewedBeforeKeyRead: boolean;
  reviewer: string;
  keyCommitment: string;
  reviews: HumanReview[];
};
type BlindIdentity = { side: string; sourceId: string };
type BlindKeyItem = {
  reviewId: string;
  episodeId: string;
  runIndex: number;
  X: BlindIdentity;
  Y: BlindIdentity;
};
type HumanBlindKey = {
  schemaVersion: 2;
  datasetVersion: string;
  items: BlindKeyItem[];
};

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const baselinePath = getArg("baseline");
const candidatePath = getArg("candidate");
const adjudicationPath = getArg("adjudication");
const keyPath = getArg("key");
const outputPath = getArg("output");
for (const [field, value] of [
  ["baseline", baselinePath],
  ["candidate", candidatePath],
  ["adjudication", adjudicationPath],
  ["key", keyPath],
  ["output", outputPath],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}

const dataset = loadChatGateDataset();
const baseline = readChatGateRunArtifact(baselinePath);
const candidate = readChatGateRunArtifact(candidatePath);
const adjudicationSource = readFileSync(adjudicationPath);
const keySource = readFileSync(keyPath);
const adjudication = JSON.parse(adjudicationSource.toString("utf8")) as HumanAdjudication;
const key = JSON.parse(keySource.toString("utf8")) as HumanBlindKey;

if (!adjudication.reviewedBeforeKeyRead) throw new Error("Review was not frozen before key read.");
if (createHash("sha256").update(keySource).digest("hex") !== adjudication.keyCommitment) {
  throw new Error("Blind-key commitment mismatch.");
}
if (key.schemaVersion !== 2 || key.datasetVersion !== dataset.datasetVersion) {
  throw new Error("Blind-key schema or dataset mismatch.");
}
for (const field of ["runnerVersion", "datasetVersion", "datasetSha256", "provider", "model", "repeatCount"] as const) {
  if (baseline[field] !== candidate[field]) {
    throw new Error(`Baseline/candidate ${field} mismatch.`);
  }
}
if (adjudication.reviews.length !== dataset.gateContract.episodeRunsPerSide) {
  throw new Error("Human review count is incomplete.");
}
if (key.items.length !== dataset.gateContract.episodeRunsPerSide) {
  throw new Error("Blind-key item count is incomplete.");
}

const reviewIndex = new Map(adjudication.reviews.map((review) => [review.reviewId, review]));
const keyIndex = new Map(key.items.map((item) => [item.reviewId, item]));
if (reviewIndex.size !== adjudication.reviews.length || keyIndex.size !== key.items.length) {
  throw new Error("Duplicate review id in adjudication or key.");
}

const allowedSides = new Map([
  [baseline.side, baseline.sourceId],
  [candidate.side, candidate.sourceId],
]);

const rows = key.items.map((item) => {
  const review = reviewIndex.get(item.reviewId);
  if (!review) throw new Error(`Missing human review: ${item.reviewId}`);
  const episode = dataset.episodes.find((entry) => entry.id === item.episodeId);
  if (!episode) throw new Error(`Unknown episode: ${item.episodeId}`);
  if (item.runIndex < 1 || item.runIndex > dataset.gateContract.runsPerSide) {
    throw new Error(`Invalid run index: ${item.reviewId}`);
  }
  if (item.X.side === item.Y.side) throw new Error(`Blind sides are not distinct: ${item.reviewId}`);
  for (const label of ["X", "Y"] as const) {
    if (allowedSides.get(item[label].side) !== item[label].sourceId) {
      throw new Error(`Unknown source identity in ${item.reviewId}/${label}`);
    }
    for (const failure of review[label].criticalFailures) {
      if (!dataset.gateContract.criticalFailures.includes(failure)) {
        throw new Error(`Unknown critical failure in ${item.reviewId}/${label}: ${failure}`);
      }
    }
  }
  const candidateLabel: BlindLabel = item.X.side === candidate.side ? "X" : "Y";
  const baselineLabel: BlindLabel = candidateLabel === "X" ? "Y" : "X";
  const preference = review.pairPreference === "tie"
    ? "tie"
    : review.pairPreference === candidateLabel
      ? "candidate"
      : "baseline";
  const clearlyWorse = review.clearlyWorseSide === "none"
    ? "none"
    : review.clearlyWorseSide === candidateLabel
      ? "candidate"
      : "baseline";
  return {
    reviewId: item.reviewId,
    episodeId: item.episodeId,
    category: episode.category,
    targetStatus: episode.targetStatus,
    runIndex: item.runIndex,
    candidateBlindLabel: candidateLabel,
    baselineBlindLabel: baselineLabel,
    candidate: review[candidateLabel],
    baseline: review[baselineLabel],
    preference,
    clearlyWorse,
    notes: review.notes,
  };
});

const summarizeSide = (side: "candidate" | "baseline") => ({
  absolutePasses: rows.filter((row) => row[side].absolutePass).length,
  appropriateConversationOutcomes: rows.filter((row) => row[side].appropriateConversationOutcome).length,
  wouldContinue: rows.filter((row) => row[side].wouldContinue).length,
  criticalFailures: rows.flatMap((row) => row[side].criticalFailures).length,
  preferred: rows.filter((row) => row.preference === side).length,
  clearlyWorse: rows.filter((row) => row.clearlyWorse === side).length,
});

const episodeRows = dataset.episodes.map((episode) => {
  const episodeReviews = rows.filter((row) => row.episodeId === episode.id);
  return {
    episodeId: episode.id,
    category: episode.category,
    targetStatus: episode.targetStatus,
    candidateAbsolutePasses: episodeReviews.filter((row) => row.candidate.absolutePass).length,
    baselineAbsolutePasses: episodeReviews.filter((row) => row.baseline.absolutePass).length,
    candidateAppropriateOutcomes: episodeReviews.filter((row) => row.candidate.appropriateConversationOutcome).length,
    baselineAppropriateOutcomes: episodeReviews.filter((row) => row.baseline.appropriateConversationOutcome).length,
    candidatePreferred: episodeReviews.filter((row) => row.preference === "candidate").length,
    baselinePreferred: episodeReviews.filter((row) => row.preference === "baseline").length,
    ties: episodeReviews.filter((row) => row.preference === "tie").length,
  };
});

const candidateSummary = summarizeSide("candidate");
const baselineSummary = summarizeSide("baseline");
const checks = {
  criticalFailureMaximum: candidateSummary.criticalFailures <= dataset.gateContract.criticalFailureMaximum,
  eachEpisodeAbsolutePass: episodeRows.every(
    (row) => row.candidateAbsolutePasses >= dataset.gateContract.absolutePassMinimumByEpisode
  ),
  absolutePassMinimumTotal: candidateSummary.absolutePasses >= dataset.gateContract.absolutePassMinimumTotal,
  appropriateConversationOutcomeMinimum:
    candidateSummary.appropriateConversationOutcomes >= dataset.gateContract.appropriateConversationOutcomeMinimum,
  clearlyWorseThanBaselineMaximum:
    candidateSummary.clearlyWorse <= dataset.gateContract.clearlyWorseThanBaselineMaximum,
  eachTargetBetterThanBaseline: episodeRows
    .filter((row) => row.targetStatus === "target")
    .every((row) => row.candidatePreferred >= dataset.gateContract.targetBetterThanBaselineMinimumByEpisode),
};
const applicableChecksPass = Object.values(checks).every(Boolean);
const evidenceAvailable = {
  productionBaselineIdentified: false,
  nonTargetRealEpisode: dataset.episodes.some((episode) => episode.targetStatus === "non_target"),
  heldOutRealEpisode: false,
};

const report = {
  schemaVersion: 1,
  datasetVersion: dataset.datasetVersion,
  reviewer: adjudication.reviewer,
  reviewedBeforeKeyRead: adjudication.reviewedBeforeKeyRead,
  adjudicationSha256: createHash("sha256").update(adjudicationSource).digest("hex"),
  keyCommitment: adjudication.keyCommitment,
  baseline: { side: baseline.side, sourceId: baseline.sourceId },
  candidate: { side: candidate.side, sourceId: candidate.sourceId },
  provider: candidate.provider,
  model: candidate.model,
  candidateSummary,
  baselineSummary,
  ties: rows.filter((row) => row.preference === "tie").length,
  episodeRows,
  checks,
  applicableChecksPass,
  evidenceAvailable,
  fullGatePass: applicableChecksPass && Object.values(evidenceAvailable).every(Boolean),
  conclusion: applicableChecksPass ? "evidence_incomplete" : "candidate_failed_applicable_thresholds",
  rows,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(report, null, 2));
