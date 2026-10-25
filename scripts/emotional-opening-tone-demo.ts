import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import type { ConversationMessage } from "../conversation-os/types";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import { executionFailureRecordFor } from "./execution-failure-audit";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

const outputPath = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "";
const structuralPath = process.argv.find((a) => a.startsWith("--structural-output="))?.slice(20) ?? "";
// Continues a stopped run without repeating any planned turn that was already attempted.
const skipTurns = Number(process.argv.find((a) => a.startsWith("--skip-turns="))?.slice(13) ?? "0");
if (!outputPath) throw new Error("--output is required.");
if (!Number.isInteger(skipTurns) || skipTurns < 0) throw new Error("--skip-turns must be a non-negative integer.");
if (process.env.AI_PROVIDER !== "qwen") throw new Error("This demo must run against the real Qwen provider.");

// Fixed before the run: every result is kept, none is selected or rerun. This is a tone demo for
// human confirmation, not an acceptance gate, and it does not score replies.
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? "3");
if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 3) throw new Error("--runs must be 1, 2 or 3.");
const verifyLocalCommit = process.argv.includes("--verify-local-commit");
if (verifyLocalCommit) {
  // A dedicated, explicitly supplied local test database is mandatory; never use the .env database.
  const expectedUrl = process.env.TONE_DEMO_LOCAL_DATABASE_URL;
  if (!expectedUrl || process.env.DATABASE_URL !== expectedUrl) {
    throw new Error("Local commit verification requires matching TONE_DEMO_LOCAL_DATABASE_URL and DATABASE_URL.");
  }
  const url = new URL(expectedUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/xq_rc_(?:ci_test_|lifecycle_|chain_test_)[a-z0-9_]+$/u.test(url.pathname)) {
    throw new Error("Local commit verification requires an isolated loopback test database.");
  }
}
const pausedHistory: ConversationMessage[] = [
  { id: "tone-demo-pause-user", role: "user", content: "先别问了" },
  { id: "tone-demo-pause-assistant", role: "assistant", content: "好，不问了。" },
];
const scenarios: Array<{
  id: string;
  userMessage: string;
  recentMessages: ConversationMessage[];
  expectedSupportFunction: string | null;
  expectedQuestionPolicy: string;
}> = [
  { id: "ordinary-low", userMessage: "我今天有点不太高兴", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "ordinary-stuck", userMessage: "心里有点堵", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "stated-event", userMessage: "今天被领导当众批评了，有点不太高兴", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "declines-talking", userMessage: "我有点难受，但不想说", recentMessages: [], expectedSupportFunction: "respect_declined_sharing", expectedQuestionPolicy: "none" },
  { id: "declines-questions", userMessage: "我不太高兴，不想被问", recentMessages: [], expectedSupportFunction: "respect_declined_sharing", expectedQuestionPolicy: "none" },
  { id: "prior-pause", userMessage: "我今天有点不太高兴", recentMessages: pausedHistory, expectedSupportFunction: "respect_declined_sharing", expectedQuestionPolicy: "none" },
  { id: "reopened-after-pause", userMessage: "你问吧，我今天有点不太高兴", recentMessages: pausedHistory, expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "willing-after-pause", userMessage: "其实我想说说，我今天有点不太高兴", recentMessages: pausedHistory, expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "willing-no-topic-after-pause", userMessage: "我想聊聊了，但不知道说什么", recentMessages: pausedHistory, expectedSupportFunction: null, expectedQuestionPolicy: "one_low_pressure_question" },
  { id: "willing-no-questions-after-pause", userMessage: "我想说说，但别问我，有点难受", recentMessages: pausedHistory, expectedSupportFunction: "respect_declined_sharing", expectedQuestionPolicy: "none" },
  { id: "declines-without-affect", userMessage: "我不想说", recentMessages: [], expectedSupportFunction: null, expectedQuestionPolicy: "none" },
];
const scenarioFilter = process.argv.find((a) => a.startsWith("--scenarios="))?.slice(12).split(",").filter(Boolean) ?? [];
for (const id of scenarioFilter) {
  if (!scenarios.some((scenario) => scenario.id === id)) throw new Error(`Unknown scenario ${id}.`);
}
const selectedScenarios = scenarioFilter.length
  ? scenarios.filter((scenario) => scenarioFilter.includes(scenario.id))
  : scenarios;
