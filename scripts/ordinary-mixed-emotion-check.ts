import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { ResponsePlan } from "../conversation-os/control";
import { enforceResponsePlan } from "../services/ai/responsePlanValidator";
import {
  assessOrdinaryUseObservation,
  plannedFunctionSemanticDeveloperContentFor,
  validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticContext,
  type PlannedFunctionSemanticVerdict,
  type PositiveFunctionSemanticVerdict,
  type OrdinaryUseObservation,
} from "../services/ai/plannedFunctionSemanticValidator";

const fixture = JSON.parse(readFileSync(new URL("./ordinary-mixed-emotion-fixture.json", import.meta.url), "utf8"));
const beforeFix = process.env.ORDINARY_FIELD_COMPAT_EXPECT_PRE_FIX === "1";
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw Error("Network forbidden in saved-response regression"); };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const results: Array<Record<string, unknown>> = [];
const promptHashes: string[] = [];
type LocalVerdict = PlannedFunctionSemanticVerdict & {
  positiveFunction: PositiveFunctionSemanticVerdict & {
    ordinaryUseObservation: OrdinaryUseObservation;
    invitationObservation: NonNullable<PositiveFunctionSemanticVerdict["invitationObservation"]>;
    invitationUseObservation: NonNullable<PositiveFunctionSemanticVerdict["invitationUseObservation"]>;
  };
};
type Mutation = (verdict: LocalVerdict, plan: ResponsePlan, context: PlannedFunctionSemanticContext) => void;
type Sample = { sequence: number; rawRequestJson: string; rawRequestSha256: string; rawProviderJson: string;
  rawProviderSha256: string; plan: ResponsePlan; reply: string; semanticContext: PlannedFunctionSemanticContext };

async function check(name: string, sample: Sample, mutate?: Mutation, expectExistingQuestionAdvisory = false) {
  const plan = structuredClone(sample.plan), context = structuredClone(sample.semanticContext);
  const verdict = JSON.parse(JSON.parse(sample.rawProviderJson).choices[0].message.content) as LocalVerdict;
  mutate?.(verdict, plan, context);
  const preserved = JSON.stringify(verdict);
  let providerCalls = 0;
  const result = await validatePlannedFunctionSemanticOutput({ plan, reply: sample.reply, semanticContext: context,
    provider: async input => {
      providerCalls++;
      if (!mutate) {
        const actual = JSON.parse(JSON.parse(sample.rawRequestJson).messages.at(-1).content);
        for (const key of ["planId", "positiveFunctionBinding", "currentUserText", "candidateReply", "ordinaryRecentMessages", "ordinaryQuestionIndependentlySupported"]) {
          assert.deepEqual(input[key as keyof typeof input], actual[key], name + ": preserve actual validator input " + key);
        }
        promptHashes.push(sha(JSON.stringify(plannedFunctionSemanticDeveloperContentFor(input))));
      }
      return verdict as PlannedFunctionSemanticVerdict;
    } });
  assert.equal(providerCalls, 1, name);
  assert.equal(result.providerFailure, undefined, name + ": no provider failure substitutes for validation");
  assert.equal(JSON.stringify(verdict), preserved, name + ": raw verdict must not be normalized");
  assert(result.verdict, name + ": consume complete valid schema, not old-format rejection");
  const expected = expectExistingQuestionAdvisory || (!mutate && !beforeFix);
  assert.equal(result.passed, expected, name + ": " + result.failureReasons.join(","));
  if (!mutate && beforeFix) assert.deepEqual(result.ordinaryUseAssessment?.failedFields, ["repetitionPurpose"]);
  if (expectExistingQuestionAdvisory) assert(result.advisoryFailureReasons.includes("planned_function_semantic:question_count_quality"));
  results.push({ name, expected, passed: result.passed, reasons: result.failureReasons });
}

