import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { buildCommittedResponseMove } from "../conversation-os/interactionMoveEnvelope";
import type { ResponsePlan } from "../conversation-os/control/types";
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
  expectedPlan?: {
    responseAction: string;
    questionPolicy: string;
    replyQuestionCount: number;
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
  forensics?: TurnForensics;
  error?: string;
};

export type SafetyForensics = {
  outcome: "passed_to_planner" | "routed_safety_response" | "blocked_fail_closed" | "unknown";
  failureType: string;
  failureCategory: string;
  routedDecision: string;
  attemptTrace: "not_exposed_by_chat_reply_result";
};

export type PlanForensics = {
  evaluatorSource: "clinicalTrace.selectedPlan";
  evaluatorSelectedPlanPresent: boolean;
  clinicalInvokedByPlanner: boolean | "unknown";
  plannerSource: "controlTrace.responsePlan" | "absent";
  plannerPlanId: string;
  behaviorSource: string;
  planningDepth: string;
  responseActions: string[];
  questionPolicy: string;
  closurePolicy: string;
  clinicalStrategy: string;
  positiveFunctionAction: string;
  interactionMoveHandoff: boolean;
};

export type TurnForensics = {
  runtimeTurnId: string;
  executionPhase: string;
  executionFailureCode: string;
  executionFailureReasonCodes: string[];
  safety: SafetyForensics;
  plan: PlanForensics;
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
  promptAdapter: string;
  historyAdapter: string;
  provider: string;
  model: string;
  promptVersion: string;
  freshness: "current" | "stale";
  staleReason: string;
  productUnderTest?: string;
  productSourceFingerprint?: string;
  evalToolFingerprint?: string;
  featureFlags?: string;
};

export const TRAJECTORY_DATASET_PATH = "clinical-evals/conversation-trajectories-v1.json";
export const TRAJECTORY_REPORT_PATH = "docs/evals/conversation-trajectory-review-latest.md";
export const TRAJECTORY_RUNNER_VERSION = "conversation-trajectory-runner-v1-forensics-2";

export const describeFeatureFlags = (env: NodeJS.ProcessEnv = process.env) =>
  ["HILL_HELPING_ORDINARY_HANDOFF", "HILL_HELPING_SHADOW"]
    .map((name) => `${name}=${env[name]?.trim() || "unset"}`)
    .join(" ");

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
      if (turn.machineChecks.includes("ordinary_plan_matches")) {
        const expected = turn.expectedPlan;
        if (
          !expected ||
          typeof expected.responseAction !== "string" ||
          typeof expected.questionPolicy !== "string" ||
          !Number.isInteger(expected.replyQuestionCount)
        ) {
          throw new Error(`${trajectory.id}/${turn.turnId} ordinary_plan_matches requires expectedPlan.`);
        }
      }
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
  "scripts/conversation-trajectory-experiment-adapters.ts",
];

const PRODUCT_SOURCE_PATHS = ["services", "conversation-os", "lib", "prisma/schema.prisma"];

const EVAL_TOOL_PATHS = [
  TRAJECTORY_DATASET_PATH,
  "scripts/conversation-trajectory-eval-lib.ts",
  "scripts/conversation-trajectory-eval-runner.ts",
  "scripts/conversation-trajectory-experiment-adapters.ts",
];

const fingerprintPaths = (paths: string[]) => {
  const hash = createHash("sha256");
  for (const absolute of paths.flatMap(listFiles).sort()) {
    hash.update(relative(process.cwd(), absolute));
    hash.update("\0");
    hash.update(readFileSync(absolute));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
};

export const computeRelevantSourceFingerprint = () => fingerprintPaths(RELEVANT_SOURCE_PATHS);
export const computeProductSourceFingerprint = () => fingerprintPaths(PRODUCT_SOURCE_PATHS);
export const computeEvalToolFingerprint = () => fingerprintPaths(EVAL_TOOL_PATHS);

const SAFETY_FAILURE_TYPES = new Set(["provider_error", "provider_unconfigured", "invalid_output"]);
const SAFETY_FAILURE_CATEGORIES = new Set([
  "invalid_output",
  "provider_error",
  "provider_4xx",
  "timeout",
  "rate_limited",
  "provider_5xx",
  "provider_unconfigured",
]);
const REASON_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,80}$/;

