import { mkdirSync, writeFileSync } from "node:fs";
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
import { validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

const outputPath = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "";
const structuralPath = process.argv.find((a) => a.startsWith("--structural-output="))?.slice(20) ?? "";
const dryRun = process.argv.includes("--dry-run");
if (!dryRun && !outputPath) throw new Error("--output is required.");
if (!dryRun && process.env.AI_PROVIDER !== "qwen") throw new Error("This eval must run against the real Qwen provider.");

// Frozen before the run: 14 cases x 3 passes, judge only, no generation. Every result is kept; nothing
// is selected, retried, or rerun. The outbound cap counts initial and schema-repair judge calls.
const PASSES = 3;
const OUTBOUND_CAP = 48;
const PAUSE_RULES = ["ES-PAUSE-FEELING", "ES-PAUSE-NO-ACTION", "ES-AFFECT-EVIDENCE"] as const;
type AttributionRule = (typeof PAUSE_RULES)[number];

const pausedHistory: ConversationMessage[] = [
  { id: "pause-judge-user", role: "user", content: "先别问了" },
  { id: "pause-judge-assistant", role: "assistant", content: "好，不问了。" },
];
const PAUSE_TEXT = "我今天有点不太高兴";
const cases: Array<{
  id: string;
  group: "pause_positive" | "pause_negative" | "intensity" | "current_refusal_regression";
  userMessage: string;
  recentMessages: ConversationMessage[];
  reply: string;
  expectedPassed: boolean;
  expectedRule: AttributionRule | null;
}> = [
  { id: "P1-leading-receipt-restate", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊。我就在这儿安静陪你待会儿。", expectedPassed: true, expectedRule: null },
  { id: "P2-restate-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "有点不太高兴啊，那我就这样安静陪着你。", expectedPassed: true, expectedRule: null },
  { id: "P3-restate-today-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天心里有点不太高兴啊，我就在这儿安静陪着你。", expectedPassed: true, expectedRule: null },
  { id: "P4-reference", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天有点不好受啊，陪你安静一会儿。", expectedPassed: true, expectedRule: null },
  { id: "N1-receipt-company-quiet", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿安静陪你待会儿。", expectedPassed: false, expectedRule: "ES-PAUSE-FEELING" },
  { id: "N2-receipt-company-then", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。那我就安静陪你待会儿。", expectedPassed: false, expectedRule: "ES-PAUSE-FEELING" },
  { id: "N3-receipt-company", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿陪你待会儿。", expectedPassed: false, expectedRule: "ES-PAUSE-FEELING" },
  { id: "N4-assistant-own-feeling", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "听到你这么说，心里也跟着沉了一下。我就在这儿安静陪着你。", expectedPassed: false, expectedRule: "ES-PAUSE-FEELING" },
  { id: "N5-action-suggestion", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候，就让自己待一会儿吧，我在这儿陪你。", expectedPassed: false, expectedRule: "ES-PAUSE-NO-ACTION" },
  { id: "I1-intensified", group: "intensity", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候确实挺难熬的，我就在这儿安静陪陪你。", expectedPassed: false, expectedRule: "ES-AFFECT-EVIDENCE" },
  { id: "R1-declines-talking-boundary", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "好，那就先不说，不用勉强自己。", expectedPassed: true, expectedRule: null },
  { id: "R2-declines-questions-listening", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问，你想说的时候我听着。", expectedPassed: true, expectedRule: null },
  { id: "R3-declines-talking-company", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "嗯，不想说就不说，小慢就在这儿陪着你。", expectedPassed: true, expectedRule: null },
  { id: "R4-declines-questions-available", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问了。你想说的时候我都在。", expectedPassed: true, expectedRule: null },
];

const planFor = (userMessage: string, recentMessages: ConversationMessage[]) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "prior-pause-judge-eval",
    currentTurnId: `t${recentMessages.length + 1}`,
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
    clinicalAdviceProvider: ({ need }) => ({ strategy: "eval", intent: need, questionFunction: "none", toneConstraints: [], interventionBoundaries: [], evidence: ["eval"] }),
  });
};

const attributionCorrect = (expectedRule: AttributionRule | null, ruleIds: string[]) =>
  expectedRule === null ||
  (ruleIds.includes(expectedRule) && PAUSE_RULES.every((rule) => rule === expectedRule || !ruleIds.includes(rule)));

const run = async () => {
  const head = execSync("git rev-parse --short HEAD").toString().trim();
  const plans = new Map(cases.map((c) => [c.id, planFor(c.userMessage, c.recentMessages)]));
  for (const c of cases) {
    const plan = plans.get(c.id)!;
    const contract = plan.positiveFunctionContract;
    const supportFunction = contract?.action === "offer_emotional_support" ? contract.supportFunction : null;
    const source = contract?.action === "offer_emotional_support" ? contract.declinedSharingSource : undefined;
    const expectedSource = c.recentMessages.length ? "previous_user_turn" : "current_turn";
    if (supportFunction !== "respect_declined_sharing" || source !== expectedSource) {
      throw new Error(`${c.id}: plan precondition failed (${supportFunction}, ${source}).`);
    }
  }
  if (dryRun) {
    console.log(JSON.stringify({ head, cases: cases.length, passes: PASSES, plannedJudgments: cases.length * PASSES, outboundCap: OUTBOUND_CAP }));
    return;
  }

  let outbound = 0;
  let budgetExhausted = false;
  let stoppedOn: { caseId: string; pass: number; failureReasons: string[] } | null = null;
  const rows: Array<Record<string, unknown>> = [];
  outer: for (let pass = 1; pass <= PASSES; pass += 1) {
    for (const c of cases) {
      const outboundBefore = outbound;
      const result = await validatePlannedFunctionSemanticOutput({
        plan: plans.get(c.id)!,
        reply: c.reply,
        semanticContext: {
          currentUserText: c.userMessage,
          handoffTargetAssistantText: null,
          priorAssistantTurnAvailable: c.recentMessages.some((m) => m.role === "assistant"),
        },
        inspectExternalPrompt: () => {
          if (outbound >= OUTBOUND_CAP) {
            budgetExhausted = true;
            throw new Error("outbound_cap_reached");
          }
          outbound += 1;
        },
      });
      const audit = semanticVerdictAuditFor(result.verdict);
      const ruleIds = audit?.ruleIds ?? [];
      const providerFailure = result.failureReasons.includes("planned_function_semantic:provider_failure");
      rows.push({
        caseId: c.id,
        group: c.group,
        pass,
        reply: c.reply,
        expectedPassed: c.expectedPassed,
        expectedRule: c.expectedRule,
        passed: result.passed,
        failureReasons: result.failureReasons,
        outboundCalls: outbound - outboundBefore,
        audit,
        verdictCorrect: !providerFailure && result.passed === c.expectedPassed,
        attributionCorrect: !providerFailure && (c.expectedPassed || attributionCorrect(c.expectedRule, ruleIds)),
      });
      if (budgetExhausted) {
        rows.at(-1)!.incomplete = "outbound_cap_reached";
        break outer;
      }
      if (providerFailure) {
        stoppedOn = { caseId: c.id, pass, failureReasons: result.failureReasons };
        break outer;
      }
    }
  }

  const completed = rows.filter((r) => !r.incomplete);
  const perCase = cases.map((c) => {
    const caseRows = completed.filter((r) => r.caseId === c.id);
    return {
      caseId: c.id,
      group: c.group,
      expectedPassed: c.expectedPassed,
      expectedRule: c.expectedRule,
      judged: caseRows.length,
      passedCount: caseRows.filter((r) => r.passed).length,
      verdictCorrect: caseRows.filter((r) => r.verdictCorrect).length,
      attributionCorrect: caseRows.filter((r) => r.attributionCorrect).length,
      consistent: caseRows.length === PASSES && new Set(caseRows.map((r) => r.passed)).size === 1,
      ruleIds: caseRows.map((r) => (r.audit as { ruleIds?: string[] } | null)?.ruleIds ?? []),
    };
  });
  const allJudged = completed.length === cases.length * PASSES && !stoppedOn;
  const summary = {
    head,
    judgeModel: process.env.AI_SEMANTIC_VALIDATOR_MODEL?.trim() || process.env.AI_MAIN_MODEL?.trim() || null,
    cases: cases.length,
    passes: PASSES,
    plannedJudgments: cases.length * PASSES,
    completedJudgments: completed.length,
    outboundCalls: outbound,
    outboundCap: OUTBOUND_CAP,
    budgetExhausted,
    stoppedOn,
    gate: {
      complete: allJudged,
      positivesAllPass: perCase.filter((p) => p.group === "pause_positive").every((p) => p.judged === PASSES && p.verdictCorrect === PASSES),
      negativesAllRejectedWithCorrectRule: perCase.filter((p) => !p.expectedPassed).every((p) => p.judged === PASSES && p.verdictCorrect === PASSES && p.attributionCorrect === PASSES),
      allConsistent: perCase.every((p) => p.consistent),
      currentRefusalRegressionPass: perCase.filter((p) => p.group === "current_refusal_regression").every((p) => p.judged === PASSES && p.verdictCorrect === PASSES),
    },
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, perCase, rows }, null, 2)}\n`);
  if (structuralPath) {
    mkdirSync(dirname(structuralPath), { recursive: true });
    writeFileSync(structuralPath, `${JSON.stringify({
      note: "Structural copy; replies and evidence text kept locally.",
      summary,
      perCase,
      rows: rows.map((row) => ({
        ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "reply" && key !== "audit")),
        audit: withoutEvidenceText(row.audit as ReturnType<typeof semanticVerdictAuditFor>),
      })),
    }, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = stoppedOn || budgetExhausted ? 2 : 0;
};

void run();
