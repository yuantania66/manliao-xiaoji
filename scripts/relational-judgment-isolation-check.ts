import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ResponsePlan } from "../conversation-os/control";
import { validatePlannedFunctionSemanticOutput, relationalSemanticValidationMessagesFor, normalizePlannedFunctionSemanticEvidence,
  type PlannedFunctionSemanticProviderInput, type RelationalSolicitationVerdict } from "../services/ai/plannedFunctionSemanticValidator";
const turnId = "isolation-local";
const basePlan = (): ResponsePlan => ({
  planId: "planned-function-plan",
  decisionOwner: "conversation_os.response_planner",
  behaviorSource: "ordinary_conversation",
  planningDepth: "minimal",
  ordinaryPosture: null,
  answerObligations: [],
  disclosureScope: { conversationId: "conversation", turnId },
  correction: null,
  responseActions: [],
  groundingFacts: [],
  requiredDisclosure: [],
  clinicalStrategy: null,
  positiveFunctionContract: null,
  interactionMoveHandoffPlan: null,
  questionPolicy: { mode: "none", reason: "offline semantic gate check" },
  closurePolicy: { mode: "forbid_closure", reason: "offline semantic gate check" },
  tone: ["natural"],
  stance: ["same plan"],
  lengthGuidance: "brief",
  prohibitedClaims: [],
  safetyConstraints: [],
  relevanceProvenance: [],
  evidence: [],
});


