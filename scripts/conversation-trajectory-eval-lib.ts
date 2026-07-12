import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { AiConversationMessage } from "../services/ai/types";
import type { ChatReplyResult } from "../services/ai/chatOrchestrationService";

export type TrajectoryRunMode = "real" | "replay";
export type FixtureStatus = "captured" | "pending_reproduction";
export type ExpectedValue = string | "pending";

export type TrajectoryTurn = {
  turnId: string;
  fixtureStatus: FixtureStatus;
  user: string;
  observedAssistant?: string;
  expectedStructure: {
    responseGoal: ExpectedValue;
    responseIntent: ExpectedValue;
    questionFunction: ExpectedValue;
  };
  allowedFacts: string[];
  forbiddenPatterns: string[];
  machineChecks: string[];
  reviewerFields: string[];
};

export type ConversationTrajectory = {
  id: string;
  category: "groundedness" | "template_rut" | "meta_repair";
  source: {
    kind: "product_self_test" | "user_reported_probe";
    capturedAt: string;
    evidence: Array<"screenshot" | "reported">;
    captureEnvironment: "pending_confirmation" | string;
  };
  purpose: string;
  initialMessages: AiConversationMessage[];
  turns: TrajectoryTurn[];
  trajectoryMachineChecks: string[];
  trajectoryReviewerFields: string[];
};

export type TrajectoryDataset = {
  schemaVersion: 1;
  datasetVersion: string;
  trajectories: ConversationTrajectory[];
};

export type TurnRunResult = {
  turn: TrajectoryTurn;
  assistant: string | null;
  status: "completed" | "pending_reproduction" | "error";
  source: string;
  model: string;
  promptVersion: string;
  selectedResponseGoal: string;
  selectedStrategy: string;
  responseIntent: string;
  questionFunction: string;
  machineCheckErrors: string[];
  heuristicFlags: Array<{ rule: string; matchedText: string }>;
  error?: string;
};

export type TrajectoryRunResult = {
  trajectory: ConversationTrajectory;
  runIndex: number;
  turns: TurnRunResult[];
  trajectoryMachineCheckErrors: string[];
  trajectoryHeuristicFlags: Array<{ rule: string; matchedText: string }>;
};

export type TrajectoryReportMetadata = {
  datasetVersion: string;
  runnerVersion: string;
  evaluatedCommit: string;
  relevantSourceFingerprint: string;
  generatedAt: string;
  runMode: TrajectoryRunMode;
  repeatCount: number;
  variant: string;
  provider: string;
  model: string;
  promptVersion: string;
  freshness: "current" | "stale";
  staleReason: string;
};

export const TRAJECTORY_DATASET_PATH = "clinical-evals/conversation-trajectories-v1.json";
export const TRAJECTORY_REPORT_PATH = "docs/evals/conversation-trajectory-review-latest.md";
export const TRAJECTORY_RUNNER_VERSION = "conversation-trajectory-runner-v1";

const ensureStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array.`);
  }
};

export const loadTrajectoryDataset = (path = TRAJECTORY_DATASET_PATH): TrajectoryDataset => {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TrajectoryDataset;
  if (parsed.schemaVersion !== 1 || !parsed.datasetVersion || !Array.isArray(parsed.trajectories)) {
    throw new Error("Invalid conversation trajectory dataset header.");
  }

  const ids = new Set<string>();
  for (const trajectory of parsed.trajectories) {
    if (!trajectory.id || ids.has(trajectory.id)) throw new Error(`Invalid or duplicate trajectory id: ${trajectory.id}`);
    ids.add(trajectory.id);
    if (!trajectory.category || !trajectory.purpose || !Array.isArray(trajectory.turns) || !trajectory.turns.length) {
      throw new Error(`Invalid trajectory: ${trajectory.id}`);
    }
    ensureStringArray(trajectory.trajectoryMachineChecks, `${trajectory.id}.trajectoryMachineChecks`);
    ensureStringArray(trajectory.trajectoryReviewerFields, `${trajectory.id}.trajectoryReviewerFields`);

    const turnIds = new Set<string>();
    for (const turn of trajectory.turns) {
      if (!turn.turnId || turnIds.has(turn.turnId) || !turn.user) {
        throw new Error(`Invalid turn in trajectory ${trajectory.id}: ${turn.turnId}`);
      }
      turnIds.add(turn.turnId);
      if (turn.fixtureStatus === "captured" && !turn.observedAssistant) {
        throw new Error(`${trajectory.id}/${turn.turnId} captured fixture requires observedAssistant.`);
      }
      if (!turn.expectedStructure) throw new Error(`${trajectory.id}/${turn.turnId} requires expectedStructure.`);
      ensureStringArray(turn.allowedFacts, `${trajectory.id}/${turn.turnId}.allowedFacts`);
      ensureStringArray(turn.forbiddenPatterns, `${trajectory.id}/${turn.turnId}.forbiddenPatterns`);
      ensureStringArray(turn.machineChecks, `${trajectory.id}/${turn.turnId}.machineChecks`);
      ensureStringArray(turn.reviewerFields, `${trajectory.id}/${turn.turnId}.reviewerFields`);
    }
  }

  return parsed;
};

const listFiles = (path: string): string[] => {
  const absolute = resolve(path);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute)
    .flatMap((name) => listFiles(resolve(absolute, name)))
    .sort();
};

const RELEVANT_SOURCE_PATHS = [
  "services/clinical",
  "services/ai/promptBuilder.ts",
  "services/ai/chatOrchestrationService.ts",
  "services/ai/aiService.ts",
  TRAJECTORY_DATASET_PATH,
  "scripts/conversation-trajectory-eval-lib.ts",
  "scripts/conversation-trajectory-eval-runner.ts",
];

export const computeRelevantSourceFingerprint = () => {
  const hash = createHash("sha256");
  for (const absolute of RELEVANT_SOURCE_PATHS.flatMap(listFiles).sort()) {
    hash.update(relative(process.cwd(), absolute));
    hash.update("\0");
    hash.update(readFileSync(absolute));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};

export const getCurrentCommit = () =>
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const getPlanFields = (result: ChatReplyResult | undefined) => {
  const plan = result?.clinicalTrace.selectedPlan;
  return {
    selectedResponseGoal: result?.clinicalTrace.skippedBySafety ? "safety" : plan?.responseGoal ?? "missing",
    selectedStrategy: result?.clinicalTrace.skippedBySafety ? "safety" : plan?.primaryStrategy ?? "missing",
    responseIntent: plan?.responseIntent ?? "none",
    questionFunction: plan?.questionFunction ?? "none",
  };
};

const normalizedOpeningSkeleton = (text: string) =>
  text
    .trim()
    .slice(0, 28)
    .replace(/[0-9０-９]+/g, "#")
    .replace(/今天有点不太高兴|累了|一个人在家里，现在好害怕|明天面试，我好紧张/g, "<slot>");

export const buildTurnResult = ({
  turn,
  assistant,
  result,
  mode,
  error,
}: {
  turn: TrajectoryTurn;
  assistant: string | null;
  result?: ChatReplyResult;
  mode: TrajectoryRunMode;
  error?: string;
}): TurnRunResult => {
  if (mode === "replay" && turn.fixtureStatus === "pending_reproduction") {
    return {
      turn,
      assistant: null,
      status: "pending_reproduction",
      source: "pending",
      model: "pending",
      promptVersion: "pending",
      ...getPlanFields(undefined),
      machineCheckErrors: [],
      heuristicFlags: [],
    };
  }

  const text = assistant ?? "";
  const plan = getPlanFields(result);
  const machineCheckErrors: string[] = [];
  const heuristicFlags: Array<{ rule: string; matchedText: string }> = [];

  if (error) machineCheckErrors.push(error);
  if (turn.machineChecks.includes("structure_matches") && result) {
    for (const [field, actual] of [
      ["responseGoal", plan.selectedResponseGoal],
      ["responseIntent", plan.responseIntent],
      ["questionFunction", plan.questionFunction],
    ] as const) {
      const expected = turn.expectedStructure[field];
      if (expected !== "pending" && expected !== actual) {
        machineCheckErrors.push(`${field} mismatch: expected=${expected}, actual=${actual}`);
      }
    }
  }
  if (turn.machineChecks.includes("forbidden_patterns_absent")) {
    for (const pattern of turn.forbiddenPatterns) {
      if (text.includes(pattern)) machineCheckErrors.push(`forbidden pattern detected: ${pattern}`);
    }
  }
  for (const pattern of ["听到你说", "让这句话在这里", "我接住了", "我接住的是", "是你刚刚说"]) {
    if (text.includes(pattern)) heuristicFlags.push({ rule: "known_literal_regression_locator", matchedText: pattern });
  }

  return {
    turn,
    assistant: text || null,
    status: error ? "error" : "completed",
    source: result?.generation.finalReplySource ?? (mode === "replay" ? "captured_replay" : result?.finalSource ?? "error"),
    model: result?.generation.model ?? (mode === "replay" ? "captured" : "error"),
    promptVersion: result?.generation.promptVersion ?? (mode === "replay" ? "captured" : "error"),
    ...plan,
    machineCheckErrors,
    heuristicFlags,
    error,
  };
};

export const buildTrajectoryChecks = (turns: TurnRunResult[]) => {
  const completed = turns.filter((turn) => turn.status === "completed" && turn.assistant);
  const trajectoryMachineCheckErrors: string[] = [];
  const trajectoryHeuristicFlags: Array<{ rule: string; matchedText: string }> = [];

  const openings = completed.map((turn) => normalizedOpeningSkeleton(turn.assistant ?? ""));
  const openingCounts = openings.reduce<Record<string, number>>((acc, opening) => {
    acc[opening] = (acc[opening] ?? 0) + 1;
    return acc;
  }, {});
  for (const [opening, count] of Object.entries(openingCounts)) {
    if (count >= 3) trajectoryHeuristicFlags.push({ rule: "repeated_opening_skeleton_locator", matchedText: `${opening} (${count})` });
  }

  for (const literal of ["听到你说", "我接住"]) {
    const count = completed.filter((turn) => turn.assistant?.includes(literal)).length;
    if (count >= 3) {
      trajectoryHeuristicFlags.push({ rule: "repeated_literal_skeleton_locator", matchedText: `${literal} (${count})` });
    }
  }

  return { trajectoryMachineCheckErrors, trajectoryHeuristicFlags };
};

const formatBlock = (value: string | null) => ["```text", (value ?? "(pending reproduction)").replace(/```/g, "`\u200b``"), "```"].join("\n");

