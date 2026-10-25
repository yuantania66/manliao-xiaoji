import type { PlannedFunctionSemanticContext, OrdinaryUseObservation } from "../services/ai/plannedFunctionSemanticValidator";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultPlannedFunctionSemanticProvider, validatePlannedFunctionSemanticOutput, type PlannedFunctionSemanticVerdict } from "../services/ai/plannedFunctionSemanticValidator";
import type { ResponsePlan } from "../conversation-os/control";
const record = JSON.parse(readFileSync(new URL("./ordinary-use-observation-regression-fixture.json", import.meta.url), "utf8"));
const original = record.originalVerdict as PlannedFunctionSemanticVerdict;
const plan = record.plan as ResponsePlan;
const initialContext = record.semanticContext;
const fetchBefore = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = async () => { externalAttempts += 1; throw new Error("External requests forbidden in local regression"); };
const quote = (text: string, source = "current_user", messageIndex: number | null = null, start = 0, end = text.length) =>
  ({ source, messageIndex, start, end, text: text.slice(start, end) });
const observation = (contentRelation: string, repetitionPurpose = "not_applicable", purposeEvidence: unknown[] = []) =>
  ({ contentRelation, repetitionPurpose, purposeEvidence });
const makeVerdict = (reply: string, obs: unknown, targetPlan = plan): PlannedFunctionSemanticVerdict => {
  const v = structuredClone(original) as PlannedFunctionSemanticVerdict & {positiveFunction: NonNullable<PlannedFunctionSemanticVerdict["positiveFunction"]>};
  const contract = targetPlan.positiveFunctionContract;
  assert(contract?.action === "acknowledge_without_psychologizing");
  v.planId = targetPlan.planId;
  v.positiveFunction.binding = { action: contract.action, sourceTurnId: contract.sourceTurnId,
    allowIdle: contract.allowIdle, ...(contract.responseFunction ? { responseFunction: contract.responseFunction } : {}) };
  v.positiveFunction.evidence = [{ start: 0, end: reply.length, text: reply,
    reason: "Human-labelled observation fixture. Tests code consumption, not model observation accuracy." }];
  // Keep the model's original satisfied booleans, deliberately contradicting negative observations.
  // Deliberately malformed observer payloads exercise the parser boundary.
  v.positiveFunction.ordinaryUseObservation = obs as OrdinaryUseObservation;
  // Explicitly fixed transport labels; not evidence of model semantic accuracy.
  if ((obs as OrdinaryUseObservation).contentRelation === "other_response") {
    v.positiveFunction.ordinaryUseObservation.useComparison = {
      userMeaning: "Fixed local fixture source context.", candidateAct: "Fixed local fixture supported conversational act.",
      candidateEvidenceIndices: [0], relation: "supported_conversational_act",
    };
  }
  return v;
};
const rebind = (user: string, allowIdle = false) => {
  const p = structuredClone(plan);
  assert(p.positiveFunctionContract?.action === "acknowledge_without_psychologizing");
  p.positiveFunctionContract.sourceText = user;
  p.positiveFunctionContract.allowIdle = allowIdle;
  p.closurePolicy.mode = allowIdle ? "allow_idle" : plan.closurePolicy.mode;
  return { plan: p, context: { currentUserText: user, handoffTargetAssistantText: null, ordinaryRecentMessages: [] } };
};
let checked = 0;
const check = async (name: string, verdict: unknown, expected: boolean, opts: {
  plan?: ResponsePlan; reply?: string; context?: PlannedFunctionSemanticContext; malformed?: boolean; uncertain?: boolean;
} = {}) => {
  let calls = 0;
  const result = await validatePlannedFunctionSemanticOutput({ plan: opts.plan ?? plan, reply: opts.reply ?? record.reply,
    semanticContext: opts.context ?? initialContext, provider: async () => { calls += 1; return verdict; } });
  assert.equal(calls, 1, name);
  assert.equal(result.providerFailure, undefined, name + ": must not pass a rejection via provider exception");
  assert.equal(result.passed, expected, name);
  if (opts.malformed) assert(result.failureReasons.some(x => x.includes("malformed_verdict")), name);
  else if (!expected && !opts.uncertain) assert(result.verdict, name + ": observation must be parsed before code rejection");
  if (opts.uncertain) assert(result.hardFailureReasons.some(x => x.includes("uncertain")), name);
  checked += 1;
  return result;
};
const main = async () => {
  // Capture the actual provider prompt; assertions stay outside the provider so an
  // intentional inspection stop cannot masquerade as a passing assertion.
  let capturedMessages: Array<{ role: string; content: string }> | undefined;
  let captureCount = 0;
  await validatePlannedFunctionSemanticOutput({ plan, reply: record.reply, semanticContext: initialContext,
    provider: async input => defaultPlannedFunctionSemanticProvider(input, ({ messages }) => {
      capturedMessages = messages; captureCount += 1;
      throw new Error("LOCAL_PROMPT_CAPTURE_ONLY");
    }) });
  assert.equal(captureCount, 1);
  assert(capturedMessages);
  const promptData = JSON.parse(capturedMessages[1].content);
  assert.deepEqual(Object.keys(promptData.outputSchema.positiveFunction), [
    "binding", "ordinaryUseObservation", "status", "realizedAction", "targetAddressed",
    "contractRealized", "containsContradictoryMove", "evidence",
  ], "The ordinary observation must precede the overall verdict in the actual output example");
  await check("saved-original-verdict-missing-observation", original, false, { malformed: true });
  const conflict = makeVerdict(record.reply, observation("repeats_or_normalizes_only", "none"));
  const failed = await check("new-live-paraphrase-satisfied-conflicts-with-observation", conflict, false);
  assert.equal(failed.verdict?.positiveFunction?.status, "satisfied");
  assert(failed.hardFailureReasons.includes("planned_function_semantic:positive_function_not_satisfied"));
  const olderReply = "问题归问题，但被当众点出来确实让人难堪，这种感受很正常。";
  await check("older-normalization-also-rejected", makeVerdict(olderReply, observation("repeats_or_normalizes_only", "none")), false, { reply: olderReply });
  await check("repetition-purpose-not-applicable-is-inconsistent", makeVerdict(record.reply,
    observation("repeats_or_normalizes_only", "not_applicable")), false);
  await check("other-response-cannot-use-repetition-purpose", makeVerdict(record.reply,
    observation("other_response", "understanding_check", [quote(initialContext.currentUserText)])), false);
  await check("other-response-needs-context-evidence", makeVerdict(record.reply, observation("other_response")), false);
  await check("uncertain-content-is-not-satisfied", makeVerdict(record.reply,
    observation("uncertain", "not_applicable")), false, { uncertain: true });
  await check("uncertain-purpose-is-not-satisfied", makeVerdict(record.reply,
    observation("repeats_or_normalizes_only", "uncertain")), false, { uncertain: true });
  const permittedReply = "承认这处疏忽，不意味着你就得接受被当众批评的方式。";
  await check("grounded-permission-no-question", makeVerdict(permittedReply,
    observation("other_response", "not_applicable", [quote(initialContext.currentUserText)])), true, { reply: permittedReply });
  const refused = rebind("先不用问，我只是说一下。");
  const refusalReply = "好，先不问细节。";
  await check("respecting-boundary-is-not-a-bare-receipt", makeVerdict(refusalReply,
    observation("other_response", "not_applicable", [quote(refused.context.currentUserText)]), refused.plan), true,
    { ...refused, reply: refusalReply });
  const idle = rebind("事情已经处理好了，你知道就行。", true);
  await check("trusted-idle-receipt", makeVerdict("好。", observation("receipt_only"), idle.plan), true,
    { ...idle, reply: "好。" });
  await check("no-self-authorized-idle", makeVerdict("好。", observation("receipt_only")), false, { reply: "好。" });
  const unclear = rebind("我想表达的是，认疏忽和对批评方式有意见是两回事，我怕没说清楚。");
  const confirmation = "你是在区分工作上的疏忽和对批评方式的意见。";
  await check("context-can-make-confirmation-useful", makeVerdict(confirmation,
    observation("repeats_or_normalizes_only", "understanding_check", [quote(unclear.context.currentUserText)]), unclear.plan), true,
    { ...unclear, reply: confirmation });
  await check("purpose-label-without-evidence-cannot-authorize-repetition", makeVerdict(record.reply,
    observation("repeats_or_normalizes_only", "understanding_check")), false);
  const complex = rebind("昨天邮件很多，今天开会也很赶，我把附件忘了。上班路上又堵车，会上还提了另一件事。我说得有点乱。");
  const organized = "你说了工作上漏看附件，以及开会上还提了另一件事。";
  await check("organizing-is-not-forbidden-by-a-phrase-list", makeVerdict(organized,
    observation("repeats_or_normalizes_only", "organizing", [quote(complex.context.currentUserText)]), complex.plan), true,
    { ...complex, reply: organized });
  const history = { ...initialContext, ordinaryRecentMessages: [
    { role: "user", content: "先别分析原因。" }, { role: "assistant", content: "这句不能当作用户用途证据。" } ] };
  await check("bounded-user-history-evidence", makeVerdict(permittedReply,
    observation("other_response", "not_applicable", [quote(history.ordinaryRecentMessages[0].content, "history", 0)])), true,
    { context: history, reply: permittedReply });
  for (const [name, span] of [
    ["assistant-history-is-not-user-evidence", quote(history.ordinaryRecentMessages[1].content, "history", 1)],
    ["history-index-outside-supplied-context", quote("不存在", "history", 9)],
    ["source-text-mismatch", { ...quote(initialContext.currentUserText), text: "伪造用途" }],
    ["offset-outside-current-source", { ...quote(initialContext.currentUserText), end: 9999 }],
  ] as const) await check(name, makeVerdict(permittedReply, observation("other_response", "not_applicable", [span])), false,
    { context: history, reply: permittedReply });
  const emoji = rebind("😔我只是想把经过理清。");
  const natural = "不用一次整理完。";
  await check("utf16-purpose-span", makeVerdict(natural,
    observation("other_response", "not_applicable", [quote(emoji.context.currentUserText, "current_user", null, 2)]), emoji.plan), true,
    { ...emoji, reply: natural });
  const wrongOffset = { ...quote(emoji.context.currentUserText, "current_user", null, 2), start: 1 };
  await check("utf16-split-surrogate-offset-rejected", makeVerdict(natural,
    observation("other_response", "not_applicable", [wrongOffset]), emoji.plan), false, { ...emoji, reply: natural });
  for (const bad of [
    { ...observation("other_response"), extra: true },
    observation("pretend_success"),
    { ...observation("other_response"), purposeEvidence: "not an array" },
  ]) await check("strict-observation-schema", makeVerdict(record.reply, bad), false, { malformed: true });
  const badCandidateEvidence = makeVerdict(permittedReply, observation("other_response", "not_applicable", [quote(initialContext.currentUserText)]));
  badCandidateEvidence.positiveFunction!.evidence[0].text = "不是候选原文";
  await check("existing-candidate-evidence-remains-enforced", badCandidateEvidence, false, { reply: permittedReply });
  const nonconformant = makeVerdict(permittedReply, observation("other_response", "not_applicable", [quote(initialContext.currentUserText)]));
  nonconformant.positiveFunction!.containsContradictoryMove = true;
  await check("use-observation-does-not-override-other-boundaries", nonconformant, false, { reply: permittedReply });
  const noQuestion = structuredClone(plan); noQuestion.questionPolicy.mode = "none";
  const question = "你当时怎么应对的？";
  const questionVerdict = makeVerdict(question, observation("other_response", "not_applicable", [quote(initialContext.currentUserText)]), noQuestion);
  questionVerdict.semanticQuestionCount = 1;
  await check("observation-does-not-grant-question-permission", questionVerdict, false, { plan: noQuestion, reply: question });
  assert.equal(externalAttempts, 0);
  console.log(JSON.stringify({ passed: true, cases: checked, externalRequests: 0, originalRawVerdictPreserved: true, ordinaryObservationBeforeOverall: true,
    originalModelSatisfiedCannotOverrideReportedRepetition: true, evidenceSource: "saved live verdict plus explicitly human-labelled local observations", modelObservationAccuracyEstablished: false }));
};
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { globalThis.fetch = fetchBefore; });