async function main() {
const fixture = JSON.parse(readFileSync(new URL("./relational-unknown-solicitation-fixture.json", import.meta.url), "utf8"));
for (const [raw, hash] of [[fixture.original292.requestRaw, fixture.original292.requestSha256], [fixture.original292.responseRaw, fixture.original292.responseSha256]])
  assert.equal(createHash("sha256").update(raw).digest("hex"), hash);
const source = JSON.parse(JSON.parse(fixture.original292.requestRaw).messages.at(-1).content);
const original292 = JSON.parse(JSON.parse(fixture.original292.responseRaw).choices[0].message.content);
const plan = basePlan();
plan.planId = source.planId;
plan.disclosureScope.turnId = source.positiveFunctionBinding.sourceTurnId;
plan.responseActions = ["offer_emotional_support"];
plan.positiveFunctionContract = source.positiveFunctionBinding;
const context = { currentUserText: source.currentUserText, handoffTargetAssistantText: null, priorAssistantTurnAvailable: false, ordinaryRecentMessages: [] };
const input: PlannedFunctionSemanticProviderInput = { ...source };
const quote = (text: string, reason: string) => ({ start: 0, end: text.length, text, reason });
const localFor = (reply: string, solicitation: "present" | "absent" | "uncertain" = "absent"): RelationalSolicitationVerdict => ({
  schemaVersion: 1, planId: plan.planId, solicitation, semanticRequestCount: solicitation === "uncertain" ? null : solicitation === "present" ? 1 : 0, requestedUserAct: solicitation === "present" ? "explain the mismatch" : null,
  explicitRequestException: null, evidence: [quote(reply, "Authored local solicitation observation, not a real model result.")],
});
const remainingFor = (reply: string, failed = false, drift = "none") => {
  const value = structuredClone(original292);
  value.positiveFunction.status = failed ? "not_satisfied" : "satisfied";
  value.positiveFunction.realizedAction = failed ? null : "offer_emotional_support";
  value.positiveFunction.contractRealized = !failed;
  value.positiveFunction.containsContradictoryMove = failed;
  value.positiveFunction.evidence = [quote(reply, failed ? "ES-ACK-BOUNDARY: Authored remaining failure, not solicitation." : "Authored remaining requirements satisfied.")];
  value.positiveFunction.affectObservation.affectDrift = drift;
  value.positiveFunction.affectEvidence = { userSpans: [{ start: 0, end: context.currentUserText.length, text: context.currentUserText }],
    candidateSpans: [{ start: 0, end: reply.length, text: reply }], reason: `${drift}: Authored affect observation independent of solicitation.` };
  return value;
};
const observations: unknown[] = [];
async function check(id: string, remaining: unknown, local: unknown, expectedPass: boolean, expectedReason?: string) {
  const tasks: string[] = [];
  const before = structuredClone(remaining);
  const result = await validatePlannedFunctionSemanticOutput({ plan, reply: source.candidateReply, semanticContext: context,
    provider: async request => {
      tasks.push(request.semanticTask!);
      if (request.semanticTask === "relational_remaining") return { task: "relational_remaining", scopeCompliance: "respected", verdict: remaining };
      return local;
    } });
  assert.equal(result.passed, expectedPass, id);
  if (expectedReason) assert(result.failureReasons.includes(expectedReason), `${id}: ${result.failureReasons}`);
  assert.deepEqual(remaining, before, "Code merge never overwrites original remaining decision.");
  observations.push({ id, passed: result.passed, reasons: result.failureReasons, tasks, evidenceType: "authored local result or labelled original292 replay" });
  return result;
}
const reply = source.candidateReply;
const good = remainingFor(reply);
await check("self-unknown-accepted", good, localFor(reply), true);
const request = await check("actual-request-rejected-independent-of-remaining-pass", good, localFor(reply, "present"), false, "planned_function_semantic:relational_solicitation_not_satisfied");
assert.equal(request.verdict!.positiveFunction!.status, "not_satisfied");
assert(request.verdict!.positiveFunction!.evidence.some(e => e.reason.startsWith("ES-ACK-NO-SOLICIT:")));
await check("absence-cannot-erase-information-boundary-failure", remainingFor(reply, true), localFor(reply), false, "planned_function_semantic:positive_function_not_satisfied");
await check("absence-cannot-erase-affect-failure", remainingFor(reply, false, "added_category"), localFor(reply), false, "planned_function_semantic:positive_function_not_satisfied");
const fabricated = remainingFor(reply, true); fabricated.positiveFunction.evidence[0].reason = "ES-ACK-NO-FABRICATION: Authored unsupported prior speech.";
await check("absence-cannot-erase-fabrication", fabricated, localFor(reply), false);
await check("original292-actual-rejection-is-owned-elsewhere-not-cleared", original292, localFor(reply), false, "planned_function_semantic:relational_remaining_ownership_conflict");
await check("uncertain-is-not-absence", good, localFor(reply, "uncertain"), false, "planned_function_semantic:relational_solicitation_uncertain");
await check("missing-second-result-does-not-pass", good, undefined, false, "planned_function_semantic:relational_solicitation_invalid");
const badEvidence = localFor(reply); badEvidence.evidence[0].end--;
await check("local-position-error-separate-from-semantics", good, badEvidence, false, "planned_function_semantic:relational_solicitation_invalid");
const wrongBinding = structuredClone(good); wrongBinding.planId = "wrong";
await check("wrong-first-binding-stops-before-second-task", wrongBinding, localFor(reply), false, "planned_function_semantic:binding_mismatch");
// Optional read-only evidence replay; raw307 has independent offset errors, then only an analysis copy is normalized.
if (process.env.RELATIONAL_SPLIT_CONTROL) {
  const control = process.env.RELATIONAL_SPLIT_CONTROL;
  const raws = [307, 308].map(sequence => readFileSync(`${control}/raw/${sequence}-response.txt`, "utf8"));
  const [verdict307, verdict308] = raws.map(raw => JSON.parse(JSON.parse(raw).choices[0].message.content));
  const local308Projection = { ...verdict308, semanticRequestCount: 0, explicitRequestException: null };
  await check("original307-unmodified-offset-failure-recorded-separately", verdict307, local308Projection, false, "planned_function_semantic:evidence_mismatch");
  const normalized307 = normalizePlannedFunctionSemanticEvidence(structuredClone(verdict307), reply, context.currentUserText, []);
  await check("original307-analysis-copy-offsets-corrected-still-ownership-conflict", normalized307, local308Projection, false, "planned_function_semantic:relational_remaining_ownership_conflict");
  await check("original308-absence-cannot-clear-original292-fail", original292, local308Projection, false, "planned_function_semantic:relational_remaining_ownership_conflict");
  for (let i = 0; i < raws.length; i++) assert.equal(readFileSync(`${control}/raw/${307+i}-response.txt`, "utf8"), raws[i]);
}
const noScope = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context, provider: async () => original292 });
assert.equal(noScope.passed, false, "Historical standalone output is incomplete, not an automatic local absence.");
const secondFailure = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context, provider: async request => {
  if (request.semanticTask === "relational_remaining") return { task: "relational_remaining", scopeCompliance: "respected", verdict: good };
  throw new Error("synthetic local provider failure");
} });
assert.equal(secondFailure.providerFailure?.call, "relational_solicitation");
assert.deepEqual(secondFailure.verdict, good);
assert(secondFailure.relationalRemainingRaw);
// Existing examples: separately authored act/content observations; no phrase classifier and no claim of real inference.
for (const item of fixture.cases) {
  const variantPlan = structuredClone(plan);
  assert(variantPlan.positiveFunctionContract?.action === "offer_emotional_support");
  variantPlan.positiveFunctionContract.sourceText = item.userText;
  const remaining = remainingFor(item.reply, item.rule !== null && item.rule !== "ES-ACK-NO-SOLICIT", item.drift);
  if (item.rule && item.rule !== "ES-ACK-NO-SOLICIT") remaining.positiveFunction.evidence[0].reason = `${item.rule}: Authored existing-case remaining failure, independent of solicitation.`;
  remaining.positiveFunction.affectEvidence.userSpans = [{ start: 0, end: item.userText.length, text: item.userText }];
  const local = localFor(item.reply, item.solicitation ? "present" : "absent");
  const result = await validatePlannedFunctionSemanticOutput({ plan: variantPlan, reply: item.reply,
    semanticContext: { ...context, currentUserText: item.userText }, provider: async request => request.semanticTask === "relational_remaining"
      ? { task: "relational_remaining", scopeCompliance: "respected", verdict: remaining } : local });
  assert.equal(result.passed, item.expectedPass, item.id);
}
// Authored counterfactual context explicitly asks for a question; it is not a historical model result.
const explicitUser = "你可以问我哪里没对上，我愿意解释。";
const explicitReply = "抱歉没懂你，我现在还不知道差在哪。你愿意说说哪里没对上吗？";
const explicitPlan = structuredClone(plan);
assert(explicitPlan.positiveFunctionContract?.action === "offer_emotional_support");
explicitPlan.positiveFunctionContract.sourceText = explicitUser;
const explicitRemaining = remainingFor(explicitReply);
explicitRemaining.positiveFunction.affectEvidence.userSpans = [{ start: 0, end: explicitUser.length, text: explicitUser }];
const explicit = localFor(explicitReply, "present");
explicit.explicitRequestException = { userEvidence: quote(explicitUser, "User explicitly requests this question."), reason: "The offered question directly answers that explicit request; authored local observation." };
for (const remainingFailure of [false, true]) {
  const value = structuredClone(explicitRemaining);
  if (remainingFailure) { value.positiveFunction.status = "not_satisfied"; value.positiveFunction.contractRealized = false; value.positiveFunction.realizedAction = null;
    value.positiveFunction.evidence[0].reason = "ES-SCOPE: Authored unsupported content independently fails."; }
  const result = await validatePlannedFunctionSemanticOutput({ plan: explicitPlan, reply: explicitReply,
    semanticContext: { ...context, currentUserText: explicitUser }, provider: async request => request.semanticTask === "relational_remaining"
      ? { task: "relational_remaining", scopeCompliance: "respected", verdict: value } : explicit });
  assert.equal(result.passed, !remainingFailure, "Explicit-request exception cannot waive remaining content constraints.");
  assert.equal(result.verdict?.semanticQuestionCount, 1, "Allowed request still contributes to original question policy.");
  assert(result.failureReasons.includes("planned_function_semantic:question_count_quality"), "Preserve original question-count advisory, do not silently waive it.");
}
const multiple = structuredClone(explicit); multiple.semanticRequestCount = 2;
const multipleResult = await validatePlannedFunctionSemanticOutput({ plan: explicitPlan, reply: explicitReply,
  semanticContext: { ...context, currentUserText: explicitUser }, provider: async request => request.semanticTask === "relational_remaining"
    ? { task: "relational_remaining", scopeCompliance: "respected", verdict: { ...explicitRemaining, semanticQuestionCount: 1 } } : multiple });
