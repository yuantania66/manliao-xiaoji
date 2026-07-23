import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  getExperienceJudgeModel,
  getExperienceJudgeProvider,
  judgeExperienceBatch,
  type ExperienceJudgeBatchResult,
} from "./experience-judge";

loadEnvConfig(process.cwd());

type ExplorerCase = {
  id: string;
  userInput: string;
  currentReply: string;
};

type BlindCase = {
  id: string;
  user: string;
  replyA: string;
  replyB: string;
  productSide: "A" | "B";
};

type LoopCase = ExplorerCase & {
  currentCandidateReply: string;
  candidateSource: "chatgpt_blind_candidate" | "unchanged_control";
};

type LoopResult = {
  caseId: string;
  userInput: string;
  baselineReply: string;
  currentReply: string;
  baselineScore: ExperienceJudgeBatchResult["baselineScore"];
  currentScore: ExperienceJudgeBatchResult["currentScore"];
  wouldContinueConversation: boolean;
  feelsUnderstood: ExperienceJudgeBatchResult["feelsUnderstood"];
  naturalness: ExperienceJudgeBatchResult["naturalness"];
  failureType: string[];
  reason: string;
};

type LoopReport = {
  generatedAt: string;
  explorerPath: string;
  blindReviewPath: string;
  provider: string;
  judgeModel: string;
  totalCases: number;
  candidateCases: number;
  unchangedControlCases: number;
  completedCases: number;
  top20WorstCases: LoopResult[];
  topFailureClusters: { failureType: string; count: number; caseIds: string[] }[];
  summary: {
    wouldContinueConversation: Record<string, number>;
    averageBaselineScore: number | null;
    averageCurrentScore: number | null;
    averageScoreDelta: number | null;
    averageFeelsUnderstood: number | null;
    averageNaturalness: number | null;
    failureType: Record<string, number>;
  };
  results: LoopResult[];
};

const DEFAULT_EXPLORER_PATH = "docs/evals/experience-explorer-latest.md";
const DEFAULT_OUTPUT_PATH = "docs/evals/experience-improvement-loop-latest.json";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const decodeTableCell = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

export const parseExperienceExplorer = (markdown: string): ExplorerCase[] => {
  const cases = markdown
    .split("\n")
    .filter((line) => /^\|\s*\d{3}\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map(decodeTableCell);
      return {
        id: cells[0] ?? "",
        userInput: cells[1] ?? "",
        currentReply: cells[2] ?? "",
      };
    });

  if (cases.length !== 100) throw new Error(`Expected 100 explorer cases, found ${cases.length}.`);
  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Explorer case IDs must be unique.");
  }
  return cases;
};

