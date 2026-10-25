import type { PlannedFunctionSemanticVerdict, OrdinaryUseObservation, OrdinaryUseComparison, InvitationUseObservation } from "../services/ai/plannedFunctionSemanticValidator";
// Mutable local transport fixtures; raw records remain unchanged and are validated by the real parser.
type FixtureVerdict = PlannedFunctionSemanticVerdict & { positiveFunction: NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]> & {
 ordinaryUseObservation: OrdinaryUseObservation & { useComparison: OrdinaryUseComparison };
 invitationObservation: NonNullable<NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]>["invitationObservation"]>;
 invitationUseObservation: InvitationUseObservation;
} };
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizePlannedFunctionSemanticEvidence, validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";
const saved = JSON.parse(readFileSync(new URL("./ordinary-use-comparison-fixture.json", import.meta.url), "utf8"));
const fixture = JSON.parse(readFileSync(new URL("./ordinary-use-observation-regression-fixture.json", import.meta.url), "utf8"));
const current = fixture.semanticContext.currentUserText;
const originalFetch = globalThis.fetch;
let networkAttempts = 0, checked = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error("External requests forbidden"); };
const raw = (name: string) => JSON.parse(JSON.parse(saved.cases[name].rawProviderJson).choices[0].message.content);
const normalize = (v: unknown, reply = saved.reply, context = fixture.semanticContext) => {
  const before = JSON.stringify(v);
  const n = normalizePlannedFunctionSemanticEvidence(v as PlannedFunctionSemanticVerdict, reply, context.currentUserText, context.ordinaryRecentMessages);
  assert.equal(JSON.stringify(v), before); assert(n); return n;
};
async function check(name: string, v: unknown, expected: boolean, reply = saved.reply, plan = fixture.plan, context = fixture.semanticContext) {
  let calls = 0;
  const r = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context, provider: async () => { calls++; return structuredClone(v); } });
  assert.equal(calls, 1, name); assert.equal(r.providerFailure, undefined, name);
  assert(r.verdict, name + ": must be parsed, not an obsolete-format rejection");
  assert.equal(r.passed, expected, name); checked++; return r;
}
const comparison = (relation: OrdinaryUseComparison["relation"] = "only_reexpresses_user"): OrdinaryUseComparison => ({ userMeaning: "用户已表达工作疏忽以及被当众批评后的难堪。",
  candidateAct: relation === "supported_conversational_act" ? "区分承担疏忽与接受公开批评方式的选择。" : "重新表述疏忽和难堪。",
  candidateEvidenceIndices: [0], relation });
const full = (relation: OrdinaryUseComparison["relation"] = "only_reexpresses_user", reply = saved.reply) => {
  const v = normalize(raw("accepted")) as FixtureVerdict;
  v.positiveFunction.evidence = [{ start: 0, end: reply.length, text: reply, reason: "Human-labelled local comparison fixture, not a new model judgment." }];
  v.positiveFunction.ordinaryUseObservation.useComparison = comparison(relation);
  return v;
};
async function main() {
  for (const item of Object.values(saved.cases) as Array<typeof import("./ordinary-use-comparison-fixture.json")["cases"]["accepted"]>) assert.equal(createHash("sha256").update(item.rawProviderJson).digest("hex"), item.sha256);
  await check("saved-real-rejection-remains-parsed-rejection", normalize(raw("rejected")), false);
  const legacy = await check("saved-real-false-acceptance-is-parsed-but-now-unproven", normalize(raw("accepted")), false);
  assert(legacy.failureReasons.includes("planned_function_semantic:positive_function_uncertain"));
  // The following are explicitly human-labelled observations, not rewritten provider responses.
  const negative = await check("full-current-schema-other-and-satisfied-cannot-override-reexpression", full(), false);
  assert.equal(negative.verdict!.positiveFunction!.status, "satisfied");
  assert(negative.ordinaryUseAssessment!.failedFields.includes("useComparison"));
  await check("full-current-schema-no-supported-act", full("no_supported_act"), false);
  await check("full-current-schema-uncertain-act", full("uncertain"), false);
  const permission = "承认这处疏忽，不意味着你就得接受被当众批评的方式。";
  await check("grounded-natural-response-without-question", full("supported_conversational_act", permission), true, permission);
  const badIndex = full("supported_conversational_act", permission);
  badIndex.positiveFunction.ordinaryUseObservation.useComparison.candidateEvidenceIndices = [3];
  await check("comparison-cannot-point-outside-candidate-evidence", badIndex, false, permission);
  const noAct = full("supported_conversational_act", permission);
  noAct.positiveFunction.ordinaryUseObservation.useComparison.candidateAct = null;
  await check("supported-relation-with-no-act-is-inconsistent", noAct, false, permission);
  const noBoundCandidate = full("supported_conversational_act", permission);
  noBoundCandidate.positiveFunction.ordinaryUseObservation.useComparison.candidateEvidenceIndices = [];
  await check("source-quote-cannot-replace-candidate-binding", noBoundCandidate, false, permission);
  const fabricated = full("supported_conversational_act", permission);
  fabricated.positiveFunction.ordinaryUseObservation.purposeEvidence[0].text = "用户没有说过的话";
  await check("comparison-does-not-relax-user-source-truth", fabricated, false, permission);
  const question = "后来他没再单独找你聊这事吧？";
  const peripheral = full("no_supported_act", question);
  peripheral.positiveFunction.ordinaryUseObservation.useComparison.candidateAct = "询问后续事件，但没有当前用途依据。";
  peripheral.semanticQuestionCount = 1;
  await check("a-question-is-not-a-supported-act-by-itself", peripheral, false, question);
  const noQuestions = structuredClone(fixture.plan); noQuestions.questionPolicy.mode = "none";
  const q = full("supported_conversational_act", question); q.semanticQuestionCount = 1;
  await check("comparison-cannot-grant-question-permission", q, false, question, noQuestions);
  // Distinct contextual boundaries are already exercised by the ordinary observation suite.
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, cases: checked, originalProviderPayloadsBytePreserved: true, externalRequests: 0,
    savedLegacyFalseAcceptanceOnlyUnprovenNotSemanticallyFixed: true, fullSchemaNegativeComparisonConsumed: true,
    humanLabelsAreNotModelEvidence: true, modelObservationAccuracyEstablished: false }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
