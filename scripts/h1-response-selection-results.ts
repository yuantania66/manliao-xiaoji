import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadEnvConfig } from "@next/env";

import { generateH1CandidateRound } from "../lib/h1-eval/generator";
import {
  H1_STATE_DIR,
  isRoundComplete,
  readManifest,
  readSelections,
} from "../lib/h1-eval/storage";
import type { H1Candidate, H1CandidateManifest, H1Selection } from "../lib/h1-eval/types";

loadEnvConfig(process.cwd());

const OUTPUT_PATH = join(process.cwd(), "docs/evals/h1-response-selection-results.md");
const LOCK_PATH = join(H1_STATE_DIR, "advance.lock");

const countBy = (values: string[]) => values.reduce<Record<string, number>>((counts, value) => {
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});

const getCandidate = (
  manifest: H1CandidateManifest,
  selection: H1Selection
): H1Candidate | null => {
  if (!selection.best || selection.best === "all_unacceptable") return null;
  return manifest.cases.find((item) => item.id === selection.caseId)?.candidates.find(
    (candidate) => candidate.label === selection.best
  ) ?? null;
};

const normalizePrefix = (value: string) =>
  value.replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 8);

const buildReport = ({
  roundOne,
  roundTwo,
  selections,
}: {
  roundOne: H1CandidateManifest;
  roundTwo: H1CandidateManifest | null;
  selections: H1Selection[];
}) => {
  const roundTwoIds = new Set(roundTwo?.cases.map((item) => item.id) ?? []);
  const finalRows = roundOne.cases.map((item) => {
    const finalRound: 1 | 2 = roundTwoIds.has(item.id) ? 2 : 1;
    const manifest = finalRound === 2 ? roundTwo! : roundOne;
    const selection = selections.find((entry) => entry.round === finalRound && entry.caseId === item.id) ?? null;
    const roundOneSelection = selections.find((entry) => entry.round === 1 && entry.caseId === item.id) ?? null;
    const winner = selection ? getCandidate(manifest, selection) : null;
    const baseline = roundOne.cases.find((entry) => entry.id === item.id)?.candidates.find(
      (candidate) => candidate.origin === "baseline"
    );
    return { item, finalRound, selection, roundOneSelection, winner, baseline };
  });

  const completeRows = finalRows.filter((row) => row.selection?.best);
  const baselineWins = completeRows.filter((row) => row.winner?.origin === "baseline").length;
  const generatedWins = completeRows.filter((row) => row.winner?.origin === "generated").length;
  const allUnacceptable = completeRows.filter((row) => row.selection?.best === "all_unacceptable").length;
  const groupLines = ["S1", "S2", "S3", "S4"].map((group) => {
    const rows = completeRows.filter((row) => row.item.group === group);
    return `| ${group} | ${rows.length} | ${rows.filter((row) => row.winner?.origin === "baseline").length} | ${rows.filter((row) => row.winner?.origin === "generated").length} | ${rows.filter((row) => row.selection?.best === "all_unacceptable").length} |`;
  });

  const actionAppearances = countBy(
    [roundOne, ...(roundTwo ? [roundTwo] : [])].flatMap((manifest) =>
      manifest.cases.flatMap((item) => item.candidates.filter((candidate) => candidate.origin === "generated").map((candidate) => candidate.action))
    )
  );
  const actionWins = countBy(completeRows.flatMap((row) => row.winner?.origin === "generated" ? [row.winner.action] : []));
  const actions = [...new Set([...Object.keys(actionAppearances), ...Object.keys(actionWins)])].sort();
  const reasonCounts = countBy(completeRows.flatMap((row) => row.selection?.reasonTags ?? []));
  const generatedWinnerPrefixes = countBy(
    completeRows.flatMap((row) => row.winner?.origin === "generated" ? [normalizePrefix(row.winner.text)] : []).filter(Boolean)
  );
  const repeatedPrefixes = Object.entries(generatedWinnerPrefixes).filter(([, count]) => count >= 3);
  const guardRows = completeRows.filter((row) => row.item.cohort === "guard");
  const confirmedRows = completeRows.filter((row) => row.item.cohort === "confirmed");
  const confirmedGeneratedWins = confirmedRows.filter((row) => row.winner?.origin === "generated").length;
  const confirmedCoverage = confirmedRows.length ? confirmedGeneratedWins / 28 : 0;
  const guardBaselineRejected = guardRows.filter((row) =>
    row.baseline && row.roundOneSelection?.unacceptable.includes(row.baseline.label)
  );
  const guardAllUnacceptable = guardRows.filter((row) => row.selection?.best === "all_unacceptable");

  const lines = [
    "# H1 Response Selection Results",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "本报告只汇总 Decision Owner 的选择事实，不自动判定候选为‘优秀’，也不修改产品。",
    "",
    "## Progress",
    "",
    `- total cases: ${roundOne.cases.length}`,
    `- completed final selections: ${completeRows.length}`,
    `- round 1 complete: ${isRoundComplete(1) ? "yes" : "no"}`,
    `- round 2 required cases: ${roundTwo?.cases.length ?? 0}`,
    `- round 2 complete: ${roundTwo ? (isRoundComplete(2) ? "yes" : "no") : "not started"}`,
    "",
    "## Outcome Counts",
    "",
    `- baseline wins: ${baselineWins}`,
    `- generated candidate wins: ${generatedWins}`,
    `- all unacceptable: ${allUnacceptable}`,
    "",
    "## Group Results",
    "",
    "| Group | Completed | Baseline wins | Generated wins | All unacceptable |",
    "|---|---:|---:|---:|---:|",
    ...groupLines,
    "",
    "## Case Winners",
    "",
    "| Case | Cohort | Group | Round | Winner | Origin | Action | Reply |",
    "|---|---|---|---:|---|---|---|---|",
    ...finalRows.map((row) => {
      const best = row.selection?.best ?? "pending selection";
      const reply = row.winner?.text.replace(/\|/g, "\\|") ?? "—";
      return `| ${row.item.id} | ${row.item.cohort} | ${row.item.group} | ${row.finalRound} | ${best} | ${row.winner?.origin ?? "—"} | ${row.winner?.action ?? "—"} | ${reply} |`;
    }),
    "",
    "## Action Win Rates",
    "",
    "| Hidden action | Wins | Appearances | Win rate |",
    "|---|---:|---:|---:|",
    ...actions.map((action) => {
      const wins = actionWins[action] ?? 0;
      const appearances = actionAppearances[action] ?? 0;
      return `| ${action} | ${wins} | ${appearances} | ${appearances ? `${((wins / appearances) * 100).toFixed(1)}%` : "0.0%"} |`;
    }),
    "",
    "## Reason Tags",
    "",
    ...Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => `- ${tag}: ${count}`),
    ...(Object.keys(reasonCounts).length ? [] : ["- none recorded"]),
    "",
    "## Repeated Winning Phrases",
    "",
    `- prefixes occurring at least 3 times: ${repeatedPrefixes.length ? repeatedPrefixes.map(([prefix, count]) => `${prefix} (${count})`).join("; ") : "none"}`,
    `- new template rut signal (same normalized 8-character prefix >= 4 wins): ${repeatedPrefixes.some(([, count]) => count >= 4) ? "present" : "not observed"}`,
    "",
    "## Guard Cases",
    "",
    `- completed guard cases: ${guardRows.length}/8`,
    `- guard baseline marked unacceptable: ${guardBaselineRejected.length}${guardBaselineRejected.length ? ` (${guardBaselineRejected.map((row) => row.item.id).join(", ")})` : ""}`,
    `- guard cases with all candidates unacceptable: ${guardAllUnacceptable.length}${guardAllUnacceptable.length ? ` (${guardAllUnacceptable.map((row) => row.item.id).join(", ")})` : ""}`,
    `- guard cases where a generated candidate won: ${guardRows.filter((row) => row.winner?.origin === "generated").length}`,
    "",
    "## Product-PR Threshold Facts",
    "",
    `- confirmed H1 cases with generated winner: ${confirmedGeneratedWins}/28 (${(confirmedCoverage * 100).toFixed(1)}%)`,
    `- at least 70% confirmed coverage: ${confirmedCoverage >= 0.7 ? "yes" : "no"}`,
    `- S1/S2/S3 each have at least one generated winner: ${["S1", "S2", "S3"].every((group) => confirmedRows.some((row) => row.item.group === group && row.winner?.origin === "generated")) ? "yes" : "no"}`,
    `- guard baseline rejection observed: ${guardBaselineRejected.length || guardAllUnacceptable.length ? "yes" : "no"}`,
    `- new high-frequency template observed: ${repeatedPrefixes.some(([, count]) => count >= 4) ? "yes" : "no"}`,
    `- one generated action accounts for every generated win: ${generatedWins > 0 && Math.max(...Object.values(actionWins)) === generatedWins ? "yes" : "no"}`,
    "- Decision Owner product authorization: not recorded by this eval",
    "",
    "## Scope Facts",
    "",
    `- cases with a selected generated reply: ${completeRows.filter((row) => row.winner?.origin === "generated").map((row) => row.item.id).join(", ") || "none"}`,
    `- cases still all unacceptable: ${completeRows.filter((row) => row.selection?.best === "all_unacceptable").map((row) => row.item.id).join(", ") || "none"}`,
    `- pending-evidence cohort: ${roundOne.cases.filter((row) => row.cohort === "pending").map((row) => row.id).join(", ")}`,
    `- winning generated actions by group: ${["S1", "S2", "S3", "S4"].map((group) => `${group}=${[...new Set(completeRows.filter((row) => row.item.group === group && row.winner?.origin === "generated").map((row) => row.winner!.action))].join(",") || "none"}`).join("; ")}`,
    "",
  ];

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`);
  return { outputPath: OUTPUT_PATH, complete: completeRows.length, total: roundOne.cases.length };
};

const main = async () => {
  mkdirSync(H1_STATE_DIR, { recursive: true });
  let lock: number;
  try {
    lock = openSync(LOCK_PATH, "wx");
  } catch {
    console.log(JSON.stringify({ status: "already-running" }));
    return;
  }

  try {
    const roundOne = readManifest(1);
    if (!roundOne) throw new Error("Round 1 candidates are missing. Run experience:h1-candidates first.");
    let roundTwo = readManifest(2);
    const selections = readSelections().selections;
    let report = buildReport({ roundOne, roundTwo, selections });

    if (isRoundComplete(1) && !roundTwo) {
      const rejectedCount = selections.filter(
        (selection) => selection.round === 1 && selection.best === "all_unacceptable"
      ).length;
      if (rejectedCount > 0) {
        const generated = await generateH1CandidateRound({ round: 2 });
        roundTwo = generated.manifest;
        report = buildReport({ roundOne, roundTwo, selections: readSelections().selections });
      }
    }

    console.log(JSON.stringify({ ...report, roundTwoCases: roundTwo?.cases.length ?? 0 }, null, 2));
  } finally {
    closeSync(lock!);
    unlinkSync(LOCK_PATH);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