const parseSafetyFailureCategory = (reason: string | undefined) => {
  const category = reason?.match(/^safety_semantic_([a-z0-9_]+)$/)?.[1];
  return category && SAFETY_FAILURE_CATEGORIES.has(category) ? category : "unknown";
};

const parseSafetyFailureType = (transitions: Array<{ reason: string }>) => {
  for (const transition of transitions) {
    const failureType = transition.reason.match(/^Safety semantic triage failed closed \(([a-z_]+)\)\.$/)?.[1];
    if (failureType) return SAFETY_FAILURE_TYPES.has(failureType) ? failureType : "unknown";
  }
  return "unknown";
};

const parseRoutedSafetyDecision = (transitions: Array<{ reason: string }>) => {
  for (const transition of transitions) {
    const match = transition.reason.match(
      /^Safety pre-gate selected the safety-owned response path \(channel=([a-z_]+), risk=([a-z]+), categories=([a-z_|]*), currentness=([a-z]+)\)\.$/
    );
    if (match) return `channel=${match[1]} risk=${match[2]} categories=${match[3] || "none"} currentness=${match[4]}`;
  }
  return "unknown";
};

const sanitizeReasonCodes = (reason: string | undefined) =>
  (reason ?? "")
    .split(/,\s*/)
    .filter(Boolean)
    .map((item) => (REASON_CODE_PATTERN.test(item) ? item : "unrecognized"));

const safeToken = (value: unknown) =>
  typeof value === "string" && REASON_CODE_PATTERN.test(value) ? value : value == null ? "none" : "unrecognized";

