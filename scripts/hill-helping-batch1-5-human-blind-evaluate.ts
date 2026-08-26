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
  rawArtifactCommitments: { A: string; B: string };
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
const baselineSource = readFileSync(baselinePath);
const candidateSource = readFileSync(candidatePath);
const adjudicationSource = readFileSync(adjudicationPath);
const keySource = readFileSync(keyPath);
const baseline = readChatGateRunArtifact(baselinePath);
const candidate = readChatGateRunArtifact(candidatePath);
const adjudication = JSON.parse(adjudicationSource.toString("utf8")) as HumanAdjudication;
const key = JSON.parse(keySource.toString("utf8")) as HumanBlindKey;
const sha256 = (source: Buffer) => createHash("sha256").update(source).digest("hex");

if (adjudication.schemaVersion !== 1 || !adjudication.reviewedBeforeKeyRead) {
  throw new Error("Human answers were not frozen before key read.");
}
if (sha256(keySource) !== adjudication.keyCommitment) {
  throw new Error("Blind-key commitment mismatch.");
}
if (key.schemaVersion !== 2 || key.datasetVersion !== dataset.datasetVersion) {
  throw new Error("Blind-key schema or dataset mismatch.");
}
if (key.rawArtifactCommitments.A !== sha256(baselineSource)) {
  throw new Error("Baseline artifact commitment mismatch.");
}
if (key.rawArtifactCommitments.B !== sha256(candidateSource)) {
  throw new Error("Candidate artifact commitment mismatch.");
}
for (const field of ["runnerVersion", "datasetVersion", "datasetSha256", "provider", "model", "repeatCount"] as const) {
  if (baseline[field] !== candidate[field]) {
    throw new Error(`Baseline/candidate ${field} mismatch.`);
  }
}

const expectedCount = dataset.gateContract.episodeRunsPerSide;
if (adjudication.reviews.length !== expectedCount || key.items.length !== expectedCount) {
  throw new Error("Human review or key item count is incomplete.");
}
const reviewIndex = new Map(adjudication.reviews.map((review) => [review.reviewId, review]));
const keyIndex = new Map(key.items.map((item) => [item.reviewId, item]));
if (reviewIndex.size !== expectedCount || keyIndex.size !== expectedCount) {
  throw new Error("Duplicate review id in adjudication or key.");
}
if ([...reviewIndex.keys()].some((reviewId) => !keyIndex.has(reviewId))) {
  throw new Error("Adjudication contains an unknown review id.");
}

