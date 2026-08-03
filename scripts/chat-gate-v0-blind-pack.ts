import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  loadChatGateDataset,
  readChatGateRunArtifact,
  type ChatGateEpisodeRun,
} from "./chat-gate-v0-lib";

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const aPath = getArg("a");
const bPath = getArg("b");
const outputPath = getArg("output");
const keyPath = getArg("key");
for (const [field, value] of [["a", aPath], ["b", bPath], ["output", outputPath], ["key", keyPath]]) {
  if (!value) throw new Error(`--${field} is required.`);
}

const dataset = loadChatGateDataset();
const a = readChatGateRunArtifact(aPath);
const b = readChatGateRunArtifact(bPath);
for (const field of ["runnerVersion", "datasetVersion", "datasetSha256", "provider", "model", "repeatCount"] as const) {
  if (a[field] !== b[field]) throw new Error(`A/B ${field} mismatch: ${a[field]} vs ${b[field]}`);
}
if (a.episodeRuns.length !== dataset.gateContract.episodeRunsPerSide) {
  throw new Error(`A has ${a.episodeRuns.length} episode runs; expected ${dataset.gateContract.episodeRunsPerSide}.`);
}
if (b.episodeRuns.length !== dataset.gateContract.episodeRunsPerSide) {
  throw new Error(`B has ${b.episodeRuns.length} episode runs; expected ${dataset.gateContract.episodeRunsPerSide}.`);
}

const indexRuns = (runs: ChatGateEpisodeRun[]) =>
  new Map(runs.map((run) => [`${run.episodeId}:run-${run.runIndex}`, run]));
const aRuns = indexRuns(a.episodeRuns);
const bRuns = indexRuns(b.episodeRuns);
const aIsX = (randomBytes(1)[0] ?? 0) % 2 === 0;

const formatTrajectory = (run: ChatGateEpisodeRun) =>
  run.turns
    .map((turn, index) => {
      const assistant = turn.assistantMessage?.content ?? `[SYSTEM STATUS: ${turn.executionStatus}]`;
      return [
        `Turn ${index + 1}`,
        "",
        `User: ${turn.user}`,
        "",
        `Assistant: ${assistant}`,
      ].join("\n");
    })
    .join("\n\n");

const lines = [
  "# Chat Gate v0 Blind Review",
  "",
  `Dataset: ${dataset.datasetVersion}`,
  "",
  `Provider/model: ${a.provider}:${a.model}`,
  "",
  "Review each pair without trying to infer which source is the baseline. A",
  "critical failure overrides the other quality fields.",
  "",
  "Allowed critical-failure codes:",
  "",
  ...dataset.gateContract.criticalFailures.map((failure) => `- ${failure}`),
  "",
];

for (const episode of dataset.episodes) {
  for (let runIndex = 1; runIndex <= dataset.gateContract.runsPerSide; runIndex += 1) {
    const key = `${episode.id}:run-${runIndex}`;
    const aRun = aRuns.get(key);
    const bRun = bRuns.get(key);
    if (!aRun || !bRun) throw new Error(`Missing A/B run: ${key}`);
    const x = aIsX ? aRun : bRun;
    const y = aIsX ? bRun : aRun;
    lines.push(
      `## ${episode.id} / run-${runIndex}`,
      "",
      `Category: ${episode.category}`,
      "",
      `Evidence limitation: ${episode.evidenceLimitations.join(" / ") || "none"}`,
      "",
      "### X",
      "",
      formatTrajectory(x),
      "",
      "### Y",
      "",
      formatTrajectory(y),
      "",
      "### Review",
      "",
      "- X absolutePass: unreviewed",
      "- Y absolutePass: unreviewed",
      "- X appropriateConversationOutcome: unreviewed",
      "- Y appropriateConversationOutcome: unreviewed",
      `- X wouldContinue: ${episode.openInteraction ? "unreviewed" : "not_applicable"}`,
      `- Y wouldContinue: ${episode.openInteraction ? "unreviewed" : "not_applicable"}`,
      "- X criticalFailures: none_or_unreviewed",
      "- Y criticalFailures: none_or_unreviewed",
      "- pairPreference: unreviewed",
      "- clearlyWorseSide: unreviewed",
      "- reviewerNotes: unreviewed",
      ""
    );
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(keyPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\n").trimEnd()}\n`, { encoding: "utf8", flag: "wx" });
writeFileSync(
  keyPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      blindReviewPath: outputPath,
      X: aIsX ? { side: a.side, sourceId: a.sourceId } : { side: b.side, sourceId: b.sourceId },
      Y: aIsX ? { side: b.side, sourceId: b.sourceId } : { side: a.side, sourceId: a.sourceId },
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", flag: "wx" }
);

console.log(JSON.stringify({ output: outputPath, key: keyPath, pairs: dataset.gateContract.episodeRunsPerSide }, null, 2));
