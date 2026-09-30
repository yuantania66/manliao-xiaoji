import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { ConversationMessage } from "../conversation-os/types";
import {
  validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticProviderFailure,
} from "../services/ai/plannedFunctionSemanticValidator";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

type JudgeCase = {
  id: string;
  category: string;
  userMessage: string;
  recentMessages?: ConversationMessage[];
  expectedPlanAction?: string;
  reply: string;
  expected: "pass" | "fail" | "ambiguous";
  acceptedRuleIds?: string[];
  rationale: string;
  derivation: string;
};

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const casesPath = arg("cases");
const outputPath = arg("output");
const structuralPath = arg("structural-output");
const repetitions = Number(arg("repetitions") || "3");
if (!casesPath || !outputPath) throw new Error("--cases and --output are required.");
if (process.env.AI_PROVIDER !== "qwen") throw new Error("This evaluation must run against the real Qwen provider.");

const countBy = (values: string[]) =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});

const latencySummary = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (quantile: number) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))];
  return {
    count: sorted.length,
    meanMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50Ms: at(0.5),
    p90Ms: at(0.9),
    maxMs: sorted[sorted.length - 1],
  };
};

const planFor = (userMessage: string, recentMessages: ConversationMessage[]) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "judge-reliability",
    currentTurnId: "judge-reliability-turn",
    userMessage,
    recentMessages,
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  return createResponsePlan({
    context,
    interpretation,
    dialogueState: buildDialogueState(context, interpretation),
    ordinaryHandoffBoundary: null,
    clinicalAdviceProvider: ({ need }) => ({
      strategy: "judge-reliability",
      intent: need,
      questionFunction: "none",
      toneConstraints: [],
      interventionBoundaries: [],
      evidence: ["judge-reliability"],
    }),
  });
};

