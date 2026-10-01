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
if (!outputPath) throw new Error("--output is required.");
if (process.env.AI_PROVIDER !== "qwen") throw new Error("This demo must run against the real Qwen provider.");

// Fixed before the run: every result is kept, none is selected or rerun. This is a tone demo for
// human confirmation, not an acceptance gate, and it does not score replies.
const RUNS = 3;
const pausedHistory: ConversationMessage[] = [
  { id: "tone-demo-pause-user", role: "user", content: "先别问了" },
  { id: "tone-demo-pause-assistant", role: "assistant", content: "好，不问了。" },
];
const scenarios: Array<{
  id: string;
  userMessage: string;
  recentMessages: ConversationMessage[];
  expectedSupportFunction: string;
  expectedQuestionPolicy: string;
}> = [
  { id: "ordinary-low", userMessage: "我今天有点不太高兴", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "ordinary-stuck", userMessage: "心里有点堵", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "stated-event", userMessage: "今天被领导当众批评了，有点不太高兴", recentMessages: [], expectedSupportFunction: "invite_optional_sharing", expectedQuestionPolicy: "optional_after_answer" },
  { id: "declines-talking", userMessage: "我有点难受，但不想说", recentMessages: [], expectedSupportFunction: "return_amount_control", expectedQuestionPolicy: "none" },
  { id: "declines-questions", userMessage: "我不太高兴，不想被问", recentMessages: [], expectedSupportFunction: "return_amount_control", expectedQuestionPolicy: "none" },
  { id: "prior-pause", userMessage: "我今天有点不太高兴", recentMessages: pausedHistory, expectedSupportFunction: "return_amount_control", expectedQuestionPolicy: "none" },
];
const head = execSync("git rev-parse --short HEAD").toString().trim();

const run = async () => {
  const rows: Array<Record<string, unknown> & { scenarioId: string; reply: string }> = [];
  let stoppedOn: { scenarioId: string; runIndex: number; failure: unknown } | null = null;
  outer: for (const scenario of scenarios) {
    for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
      const reply = await createChatReply({
        conversationId: `tone-demo:${head}:${scenario.id}:r${runIndex}`,
        currentTurnId: `${scenario.id}:r${runIndex}:t${scenario.recentMessages.length + 1}`,
        userMessage: scenario.userMessage,
        recentMessages: scenario.recentMessages,
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
      });
      const plan = reply.controlTrace?.responsePlan;
      const contract = plan?.positiveFunctionContract;
      const validations = reply.controlTrace?.validation ?? [];
      const executionFailure = executionFailureRecordFor(reply.execution);
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
        regenerateAttempted: reply.regenerateAttempted,
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
        attempts: row.attempts.map((a) => ({ failures: a.validationFailures, ruleIds: a.semanticAudit?.ruleIds ?? null })),
      }));
      if (executionFailure?.code === "PROVIDER_ERROR" || executionFailure?.code === "TIMEOUT") {
        stoppedOn = { scenarioId: scenario.id, runIndex, failure: executionFailure };
        break outer;
      }
    }
  }
  const summary = {
    head,
    model: process.env.AI_MAIN_MODEL?.trim() || null,
    judgeModel: process.env.AI_SEMANTIC_VALIDATOR_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || null,
    runsPerScenario: RUNS,
    plannedTotal: scenarios.length * RUNS,
    completed: rows.length,
    stoppedOn,
    planMismatches: rows.filter((r) =>
      r.actualSupportFunction !== r.expectedSupportFunction || r.questionPolicy !== r.expectedQuestionPolicy).length,
    committed: rows.filter((r) => r.finalSource !== "constraint_failure" && !r.executionFailure).length,
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
  process.exitCode = stoppedOn ? 2 : 0;
};

void run();
