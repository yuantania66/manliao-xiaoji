import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { executionFailureRecordFor } from "./execution-failure-audit";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

const outputPath = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "";
const structuralPath = process.argv.find((a) => a.startsWith("--structural-output="))?.slice(20) ?? "";
if (!outputPath) throw new Error("--output is required.");
const RUNS = 5;
// Reviewer cross-check only, frozen before the run; it never replaces the semantic verdict.
const screens = {
  return_focus_control: {
    forbidden: /别的|其他|发生了什么|经过|原因|起因|细节/u,
    ambiguous: /情形|场景|瞬间|那一刻|当时/u,
  },
  acknowledge_current_relational_impact: {
    forbidden: /(?:你想|你愿意|想不想|要不要|可以|愿意).{0,12}(?:说|讲|聊|告诉|指出)|先说哪|说多少|说到什么程度|举个例子|哪里没懂[吗？?]|我(?:刚才|之前|上一句).{0,12}(?:说成|说了|以为|当成)/u,
    ambiguous: /刚才|这轮|上一轮/u,
  },
} as const;
const scenarios = [
  { id: "emotion-being-ignored", userMessage: "刚才被忽略的时候挺难受的", supportFunction: "return_focus_control" },
  { id: "relational-challenge-no-history", userMessage: "你一点都不懂我", supportFunction: "acknowledge_current_relational_impact" },
] as const;
const head = execSync("git rev-parse --short HEAD").toString().trim();

const run = async () => {
  const rows: Array<Record<string, unknown> & {
    scenarioId: string;
    passed: boolean;
    finalSource: string;
    regenerateAttempted: boolean;
    screen: { forbidden: boolean; ambiguous: boolean };
  }> = [];
  for (const scenario of scenarios) {
    for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
      const reply = await createChatReply({
        conversationId: `emotional-fix-budget:${head}:${scenario.id}:r${runIndex}`,
        currentTurnId: `${scenario.id}:r${runIndex}:t1`,
        userMessage: scenario.userMessage,
        recentMessages: [],
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
      });
      const plan = reply.controlTrace?.responsePlan;
      const contract = plan?.positiveFunctionContract;
      const validations = reply.controlTrace?.validation ?? [];
      const final = validations.at(-1);
      const actualSupportFunction = contract?.action === "offer_emotional_support" ? contract.supportFunction : null;
      const attempts = reply.generationAttempts.map((attempt, index) => ({
        attempt: index + 1,
        text: attempt.text,
        validationFailures: validations[index]?.failureReasons ?? ["missing_attempt_validation"],
        semanticAudit: semanticVerdictAuditFor(
          reply.plannedFunctionSemanticVerdicts?.[index],
          reply.plannedFunctionSemanticDiagnostics?.[index]
        ),
        semanticProviderFailure: reply.plannedFunctionSemanticDiagnostics?.[index]?.providerFailure ?? null,
      }));
      const committed = reply.finalSource !== "constraint_failure";
      const screenRules = screens[scenario.supportFunction];
      const screen = {
        forbidden: committed && screenRules.forbidden.test(reply.generation.text),
        ambiguous: committed && screenRules.ambiguous.test(reply.generation.text),
      };
      const passed = Boolean(final?.passed) &&
        committed &&
        Boolean(plan?.responseActions.includes("offer_emotional_support")) &&
        actualSupportFunction === scenario.supportFunction &&
        !screen.forbidden;
      rows.push({
        scenarioId: scenario.id,
        runIndex,
        actualActions: plan?.responseActions ?? [],
        actualSupportFunction,
        questionPolicy: plan?.questionPolicy.mode ?? null,
        finalSource: reply.finalSource,
        executionPhase: reply.execution.phase,
        executionFailure: executionFailureRecordFor(reply.execution),
        regenerateAttempted: reply.regenerateAttempted,
        promptVersion: reply.generation.promptVersion ?? null,
        attempts,
        reply: reply.generation.text,
        screen,
        passed,
      });
      console.log(JSON.stringify({
        scenarioId: scenario.id,
        runIndex,
        passed,
        finalSource: reply.finalSource,
        executionFailure: executionFailureRecordFor(reply.execution),
        screen,
        attempts: attempts.map((a) => ({ failures: a.validationFailures, ruleIds: a.semanticAudit?.ruleIds ?? null })),
      }));
    }
  }
  const summary = {
    head,
    runsPerScenario: RUNS,
    total: rows.length,
    passed: rows.filter((r) => r.passed).length,
    constraintFailures: rows.filter((r) => r.finalSource === "constraint_failure").length,
    regenerations: rows.filter((r) => r.regenerateAttempted).length,
    committedForbiddenScreenHits: rows.filter((r) => r.screen.forbidden).length,
    committedAmbiguousForHumanReview: rows.filter((r) => r.screen.ambiguous).length,
    byScenario: Object.fromEntries(scenarios.map((s) => [s.id, {
      passed: rows.filter((r) => r.scenarioId === s.id && r.passed).length,
      regenerations: rows.filter((r) => r.scenarioId === s.id && r.regenerateAttempted).length,
    }])),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  if (structuralPath) {
    const structuralRows = rows.map((row) => ({
      ...row,
      reply: undefined,
      attempts: (row.attempts as Array<{
        attempt: number;
        validationFailures: string[];
        semanticAudit: ReturnType<typeof semanticVerdictAuditFor>;
        semanticProviderFailure: unknown;
      }>)
        .map(({ attempt, validationFailures, semanticAudit, semanticProviderFailure }) => ({
          attempt,
          validationFailures,
          semanticAudit: withoutEvidenceText(semanticAudit),
          semanticProviderFailure,
        })),
    }));
    mkdirSync(dirname(structuralPath), { recursive: true });
    writeFileSync(structuralPath, `${JSON.stringify({
      note: "Structural copy; reply texts and evidence text kept locally.",
      summary,
      rows: structuralRows,
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.passed === summary.total ? 0 : 1;
};

void run();
