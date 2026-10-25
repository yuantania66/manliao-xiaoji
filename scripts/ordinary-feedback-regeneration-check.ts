import type { OrdinaryRegenerationFeedback } from "../services/ai/responsePlanValidator";
import type { ResponsePlan } from "../conversation-os/control";
type WireMessage = {role:string;content:string};
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enforceResponsePlan, formatResponsePlanRegenerateConstraint } from "../services/ai/responsePlanValidator";
import { generateChatReply } from "../services/ai/aiService";
import { CHAT_PROMPT_VERSION } from "../services/ai/promptBuilder";
const fixture = JSON.parse(readFileSync(new URL("./ordinary-feedback-regeneration-fixture.json", import.meta.url), "utf8"));
const clone = <T>(x: T): T => structuredClone(x);
const failures = ["planned_function_semantic:positive_function_not_satisfied"];
type FeedbackFixture = Omit<typeof import("./ordinary-feedback-regeneration-fixture.json")["feedback"], "ordinaryUseAssessment"> & { ordinaryUseAssessment: { failedFields: string[] | string; uncertainFields: string[]; overallRejected: boolean } | null };
type Case = {name:string;plan:ResponsePlan;failures:string[];feedback:unknown;changes:boolean};
const cases: Case[] = [];
const add = (name: string, patch: Partial<Case> = {}, changes = false) => cases.push({ name, plan: clone(fixture.plan), failures,
  feedback: clone(fixture.feedback), changes, ...patch });
add("confirmed-repeat-none", {}, true); add("no-feedback", { feedback: undefined }); add("null-feedback", { feedback: null });
for (const [name, mutate] of Object.entries({
  "wrong-plan": (f: FeedbackFixture): unknown => f.planId = "wrong-plan", "wrong-kind": (f: FeedbackFixture): unknown => f.kind = "other",
  "empty-candidate": (f: FeedbackFixture): unknown => f.candidateReply = " ",
  "other-response": (f: FeedbackFixture): unknown => f.ordinaryUseObservation = { contentRelation: "other_response", repetitionPurpose: "not_applicable" },
  "purposeful-repetition": (f: FeedbackFixture): unknown => f.ordinaryUseObservation.repetitionPurpose = "understanding_check",
  "uncertain-observation": (f: FeedbackFixture): unknown => f.ordinaryUseAssessment!.uncertainFields = ["contentRelation"],
  "missing-quality-field": (f: FeedbackFixture): unknown => f.ordinaryUseAssessment!.failedFields = [],
  "malformed-assessment": (f: FeedbackFixture): unknown => f.ordinaryUseAssessment = null,
  "malformed-failed-fields": (f: FeedbackFixture): unknown => f.ordinaryUseAssessment!.failedFields = "repetitionPurpose",
})) { const f = clone(fixture.feedback); mutate(f); add(name, { feedback: f }); }
for (const key of ["positive_function_uncertain", "question_count_quality", "binding_mismatch", "evidence_mismatch"])
  add(key, { failures: ["planned_function_semantic:" + key] });
