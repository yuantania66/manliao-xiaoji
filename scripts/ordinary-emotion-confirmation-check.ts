import type { ResponsePlan } from "../conversation-os/control";
import type { OrdinaryRegenerationFeedback } from "../services/ai/responsePlanValidator";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildChatPrompt } from "../services/ai/promptBuilder";
import { formatResponsePlanRegenerateConstraint, enforceResponsePlan } from "../services/ai/responsePlanValidator";
import { plannedFunctionSemanticDeveloperContentFor, validatePlannedFunctionSemanticOutput } from "../services/ai/plannedFunctionSemanticValidator";

// Human-labelled transport/evidence regressions. No model judgments are fabricated.
const fixture = JSON.parse(readFileSync(new URL("./ordinary-use-observation-regression-fixture.json", import.meta.url), "utf8"));
const archive = JSON.parse(readFileSync(new URL("./ordinary-role-purpose-adoption-fixture.json", import.meta.url), "utf8"));
const source = fixture.semanticContext.currentUserText;
const plan = fixture.plan;
const context = fixture.semanticContext;
const acceptedReply = "知道自己有疏忽，和被当众指出来觉得难堪，是可以同时存在的。不是承认他说得对，就得把自己的不舒服也收回去。那一刻，最让你难受的是什么？";
const confirmation = acceptedReply.slice(0, acceptedReply.indexOf("那一刻"));
const originalFetch = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = async () => { externalAttempts++; throw new Error("No external requests in local regression"); };
const quote = { source: "current_user", messageIndex: null, start: 0, end: source.length, text: source };
const observation = (kind: string, purpose: string, act: string | null, relation = "supported_conversational_act") => ({
  contentRelation: kind, repetitionPurpose: purpose, purposeEvidence: [quote],
  useComparison: { userMeaning: "用户承认疏忽，明确表达当众被指出后的难堪。", candidateAct: act,
    candidateEvidenceIndices: [0], relation },
});
const emotional = () => observation("repeats_or_normalizes_only", "emotional_acknowledgment", "确认本轮已表达的难堪，不要求用户证明感受或继续说。");
type MutableEmotionObservation = Omit<ReturnType<typeof emotional>, "useComparison"> & {useComparison: ReturnType<typeof emotional>["useComparison"] | null};
const verdict = (reply: string, obs: unknown, questions = 0) => {
  const v = structuredClone(fixture.originalVerdict);
  v.semanticQuestionCount = questions;
  v.positiveFunction.ordinaryUseObservation = obs;
  v.positiveFunction.evidence = [{ start: 0, end: reply.length, text: reply,
    reason: "Explicit human-labelled local fixture, not a model observation or proof of reader experience." }];
  return v;
};
const results: Array<{name: string; expected: boolean; passed: boolean; reasons: string[]}> = [];
async function check(name: string, reply: string, obs: unknown, expected: boolean, opts: {questions?: number; targetPlan?: ResponsePlan; mutate?: (v: ReturnType<typeof verdict>) => void} = {}) {
  const v = verdict(reply, obs, opts.questions);
  opts.mutate?.(v);
  let calls = 0;
  const before = JSON.stringify(v);
  const r = await validatePlannedFunctionSemanticOutput({ plan: opts.targetPlan ?? plan, reply, semanticContext: context,
    provider: async () => { calls++; return structuredClone(v); } });
  assert.equal(calls, 1, name); assert.equal(JSON.stringify(v), before, name + ": retain observation");
  assert.equal(r.providerFailure, undefined, name);
  results.push({name, expected, passed: r.passed, reasons: r.failureReasons});
  assert.equal(r.passed, expected, name + ": " + r.failureReasons.join(","));
  assert(r.verdict, name + ": must consume current observations, not reject an old schema");
  return r;
}
async function main() {
  const prompt = buildChatPrompt({userMessage: source, recentMessages: context.ordinaryRecentMessages, responsePlan: plan});
  const judgeInput = {planId: plan.planId, handoffBinding: null, positiveFunctionBinding: plan.positiveFunctionContract,
    currentUserText: source, handoffTargetAssistantText: null, candidateReply: acceptedReply,
    ordinaryQuestionIndependentlySupported: true, ordinaryRecentMessages: context.ordinaryRecentMessages};
  const judge = plannedFunctionSemanticDeveloperContentFor(judgeInput).scoped;
  const feedback: OrdinaryRegenerationFeedback = {kind: "ordinary_response_validation_feedback", planId: plan.planId, candidateReply: fixture.reply,
    ordinaryUseObservation: {contentRelation: "repeats_or_normalizes_only", repetitionPurpose: "none"},
    ordinaryUseAssessment: {failedFields: ["repetitionPurpose"], uncertainFields: [], overallRejected: false}};
  const regeneration = formatResponsePlanRegenerateConstraint(plan, ["planned_function_semantic:positive_function_not_satisfied"], feedback);
  if (process.env.ORDINARY_LOCAL_EVIDENCE_DIR) writeFileSync(process.env.ORDINARY_LOCAL_EVIDENCE_DIR + "/prompts.json",
    JSON.stringify({generation: prompt.messages, judge, regeneration}, null, 2));

  // The first new positive reproduces the missing-purpose failure before repair.
  await check("grounded-emotion-confirmation-no-question", confirmation, emotional(), true);
  await check("user-preferred-confirmation-with-optional-question", acceptedReply,
    observation("other_response", "not_applicable", "先确认用户当前感受，再让用户自愿说明那一刻在意的部分，不预设答案。"), true, {questions: 1});
  const noQuestions = structuredClone(plan); noQuestions.questionPolicy.mode = "none";
  await check("confirmation-need-not-ask-or-progress", confirmation, emotional(), true, {targetPlan: noQuestions});
  await check("permission-does-not-override-question-none", acceptedReply, observation("other_response", "not_applicable", "自然确认后邀请展开。"), false,
    {questions: 1, targetPlan: noQuestions});
  await check("at-most-one-question-remains", acceptedReply + "后来呢？", observation("other_response", "not_applicable", "邀请展开。"), false, {questions: 2});

  // Full valid schemas with concrete observations, not field-presence checks.
  for (const [name, mutate] of [
    ["emotional-label-without-supported-act", (o: MutableEmotionObservation) => o.useComparison!.relation = "no_supported_act"],
    ["emotional-label-without-source", (o: MutableEmotionObservation) => o.purposeEvidence = []],
    ["emotional-label-without-candidate-evidence", (o: MutableEmotionObservation) => o.useComparison!.candidateEvidenceIndices = []],
    ["emotional-label-with-uncertain-act", (o: MutableEmotionObservation) => o.useComparison!.relation = "uncertain"],
    ["emotional-label-with-only-reexpression", (o: MutableEmotionObservation) => o.useComparison!.relation = "only_reexpresses_user"],
    ["emotional-label-without-comparison", (o: MutableEmotionObservation) => o.useComparison = null],
    ["emotional-label-with-outside-evidence", (o: MutableEmotionObservation) => o.useComparison!.candidateEvidenceIndices = [4]],
  ] as const) { const o = emotional(); mutate(o); await check(name, confirmation, o, false); }
  const badSource = emotional(); badSource.purposeEvidence[0] = {...quote, text: "用户没有说过这句话"};
  await check("feeling-confirmation-cannot-invent-source", confirmation, badSource, false);
  for (const reply of ["抱抱你。", "唉，让你受这一遭了。", "听着都替你难受。", "想聊的话随时可以说说。"])
    await check("generic-or-repeated-invitation:" + reply, reply,
      observation("other_response", "not_applicable", null, "no_supported_act"), false);
  for (const reply of ["事情说过去了，那阵难堪却还留着。光是再提起来，都不太好受。", "你是因为自卑才这么在意别人的看法。"])
    await check("unsupported-fact-or-psychology:" + reply, reply, emotional(), false,
      {mutate: v => v.positiveFunction.containsContradictoryMove = true});
  await check("support-label-cannot-override-whole-reply-rejection", confirmation, emotional(), false,
    {mutate: v => v.positiveFunction.status = "not_satisfied"});
  const refused = structuredClone(plan); refused.questionPolicy.mode = "none";
  refused.positiveFunctionContract.responseFunction = "respect_declined_sharing";
  const supportedQuestion = observation("other_response", "not_applicable", "邀请继续说");
  await check("respect-declined-sharing-still-forbids-question", acceptedReply, supportedQuestion, false,
    {questions: 1, targetPlan: refused, mutate: v => v.positiveFunction.binding.responseFunction = "respect_declined_sharing"});

  for (const raw of archive.rawReplies) {
    assert.equal(createHash("sha256").update(raw.rawProviderJson).digest("hex"), raw.sha256);
    assert.equal(raw.expectedUserOverallAcceptance, "REJECTED_BY_USER");
    const reply = JSON.parse(raw.rawProviderJson).choices[0].message.content;
    await check(`historical-user-rejection:${raw.arm}:${raw.round}`, reply,
      {contentRelation: "repeats_or_normalizes_only", repetitionPurpose: "none", purposeEvidence: [], useComparison: null}, false);
  }
  // Closed-loop local seam: no generation provider, no commit, no added retry.
  let generations = 0, judgments = 0;
  const accepted = await enforceResponsePlan({plan, plannedFunctionSemanticContext: context,
    generate: async () => { generations++; return {text: acceptedReply, rawLLMOutput: acceptedReply, model: "offline-fixed",
      promptVersion: prompt.meta.promptVersion, finalReplySource: "llm", latencyMs: 0, postProcessSteps: []}; },
    plannedFunctionSemanticProvider: async () => { judgments++; return verdict(acceptedReply,
      observation("other_response", "not_applicable", "贴近本轮感受的确认与可选经历延续。"), 1); }});
  assert.equal(accepted.outcome, "validated"); assert.equal(generations, 1); assert.equal(judgments, 1);
  const text = prompt.messages.map(m => m.content).join("\n");
  assert(!text.includes(acceptedReply), "No hardcoded answer in generation");
  assert(text.includes('"requiredContribution":null'), "No restored mandatory goal");
  assert(text.includes("Natural emotional acknowledgment"));
  assert(text.includes("confirmation followed by an optional question"));
  assert(!text.includes("When bounded recent history shows"), "Superseded Surface-only preference removed; this historical natural contract stays optional");
  assert(text.includes("neither the sequence nor a question is required"));
  assert(!text.includes("Restate only for a current purpose, such as checking understanding"));
  assert(regeneration.includes("情绪确认"));
  assert(judge.includes("emotional_acknowledgment"));
  assert(judge.includes("do not reject it merely for overlapping"));
  assert(text.includes("不得编造事件、动机或心理状态"));
  assert.equal(externalAttempts, 0);
  const report = {passed: true, cases: results.length, casesDetail: results, externalRequests: externalAttempts,
    archivedRawRepliesPreserved: archive.rawReplies.length, evidenceKind: "human-labelled local observations + actual prompt capture",
    modelObservationAccuracyEstablished: false, realGenerationQualityEstablished: false};
  if (process.env.ORDINARY_LOCAL_EVIDENCE_DIR) writeFileSync(process.env.ORDINARY_LOCAL_EVIDENCE_DIR + "/results.json", JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report, casesDetail: undefined}));
}
main().catch(e => {console.error(e); process.exitCode = 1;}).finally(() => {globalThis.fetch = originalFetch;});