export const parseBlindReviewCases = (html: string): BlindCase[] => {
  const match = html.match(/const cases = (\[[\s\S]*?\]);\s*const storageKey/);
  if (!match?.[1]) throw new Error("Could not find blind-review case payload.");
  const parsed = JSON.parse(match[1]) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Blind-review case payload must be an array.");

  return parsed.map((value, index) => {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Blind-review case ${index + 1} must be an object.`);
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.user !== "string" ||
      typeof item.replyA !== "string" ||
      typeof item.replyB !== "string" ||
      (item.productSide !== "A" && item.productSide !== "B")
    ) {
      throw new Error(`Blind-review case ${index + 1} is invalid.`);
    }
    return {
      id: item.id,
      user: item.user,
      replyA: item.replyA,
      replyB: item.replyB,
      productSide: item.productSide,
    };
  });
};

export const buildLoopCases = (explorerCases: ExplorerCase[], blindCases: BlindCase[]): LoopCase[] => {
  const blindById = new Map(blindCases.map((item) => [item.id, item]));

  return explorerCases.map((item) => {
    const blind = blindById.get(item.id);
    if (!blind) {
      return {
        ...item,
        currentCandidateReply: item.currentReply,
        candidateSource: "unchanged_control",
      };
    }

    const productReply = blind.productSide === "A" ? blind.replyA : blind.replyB;
    const candidateReply = blind.productSide === "A" ? blind.replyB : blind.replyA;
    if (normalize(blind.user) !== normalize(item.userInput)) {
      throw new Error(`Case ${item.id} user input differs between explorer and blind review.`);
    }
    if (normalize(productReply) !== normalize(item.currentReply)) {
      throw new Error(`Case ${item.id} product reply differs between explorer and blind review.`);
    }

    return {
      ...item,
      currentCandidateReply: candidateReply,
      candidateSource: "chatgpt_blind_candidate",
    };
  });
};

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});

const average = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

const buildReport = ({
  explorerPath,
  blindReviewPath,
  cases,
  results,
}: {
  explorerPath: string;
  blindReviewPath: string;
  cases: LoopCase[];
  results: LoopResult[];
}): LoopReport => {
  const orderedResults = [...results]
    .map((item) =>
      item.baselineReply === item.currentReply
        ? {
            ...item,
            currentScore: item.baselineScore,
            reason: item.failureType.length
              ? `Baseline 与 current 文本相同，用户体验一致。Experience Judge 给该回复 ${item.baselineScore}/5 分，识别到的体验问题：${item.failureType.join("、")}。`
              : `Baseline 与 current 文本相同，用户体验一致。Experience Judge 给该回复 ${item.baselineScore}/5 分，未识别出明显体验失败。`,
          }
        : item
    )
    .sort((a, b) => a.caseId.localeCompare(b.caseId));
  const failureTypes = [...new Set(orderedResults.flatMap((item) => item.failureType))];
  const topFailureClusters = failureTypes
    .map((failureType) => ({
      failureType,
      caseIds: orderedResults
        .filter((item) => item.failureType.includes(failureType))
        .map((item) => item.caseId),
    }))
    .map((item) => ({ ...item, count: item.caseIds.length }))
    .sort((a, b) => b.count - a.count || a.failureType.localeCompare(b.failureType));
  const top20WorstCases = [...orderedResults]
    .sort(
      (a, b) =>
        a.currentScore - b.currentScore ||
        a.feelsUnderstood - b.feelsUnderstood ||
        a.naturalness - b.naturalness ||
        a.caseId.localeCompare(b.caseId)
    )
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    explorerPath,
    blindReviewPath,
    provider: getExperienceJudgeProvider(),
    judgeModel: getExperienceJudgeModel(),
    totalCases: cases.length,
    candidateCases: cases.filter((item) => item.candidateSource === "chatgpt_blind_candidate").length,
    unchangedControlCases: cases.filter((item) => item.candidateSource === "unchanged_control").length,
    completedCases: orderedResults.length,
    top20WorstCases,
    topFailureClusters,
    summary: {
      wouldContinueConversation: countBy(
        orderedResults.map((item) => String(item.wouldContinueConversation))
      ),
      averageBaselineScore: average(orderedResults.map((item) => item.baselineScore)),
      averageCurrentScore: average(orderedResults.map((item) => item.currentScore)),
      averageScoreDelta: average(
        orderedResults.map((item) => item.currentScore - item.baselineScore)
      ),
      averageFeelsUnderstood: average(orderedResults.map((item) => item.feelsUnderstood)),
      averageNaturalness: average(orderedResults.map((item) => item.naturalness)),
      failureType: countBy(orderedResults.flatMap((item) => item.failureType)),
    },
    results: orderedResults,
  };
};

const readArgument = (args: string[], name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
};

const writeReport = (path: string, report: LoopReport) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const explorerPath = readArgument(args, "--explorer") ?? DEFAULT_EXPLORER_PATH;
  const blindReviewPath =
    readArgument(args, "--blind-review") ?? process.env.EXPERIENCE_BLIND_REVIEW_PATH?.trim();
  const outputPath = readArgument(args, "--output") ?? DEFAULT_OUTPUT_PATH;
  const requestedCase = readArgument(args, "--case");
  const requestedSource = readArgument(args, "--source") ?? "all";
  const batchSize = Number(readArgument(args, "--batch-size") ?? "20");
  const dryRun = args.includes("--dry-run");
  const resume = args.includes("--resume");
  const refresh = args.includes("--refresh");

  if (!blindReviewPath) {
    throw new Error("Provide --blind-review or EXPERIENCE_BLIND_REVIEW_PATH.");
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) {
    throw new Error("--batch-size must be an integer from 1 to 20.");
  }
  if (!["all", "candidate", "control"].includes(requestedSource)) {
    throw new Error("--source must be all, candidate, or control.");
  }
  if (refresh && !resume) throw new Error("--refresh requires --resume.");

  const explorerCases = parseExperienceExplorer(readFileSync(explorerPath, "utf8"));
  const blindCases = parseBlindReviewCases(readFileSync(blindReviewPath, "utf8"));
  const allCases = buildLoopCases(explorerCases, blindCases);
  const sourceCases =
    requestedSource === "candidate"
      ? allCases.filter((item) => item.candidateSource === "chatgpt_blind_candidate")
      : requestedSource === "control"
        ? allCases.filter((item) => item.candidateSource === "unchanged_control")
        : allCases;
  const cases = requestedCase ? sourceCases.filter((item) => item.id === requestedCase) : sourceCases;
  if (requestedCase && cases.length !== 1) throw new Error(`Unknown case: ${requestedCase}.`);

  const previousReport = resume
    ? (JSON.parse(readFileSync(outputPath, "utf8")) as LoopReport)
    : undefined;
  const selectedIds = new Set(cases.map((item) => item.id));
  const results = refresh
    ? (previousReport?.results ?? []).filter((item) => !selectedIds.has(item.caseId))
    : previousReport?.results ?? [];
  const completedIds = new Set(results.map((item) => item.caseId));

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          totalCases: allCases.length,
          selectedCases: cases.length,
          blindReviewCases: blindCases.length,
          candidateCases: allCases.filter(
            (item) => item.candidateSource === "chatgpt_blind_candidate"
          ).length,
          unchangedControlCases: allCases.filter(
            (item) => item.candidateSource === "unchanged_control"
          ).length,
          batchSize,
          estimatedJudgeCalls: Math.ceil(cases.length / batchSize),
          requestedSource,
          dataValidated: true,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const pendingCases = cases.filter((item) => !completedIds.has(item.id));
  for (let offset = 0; offset < pendingCases.length; offset += batchSize) {
    const batch = pendingCases.slice(offset, offset + batchSize);
    process.stderr.write(`Judging Cases ${batch[0]?.id}–${batch.at(-1)?.id}...\n`);
    const judgments = await judgeExperienceBatch(
      batch.map((item) => ({
        id: item.id,
        userInput:
          item.userInput === "（空消息）"
            ? ""
            : item.userInput === "（仅空格，共 3 个）"
              ? "   "
              : item.userInput,
        context: [],
        currentReply: item.currentReply,
        modifiedReply: item.currentCandidateReply,
        unchangedControl: item.candidateSource === "unchanged_control",
      }))
    );
    const judgmentById = new Map(judgments.map((item) => [item.id, item]));
    for (const item of batch) {
      const judgment = judgmentById.get(item.id);
      if (!judgment) throw new Error(`Missing judgment for Case ${item.id}.`);
      results.push({
        caseId: item.id,
        userInput: item.userInput,
        baselineReply: item.currentReply,
        currentReply: item.currentCandidateReply,
        baselineScore: judgment.baselineScore,
        currentScore:
          item.candidateSource === "unchanged_control"
            ? judgment.baselineScore
            : judgment.currentScore,
        wouldContinueConversation: judgment.wouldContinueConversation,
        feelsUnderstood: judgment.feelsUnderstood,
        naturalness: judgment.naturalness,
        failureType: judgment.failureType,
        reason: judgment.reason,
      });
      completedIds.add(item.id);
    }
    writeReport(outputPath, buildReport({ explorerPath, blindReviewPath, cases: allCases, results }));
  }

  const report = buildReport({ explorerPath, blindReviewPath, cases: allCases, results });
  writeReport(outputPath, report);
  process.stdout.write(`${JSON.stringify({ outputPath, ...report.summary, completedCases: results.length }, null, 2)}\n`);
};

if (process.argv[1]?.endsWith("experience-improvement-loop.ts")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