async function main() {
  for (const sample of fixture.cases as Sample[]) {
    assert.equal(sha(sample.rawRequestJson), sample.rawRequestSha256);
    assert.equal(sha(sample.rawProviderJson), sample.rawProviderSha256);
    await check("saved-original-" + sample.sequence, sample);
  }
  if (!beforeFix) {
    const sample = fixture.cases[0] as Sample;
    const negatives: Array<[string, Mutation]> = [
      ["missing-use-comparison", v => { v.positiveFunction.ordinaryUseObservation.useComparison = null; }],
      ...(["no_supported_act", "only_reexpresses_user", "uncertain"] as const).map(relation =>
        ["comparison-" + relation, (v: LocalVerdict) => { v.positiveFunction.ordinaryUseObservation.useComparison!.relation = relation; }] as [string, Mutation]),
      ["missing-purpose-source", v => { v.positiveFunction.ordinaryUseObservation.purposeEvidence = []; }],
      ["fabricated-purpose-source", v => { v.positiveFunction.ordinaryUseObservation.purposeEvidence[0].text = "没有这句用户原话"; }],
      ["assistant-is-not-user-purpose", (v, _p, c) => { c.ordinaryRecentMessages = [{ role: "assistant", content: sample.semanticContext.currentUserText }]; const span = v.positiveFunction.ordinaryUseObservation.purposeEvidence[0]; span.source = "history"; span.messageIndex = 0; }],
      ["purpose-offset-outside-source", v => { v.positiveFunction.ordinaryUseObservation.purposeEvidence[0].end = 9999; }],
      ["missing-comparison-candidate-reference", v => { v.positiveFunction.ordinaryUseObservation.useComparison!.candidateEvidenceIndices = []; }],
      ["comparison-candidate-index-outside", v => { v.positiveFunction.ordinaryUseObservation.useComparison!.candidateEvidenceIndices = [999]; }],
      ["candidate-evidence-wrong-text", v => { v.positiveFunction.evidence[0].text = "候选没有这句话"; }],
      ["overall-rejected", v => { v.positiveFunction.status = "not_satisfied"; }],
      ["fact-or-other-contradiction", v => { v.positiveFunction.containsContradictoryMove = true; }],
      ["invitation-has-no-use", v => { v.positiveFunction.invitationUseObservation.contextualUse = "no_supported_use"; }],
      ["repeated-invitation-has-no-use", (v, _p, c) => { const text = "想聊聊的话随时可以说说。"; c.ordinaryRecentMessages = [{ role: "assistant", content: text }]; v.positiveFunction.invitationUseObservation.contextualUse = "repeats_prior_permission_without_use"; v.positiveFunction.invitationUseObservation.priorInvitation = { messageIndex: 0, start: 0, end: text.length, text }; }],
      ["invitation-reference-missing", v => { v.positiveFunction.invitationUseObservation.candidateEvidenceIndices = []; }],
      ["stronger-affect-remains-rejected", v => { v.positiveFunction.invitationObservation.affectDrift = "stronger_intensity"; }],
      ["pure-repeat-has-no-purpose", v => { v.positiveFunction.ordinaryUseObservation.contentRelation = "repeats_or_normalizes_only"; v.positiveFunction.ordinaryUseObservation.repetitionPurpose = "none"; }],
    ];
    for (const [name, mutate] of negatives) await check(name, sample, mutate);
    // This offer_emotional_support counter is historically advisory; do not silently change that contract.
    await check("existing-invitation-question-count-advisory-preserved", sample, (v, p) => {
      p.questionPolicy.mode = "none"; v.semanticQuestionCount = 1;
    }, true);
    const observation = JSON.parse(JSON.parse(sample.rawProviderJson).choices[0].message.content).positiveFunction.ordinaryUseObservation;
    const evidence = JSON.parse(JSON.parse(sample.rawProviderJson).choices[0].message.content).positiveFunction.evidence;
    for (const purpose of ["none", "understanding_check", "clarification", "organizing"] as const) {
      const assessment = assessOrdinaryUseObservation({ ...observation, repetitionPurpose: purpose }, false, false, evidence);
      assert(assessment.failedFields.includes("repetitionPurpose"), "Other purpose labels are not newly allowed: " + purpose);
    }
    const receipt = assessOrdinaryUseObservation({ ...observation, contentRelation: "receipt_only" }, true, false, evidence);
    assert(receipt.failedFields.includes("repetitionPurpose"), "No global idle/receipt relaxation");
  }
  let closedLoopCases = 0;
  if (!beforeFix) {
    const checkedPlans = new Set<string>();
    for (const sample of fixture.cases as Sample[]) {
      if (checkedPlans.has(sample.plan.planId)) continue;
      checkedPlans.add(sample.plan.planId);
      let generations = 0, judgments = 0;
      const verdict = JSON.parse(JSON.parse(sample.rawProviderJson).choices[0].message.content) as LocalVerdict;
      const preserved = JSON.stringify(verdict);
      const result = await enforceResponsePlan({ plan: sample.plan, plannedFunctionSemanticContext: sample.semanticContext,
        generate: async () => { generations++; return { text: sample.reply, rawLLMOutput: sample.reply,
          model: "offline-saved-F", promptVersion: "saved-original-replay", finalReplySource: "llm", latencyMs: 0, postProcessSteps: [] }; },
        plannedFunctionSemanticProvider: async () => { judgments++; return verdict; } });
      assert.equal(result.outcome, "validated", "Saved first draft must complete enforcement without regeneration");
      assert.equal(generations, 1); assert.equal(judgments, 1);
      assert.equal(JSON.stringify(verdict), preserved);
      closedLoopCases++;
    }
    assert.equal(closedLoopCases, 4);
  }
  assert.equal(networkCalls, 0);
  const report = { status: beforeFix ? "BASELINE_8_FALSE_REJECTIONS_REPRODUCED" : "PASS_LOCAL_COMPATIBILITY_ONLY",
    cases: results.length, closedLoopCases, results, promptHashes, originalRawPairs: fixture.cases.length, networkCalls,
    realModelAccuracyEstablished: false, remainingFullReleaseAcceptanceCompleted: false };
  if (process.env.ORDINARY_FIELD_COMPAT_REPORT) writeFileSync(process.env.ORDINARY_FIELD_COMPAT_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, results: undefined, promptHashes: undefined }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
