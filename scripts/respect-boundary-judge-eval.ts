import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

// Frozen before the run: the 14 human-labelled cases of the withdrawn 60719c8 batch, judged by the
// current production judge (source-selected v38 rules). 14 x 3 = 42 judgments, judge only, no generation;
// every result is kept, nothing is selected, retried, or rerun. The cap counts schema-repair calls.
const PASSES = 3;
const OUTBOUND_CAP = 48;

const BRANCH_DEVELOPER_SHA16 = { current_turn: "9ec838c034e30e45", previous_user_turn: "f4c3bb132e0b1547" } as const;
// ES rules the current judge applies to every emotional support function; the others belong to
// return_focus_control (ES-FOCUS) or acknowledge_current_relational_impact (ES-ACK-*).
const RESPECT_APPLICABLE_RULES = new Set(["ES-AFFECT-EVIDENCE", "ES-SCOPE"]);

// expected_rule: the current rules name the failure. no_applicable_rule: no current rule id names it, so
// any id cited for the rejection is borrowed. ambiguous: a current id literally covers part of the reply
// but none names the human-labelled failure; recorded, not scored.
type Attribution =
  | { kind: "no_rule_expected" }
  | { kind: "expected_rule"; rule: "ES-AFFECT-EVIDENCE" }
  | { kind: "no_applicable_rule" }
  | { kind: "ambiguous" };

