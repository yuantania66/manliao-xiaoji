/**
 * Freeze a 100-case experience baseline from the current createChatReply orchestration.
 *
 * Scope: baseline capture only. Does not modify TA-009, Prompt, or Voice.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply, type ChatReplyResult } from "../services/ai/chatOrchestrationService";
import { getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import { CHAT_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../services/ai/promptBuilder";
import type { ClinicalPlan } from "../services/clinical/clinicalTypes";

import { parseExperienceExplorer } from "./experience-improvement-loop";

loadEnvConfig(process.cwd());

const DEFAULT_EXPLORER_PATH = "docs/evals/experience-explorer-latest.md";
const DEFAULT_OUTPUT_PATH = "docs/evals/experience-orchestration-baseline-latest.json";
const DEFAULT_MARKDOWN_PATH = "docs/evals/experience-orchestration-baseline-latest.md";

type BaselineCaseResult = {
  caseId: string;
  explorerUserInput: string;
  resolvedUserInput: string;
  status: "ok" | "error";
  error?: string;
  reply: string;
  previousExplorerReply: string;
  finalReplySource: string;
  orchestrationFinalSource: string;
  rewriteAttempted: boolean;
  regenerateAttempted: boolean;
  fallbackUsed: boolean;
  guardHit: boolean;
  guardLayerHits: string[];
  rawLLMOutput: string | null;
  clinicalPlanSummary: {
    skippedBySafety: boolean;
    responseGoal: string | null;
    responseIntent: string | null;
    primaryStrategy: string | null;
    questionFunction: string | null;
    toneConstraint: string[];
    interventionBoundary: string[];
  } | null;
  semanticEvidence: {
    status: string | null;
    source: string | null;
    reason: string | null;
  };
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  tokenInput: number | null;
  tokenOutput: number | null;
};

type BaselineReport = {
  generatedAt: string;
  purpose: string;
  explorerPath: string;
  outputPath: string;
  markdownPath: string;
  reproducibleCommand: string;
  runParameters: {
    entrypoint: string;
    recentMessages: "empty_single_turn";
    clinicalPlanPromptEnabled: string;
    aiProvider: string;
    aiMainModelConfigured: string;
    aiTimeoutMs: string;
    chatPromptVersion: string;
    judgePromptVersion: string;
    includeDebugTrace: boolean;
    concurrency: number;
  };
  git: {
    branch: string;
    headSha: string;
    dirty: boolean;
    statusShort: string[];
  };
  summary: {
    totalCases: number;
    completedOk: number;
    completedError: number;
    finalReplySource: Record<string, number>;
    guardHitCount: number;
    semanticEvidenceStatus: Record<string, number>;
    responseGoal: Record<string, number>;
    models: Record<string, number>;
  };
  results: BaselineCaseResult[];
};

const readArgument = (args: string[], name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
};

const resolveUserInput = (explorerUserInput: string) => {
  if (explorerUserInput === "（空消息）") return "";
  if (explorerUserInput === "（仅空格，共 3 个）") return "   ";
  return explorerUserInput;
};

const summarizePlan = (result: ChatReplyResult): BaselineCaseResult["clinicalPlanSummary"] => {
  const plan: ClinicalPlan | undefined = result.clinicalTrace.selectedPlan;
  return {
    skippedBySafety: result.clinicalTrace.skippedBySafety,
    responseGoal: plan?.responseGoal ?? null,
    responseIntent: plan?.responseIntent ?? null,
    primaryStrategy: plan?.primaryStrategy ?? null,
    questionFunction: plan?.questionFunction ?? null,
    toneConstraint: plan?.toneConstraint ?? [],
    interventionBoundary: plan?.interventionBoundary ?? [],
  };
};

const countBy = (values: Array<string | null | undefined>) =>
  values.reduce<Record<string, number>>((acc, value) => {
    const key = value && value.length > 0 ? value : "null";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const getGitMeta = () => {
  const run = (command: string) => {
    try {
      return execSync(command, { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };

  const statusShort = run("git status --short")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return {
    branch: run("git rev-parse --abbrev-ref HEAD") || "unknown",
    headSha: run("git rev-parse HEAD") || "unknown",
    dirty: statusShort.length > 0,
    statusShort,
  };
};

const toCaseResult = ({
  caseId,
  explorerUserInput,
  resolvedUserInput,
  previousExplorerReply,
  run,
}: {
  caseId: string;
  explorerUserInput: string;
  resolvedUserInput: string;
  previousExplorerReply: string;
  run: { ok: true; result: ChatReplyResult } | { ok: false; error: string };
}): BaselineCaseResult => {
  if (!run.ok) {
    return {
      caseId,
      explorerUserInput,
      resolvedUserInput,
      status: "error",
      error: run.error,
      reply: "",
      previousExplorerReply,
      finalReplySource: "error",
      orchestrationFinalSource: "error",
      rewriteAttempted: false,
      regenerateAttempted: false,
      fallbackUsed: false,
      guardHit: false,
      guardLayerHits: [],
      rawLLMOutput: null,
      clinicalPlanSummary: null,
      semanticEvidence: { status: null, source: null, reason: null },
      model: null,
      promptVersion: null,
      latencyMs: null,
      tokenInput: null,
      tokenOutput: null,
    };
  }

  const { result } = run;
  const guardLayerHits = (result.generation.postProcessSteps ?? [])
    .filter((step) => step.layer.includes("semantic_evidence") || step.layer.includes("guard"))
    .map((step) => step.layer);
  const finalReplySource = result.generation.finalReplySource ?? result.finalSource;
  const guardHit =
    result.regenerateAttempted ||
    finalReplySource === "guard_rewrite" ||
    finalReplySource === "llm_regenerate" ||
    finalReplySource === "constraint_failure" ||
    result.finalSource === "guard_rewrite" ||
    result.finalSource === "llm_regenerate" ||
    result.finalSource === "constraint_failure";
  const semantic = result.clinicalTrace.signals?.semanticEvidence;

  return {
    caseId,
    explorerUserInput,
    resolvedUserInput,
    status: "ok",
    reply: result.generation.text,
    previousExplorerReply,
    finalReplySource,
    orchestrationFinalSource: result.finalSource,
    rewriteAttempted: result.rewriteAttempted,
    regenerateAttempted: result.regenerateAttempted,
    fallbackUsed: result.fallbackUsed,
    guardHit,
    guardLayerHits,
    rawLLMOutput: result.generation.rawLLMOutput ?? null,
    clinicalPlanSummary: summarizePlan(result),
    semanticEvidence: {
      status: semantic?.status ?? null,
      source: semantic?.source ?? null,
      reason: semantic?.reason ?? null,
    },
    model: result.generation.model ?? null,
    promptVersion: result.generation.promptVersion ?? null,
    latencyMs: result.generation.latencyMs ?? null,
    tokenInput: result.generation.tokenInput ?? null,
    tokenOutput: result.generation.tokenOutput ?? null,
  };
};

const runCase = async (caseId: string, userMessage: string) => {
  try {
    const result = await createChatReply({
      conversationId: `experience-orchestration-baseline-${caseId}`,
      userId: "experience-orchestration-baseline-user",
      userMessage,
      recentMessages: [],
      memoryContext: null,
      includeDebugTrace: false,
    });
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildReport = ({
  explorerPath,
  outputPath,
  markdownPath,
  reproducibleCommand,
  results,
}: {
  explorerPath: string;
  outputPath: string;
  markdownPath: string;
  reproducibleCommand: string;
  results: BaselineCaseResult[];
}): BaselineReport => {
  const ok = results.filter((item) => item.status === "ok");
  return {
    generatedAt: new Date().toISOString(),
    purpose:
      "Freeze current-code createChatReply replies for the 100 experience explorer cases before any TA-009 change.",
    explorerPath,
    outputPath,
    markdownPath,
    reproducibleCommand,
    runParameters: {
      entrypoint: "services/ai/chatOrchestrationService.createChatReply",
      recentMessages: "empty_single_turn",
      clinicalPlanPromptEnabled: process.env.CLINICAL_PLAN_PROMPT_ENABLED ?? "unset(false)",
      aiProvider: getAiProvider(),
      aiMainModelConfigured: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
      aiTimeoutMs: process.env.AI_TIMEOUT_MS?.trim() || "45000",
      chatPromptVersion: CHAT_PROMPT_VERSION,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      includeDebugTrace: false,
      concurrency: 1,
    },
    git: getGitMeta(),
    summary: {
      totalCases: results.length,
      completedOk: ok.length,
      completedError: results.length - ok.length,
      finalReplySource: countBy(ok.map((item) => item.finalReplySource)),
      guardHitCount: ok.filter((item) => item.guardHit).length,
      semanticEvidenceStatus: countBy(ok.map((item) => item.semanticEvidence.status)),
      responseGoal: countBy(ok.map((item) => item.clinicalPlanSummary?.responseGoal)),
      models: countBy(ok.map((item) => item.model)),
    },
    results: [...results].sort((a, b) => a.caseId.localeCompare(b.caseId)),
  };
};

const formatBlock = (value: string) => {
  const text = value.length > 0 ? value : "(empty)";
  return ["```text", text.replace(/```/g, "`\u200b``"), "```"].join("\n");
};

const writeMarkdown = (path: string, report: BaselineReport) => {
  const lines: string[] = [
    "# Experience Orchestration Baseline",
    "",
    "Current-code `createChatReply` freeze for the 100 experience explorer cases.",
    "",
    "## Run Meta",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- explorerPath: ${report.explorerPath}`,
    `- reproducibleCommand: \`${report.reproducibleCommand}\``,
    `- aiProvider: ${report.runParameters.aiProvider}`,
    `- aiMainModelConfigured: ${report.runParameters.aiMainModelConfigured}`,
    `- clinicalPlanPromptEnabled: ${report.runParameters.clinicalPlanPromptEnabled}`,
    `- chatPromptVersion: ${report.runParameters.chatPromptVersion}`,
    `- git.headSha: ${report.git.headSha}`,
    `- git.branch: ${report.git.branch}`,
    `- git.dirty: ${report.git.dirty}`,
    "",
    "## Summary",
    "",
    `- totalCases: ${report.summary.totalCases}`,
    `- completedOk: ${report.summary.completedOk}`,
    `- completedError: ${report.summary.completedError}`,
    `- guardHitCount: ${report.summary.guardHitCount}`,
    `- finalReplySource: ${JSON.stringify(report.summary.finalReplySource)}`,
    `- semanticEvidenceStatus: ${JSON.stringify(report.summary.semanticEvidenceStatus)}`,
    `- responseGoal: ${JSON.stringify(report.summary.responseGoal)}`,
    `- models: ${JSON.stringify(report.summary.models)}`,
    "",
  ];

  for (const item of report.results) {
    lines.push(`## Case ${item.caseId}`, "");
    lines.push(`- status: ${item.status}`);
    if (item.error) lines.push(`- error: ${item.error}`);
    lines.push(`- explorerUserInput:`);
    lines.push(formatBlock(item.explorerUserInput));
    lines.push(`- resolvedUserInput:`);
    lines.push(formatBlock(item.resolvedUserInput));
    lines.push(`- reply:`);
    lines.push(formatBlock(item.reply));
    lines.push(`- previousExplorerReply:`);
    lines.push(formatBlock(item.previousExplorerReply));
    lines.push(`- finalReplySource: ${item.finalReplySource}`);
    lines.push(`- orchestrationFinalSource: ${item.orchestrationFinalSource}`);
    lines.push(`- rewriteAttempted: ${item.rewriteAttempted}`);
    lines.push(`- fallbackUsed: ${item.fallbackUsed}`);
    lines.push(`- guardHit: ${item.guardHit}`);
    lines.push(`- guardLayerHits: ${item.guardLayerHits.join(", ") || "none"}`);
    lines.push(`- semanticEvidence.status: ${item.semanticEvidence.status}`);
    lines.push(`- semanticEvidence.source: ${item.semanticEvidence.source}`);
    lines.push(`- semanticEvidence.reason: ${item.semanticEvidence.reason}`);
    lines.push(`- clinicalPlan.responseGoal: ${item.clinicalPlanSummary?.responseGoal}`);
    lines.push(`- clinicalPlan.responseIntent: ${item.clinicalPlanSummary?.responseIntent}`);
    lines.push(`- clinicalPlan.primaryStrategy: ${item.clinicalPlanSummary?.primaryStrategy}`);
    lines.push(`- clinicalPlan.questionFunction: ${item.clinicalPlanSummary?.questionFunction}`);
    lines.push(`- model: ${item.model}`);
    lines.push(`- promptVersion: ${item.promptVersion}`);
    lines.push(`- latencyMs: ${item.latencyMs}`);
    lines.push("");
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
};

const writeJson = (path: string, report: BaselineReport) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const explorerPath = readArgument(args, "--explorer") ?? DEFAULT_EXPLORER_PATH;
  const outputPath = readArgument(args, "--output") ?? DEFAULT_OUTPUT_PATH;
  const markdownPath = readArgument(args, "--markdown") ?? DEFAULT_MARKDOWN_PATH;
  const requestedCase = readArgument(args, "--case");
  const dryRun = args.includes("--dry-run");
  const resume = args.includes("--resume");

  if (!isAiProviderConfigured() && !dryRun) {
    throw new Error("AI provider is not configured; refuse to freeze a mock/fallback baseline.");
  }

  const explorerCases = parseExperienceExplorer(readFileSync(explorerPath, "utf8"));
  const selected = requestedCase
    ? explorerCases.filter((item) => item.id === requestedCase)
    : explorerCases;
  if (requestedCase && selected.length !== 1) {
    throw new Error(`Unknown case: ${requestedCase}`);
  }

  const reproducibleCommand = [
    "npx tsx scripts/experience-orchestration-baseline-freeze.ts",
    `--explorer ${explorerPath}`,
    `--output ${outputPath}`,
    `--markdown ${markdownPath}`,
    requestedCase ? `--case ${requestedCase}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          explorerPath,
          outputPath,
          markdownPath,
          selectedCases: selected.length,
          providerConfigured: isAiProviderConfigured(),
          clinicalPlanPromptEnabled: process.env.CLINICAL_PLAN_PROMPT_ENABLED ?? "unset(false)",
          aiProvider: getAiProvider(),
          aiMainModelConfigured: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
          chatPromptVersion: CHAT_PROMPT_VERSION,
          reproducibleCommand,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const previous =
    resume && !requestedCase
      ? (JSON.parse(readFileSync(outputPath, "utf8")) as BaselineReport)
      : undefined;
  const results: BaselineCaseResult[] = previous?.results ? [...previous.results] : [];
  const completedIds = new Set(results.map((item) => item.caseId));

  for (const item of selected) {
    if (completedIds.has(item.id) && resume) continue;
    const resolvedUserInput = resolveUserInput(item.userInput);
    process.stderr.write(`Freezing Case ${item.id}...\n`);
    const run = await runCase(item.id, resolvedUserInput);
    const next = toCaseResult({
      caseId: item.id,
      explorerUserInput: item.userInput,
      resolvedUserInput,
      previousExplorerReply: item.currentReply,
      run,
    });
    const existingIndex = results.findIndex((entry) => entry.caseId === item.id);
    if (existingIndex >= 0) results[existingIndex] = next;
    else results.push(next);
    completedIds.add(item.id);

    const partial = buildReport({
      explorerPath,
      outputPath,
      markdownPath,
      reproducibleCommand,
      results,
    });
    writeJson(outputPath, partial);
  }

  const report = buildReport({
    explorerPath,
    outputPath,
    markdownPath,
    reproducibleCommand,
    results,
  });
  writeJson(outputPath, report);
  writeMarkdown(markdownPath, report);
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath,
        markdownPath,
        summary: report.summary,
        runParameters: report.runParameters,
        git: {
          branch: report.git.branch,
          headSha: report.git.headSha,
          dirty: report.git.dirty,
        },
      },
      null,
      2
    )}\n`
  );

  if (report.summary.completedError > 0) {
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith("experience-orchestration-baseline-freeze.ts")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