export const extractTurnForensics = (result: ChatReplyResult | undefined): TurnForensics => {
  const execution = result?.execution;
  const failure = execution?.failure;
  const transitions = execution?.transitions ?? [];
  const blocked = failure?.code === "SAFETY_BLOCKED" ||
    transitions.some((transition) => transition.reason.startsWith("Safety semantic triage failed closed"));
  const routed = !blocked && result?.finalSource === "safety";
  const safety: SafetyForensics = {
    outcome: !result
      ? "unknown"
      : blocked
        ? "blocked_fail_closed"
        : routed
          ? "routed_safety_response"
          : "passed_to_planner",
    failureType: !result ? "unknown" : blocked ? parseSafetyFailureType(transitions) : "none",
    failureCategory: !result ? "unknown" : blocked ? parseSafetyFailureCategory(failure?.reason) : "none",
    routedDecision: routed ? parseRoutedSafetyDecision(transitions) : "none",
    attemptTrace: "not_exposed_by_chat_reply_result",
  };

  const plan = result?.controlTrace?.responsePlan;
  const clinical = plan?.clinicalStrategy;
  return {
    runtimeTurnId: safeToken(execution?.turnId),
    executionPhase: safeToken(execution?.phase?.toLowerCase()),
    executionFailureCode: failure?.code ?? (result && !blocked ? "none" : "unknown"),
    executionFailureReasonCodes: blocked ? [] : sanitizeReasonCodes(failure?.reason),
    safety,
    plan: {
      evaluatorSource: "clinicalTrace.selectedPlan",
      evaluatorSelectedPlanPresent: Boolean(result?.clinicalTrace?.selectedPlan),
      clinicalInvokedByPlanner: result?.controlTrace ? result.controlTrace.clinicalInvoked : "unknown",
      plannerSource: plan ? "controlTrace.responsePlan" : "absent",
      plannerPlanId: plan ? safeToken(plan.planId) : "none",
      behaviorSource: plan ? safeToken(plan.behaviorSource) : "none",
      planningDepth: plan ? safeToken(plan.planningDepth) : "none",
      responseActions: plan ? plan.responseActions.map(safeToken) : [],
      questionPolicy: plan ? safeToken(plan.questionPolicy.mode) : "none",
      closurePolicy: plan ? safeToken(plan.closurePolicy.mode) : "none",
      clinicalStrategy: clinical
        ? `strategy=${safeToken(clinical.strategy)} intent=${safeToken(clinical.intent)} questionFunction=${safeToken(clinical.questionFunction)}`
        : "none",
      positiveFunctionAction: plan?.positiveFunctionContract ? safeToken(plan.positiveFunctionContract.action) : "none",
      interactionMoveHandoff: Boolean(plan?.interactionMoveHandoffPlan),
    },
  };
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

const normalizedOpeningSkeleton = (text: string) => {
  const opening = text
    .trim()
    .slice(0, 28)
    .split(/[。！？!?，,]/u)[0]
    .replace(/[0-9０-９]+/g, "#")
    .replace(/[「『“‘][^」』”’]{1,16}[」』”’]/g, "<slot>")
    .replace(/今天有点不太高兴|累了|一个人在家里，现在好害怕|明天面试，我好紧张/g, "<slot>")
    .replace(/\s+/g, "");

  return opening
    .replace(/^(?:我)?(?:看到了|收到了|注意到|留意到|看见|看到|收到)(?:你发了|你发的|这个|了)?/u, "<observe>")
    .replace(/^<observe>#了?/u, "<observe><token>")
    .replace(/^(?:嗯|好|好的|行)[，,。]?/u, "<ack>")
    .replace(/^(?:先|暂时).{0,12}(?:留|放|停|待)(?:在|到)?(?:这里|这儿)?[。.]?/u, "<park>");
};

export const locateRepeatedOpeningSkeletons = (turns: TurnRunResult[], threshold = 3) => {
  const completed = turns.filter((turn) => turn.status === "completed" && turn.assistant);
  const counts = completed.reduce<Record<string, number>>((acc, turn) => {
    const opening = normalizedOpeningSkeleton(turn.assistant ?? "");
    acc[opening] = (acc[opening] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .map(([opening, count]) => ({ rule: "repeated_opening_skeleton_locator", matchedText: `${opening} (${count})` }));
};

const countQuestions = (text: string) => (text.match(/[？?]/gu) ?? []).length;

// Ordinary-conversation plans are read from controlTrace.responsePlan. A plan that merely permits a
// question does not prove calibration: the turn must also commit and realize the expected question count.
export const checkOrdinaryPlan = (
  expected: NonNullable<TrajectoryTurn["expectedPlan"]>,
  result: ChatReplyResult,
  replyText: string
): string[] => {
  const plan = result.controlTrace?.responsePlan;
  if (!plan) {
    return [`ordinaryPlan missing: source=${result.finalSource}, executionFailure=${result.execution?.failure?.code ?? "none"}`];
  }
  const errors: string[] = [];
  if (!plan.responseActions.includes(expected.responseAction as ResponsePlan["responseActions"][number])) {
    errors.push(`ordinaryPlan responseAction mismatch: expected=${expected.responseAction}, actual=${plan.responseActions.join("|") || "none"}`);
  }
  if (plan.questionPolicy.mode !== expected.questionPolicy) {
    errors.push(`ordinaryPlan questionPolicy mismatch: expected=${expected.questionPolicy}, actual=${plan.questionPolicy.mode}`);
  }
  if (result.execution?.phase !== "VALIDATED") {
    errors.push(`ordinaryPlan not committed: phase=${result.execution?.phase ?? "unknown"}, failure=${result.execution?.failure?.code ?? "none"}`);
  }
  const questions = countQuestions(replyText);
  if (questions !== expected.replyQuestionCount) {
    errors.push(`ordinaryPlan reply question count mismatch: expected=${expected.replyQuestionCount}, actual=${questions}`);
  }
  return errors;
};

// Mirrors the chat routes: only a validated reply is committed into history, carrying the same
// committed Assistant move the authenticated route persists.
export const buildCommittedHistoryEntry = (
  result: ChatReplyResult,
  assistantId: string
): AiConversationMessage | null => {
  if (result.execution.phase !== "VALIDATED") return null;
  return {
    id: assistantId,
    role: "assistant",
    content: result.generation.text,
    promptVersion: result.generation.promptVersion,
    status: "saved",
    committedAssistantMove: buildCommittedResponseMove({
      plan: result.controlTrace?.responsePlan,
      replyText: result.generation.text,
      sourceUserTurnId: result.execution.turnId,
      planId: result.execution.planId,
      requestId: result.execution.requestId,
    }),
  };
};

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
  if (turn.machineChecks.includes("ordinary_plan_matches") && result && turn.expectedPlan) {
    machineCheckErrors.push(...checkOrdinaryPlan(turn.expectedPlan, result, text));
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
    ...(mode === "real" ? { forensics: extractTurnForensics(result) } : {}),
    error,
  };
};

export type TurnForensicsRecord = {
  caseId: string;
  runIndex: number;
  turnId: string;
  runStatus: TurnRunResult["status"];
  source: string;
  selectedResponseGoal: string;
  structureChecked: boolean;
  forensics: TurnForensics;
};

export const collectForensicsRecords = (results: TrajectoryRunResult[]): TurnForensicsRecord[] =>
  results.flatMap((result) =>
    result.turns
      .filter((turn) => turn.forensics)
      .map((turn) => ({
        caseId: result.trajectory.id,
        runIndex: result.runIndex,
        turnId: turn.turn.turnId,
        runStatus: turn.status,
        source: turn.source,
        selectedResponseGoal: turn.selectedResponseGoal,
        structureChecked: turn.turn.machineChecks.includes("structure_matches"),
        forensics: turn.forensics!,
      }))
  );

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

export const summarizeForensics = (records: TurnForensicsRecord[]) => {
  const blocked = records.filter((record) => record.forensics.safety.outcome === "blocked_fail_closed");
  const evaluatorPlanAbsent = records.filter(
    (record) => record.structureChecked && !record.forensics.plan.evaluatorSelectedPlanPresent
  );
  return {
    safetyOutcomes: countBy(records.map((record) => record.forensics.safety.outcome)),
    safetyBlockedByCategory: countBy(blocked.map((record) => record.forensics.safety.failureCategory)),
    safetyBlockedByType: countBy(blocked.map((record) => record.forensics.safety.failureType)),
    safetyBlocked: blocked.map((record) => ({
      caseId: record.caseId,
      runIndex: record.runIndex,
      turnId: record.turnId,
      failureType: record.forensics.safety.failureType,
      failureCategory: record.forensics.safety.failureCategory,
    })),
    executionFailureCodes: countBy(records.map((record) => record.forensics.executionFailureCode)),
    structureCheckedTurnsWithoutEvaluatorPlan: evaluatorPlanAbsent.map((record) => ({
      caseId: record.caseId,
      runIndex: record.runIndex,
      turnId: record.turnId,
      safetyOutcome: record.forensics.safety.outcome,
      plannerSource: record.forensics.plan.plannerSource,
      clinicalInvokedByPlanner: record.forensics.plan.clinicalInvokedByPlanner,
      responseActions: record.forensics.plan.responseActions,
      questionPolicy: record.forensics.plan.questionPolicy,
    })),
  };
};

const formatForensicsLines = (forensics: TurnForensics) => [
  `- runtimeTurnId: ${forensics.runtimeTurnId}`,
  `- executionPhase: ${forensics.executionPhase}`,
  `- executionFailure: ${forensics.executionFailureCode}${forensics.executionFailureReasonCodes.length ? ` (${forensics.executionFailureReasonCodes.join(", ")})` : ""}`,
  `- safetyOutcome: ${forensics.safety.outcome}`,
  `- safetyFailureType: ${forensics.safety.failureType}`,
  `- safetyFailureCategory: ${forensics.safety.failureCategory}`,
  `- safetyRoutedDecision: ${forensics.safety.routedDecision}`,
  `- safetyAttemptTrace: ${forensics.safety.attemptTrace}`,
  `- evaluatorPlanSource: ${forensics.plan.evaluatorSource} (${forensics.plan.evaluatorSelectedPlanPresent ? "present" : "absent"})`,
  `- plannerPlanSource: ${forensics.plan.plannerSource}`,
  `- plannerClinicalInvoked: ${forensics.plan.clinicalInvokedByPlanner}`,
  `- plannerPlan: planId=${forensics.plan.plannerPlanId} behaviorSource=${forensics.plan.behaviorSource} planningDepth=${forensics.plan.planningDepth} responseActions=${forensics.plan.responseActions.join("|") || "none"} questionPolicy=${forensics.plan.questionPolicy} closurePolicy=${forensics.plan.closurePolicy} positiveFunction=${forensics.plan.positiveFunctionAction} interactionMoveHandoff=${forensics.plan.interactionMoveHandoff}`,
  `- plannerClinicalStrategy: ${forensics.plan.clinicalStrategy}`,
];

export const buildTrajectoryChecks = (turns: TurnRunResult[]) => {
  const completed = turns.filter((turn) => turn.status === "completed" && turn.assistant);
  const trajectoryMachineCheckErrors: string[] = [];
  const trajectoryHeuristicFlags: Array<{ rule: string; matchedText: string }> = [];

  trajectoryHeuristicFlags.push(...locateRepeatedOpeningSkeletons(turns));

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
    `- promptAdapter: ${metadata.promptAdapter}`,
    `- historyAdapter: ${metadata.historyAdapter}`,
    `- provider: ${metadata.provider}`,
    `- model: ${metadata.model}`,
    `- promptVersion: ${metadata.promptVersion}`,
    `- freshness: ${metadata.freshness}`,
    `- staleReason: ${metadata.staleReason || "none"}`,
    ...(metadata.productUnderTest ? [`- productUnderTest: ${metadata.productUnderTest}`] : []),
    ...(metadata.productSourceFingerprint ? [`- productSourceFingerprint: ${metadata.productSourceFingerprint}`] : []),
    ...(metadata.evalToolFingerprint ? [`- evalToolFingerprint: ${metadata.evalToolFingerprint}`] : []),
    ...(metadata.featureFlags ? [`- featureFlags: ${metadata.featureFlags}`] : []),
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

  const forensicsRecords = collectForensicsRecords(results);
  if (forensicsRecords.length) {
    const summary = summarizeForensics(forensicsRecords);
    lines.push(
      "## Forensics Summary",
      "",
      "Safety failure fields come only from execution.failure and execution.transitions; unexposed values are recorded as unknown. Plan fields list the evaluator source (clinicalTrace.selectedPlan) beside the runtime plan (controlTrace.responsePlan) without mapping one onto the other.",
      "",
      `- safetyOutcomes: ${JSON.stringify(summary.safetyOutcomes)}`,
      `- safetyBlockedByCategory: ${JSON.stringify(summary.safetyBlockedByCategory)}`,
      `- safetyBlockedByType: ${JSON.stringify(summary.safetyBlockedByType)}`,
      `- executionFailureCodes: ${JSON.stringify(summary.executionFailureCodes)}`,
      ...summary.safetyBlocked.map(
        (item) => `- safetyBlocked: ${item.caseId} / run-${item.runIndex} / ${item.turnId}: type=${item.failureType} category=${item.failureCategory}`
      ),
      ...summary.structureCheckedTurnsWithoutEvaluatorPlan.map(
        (item) => `- evaluatorPlanAbsent: ${item.caseId} / run-${item.runIndex} / ${item.turnId}: safety=${item.safetyOutcome} planner=${item.plannerSource} clinicalInvoked=${item.clinicalInvokedByPlanner} responseActions=${item.responseActions.join("|") || "none"} questionPolicy=${item.questionPolicy}`
      ),
      ""
    );
  }

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
        ...(turn.forensics ? formatForensicsLines(turn.forensics) : []),
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
