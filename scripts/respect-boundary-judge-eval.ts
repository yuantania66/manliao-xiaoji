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
import {
  validatePlannedFunctionSemanticOutput,
  type PriorPauseObservation,
} from "../services/ai/plannedFunctionSemanticValidator";
import { semanticVerdictAuditFor, withoutEvidenceText } from "./semantic-verdict-audit";

loadEnvConfig(process.cwd());

const outputPath = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "";
const structuralPath = process.argv.find((a) => a.startsWith("--structural-output="))?.slice(20) ?? "";
const dryRun = process.argv.includes("--dry-run");
if (!dryRun && !outputPath) throw new Error("--output is required.");
if (!dryRun && process.env.AI_PROVIDER !== "qwen") throw new Error("This eval must run against the real Qwen provider.");

// Frozen before the run (ledger, D0 pre-implementation freeze): the 14 human-labelled cases plus 6 cases
// confirmed by the user on 10-04 18:55 (2 positive, 4 negative). 20 x 3 = 60 judgments, judge only, no
// generation; every result is kept, nothing is selected, retried, or rerun. The cap counts schema-repair calls.
const PASSES = 3;
const OUTBOUND_CAP = 66;

// D0 ran on 42483a8e… / 12fe0e10…; these are the current texts (current-refusal observation after c82698f).
const BRANCH_DEVELOPER_SHA16 = { current_turn: "ab3f184aba19c335", previous_user_turn: "27dbaf64f655a963" } as const;

type Field = keyof PriorPauseObservation;
type ExpectedObservation = { [F in Field]: Array<PriorPauseObservation[F]> };
type ExpectedRules = { required: string; allowed: string[] } | null;