if (verifyLocalCommit && (selectedScenarios.length !== 1 || selectedScenarios[0].id !== "stated-event")) {
  throw new Error("Local commit verification is limited to the existing stated-event scenario with empty history.");
}
const head = execSync("git rev-parse --short HEAD").toString().trim();
// Safety fails closed as SAFETY_BLOCKED when its provider call fails; these fixed reasons still identify a
// provider failure, unlike safety_semantic_invalid_output, which means the provider did answer.
const SAFETY_PROVIDER_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "safety_semantic_provider_error",
  "safety_semantic_provider_4xx",
  "safety_semantic_provider_5xx",
  "safety_semantic_rate_limited",
  "safety_semantic_timeout",
  "safety_semantic_provider_unconfigured",
]);

// Exercise the production commit function with this exact measured reply. This checks persistence,
// not the HTTP route or createReviewedChatReply wrapper; the synthetic user is always removed.
const runTurn = async (scenario: typeof scenarios[number], runIndex: number) => {
  const input = {
    conversationId: `tone-demo:${head}:${scenario.id}:r${runIndex}`,
    currentTurnId: `${scenario.id}:r${runIndex}:t${scenario.recentMessages.length + 1}`,
    userMessage: scenario.userMessage,
    recentMessages: scenario.recentMessages,
    includeDebugTrace: true,
    helpingShadowEnabled: false,
    helpingOrdinaryHandoffEnabled: true,
  };
  if (!verifyLocalCommit) return { reply: await createChatReply(input), localCommit: null };
  const { prisma } = await import("../lib/prisma");
  const { AiGenerationStatus, AiSourceType, MessageRole, MessageStatus } = await import("@prisma/client");
  const { buildCommittedAssistantMove, commitValidatedAssistantMessage } = await import("../services/ai/chatReplyService");
  const fixtureUser = await prisma.user.create({ data: {} });
  const localCommit = {
    status: "not_attempted" as "not_attempted" | "committed" | "rejected_not_committed" | "failed",
    assistantCount: 0,
    committedTextMatches: false,
    committedPhase: null as string | null,
    committedMessageMatches: false,
    loserCommitted: false,
    fixtureCleaned: false,
  };
  try {
    const session = await prisma.chatSession.create({ data: { userId: fixtureUser.id } });
    const turn = await prisma.chatMessage.create({ data: {
      userId: fixtureUser.id, sessionId: session.id, role: MessageRole.USER,
      content: scenario.userMessage, status: MessageStatus.SAVED,
    } });
    const reply = await createChatReply({ ...input, conversationId: session.id, currentTurnId: turn.id });
    const generations: Array<{ id: string }> = [];
    for (const [index, generation] of reply.generationAttempts.entries()) {
      const accepted = reply.execution.phase === "VALIDATED" && index === reply.generationAttempts.length - 1;
      generations.push(await prisma.aiGeneration.create({ data: {
        userId: fixtureUser.id, sessionId: session.id, sourceType: AiSourceType.CHAT, sourceId: turn.id,
        model: generation.model, promptVersion: generation.promptVersion, inputText: scenario.userMessage,
        outputText: generation.text, rewriteOfId: generations.at(-1)?.id,
        requestId: reply.execution.requestId, turnId: turn.id, attemptId: reply.execution.attempts[index]?.attemptId,
        executionTrace: JSON.parse(JSON.stringify(reply.execution)),
        status: accepted ? AiGenerationStatus.GENERATED : AiGenerationStatus.FAILED,
      }, select: { id: true } }));
    }
    if (reply.execution.phase === "VALIDATED") {
      const generation = generations.at(-1);
      if (!generation || !reply.generation.text.trim()) throw new Error("Validated reply has no nonempty saved generation.");
      const saved = await commitValidatedAssistantMessage({
        userId: fixtureUser.id, sessionId: session.id, content: reply.generation.text,
        status: MessageStatus.SAVED, aiGenerationId: generation.id, replyToMessageId: turn.id,
        interactionMetadata: buildCommittedAssistantMove(reply), execution: reply.execution,
        responsePlan: reply.controlTrace?.responsePlan ?? null,
        envelopeOrigin: reply.finalSource === "safety" ? "safety_override" : "response_plan",
      });
      const stored = await prisma.chatMessage.findUniqueOrThrow({ where: { id: saved.id },
        select: { content: true, aiGeneration: { select: { executionTrace: true } } } });
      const trace = stored.aiGeneration?.executionTrace as { phase?: string; committedMessageId?: string } | null;
      localCommit.committedTextMatches = stored.content === reply.generation.text;
      localCommit.committedPhase = trace?.phase ?? null;
      localCommit.committedMessageMatches = trace?.committedMessageId === saved.id;
    }
    const messages = await prisma.chatMessage.findMany({ where: { sessionId: session.id, role: MessageRole.ASSISTANT },
      select: { aiGenerationId: true } });
    localCommit.assistantCount = messages.length;
    const loserIds = new Set(generations.slice(0, reply.execution.phase === "VALIDATED" ? -1 : undefined).map((g) => g.id));
    localCommit.loserCommitted = messages.some((m) => m.aiGenerationId !== null && loserIds.has(m.aiGenerationId));
    localCommit.status = reply.execution.phase === "VALIDATED"
      ? localCommit.assistantCount === 1 && localCommit.committedTextMatches && localCommit.committedPhase === "COMMITTED" &&
        localCommit.committedMessageMatches && !localCommit.loserCommitted ? "committed" : "failed"
      : localCommit.assistantCount === 0 ? "rejected_not_committed" : "failed";
    return { reply, localCommit };
  } finally {
    await prisma.user.delete({ where: { id: fixtureUser.id } });
    localCommit.fixtureCleaned = await prisma.user.count({ where: { id: fixtureUser.id } }) === 0;
  }
};