const run = async () => {
  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as JudgeCase[];
  const head = execSync("git rev-parse --short HEAD").toString().trim();
  const calls: Array<{
    caseId: string;
    category: string;
    expected: JudgeCase["expected"];
    repetition: number;
    planAction: string | null;
    supportFunction: string | null;
    questionPolicy: string;
    outcome: "pass" | "fail";
    hardFailureReasons: string[];
    advisoryFailureReasons: string[];
    audit: ReturnType<typeof semanticVerdictAuditFor>;
    providerFailure: PlannedFunctionSemanticProviderFailure | null;
    // Every outbound judge call, including the schema-repair call; latency runs to the next call or the end.
    modelCalls: Array<{ call: "initial" | "schema_repair"; latencyMs: number }>;
    validationLatencyMs: number;
    formatFailure: boolean;
    outcomeMatches: boolean | null;
    citationMatches: boolean | null;
    ruleScopeViolation: boolean;
  }> = [];
  for (const testCase of cases) {
    const recentMessages = testCase.recentMessages ?? [];
    const plan = planFor(testCase.userMessage, recentMessages);
    const contract = plan.positiveFunctionContract;
    if (testCase.expectedPlanAction && contract?.action !== testCase.expectedPlanAction) {
      throw new Error(`${testCase.id}: fixture plan is ${contract?.action ?? "none"}, expected ${testCase.expectedPlanAction}.`);
    }
    const reps = testCase.expected === "ambiguous" ? 1 : repetitions;
    for (let repetition = 1; repetition <= reps; repetition += 1) {
      const callStarts: number[] = [];
      const startedAt = Date.now();
      const result = await validatePlannedFunctionSemanticOutput({
        plan,
        reply: testCase.reply,
        semanticContext: {
          currentUserText: testCase.userMessage,
          handoffTargetAssistantText: null,
          priorAssistantTurnAvailable: recentMessages.some((message) => message.role === "assistant"),
        },
        inspectExternalPrompt: () => {
          callStarts.push(Date.now());
        },
      });
      const endedAt = Date.now();
      const modelCalls = callStarts.map((start, index) => ({
        call: index === 0 ? "initial" as const : "schema_repair" as const,
        latencyMs: (callStarts[index + 1] ?? endedAt) - start,
      }));
      const formatFailure = modelCalls.length > 1 ||
        result.hardFailureReasons.some((reason) =>
          reason === "planned_function_semantic:malformed_verdict" ||
          reason === "planned_function_semantic:evidence_mismatch");
      const audit = semanticVerdictAuditFor(result.verdict);
      const outcome = result.passed ? "pass" : "fail";
      const outcomeMatches = testCase.expected === "ambiguous" ? null : outcome === testCase.expected;
      const citationMatches = testCase.expected !== "fail" || !testCase.acceptedRuleIds?.length
        ? null
        : Boolean(audit?.ruleIds.some((ruleId) => testCase.acceptedRuleIds?.includes(ruleId)));
      const ruleScopeViolation = (audit?.outOfScopeRuleIds.length ?? 0) > 0;
      calls.push({
        caseId: testCase.id,
        category: testCase.category,
        expected: testCase.expected,
        repetition,
        planAction: contract?.action ?? null,
        supportFunction: contract?.action === "offer_emotional_support" ? contract.supportFunction : null,
        questionPolicy: plan.questionPolicy.mode,
        outcome,
        hardFailureReasons: result.hardFailureReasons,
        advisoryFailureReasons: result.advisoryFailureReasons,
        audit,
        providerFailure: result.providerFailure ?? null,
        modelCalls,
        validationLatencyMs: endedAt - startedAt,
        formatFailure,
        outcomeMatches,
        citationMatches,
        ruleScopeViolation,
      });
      console.log(JSON.stringify({
        caseId: testCase.id,
        repetition,
        expected: testCase.expected,
        outcome,
        ruleIds: audit?.ruleIds ?? null,
        outOfScopeRuleIds: audit?.outOfScopeRuleIds ?? null,
        hardFailureReasons: result.hardFailureReasons,
        providerFailure: result.providerFailure ?? null,
        modelCalls: modelCalls.length,
        validationLatencyMs: endedAt - startedAt,
      }));
    }
  }
  const labeled = calls.filter((call) => call.expected !== "ambiguous");
  const byCase = Object.fromEntries(cases.map((testCase) => {
    const caseCalls = calls.filter((call) => call.caseId === testCase.id);
    return [testCase.id, {
      category: testCase.category,
      expected: testCase.expected,
      outcomes: caseCalls.map((call) => call.outcome),
      ruleIds: caseCalls.map((call) => call.audit?.ruleIds ?? null),
      ruleScopeViolations: caseCalls.filter((call) => call.ruleScopeViolation).length,
      reliable: testCase.expected === "ambiguous"
        ? null
        : caseCalls.every((call) =>
          call.outcomeMatches && call.citationMatches !== false && !call.ruleScopeViolation),
    }];
  }));
  const summary = {
    head,
    repetitions,
    labeledCases: cases.filter((testCase) => testCase.expected !== "ambiguous").length,
    ambiguousCases: cases.filter((testCase) => testCase.expected === "ambiguous").length,
    judgeCalls: calls.length,
    outcomeMatches: labeled.filter((call) => call.outcomeMatches).length,
    labeledCalls: labeled.length,
    failCitationMatches: labeled.filter((call) => call.citationMatches === true).length,
    failLabeledCalls: labeled.filter((call) => call.expected === "fail").length,
    ruleScopeViolationCalls: calls.filter((call) => call.ruleScopeViolation).length,
    reliableCases: Object.values(byCase).filter((item) => item.reliable === true).length,
    // Diagnostics only; they never relax the reliability standard above.
    diagnostics: {
      totalModelCalls: calls.reduce((sum, call) => sum + call.modelCalls.length, 0),
      schemaRepairCalls: calls.reduce(
        (sum, call) => sum + call.modelCalls.filter((modelCall) => modelCall.call === "schema_repair").length, 0),
      formatFailureValidations: calls.filter((call) => call.formatFailure).length,
      malformedOrEvidenceMismatchValidations: calls.filter((call) => call.hardFailureReasons.some((reason) =>
        reason === "planned_function_semantic:malformed_verdict" ||
        reason === "planned_function_semantic:evidence_mismatch")).length,
      semanticMisjudgments: labeled.filter((call) => call.outcomeMatches === false).length,
      citationMisses: labeled.filter((call) => call.citationMatches === false).length,
      providerFailures: countBy(calls.flatMap((call) =>
        call.providerFailure ? [`${call.providerFailure.category}:${call.providerFailure.call ?? "unattributed"}`] : [])),
      validationLatencyMs: latencySummary(calls.map((call) => call.validationLatencyMs)),
      modelCallLatencyMs: latencySummary(calls.flatMap((call) => call.modelCalls.map((modelCall) => modelCall.latencyMs))),
    },
    byCase,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, cases, calls }, null, 2)}\n`);
  if (structuralPath) {
    mkdirSync(dirname(structuralPath), { recursive: true });
    writeFileSync(structuralPath, `${JSON.stringify({
      note: "Structural copy; synthetic case replies and evidence text kept locally.",
      summary,
      cases: cases.map(({ id, category, expected, acceptedRuleIds }) => ({
        id, category, expected, acceptedRuleIds,
      })),
      calls: calls.map((call) => ({ ...call, audit: withoutEvidenceText(call.audit) })),
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.reliableCases === summary.labeledCases ? 0 : 1;
};

void run();