for (const mode of ["none", "optional_after_answer"]) { const plan = clone(fixture.plan); plan.questionPolicy.mode = mode; add("question-policy-" + mode, { plan }, true); }
const idle = clone(fixture.plan); idle.positiveFunctionContract.allowIdle = true; idle.closurePolicy.mode = "allow_idle"; add("trusted-idle-boundary", { plan: idle }, true);
for (const key of ["assistant_grounding:invented_waiting_activity", "assistant_voice:mechanical_receipt_or_presence", "unknown:failure"]) add(key, { failures: [key] });
const other = clone(fixture.plan); other.responseActions = ["repair_previous_wording"]; other.positiveFunctionContract = { action: "repair_previous_wording", repairMode: "proposition_withdrawal", sourceTurnId: "other", targetTurnId: "prior", targetText: "target" }; add("other-action", { plan: other });
// Normalize only the already-approved acknowledgement-only exception in a comparison copy.
const legacySharedGuidance = '不要把“收到、我在、随时都在、记下了”当成完整回复，也不要声称一直在等用户。';
const currentSharedGuidance = '不要把“收到、我在、随时都在、记下了”自动当成完整回复，也不要声称一直在等用户。普通自然回应中，用户明确只需知悉时，简短确认收到可以完成这个要求；不得据此豁免其他已选功能或答复义务。';
const originalFetch = globalThis.fetch;
const envNames = ["AI_PROVIDER", "AI_MAIN_MODEL", "QWEN_BASE_URL", "QWEN_API_KEY", "DASHSCOPE_API_KEY"];
const env = Object.fromEntries(envNames.map(n => [n, process.env[n]]));
let localRequests = 0;
async function main() {
  let unchanged = 0, targeted = 0;
  for (const c of cases) {
    const before = JSON.stringify(c);
    // Deliberately malformed feedback must reach the runtime validator unchanged.
    const output = formatResponsePlanRegenerateConstraint(c.plan, c.failures, c.feedback as OrdinaryRegenerationFeedback | null | undefined);
    const baseline = fixture.baselineCaseOutputs[c.name]; assert.equal(typeof baseline, "string", c.name);
    if (c.changes) { assert.notEqual(output, baseline, c.name + ": target task must replace generic paragraph"); targeted++; }
    else if (c.plan.positiveFunctionContract?.action === "acknowledge_without_psychologizing" && c.failures[0].startsWith("planned_function_semantic:")) {
      assert(output.includes("自然情绪确认"), c.name + ": ordinary regeneration follows the revised acceptance");
      assert(!output.includes("本次校验未确认失败稿"), c.name + ": malformed or unrelated feedback must not select targeted repair"); targeted++;
    } else { assert.equal(output, baseline, c.name + ": unrelated branch must be byte-identical"); unchanged++; }
    assert.equal(JSON.stringify(c), before, c.name + ": input immutable");
  }
  Object.assign(process.env, { AI_PROVIDER: "qwen", AI_MAIN_MODEL: "qwen3.7-max", QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1", QWEN_API_KEY: "offline-only", DASHSCOPE_API_KEY: "" });
  let body: {messages:WireMessage[];max_tokens?:number}|undefined; let generationCallbacks = 0, semanticCallbacks = 0;
  globalThis.fetch = async (url, init) => { assert.equal(String(url), fixture.endpoint); localRequests++; assert.equal(localRequests, 1);
    body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ model: "qwen3.7-max", choices: [{ message: { content: fixture.rejectedCandidate } }] })); };
  const result = await enforceResponsePlan({ plan: fixture.plan, plannedFunctionSemanticContext: fixture.semanticContext,
    plannedFunctionSemanticProvider: async input => { semanticCallbacks++; assert.equal(input.candidateReply, fixture.rejectedCandidate); return clone(fixture.realRejection); },
    generate: async (constraint, plan, feedback) => {
      generationCallbacks++; assert.deepEqual(plan, fixture.plan);
      if (generationCallbacks === 1) { assert.equal(constraint, null); return { text: fixture.rejectedCandidate, rawLLMOutput: fixture.rejectedCandidate,
        model: "qwen3.7-max", promptVersion: CHAT_PROMPT_VERSION, finalReplySource: "llm", latencyMs: 0, postProcessSteps: [] }; }
      assert.equal(generationCallbacks, 2); assert.deepEqual(feedback, fixture.feedback);
      assert.equal(constraint, formatResponsePlanRegenerateConstraint(plan, failures, feedback), "Actual enforcement must pass validated feedback into formatter");
      return generateChatReply({ conversationId: fixture.input.conversationId, userMessage: fixture.input.userMessage, recentMessages: fixture.input.recentMessages,
        memoryContext: null, understandingContext: null, responsePlan: plan, responsePlanRegenerateConstraint: constraint, regenerationFeedback: feedback });
    } });
  assert.equal(result.outcome, "failed", "Fixed rejected local output must remain rejected; this is not model-quality evidence");
  assert.equal(generationCallbacks, 2); assert.equal(semanticCallbacks, 2); assert.equal(localRequests, 1);
  const actual = { ...body!, max_completion_tokens: 4096 }; delete actual.max_tokens;
  const prior = clone(fixture.actualPreviousGenerationRequest);
  const sharedBefore = prior.messages[0].content as string;
  assert.equal(sharedBefore.split(legacySharedGuidance).length, 2, "Frozen shared guidance must contain exactly one known legacy sentence");
  assert.equal(actual.messages[0].content.split(currentSharedGuidance).length, 2, "Actual shared guidance must contain exactly one approved replacement");
  prior.messages[0].content = sharedBefore.replace(legacySharedGuidance, currentSharedGuidance);
  assert.deepEqual(actual.messages[0], prior.messages[0], "Shared developer message changes only the explicit acknowledgement-only exception; factual and other-function boundaries are byte-preserved");
  assert.equal(actual.messages.length, prior.messages.length);
  const differences = actual.messages.flatMap((m: WireMessage, i: number) => JSON.stringify(m) !== JSON.stringify(prior.messages[i]) ? [i] : []);
  assert.deepEqual(differences, [1, 2], "Only ordinary plan guidance and the existing regeneration instruction change");
  const restored = clone(actual);
  for (const index of differences) restored.messages[index] = clone(prior.messages[index]);
  assert.deepEqual(restored, prior);
  assert.equal(actual.messages.at(-1)!.content, fixture.input.userMessage);
  assert(actual.messages.filter((m: WireMessage) => m.role === "system").every((m: WireMessage) => !m.content.includes(fixture.rejectedCandidate)));
  console.log(JSON.stringify({ passed: true, formatterCases: cases.length, unchangedBranches: unchanged, targetedCases: targeted,
    actualRequestChangedMessageIndices: [0, ...differences], sharedGuidanceChangedOnlyByAcknowledgementException: true, savedRealRejectionReplayed: true, localRequests, externalRequests: 0,
    localGenerationRemainsRejected: true, modelQualityEstablished: false }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch;
  for (const n of envNames) { if (env[n] === undefined) delete process.env[n]; else process.env[n] = env[n]; } });
