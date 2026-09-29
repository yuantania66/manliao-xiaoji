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
import { validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

type JudgeCase = {
  id: string;
  category: string;
  userMessage: string;
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

const planFor = (userMessage: string) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages: [] });
  const context = assembleConversationControlContext({
    conversationId: "judge-reliability",
    currentTurnId: "judge-reliability-turn",
    userMessage,
    recentMessages: [],
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
    supportFunction: string | null;
    questionPolicy: string;
    outcome: "pass" | "fail";
    hardFailureReasons: string[];
    advisoryFailureReasons: string[];
    audit: ReturnType<typeof semanticVerdictAuditFor>;
    outcomeMatches: boolean | null;
    citationMatches: boolean | null;
  }> = [];
  for (const testCase of cases) {
    const plan = planFor(testCase.userMessage);
    const contract = plan.positiveFunctionContract;
    const reps = testCase.expected === "ambiguous" ? 1 : repetitions;
    for (let repetition = 1; repetition <= reps; repetition += 1) {
      const result = await validatePlannedFunctionSemanticOutput({
        plan,
        reply: testCase.reply,
        semanticContext: {
          currentUserText: testCase.userMessage,
          handoffTargetAssistantText: null,
          priorAssistantTurnAvailable: false,
        },
      });
      const audit = semanticVerdictAuditFor(result.verdict);
      const outcome = result.passed ? "pass" : "fail";
      const outcomeMatches = testCase.expected === "ambiguous" ? null : outcome === testCase.expected;
      const citationMatches = testCase.expected !== "fail"
        ? null
        : Boolean(audit?.ruleIds.some((ruleId) => testCase.acceptedRuleIds?.includes(ruleId)));
      calls.push({
        caseId: testCase.id,
        category: testCase.category,
        expected: testCase.expected,
        repetition,
        supportFunction: contract?.action === "offer_emotional_support" ? contract.supportFunction : null,
        questionPolicy: plan.questionPolicy.mode,
        outcome,
        hardFailureReasons: result.hardFailureReasons,
        advisoryFailureReasons: result.advisoryFailureReasons,
        audit,
        outcomeMatches,
        citationMatches,
      });
      console.log(JSON.stringify({
        caseId: testCase.id,
        repetition,
        expected: testCase.expected,
        outcome,
        ruleIds: audit?.ruleIds ?? null,
        hardFailureReasons: result.hardFailureReasons,
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
      reliable: testCase.expected === "ambiguous"
        ? null
        : caseCalls.every((call) => call.outcomeMatches && call.citationMatches !== false),
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
    reliableCases: Object.values(byCase).filter((item) => item.reliable === true).length,
    byCase,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, cases, calls }, null, 2)}\n`);
  if (structuralPath) {
    mkdirSync(dirname(structuralPath), { recursive: true });
    writeFileSync(structuralPath, `${JSON.stringify({
      note: "Structural copy; synthetic case replies and evidence text kept locally.",
      summary,
      cases: cases.map(({ id, category, expected, acceptedRuleIds, rationale, derivation }) => ({
        id, category, expected, acceptedRuleIds, rationale, derivation,
      })),
      calls: calls.map((call) => ({ ...call, audit: withoutEvidenceText(call.audit) })),
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.reliableCases === summary.labeledCases ? 0 : 1;
};

void run();