const allowedIdentities = new Map([
  [baseline.side, baseline.sourceId],
  [candidate.side, candidate.sourceId],
]);
const criticalFailures = new Set(dataset.gateContract.criticalFailures);
const rows = key.items.map((item) => {
  const review = reviewIndex.get(item.reviewId);
  if (!review) throw new Error(`Missing human review: ${item.reviewId}`);
  if (!dataset.episodes.some((episode) => episode.id === item.episodeId)) {
    throw new Error(`Unknown episode in key: ${item.reviewId}/${item.episodeId}.`);
  }
  if (item.runIndex < 1 || item.runIndex > dataset.gateContract.runsPerSide) {
    throw new Error(`Invalid run index in key: ${item.reviewId}/${item.runIndex}.`);
  }
  if (item.X.side === item.Y.side) throw new Error(`Blind sides are not distinct: ${item.reviewId}`);
  for (const label of ["X", "Y"] as const) {
    if (allowedIdentities.get(item[label].side) !== item[label].sourceId) {
      throw new Error(`Unknown source identity in ${item.reviewId}/${label}.`);
    }
    if (!Array.isArray(review[label].criticalFailures)) {
      throw new Error(`Invalid critical failure list in ${item.reviewId}/${label}.`);
    }
    for (const field of ["absolutePass", "appropriateConversationOutcome", "wouldContinue"] as const) {
      if (typeof review[label][field] !== "boolean") {
        throw new Error(`Invalid ${field} value in ${item.reviewId}/${label}.`);
      }
    }
    for (const failure of review[label].criticalFailures) {
      if (!criticalFailures.has(failure)) {
        throw new Error(`Unknown critical failure in ${item.reviewId}/${label}: ${failure}`);
      }
    }
  }
  if (!["X", "Y", "tie"].includes(review.pairPreference)) {
    throw new Error(`Invalid pair preference in ${item.reviewId}.`);
  }
  if (!["X", "Y", "none"].includes(review.clearlyWorseSide)) {
    throw new Error(`Invalid clearly-worse side in ${item.reviewId}.`);
  }
  if (typeof review.notes !== "string") throw new Error(`Invalid notes in ${item.reviewId}.`);
  const candidateLabel: BlindLabel = item.X.side === candidate.side ? "X" : "Y";
  const baselineLabel: BlindLabel = candidateLabel === "X" ? "Y" : "X";
  return {
    reviewId: item.reviewId,
    episodeId: item.episodeId,
    runIndex: item.runIndex,
    candidateBlindLabel: candidateLabel,
    candidate: review[candidateLabel],
    baseline: review[baselineLabel],
    preference: review.pairPreference === "tie"
      ? "tie"
      : review.pairPreference === candidateLabel ? "candidate" : "baseline",
    clearlyWorse: review.clearlyWorseSide === "none"
      ? "none"
      : review.clearlyWorseSide === candidateLabel ? "candidate" : "baseline",
    notes: review.notes,
  };
});

const summarize = (side: "candidate" | "baseline") => ({
  absolutePasses: rows.filter((row) => row[side].absolutePass).length,
  appropriateConversationOutcomes: rows.filter((row) => row[side].appropriateConversationOutcome).length,
  wouldContinue: rows.filter((row) => row[side].wouldContinue).length,
  criticalFailures: rows.flatMap((row) => row[side].criticalFailures).length,
  preferred: rows.filter((row) => row.preference === side).length,
  clearlyWorse: rows.filter((row) => row.clearlyWorse === side).length,
});

const candidateSummary = summarize("candidate");
const baselineSummary = summarize("baseline");
const thresholds = {
  totalReviews: expectedCount,
  minimumPassesPerPositiveMetric: Math.ceil(expectedCount * 0.85),
  maximumClearlyWorse: Math.floor(expectedCount * 0.10),
  maximumCriticalFailures: 0,
};
const checks = {
  absolutePass: candidateSummary.absolutePasses >= thresholds.minimumPassesPerPositiveMetric,
  appropriateConversationOutcome:
    candidateSummary.appropriateConversationOutcomes >= thresholds.minimumPassesPerPositiveMetric,
  wouldContinue: candidateSummary.wouldContinue >= thresholds.minimumPassesPerPositiveMetric,
  clearlyWorse: candidateSummary.clearlyWorse <= thresholds.maximumClearlyWorse,
  criticalFailures: candidateSummary.criticalFailures <= thresholds.maximumCriticalFailures,
};
const passed = Object.values(checks).every(Boolean);
const report = {
  schemaVersion: 1,
  batch: "1.5",
  datasetVersion: dataset.datasetVersion,
  reviewer: adjudication.reviewer,
  reviewedBeforeKeyRead: adjudication.reviewedBeforeKeyRead,
  adjudicationSha256: sha256(adjudicationSource),
  keyCommitment: adjudication.keyCommitment,
  baseline: { side: baseline.side, sourceId: baseline.sourceId },
  candidate: { side: candidate.side, sourceId: candidate.sourceId },
  thresholds,
  candidateSummary,
  baselineSummary,
  ties: rows.filter((row) => row.preference === "tie").length,
  checks,
  passed,
  conclusion: passed ? "batch1_5_human_gate_passed" : "batch1_5_human_gate_failed",
  rows,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(report, null, 2));
