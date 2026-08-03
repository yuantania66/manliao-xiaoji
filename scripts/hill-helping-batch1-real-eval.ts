import assert from "node:assert/strict";

import { loadEnvConfig } from "@next/env";

import {
  assembleConversationControlContext,
  buildDialogueState,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { getAiProvider, getDefaultAiModel, isAiProviderConfigured } from "../services/ai/modelProvider";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import { buildHillHelpingInput, runHillHelpingShadow } from "../services/helping";

loadEnvConfig(process.cwd());

const CASES = [
  {
    id: "exploration-share",
    text: "今天发生一件小事，我一直放不下。",
    allowedApplicability: ["applicable"],
    allowedGoals: ["exploration"],
  },
  {
    id: "action-request",
    text: "我明天要跟领导谈，怎么开口比较好？",
    allowedApplicability: ["applicable"],
    allowedGoals: ["action"],
  },
  {
    id: "insight-readiness",
    text: "我想弄明白，为什么类似的事情总让我这么在意。",
    allowedApplicability: ["applicable"],
    allowedGoals: ["exploration", "insight"],
  },
  {
    id: "no-advice-boundary",
    text: "别给我建议，我只想把今天吵架的事说出来。",
    allowedApplicability: ["applicable"],
    allowedGoals: ["exploration"],
  },
  {
    id: "no-analysis-boundary",
    text: "别分析我，我只是想把这件事说出来。",
    allowedApplicability: ["applicable"],
    allowedGoals: ["exploration"],
  },
] as const;

const buildInput = (text: string, index: number) => {
  const conversationState = determineConversationState({ currentUserMessage: text, recentMessages: [] });
  const context = assembleConversationControlContext({
    conversationId: `hill-batch1-real-${index + 1}`,
    currentTurnId: `hill-batch1-real-turn-${index + 1}`,
    userMessage: text,
    recentMessages: [],
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  return buildHillHelpingInput({ context, interpretation, dialogueState });
};

const percentile = (values: number[], quantile: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
};

const assertHelpingTokenGates = (results: Array<{ tokenInput?: number; tokenOutput?: number }>) => {
  const inputP95 = percentile(results.map((item) => item.tokenInput ?? Number.POSITIVE_INFINITY), 0.95);
  const outputP95 = percentile(results.map((item) => item.tokenOutput ?? Number.POSITIVE_INFINITY), 0.95);
  assert(inputP95 <= 1136, `Helping Shadow input P95 ${inputP95} exceeds frozen gate 1136.`);
  assert(outputP95 <= 390, `Helping Shadow output P95 ${outputP95} exceeds frozen gate 390.`);
  return { inputP95, outputP95 };
};

const assertExpectedDecision = ({
  testCase,
  trace,
}: {
  testCase: (typeof CASES)[number];
  trace: Awaited<ReturnType<typeof runHillHelpingShadow>>;
}) => {
  assert.equal(
    trace.decision?.status,
    "decided",
    `${testCase.id} failed: ${JSON.stringify({
      decision: trace.decision,
      tokenInput: trace.provider.tokenInput,
      tokenOutput: trace.provider.tokenOutput,
      rawOutput: trace.provider.rawOutput,
    })}`
  );
  if (trace.decision?.status !== "decided") return;
  assert(
    testCase.allowedApplicability.includes(trace.decision.plan.applicability as never),
    `${testCase.id} applicability=${trace.decision.plan.applicability}`
  );
  assert(
    testCase.allowedGoals.includes(trace.decision.plan.primaryGoal as never),
    `${testCase.id} goal=${trace.decision.plan.primaryGoal ?? "none"}`
  );
};

const runOfficialEntrypoint = async () => {
  const results = [];
  for (const [index, testCase] of CASES.entries()) {
    const startedAt = Date.now();
    const reply = await createChatReply({
      conversationId: `hill-batch1-real-official-${index + 1}`,
      currentTurnId: `hill-batch1-real-official-turn-${index + 1}`,
      userMessage: testCase.text,
      recentMessages: [],
      helpingShadowEnabled: true,
      includeDebugTrace: true,
    });
    const elapsedMs = Date.now() - startedAt;
    assertExpectedDecision({ testCase, trace: reply.helpingTrace });
    assert.equal(reply.execution.phase, "VALIDATED", `${testCase.id} official reply must validate.`);
    const providerCalls = Number(reply.controlTrace?.interpretationModel.attempted ?? false) +
      Number(reply.helpingTrace.provider.attempted) +
      reply.generationAttempts.length;
    assert(providerCalls <= 3, `${testCase.id} used ${providerCalls} provider calls; frozen maximum is 3.`);
    results.push({
      id: testCase.id,
      elapsedMs,
      providerCalls,
      tokenInput: reply.helpingTrace.provider.tokenInput,
      tokenOutput: reply.helpingTrace.provider.tokenOutput,
      applicability: reply.helpingTrace.decision?.status === "decided"
        ? reply.helpingTrace.decision.plan.applicability
        : undefined,
      primaryGoal: reply.helpingTrace.decision?.status === "decided"
        ? reply.helpingTrace.decision.plan.primaryGoal
        : undefined,
    });
  }
  const tokenGates = assertHelpingTokenGates(results);
  const endToEndP50 = percentile(results.map((item) => item.elapsedMs), 0.5);
  const endToEndP95 = percentile(results.map((item) => item.elapsedMs), 0.95);
  assert(endToEndP95 <= 15779, `Shadow end-to-end P95 ${endToEndP95} exceeds frozen gate 15779.`);
  console.log(JSON.stringify({
    mode: "official-entrypoint",
    provider: getAiProvider(),
    configuredModel: process.env.HILL_HELPING_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    cases: results,
    gates: {
      ...tokenGates,
      endToEndP50,
      endToEndP95,
      endToEndP95Limit: 15779,
      maxProviderCalls: Math.max(...results.map((item) => item.providerCalls)),
    },
  }, null, 2));
};

const run = async () => {
  assert(isAiProviderConfigured(), "A real AI provider must be configured for this explicitly invoked evaluation.");
  if (process.argv.includes("--official")) {
    await runOfficialEntrypoint();
    return;
  }
  const results = [];
  for (const [index, testCase] of CASES.entries()) {
    const trace = await runHillHelpingShadow({
      input: buildInput(testCase.text, index),
      enabled: true,
    });
    assert.equal(trace.provider.attempted, true, `${testCase.id} must use the real structured provider path.`);
    assertExpectedDecision({ testCase, trace });
    if (trace.decision?.status !== "decided") continue;
    results.push({
      id: testCase.id,
      status: trace.decision.status,
      applicability: trace.decision.plan.applicability,
      primaryGoal: trace.decision.plan.primaryGoal,
      intention: trace.decision.plan.intention,
      primarySkill: trace.decision.plan.primarySkill,
      provider: trace.provider.model,
      latencyMs: trace.provider.latencyMs,
      tokenInput: trace.provider.tokenInput,
      tokenOutput: trace.provider.tokenOutput,
    });
  }
  const tokenGates = assertHelpingTokenGates(results);
  console.log(JSON.stringify({
    mode: "helping-provider-only",
    provider: getAiProvider(),
    configuredModel: process.env.HILL_HELPING_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    cases: results,
    gates: tokenGates,
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