export const renderTrajectoryReport = (metadata: TrajectoryReportMetadata, results: TrajectoryRunResult[]) => {
  const lines = [
    "# Conversation Trajectory Review Latest",
    "",
    `Generated at: ${metadata.generatedAt}`,
    "",
    "## Runtime Metadata",
    "",
    `- datasetVersion: ${metadata.datasetVersion}`,
    `- runnerVersion: ${metadata.runnerVersion}`,
    `- evaluatedCommit: ${metadata.evaluatedCommit}`,
    `- relevantSourceFingerprint: ${metadata.relevantSourceFingerprint}`,
    `- runMode: ${metadata.runMode}`,
    `- repeatCount: ${metadata.repeatCount}`,
    `- variant: ${metadata.variant}`,
    `- provider: ${metadata.provider}`,
    `- model: ${metadata.model}`,
    `- promptVersion: ${metadata.promptVersion}`,
    `- freshness: ${metadata.freshness}`,
    `- staleReason: ${metadata.staleReason || "none"}`,
    "",
    "Replay mode validates fixtures, report structure, and deterministic checks only. It is not evidence of current model quality.",
    "",
    "## Summary",
    "",
    `- trajectories: ${results.length}`,
    `- completed turns: ${results.flatMap((item) => item.turns).filter((turn) => turn.status === "completed").length}`,
    `- pending reproduction turns: ${results.flatMap((item) => item.turns).filter((turn) => turn.status === "pending_reproduction").length}`,
    `- deterministic errors: ${results.flatMap((item) => [...item.turns.flatMap((turn) => turn.machineCheckErrors), ...item.trajectoryMachineCheckErrors]).length}`,
    "",
  ];

  for (const result of results) {
    lines.push(
      `## ${result.trajectory.id} / run-${result.runIndex} (${result.trajectory.category})`,
      "",
      result.trajectory.purpose,
      ""
    );
    for (const turn of result.turns) {
      lines.push(
        `### ${turn.turn.turnId}`,
        "",
        "**User**",
        "",
        formatBlock(turn.turn.user),
        "",
        "**Assistant**",
        "",
        formatBlock(turn.assistant),
        "",
        `- fixtureStatus: ${turn.turn.fixtureStatus}`,
        `- runStatus: ${turn.status}`,
        `- source: ${turn.source}`,
        `- model: ${turn.model}`,
        `- promptVersion: ${turn.promptVersion}`,
        `- selectedResponseGoal: ${turn.selectedResponseGoal}`,
        `- selectedStrategy: ${turn.selectedStrategy}`,
        `- responseIntent: ${turn.responseIntent}`,
        `- questionFunction: ${turn.questionFunction}`,
        `- machineCheckErrors: ${turn.machineCheckErrors.length ? turn.machineCheckErrors.join(" / ") : "none"}`,
        `- heuristicFlags: ${turn.heuristicFlags.length ? JSON.stringify(turn.heuristicFlags) : "none"}`,
        "",
        "**Reviewer Fields**",
        "",
        ...turn.turn.reviewerFields.map((field) => `- ${field}: unreviewed`),
        ""
      );
    }
    lines.push(
      "**Trajectory Machine Checks**",
      "",
      `- errors: ${result.trajectoryMachineCheckErrors.length ? result.trajectoryMachineCheckErrors.join(" / ") : "none"}`,
      `- heuristicFlags: ${result.trajectoryHeuristicFlags.length ? JSON.stringify(result.trajectoryHeuristicFlags) : "none"}`,
      "",
      "**Trajectory Reviewer Fields**",
      "",
      ...result.trajectory.trajectoryReviewerFields.map((field) => `- ${field}: unreviewed`),
      ""
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
};
