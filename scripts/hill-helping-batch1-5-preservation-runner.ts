import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import { createChatReply } from "../services/ai/chatOrchestrationService";
import { getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import { loadPreservationDataset } from "./hill-helping-batch1-5-preservation-lib";

loadEnvConfig(process.cwd());

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const outputPath = getArg("output");
const sourceId = getArg("source-id");
if (!outputPath) throw new Error("--output is required.");
if (!sourceId) throw new Error("--source-id is required.");
assert(isAiProviderConfigured(), "A configured real AI provider is required for the preservation run.");

const { dataset, sha256: datasetSha256 } = loadPreservationDataset();
const run = async () => {
  const startedAt = new Date().toISOString();
  const rows = [];

  for (const scenario of dataset.scenarios) {
    for (let runIndex = 1; runIndex <= dataset.gate.runsPerScenario; runIndex += 1) {
      const turnStartedAt = Date.now();
      const reply = await createChatReply({
        conversationId: `batch1-5-preservation:${sourceId}:${scenario.id}:r${runIndex}`,
        currentTurnId: `${scenario.id}:r${runIndex}:t1`,
        userMessage: scenario.userMessage,
        recentMessages: scenario.recentMessages,
        includeDebugTrace: true,
        helpingShadowEnabled: false,
        helpingOrdinaryHandoffEnabled: true,
      });
      const plan = reply.controlTrace?.responsePlan;
      const validation = reply.controlTrace?.validation.at(-1);
      const row = {
        scenarioId: scenario.id,
        kind: scenario.kind,
        runIndex,
        userMessage: scenario.userMessage,
        recentMessages: scenario.recentMessages,
        expectedAction: scenario.expectedAction,
        actualActions: plan?.responseActions ?? [],
        behaviorSource: plan?.behaviorSource ?? null,
        questionPolicy: plan?.questionPolicy.mode ?? null,
        reply: reply.generation.text,
        executionPhase: reply.execution.phase,
        planPreflightPassed: reply.execution.planPreflight.passed,
        planPreflightFailures: reply.execution.planPreflight.failureReasons,
        finalSource: reply.finalSource,
        validationPassed: validation?.passed ?? false,
        validationFailures: validation?.failureReasons ?? ["missing_final_validation"],
        regenerateAttempted: reply.regenerateAttempted,
        generationAttempts: reply.generationAttempts.length,
        attempts: reply.generationAttempts.map((attempt, index) => ({
          attempt: index + 1,
          text: attempt.text,
          validationPassed: reply.controlTrace?.validation[index]?.passed ?? false,
          validationFailures:
            reply.controlTrace?.validation[index]?.failureReasons ?? ["missing_attempt_validation"],
        })),
        helpingProviderAttempted: reply.helpingTrace.provider.attempted,
        interpretationProviderAttempted: reply.controlTrace?.interpretationModel.attempted ?? false,
        latencyMs: Date.now() - turnStartedAt,
      };
      rows.push(row);
      console.log(JSON.stringify({
        scenarioId: row.scenarioId,
        runIndex: row.runIndex,
        executionPhase: row.executionPhase,
        finalSource: row.finalSource,
        actualActions: row.actualActions,
        regenerateAttempted: row.regenerateAttempted,
      }));
    }
  }

  const total = rows.length;
  const validated = rows.filter((row) => row.executionPhase === "VALIDATED" && row.validationPassed).length;
  const preflightPassed = rows.filter((row) => row.planPreflightPassed).length;
  const expectedAction = rows.filter((row) => row.actualActions.includes(row.expectedAction)).length;
  const constraintFailures = rows.filter((row) => row.finalSource === "constraint_failure").length;
  const helpingProviderCalls = rows.filter((row) => row.helpingProviderAttempted).length;
  const regenerations = rows.filter((row) => row.regenerateAttempted).length;
  const summary = {
    total,
    validated,
    validatedRate: validated / total,
    preflightPassed,
    preflightPassedRate: preflightPassed / total,
    expectedAction,
    expectedActionRate: expectedAction / total,
    constraintFailures,
    helpingProviderCalls,
    regenerations,
    regenerationRate: regenerations / total,
  };
  const checks = {
    completeRunCount: total === dataset.gate.scenarioCount * dataset.gate.runsPerScenario,
    preflightPassed: summary.preflightPassedRate === 1,
    validatedRate: summary.validatedRate >= dataset.gate.requiredValidatedRate,
    expectedActionRate: summary.expectedActionRate >= dataset.gate.requiredExpectedActionRate,
    constraintFailures: summary.constraintFailures <= dataset.gate.maximumConstraintFailures,
    helpingProviderCalls: summary.helpingProviderCalls <= dataset.gate.maximumHelpingProviderCalls,
    regenerationRate: summary.regenerationRate <= dataset.gate.maximumRegenerationRate,
  };
  const passed = Object.values(checks).every(Boolean);
  const artifact = {
    schemaVersion: 1,
    sourceId,
    datasetVersion: dataset.datasetVersion,
    datasetSha256,
    provider: getAiProvider(),
    model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    startedAt,
    completedAt: new Date().toISOString(),
    gate: dataset.gate,
    summary,
    checks,
    passed,
    rows,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ outputPath, ...summary, checks, passed }, null, 2));
  if (!passed) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