const run = async () => {
  const rows: Array<Record<string, unknown> & { scenarioId: string; reply: string }> = [];
  let stoppedOn: { scenarioId: string; runIndex: number; failure: unknown } | null = null;
  let plannedIndex = 0;
  outer: for (const scenario of selectedScenarios) {
    for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
      plannedIndex += 1;
      if (plannedIndex <= skipTurns) continue;
      const { reply, localCommit } = await runTurn(scenario, runIndex);
      const plan = reply.controlTrace?.responsePlan;
      const contract = plan?.positiveFunctionContract;
      const validations = reply.controlTrace?.validation ?? [];
      const executionFailure = executionFailureRecordFor(reply.execution);
      const safetyProviderFailureReason =
        reply.execution.failure?.code === "SAFETY_BLOCKED" &&
        SAFETY_PROVIDER_FAILURE_REASONS.has(reply.execution.failure.reason)
          ? reply.execution.failure.reason
          : null;
      const row = {
        scenarioId: scenario.id,
        runIndex,
        actualActions: plan?.responseActions ?? [],
        actualSupportFunction: contract?.action === "offer_emotional_support" ? contract.supportFunction : null,
        expectedSupportFunction: scenario.expectedSupportFunction,
        questionPolicy: plan?.questionPolicy.mode ?? null,
        expectedQuestionPolicy: scenario.expectedQuestionPolicy,
        finalSource: reply.finalSource,
        executionFailure,
        safetyProviderFailureReason,
        regenerateAttempted: reply.regenerateAttempted,
        ...(localCommit ? { localCommit } : {}),
        promptVersion: reply.generation.promptVersion ?? null,
        attempts: reply.generationAttempts.map((attempt, index) => ({
          attempt: index + 1,
          text: attempt.text,
          validationFailures: validations[index]?.failureReasons ?? ["missing_attempt_validation"],
          semanticAudit: semanticVerdictAuditFor(reply.plannedFunctionSemanticVerdicts?.[index]),
          semanticProviderFailure: reply.plannedFunctionSemanticDiagnostics?.[index]?.providerFailure ?? null,
        })),
        reply: reply.generation.text,
      };
      rows.push(row);
      console.log(JSON.stringify({
        scenarioId: scenario.id,
        runIndex,
        supportFunction: row.actualSupportFunction,
        questionPolicy: row.questionPolicy,
        finalSource: row.finalSource,
        executionFailure,
        safetyProviderFailureReason,
        attempts: row.attempts.map((a) => ({ failures: a.validationFailures, ruleIds: a.semanticAudit?.ruleIds ?? null })),
      }));
      if (
        executionFailure?.code === "PROVIDER_ERROR" ||
        executionFailure?.code === "TIMEOUT" ||
        safetyProviderFailureReason !== null
      ) {
        stoppedOn = { scenarioId: scenario.id, runIndex, failure: { ...executionFailure, safetyProviderFailureReason } };
        break outer;
      }
    }
  }
  const summary = {
    head,
    model: process.env.AI_MAIN_MODEL?.trim() || null,
    judgeModel: process.env.AI_SEMANTIC_VALIDATOR_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || null,
    runsPerScenario: RUNS,
    scenarios: selectedScenarios.map((scenario) => scenario.id),
    plannedTotal: selectedScenarios.length * RUNS,
    skippedTurns: skipTurns,
    completed: rows.length,
    stoppedOn,
    planMismatches: rows.filter((r) =>
      r.actualSupportFunction !== r.expectedSupportFunction || r.questionPolicy !== r.expectedQuestionPolicy).length,
    committed: rows.filter((r) => r.finalSource !== "constraint_failure" && !r.executionFailure).length,
    ...(verifyLocalCommit ? {
      commitVerificationScope: "production_commit_function_with_synthetic_local_database",
      persisted: rows.filter((r) => (r.localCommit as { status: string }).status === "committed").length,
      persistenceFailures: rows.filter((r) => (r.localCommit as { status: string }).status === "failed").length,
    } : {}),
    constraintFailures: rows.filter((r) => r.finalSource === "constraint_failure").length,
    regenerations: rows.filter((r) => r.regenerateAttempted).length,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  if (structuralPath) {
    const structuralRows = rows.map(({ reply: _reply, attempts, ...row }) => ({
      ...row,
      attempts: (attempts as Array<{
        attempt: number;
        validationFailures: string[];
        semanticAudit: ReturnType<typeof semanticVerdictAuditFor>;
        semanticProviderFailure: unknown;
      }>).map(({ attempt, validationFailures, semanticAudit, semanticProviderFailure }) => ({
        attempt,
        validationFailures,
        semanticAudit: withoutEvidenceText(semanticAudit),
        semanticProviderFailure,
      })),
    }));
    mkdirSync(dirname(structuralPath), { recursive: true });
    writeFileSync(structuralPath, `${JSON.stringify({
      note: "Structural copy; user messages, reply texts and evidence text kept locally.",
      summary,
      rows: structuralRows,
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = stoppedOn ? 2 : verifyLocalCommit && rows.some((r) => (r.localCommit as { status: string }).status !== "committed") ? 1 : 0;
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Tone demo failed.");
  process.exitCode = 2;
}).finally(async () => {
  if (verifyLocalCommit) await (await import("../lib/prisma")).prisma.$disconnect();
});