assert.equal(multipleResult.verdict?.semanticQuestionCount, 3, "Combine all local requests with other remaining requests, never compress present into one.");
const unfoundedException = structuredClone(explicit); unfoundedException.explicitRequestException!.userEvidence.text = "用户没有说过这句话";
const invalidException = await validatePlannedFunctionSemanticOutput({ plan: explicitPlan, reply: explicitReply,
  semanticContext: { ...context, currentUserText: explicitUser }, provider: async request => request.semanticTask === "relational_remaining"
    ? { task: "relational_remaining", scopeCompliance: "respected", verdict: explicitRemaining } : unfoundedException });
assert(invalidException.hardFailureReasons.includes("planned_function_semantic:relational_solicitation_invalid"));
// Actual default provider transport is replaced in memory; no network or real key is used.
const savedFetch = globalThis.fetch;
const keys = ["AI_PROVIDER", "QWEN_API_KEY", "QWEN_BASE_URL", "AI_SEMANTIC_VALIDATOR_MODEL"] as const;
const env = keys.map(key => [key, process.env[key]] as const);
let actualWireCalls = 0;
const wires: unknown[] = [];
try {
  process.env.AI_PROVIDER = "qwen"; process.env.QWEN_API_KEY = "synthetic-isolation-key";
  process.env.QWEN_BASE_URL = "https://synthetic.invalid/compatible-mode/v1"; process.env.AI_SEMANTIC_VALIDATOR_MODEL = "qwen3.7-max";
  let queue: unknown[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://synthetic.invalid/compatible-mode/v1/chat/completions");
    actualWireCalls++; wires.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(queue.shift()) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
  queue = [{ task: "relational_remaining", scopeCompliance: "respected", verdict: good }, localFor(reply)];
  const actual = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context });
  assert.equal(actual.passed, true); assert.equal(actualWireCalls, 2);
  queue = [{ malformed: true }];
  const malformed = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context });
  assert.equal(malformed.passed, false); assert.equal(actualWireCalls, 3, "Bad first task causes no second call or format repair.");
  queue = [{ task: "relational_remaining", scopeCompliance: "respected", verdict: good }, { malformed: true }];
  const malformedLocal = await validatePlannedFunctionSemanticOutput({ plan, reply, semanticContext: context });
  assert.equal(malformedLocal.passed, false); assert.equal(actualWireCalls, 5, "Bad local task causes no repair call.");
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of env) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
assert.equal((wires[0] as { messages: { content: string }[] }).messages[0].content.includes("RELATIONAL REMAINING TASK"), true);
assert.equal((wires[1] as { messages: { content: string }[] }).messages[0].content.includes("Judge only whether candidateReply"), true);
const remainingMessages = relationalSemanticValidationMessagesFor({ ...input, semanticTask: "relational_remaining" });
const localMessages = relationalSemanticValidationMessagesFor({ ...input, semanticTask: "relational_solicitation" });
assert(!remainingMessages[0].content.includes("\nES-ACK-NO-SOLICIT:"));
assert(!remainingMessages[0].content.includes("boundary, solicitation and invented"));
assert(remainingMessages[0].content.includes("Every option, invitation or permission may refer only"));
assert(localMessages[0].content.includes("ES-ACK-NO-SOLICIT:"));
assert(!localMessages[0].content.includes("ES-ACK-NO-FABRICATION"));
assert.equal(JSON.parse(remainingMessages[1].content).candidateReply, JSON.parse(localMessages[1].content).candidateReply);
console.log(JSON.stringify({ status: "PASS_LOCAL_ONLY", observations, existingExampleCount: fixture.cases.length,
  externalCalls: 0, semanticEvidenceLimit: "Authored task decisions test isolation and composition; original292 replay stays rejected. No claim of stable model correction." }, null, 2));

}
void main();