const pausedHistory: ConversationMessage[] = [
  { id: "pause-judge-user", role: "user", content: "先别问了" },
  { id: "pause-judge-assistant", role: "assistant", content: "好，不问了。" },
];
const PAUSE_TEXT = "我今天有点不太高兴";
// Values the human labels do not distinguish within the same passing or failing class are accepted together.
const RESPONDS: ExpectedObservation["feelingResponse"] = ["restates_or_paraphrases", "reacts_to_state"];
const observe = (o: Partial<ExpectedObservation>): ExpectedObservation => ({
  feelingResponse: RESPONDS,
  affectDrift: ["none"],
  suggestsUserAction: ["no"],
  invitesOrAsks: ["no"],
  ...o,
});
const cases: Array<{
  id: string;
  group: "pause_positive" | "pause_negative" | "intensity" | "current_refusal_regression";
  userMessage: string;
  recentMessages: ConversationMessage[];
  reply: string;
  expectedPassed: boolean;
  observation: ExpectedObservation | null;
  rules: ExpectedRules;
}> = [
  { id: "P1-leading-receipt-restate", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊。我就在这儿安静陪你待会儿。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "P2-restate-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "有点不太高兴啊，那我就这样安静陪着你。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "P3-restate-today-company", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天心里有点不太高兴啊，我就在这儿安静陪着你。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "P4-reference", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "今天有点不好受啊，陪你安静一会儿。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "C1-leading-receipt-paraphrase", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，有点不开心啊。我在这儿陪你。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "C2-receipt-phrase-restate", group: "pause_positive", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "听到你这么说，今天是有点不太高兴啊。我就在这儿陪你。", expectedPassed: true, observation: observe({}), rules: null },
  { id: "N1-receipt-company-quiet", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿安静陪你待会儿。", expectedPassed: false, observation: observe({ feelingResponse: ["receipt_only"] }), rules: { required: "ES-PAUSE-RECEIPT", allowed: [] } },
  { id: "N2-receipt-company-then", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。那我就安静陪你待会儿。", expectedPassed: false, observation: observe({ feelingResponse: ["receipt_only"] }), rules: { required: "ES-PAUSE-RECEIPT", allowed: [] } },
  { id: "N3-receipt-company", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。我就在这儿陪你待会儿。", expectedPassed: false, observation: observe({ feelingResponse: ["receipt_only"] }), rules: { required: "ES-PAUSE-RECEIPT", allowed: [] } },
  { id: "C5-receipt-only", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，听到了。", expectedPassed: false, observation: observe({ feelingResponse: ["receipt_only"] }), rules: { required: "ES-PAUSE-RECEIPT", allowed: [] } },
  // ES-AFFECT-EVIDENCE covers every emotion category the reply names; the human label settles only the substitution.
  { id: "N4-assistant-own-feeling", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "听到你这么说，心里也跟着沉了一下。我就在这儿安静陪着你。", expectedPassed: false, observation: observe({ feelingResponse: ["assistant_feeling_instead"], affectDrift: ["none", "added_category"] }), rules: { required: "ES-PAUSE-SUBSTITUTE", allowed: ["ES-AFFECT-EVIDENCE"] } },
  { id: "N5-action-suggestion", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候，就让自己待一会儿吧，我在这儿陪你。", expectedPassed: false, observation: observe({ suggestsUserAction: ["yes"] }), rules: { required: "ES-PAUSE-ACTION", allowed: [] } },
  { id: "C4-restate-action", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊。早点休息吧，我陪着你。", expectedPassed: false, observation: observe({ suggestsUserAction: ["yes"] }), rules: { required: "ES-PAUSE-ACTION", allowed: [] } },
  { id: "C6-restate-invite", group: "pause_negative", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊。想说说是怎么了吗？", expectedPassed: false, observation: observe({ invitesOrAsks: ["yes"] }), rules: { required: "ES-SCOPE", allowed: [] } },
  { id: "I1-intensified", group: "intensity", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "不太高兴的时候确实挺难熬的，我就在这儿安静陪陪你。", expectedPassed: false, observation: observe({ affectDrift: ["stronger_intensity"] }), rules: { required: "ES-AFFECT-EVIDENCE", allowed: [] } },
  // Whether the trailing 吧 asks anything is not settled by the human label (it fails for intensity).
  { id: "C3-receipt-restate-intensified", group: "intensity", userMessage: PAUSE_TEXT, recentMessages: pausedHistory, reply: "嗯，今天不太高兴啊，心里一定很难受吧。我陪着你。", expectedPassed: false, observation: observe({ affectDrift: ["stronger_intensity"], invitesOrAsks: ["no", "yes"] }), rules: { required: "ES-AFFECT-EVIDENCE", allowed: ["ES-SCOPE"] } },
  { id: "R1-declines-talking-boundary", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "好，那就先不说，不用勉强自己。", expectedPassed: true, observation: null, rules: null },
  { id: "R2-declines-questions-listening", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问，你想说的时候我听着。", expectedPassed: true, observation: null, rules: null },
  { id: "R3-declines-talking-company", group: "current_refusal_regression", userMessage: "我有点难受，但不想说", recentMessages: [], reply: "嗯，不想说就不说，小慢就在这儿陪着你。", expectedPassed: true, observation: null, rules: null },
  { id: "R4-declines-questions-available", group: "current_refusal_regression", userMessage: "我不太高兴，不想被问", recentMessages: [], reply: "好，我不问了。你想说的时候我都在。", expectedPassed: true, observation: null, rules: null },
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

const FAILING_VALUES: { [F in Field]: Array<PriorPauseObservation[F]> } = {
  feelingResponse: ["assistant_feeling_instead", "receipt_only", "none"],
  affectDrift: ["stronger_intensity", "added_category"],
  suggestsUserAction: ["yes"],
  invitesOrAsks: ["yes"],
};
const FIELDS = Object.keys(FAILING_VALUES) as Field[];

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
    const captured: Array<{ developer: string; user: string }> = [];
    await validatePlannedFunctionSemanticOutput({
      plan,
      reply: c.reply,
      semanticContext: semanticContextFor(c),
      inspectExternalPrompt: ({ messages }) => {
        captured.push({ developer: messages[0].content, user: messages[1].content });
        throw new Error("precheck only");
      },
    });
    const developerSha = captured[0] ? sha16(captured[0].developer) : null;
    const observationRequested = Boolean(captured[0]?.user.includes("priorPauseObservation"));
    if (
      supportFunction !== "respect_declined_sharing" ||
      source !== expectedSource ||
      developerSha !== BRANCH_DEVELOPER_SHA16[expectedSource] ||
      observationRequested !== (c.observation !== null)
    ) {
      throw new Error(`${c.id}: precondition failed (${supportFunction}, ${source}, ${developerSha}, observation=${observationRequested}).`);
    }
    precheck.push({ caseId: c.id, supportFunction, source, developerSha, observationRequested, expectedPassed: c.expectedPassed, rules: c.rules });
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
      const providerFailure = result.failureReasons.includes("planned_function_semantic:provider_failure");
      const formatFailure = result.failureReasons.includes("planned_function_semantic:malformed_verdict") ||
        result.failureReasons.includes("planned_function_semantic:evidence_mismatch");
      const branch = result.verdict?.positiveFunction ?? null;
      const observation = branch?.priorPauseObservation ?? null;
      const assessment = result.priorPauseAssessment ?? null;
      // Independent recomputation of the frozen combination rule, from the model's fields only.
      const overallSatisfied = Boolean(branch && branch.status === "satisfied" &&
        branch.realizedAction === "offer_emotional_support" && branch.targetAddressed && branch.contractRealized &&
        !branch.containsContradictoryMove && branch.evidence.length > 0);
      const observationPasses = observation === null ||
        FIELDS.every((field) => !(FAILING_VALUES[field] as string[]).includes(observation[field]) && observation[field] !== "uncertain");
      const recomputedPassed = c.observation === null ? overallSatisfied : observation !== null && overallSatisfied && observationPasses;
      const fieldCorrect = c.observation && observation
        ? Object.fromEntries(FIELDS.map((field) => [field, (c.observation![field] as string[]).includes(observation[field])]))
        : null;
      const ruleIds = assessment?.ruleIds ?? [];
      const attribution = formatFailure || providerFailure
        ? null
        : result.passed
          ? (c.expectedPassed ? "correct" : "false_accept")
          : c.expectedPassed
            ? (ruleIds.length ? "rejection_on_positive" : "unattributed_rejection_on_positive")
            : !ruleIds.length
              ? "unattributed_overall_rejection"
              : c.rules && ruleIds.includes(c.rules.required) && ruleIds.every((id) => id === c.rules!.required || c.rules!.allowed.includes(id))
                ? "correct"
                : "wrong_rule";
      rows.push({
        caseId: c.id,
        group: c.group,
        pass,
        reply: c.reply,
        expectedPassed: c.expectedPassed,
        passed: result.passed,
        failureReasons: result.failureReasons,
        outboundCalls: outbound - outboundBefore,
        schemaRepairCall: outbound - outboundBefore > 1,
        formatFailure,
        developerSha,
        overallStatus: branch?.status ?? null,
        overallSatisfied,
        observation,
        observationPresent: observation !== null,
        fieldCorrect,
        semanticUncertain: assessment ? assessment.uncertainFields.length > 0 : branch?.status === "uncertain",
        codeRuleIds: ruleIds,
        overlapRejection: Boolean(assessment && assessment.failedFields.length > 0 && assessment.overallRejected),
        recomputedPassed,
        aggregationCorrect: formatFailure || providerFailure ? null : recomputedPassed === result.passed,
        verdictCorrect: providerFailure ? null : result.passed === c.expectedPassed,
        attribution,
        reasonRuleIds: semanticVerdictAuditFor(result.verdict)?.ruleIds ?? [],
        audit: semanticVerdictAuditFor(result.verdict, assessment?.ruleIds),
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
  const observed = completed.filter((r) => r.fieldCorrect);
  const perCase = cases.map((c) => {
    const caseRows = completed.filter((r) => r.caseId === c.id);
    return {
      caseId: c.id,
      group: c.group,
      expectedPassed: c.expectedPassed,
      rules: c.rules,
      judged: caseRows.length,
      passedCount: caseRows.filter((r) => r.passed).length,
      verdictCorrect: caseRows.filter((r) => r.verdictCorrect).length,
      consistent: caseRows.length === PASSES && new Set(caseRows.map((r) => r.passed)).size === 1,
      observations: caseRows.map((r) => r.observation),
      fieldCorrect: caseRows.map((r) => r.fieldCorrect),
      overallStatus: caseRows.map((r) => r.overallStatus),
      codeRuleIds: caseRows.map((r) => r.codeRuleIds),
      attribution: caseRows.map((r) => r.attribution),
    };
  });
  const count = (predicate: (r: Record<string, unknown>) => boolean) => completed.filter(predicate).length;
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
    verdicts: {
      misrejections: count((r) => r.expectedPassed === true && r.passed === false),
      falseAccepts: count((r) => r.expectedPassed === false && r.passed === true),
      byGroup: Object.fromEntries(groups.map((group) => {
        const groupCases = perCase.filter((p) => p.group === group);
        return [group, {
          correctJudgments: groupCases.reduce((sum, p) => sum + p.verdictCorrect, 0),
          plannedJudgments: groupCases.length * PASSES,
          consistentCases: groupCases.filter((p) => p.consistent).length,
          cases: groupCases.length,
        }];
      })),
    },
    observationFields: {
      judgmentsWithObservation: observed.length,
      allFieldsCorrect: observed.filter((r) => Object.values(r.fieldCorrect as Record<string, boolean>).every(Boolean)).length,
      byField: Object.fromEntries(FIELDS.map((field) => [
        field,
        observed.filter((r) => (r.fieldCorrect as Record<string, boolean>)[field]).length,
      ])),
    },
    aggregation: {
      correct: count((r) => r.aggregationCorrect === true),
      incorrect: count((r) => r.aggregationCorrect === false),
    },
    attribution: completed.reduce<Record<string, number>>((counts, r) => {
      const key = String(r.attribution);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    format: {
      malformedOrEvidenceMismatch: count((r) => r.formatFailure === true),
      judgmentsNeedingSchemaRepairCall: count((r) => r.schemaRepairCall === true),
    },
    semanticUncertain: count((r) => r.semanticUncertain === true),
    overlapRejections: count((r) => r.overlapRejection === true),
    currentRefusal: {
      passed: count((r) => r.group === "current_refusal_regression" && r.passed === true),
      withObservation: count((r) => r.group === "current_refusal_regression" && r.observationPresent === true),
      withPausedRuleIds: count((r) => r.group === "current_refusal_regression" && (r.codeRuleIds as string[]).length > 0),
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