const pausedHistory: ConversationMessage[] = [
  { id: "pause-judge-user", role: "user", content: "先别问了" },
  { id: "pause-judge-assistant", role: "assistant", content: "好，不问了。" },
];
const PAUSE_TEXT = "我今天有点不太高兴";
const none: Attribution = { kind: "no_rule_expected" };
const cases: Array<{
  id: string;
  group: "pause_positive" | "pause_negative" | "intensity" | "current_refusal_regression";
  userMessage: string;
  recentMessages: ConversationMessage[];
  reply: string;
  expectedPassed: boolean;
  attribution: Attribution;
}> = [
  { id: "P1-leading-receipt-restate", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊。我就在这儿安静陪你待会儿。", expectedPassed: true, attribution: none },
  { id: "P2-restate-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "有点不太高兴啊，那我就这样安静陪着你。", expectedPassed: true, attribution: none },
  { id: "P3-restate-today-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天心里有点不太高兴啊，我就在这儿安静陪着你。", expectedPassed: true, attribution: none },
  { id: "P4-reference", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天有点不好受啊，陪你安静一会儿。", expectedPassed: true, attribution: none },
  { id: "N1-receipt-company-quiet", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿安静陪你待会儿。", expectedPassed: false, attribution: { kind: "no_applicable_rule" } },
  { id: "N2-receipt-company-then", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。那我就安静陪你待会儿。", expectedPassed: false, attribution: { kind: "no_applicable_rule" } },
  { id: "N3-receipt-company", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿陪你待会儿。", expectedPassed: false, attribution: { kind: "no_applicable_rule" } },
  { id: "N4-assistant-own-feeling", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "听到你这么说，心里也跟着沉了一下。我就在这儿安静陪着你。", expectedPassed: false, attribution: { kind: "ambiguous" } },
  { id: "N5-action-suggestion", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候，就让自己待一会儿吧，我在这儿陪你。", expectedPassed: false, attribution: { kind: "no_applicable_rule" } },
  { id: "I1-intensified", group: "intensity", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候确实挺难熬的，我就在这儿安静陪陪你。", expectedPassed: false, attribution: { kind: "expected_rule", rule: "ES-AFFECT-EVIDENCE" } },
  { id: "R1-declines-talking-boundary", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "好，那就先不说，不用勉强自己。", expectedPassed: true, attribution: none },
  { id: "R2-declines-questions-listening", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问，你想说的时候我听着。", expectedPassed: true, attribution: none },
  { id: "R3-declines-talking-company", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "嗯，不想说就不说，小慢就在这儿陪着你。", expectedPassed: true, attribution: none },
  { id: "R4-declines-questions-available", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问了。你想说的时候我都在。", expectedPassed: true, attribution: none },
];

const planFor = (userMessage: string, recentMessages: ConversationMessage[]) => {
  const conversationState = determineConversationState({ currentUserMessage: userMessage, recentMessages });
  const context = assembleConversationControlContext({
    conversationId: "respect-boundary-judge-eval",
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

const sha16 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const semanticContextFor = (c: (typeof cases)[number]) => ({
  currentUserText: c.userMessage,
  handoffTargetAssistantText: null,
  priorAssistantTurnAvailable: c.recentMessages.some((m) => m.role === "assistant"),
});

const attributionStatusFor = (attribution: Attribution, passed: boolean, ruleIds: string[]) => {
  if (ruleIds.some((id) => !RESPECT_APPLICABLE_RULES.has(id))) return "out_of_function_citation";
  if (attribution.kind === "ambiguous") return "ambiguous_recorded";
  if (passed) return attribution.kind === "no_rule_expected" ? "correct" : "no_rejection_to_attribute";
  if (attribution.kind === "no_rule_expected") return "rejection_on_positive";
  if (attribution.kind === "no_applicable_rule") return ruleIds.length ? "borrowed_no_applicable_rule" : "no_rule_cited";
  return ruleIds.includes(attribution.rule) && ruleIds.every((id) => id === attribution.rule) ? "correct" : "wrong_rule";
};

const run = async () => {
  const head = execSync("git rev-parse --short HEAD").toString().trim();
  const plans = new Map(cases.map((c) => [c.id, planFor(c.userMessage, c.recentMessages)]));
  const precheck = [];
  for (const c of cases) {
    const plan = plans.get(c.id)!;
    const contract = plan.positiveFunctionContract;
    const supportFunction = contract?.action === "offer_emotional_support" ? contract.supportFunction : null;
    const source = contract?.action === "offer_emotional_support" ? contract.declinedSharingSource : undefined;
    const expectedSource = c.recentMessages.length ? "previous_user_turn" : "current_turn";
    const developer: string[] = [];
    await validatePlannedFunctionSemanticOutput({
      plan,
      reply: c.reply,
      semanticContext: semanticContextFor(c),
      inspectExternalPrompt: ({ messages }) => {
        developer.push(sha16(messages[0].content));
        throw new Error("precheck only");
      },
    });
    if (supportFunction !== "respect_declined_sharing" || source !== expectedSource || developer[0] !== BRANCH_DEVELOPER_SHA16[expectedSource]) {
      throw new Error(`${c.id}: precondition failed (${supportFunction}, ${source}, ${developer[0]}).`);
    }
    precheck.push({ caseId: c.id, supportFunction, source, developerSha: developer[0], expectedPassed: c.expectedPassed, attribution: c.attribution });
  }
  if (dryRun) {
    console.log(JSON.stringify({ head, cases: cases.length, passes: PASSES, plannedJudgments: cases.length * PASSES, outboundCap: OUTBOUND_CAP, precheck }, null, 2));
    return;
  }

  let outbound = 0;
  let budgetExhausted = false;
  let stoppedOn: { caseId: string; pass: number; failureReasons: string[] } | null = null;
  const rows: Array<Record<string, unknown>> = [];
  outer: for (let pass = 1; pass <= PASSES; pass += 1) {
    for (const c of cases) {
      const outboundBefore = outbound;
      const developerSha: string[] = [];
      const result = await validatePlannedFunctionSemanticOutput({
        plan: plans.get(c.id)!,
        reply: c.reply,
        semanticContext: semanticContextFor(c),
        inspectExternalPrompt: ({ messages }) => {
          if (outbound >= OUTBOUND_CAP) {
            budgetExhausted = true;
            throw new Error("outbound_cap_reached");
          }
          outbound += 1;
          developerSha.push(sha16(messages[0].content));
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
        passed: result.passed,
        failureReasons: result.failureReasons,
        outboundCalls: outbound - outboundBefore,
        developerSha,
        audit,
        verdictCorrect: providerFailure ? null : result.passed === c.expectedPassed,
        attributionStatus: providerFailure ? null : attributionStatusFor(c.attribution, result.passed, ruleIds),
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

  const completed = rows.filter((r) => !r.incomplete && r.verdictCorrect !== null);
  const perCase = cases.map((c) => {
    const caseRows = completed.filter((r) => r.caseId === c.id);
    return {
      caseId: c.id,
      group: c.group,
      expectedPassed: c.expectedPassed,
      attribution: c.attribution,
      judged: caseRows.length,
      passedCount: caseRows.filter((r) => r.passed).length,
      verdictCorrect: caseRows.filter((r) => r.verdictCorrect).length,
      consistent: caseRows.length === PASSES && new Set(caseRows.map((r) => r.passed)).size === 1,
      ruleIds: caseRows.map((r) => (r.audit as { ruleIds?: string[] } | null)?.ruleIds ?? []),
      attributionStatus: caseRows.map((r) => r.attributionStatus),
    };
  });
  const groups = ["pause_positive", "pause_negative", "intensity", "current_refusal_regression"] as const;
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
    complete: completed.length === cases.length * PASSES && !stoppedOn,
    verdictsByGroup: Object.fromEntries(groups.map((group) => {
      const groupCases = perCase.filter((p) => p.group === group);
      return [group, {
        correctJudgments: groupCases.reduce((sum, p) => sum + p.verdictCorrect, 0),
        plannedJudgments: groupCases.length * PASSES,
        consistentCases: groupCases.filter((p) => p.consistent).length,
        cases: groupCases.length,
      }];
    })),
    attributionCounts: completed.reduce<Record<string, number>>((counts, r) => {
      const key = String(r.attributionStatus);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
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
