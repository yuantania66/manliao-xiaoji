import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultPlannedFunctionSemanticProvider, normalizePlannedFunctionSemanticEvidence, validatePlannedFunctionSemanticOutput,
  type PlannedFunctionSemanticVerdict, type OrdinaryPurposeEvidence } from "../services/ai/plannedFunctionSemanticValidator";
import type { ResponsePlan } from "../conversation-os/control";
const saved = JSON.parse(readFileSync(new URL("./ordinary-purpose-evidence-location-fixture.json", import.meta.url), "utf8"));
const contextRecord = JSON.parse(readFileSync(new URL("./ordinary-use-observation-regression-fixture.json", import.meta.url), "utf8"));
const plan = contextRecord.plan as ResponsePlan, context = contextRecord.semanticContext;
const originalFetch = globalThis.fetch;
const names = ["AI_PROVIDER", "AI_MAIN_MODEL", "AI_SEMANTIC_VALIDATOR_MODEL", "QWEN_BASE_URL", "QWEN_API_KEY", "DASHSCOPE_API_KEY"];
const env = Object.fromEntries(names.map(n => [n, process.env[n]]));
let localProviderRequests = 0, sourceCases = 0;
const originalB = JSON.parse(saved.cases.B.providerResponse.choices[0].message.content) as PlannedFunctionSemanticVerdict;
const span = (text: string, source: "current_user" | "history" = "current_user", messageIndex: number | null = null): OrdinaryPurposeEvidence =>
  ({ source, messageIndex, start: 0, end: 25, text });
const locate = (evidence: OrdinaryPurposeEvidence, current = context.currentUserText,
  history: Array<{ role: "user" | "assistant"; content: string }> = []) => {
  const verdict = structuredClone(originalB);
  verdict.positiveFunction!.ordinaryUseObservation!.purposeEvidence = [evidence];
  const before = JSON.stringify(verdict);
  const normalized = normalizePlannedFunctionSemanticEvidence(verdict, saved.cases.B.reply, current, history);
  assert.equal(JSON.stringify(verdict), before, "Raw verdict must remain unchanged");
  sourceCases += 1;
  return normalized;
};
const main = async () => {
  Object.assign(process.env, { AI_PROVIDER: "qwen", AI_MAIN_MODEL: "qwen3.7-max", AI_SEMANTIC_VALIDATOR_MODEL: "qwen3.7-max",
    QWEN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1", QWEN_API_KEY: "offline-only", DASHSCOPE_API_KEY: "" });
  for (const name of ["A", "B"]) {
    let calls = 0; const before = JSON.stringify(saved.cases[name].providerResponse);
    globalThis.fetch = async (url, init) => {
      calls += 1; localProviderRequests += 1;
      assert.equal(calls, 1, "Saved valid unique quotes must not need a format-repair request");
      assert.equal(String(url), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, "qwen3.7-max");
      return new Response(JSON.stringify(saved.cases[name].providerResponse), { status: 200 });
    };
    const result = await validatePlannedFunctionSemanticOutput({ plan, reply: saved.cases[name].reply, semanticContext: context,
      provider: async input => defaultPlannedFunctionSemanticProvider(input) });
    assert.equal(calls, 1, name + ": no schema repair"); assert.equal(result.providerFailure, undefined, name);
    assert(result.verdict, name); assert.equal(result.passed, false, name);
    if (name === "B") assert(result.hardFailureReasons.includes("planned_function_semantic:positive_function_uncertain"),
      "Location normalization is valid, but the saved legacy other_response has no use comparison; this is not semantic improvement evidence");
    if (name === "A") assert.deepEqual(result.failureReasons, ["planned_function_semantic:positive_function_not_satisfied"]);
    else { const located = result.verdict.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0];
      assert.equal(located.end, 33); assert.equal(located.text, context.currentUserText); }
    assert.equal(JSON.stringify(saved.cases[name].providerResponse), before);
  }
  const full = locate(span(context.currentUserText)); assert(full);
  assert.equal(full.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0].end, 33);
  assert.equal(originalB.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0].end, 25);
  const history: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: "先不要问细节。" }, { role: "assistant", content: "先不要问细节。" } ];
  const historical = locate(span(history[0].content, "history", 0), context.currentUserText, history); assert(historical);
  assert.equal(historical.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0].end, history[0].content.length);
  assert.equal(locate(span(history[1].content, "history", 1), context.currentUserText, history), null, "Assistant is not User evidence");
  assert.equal(locate(span(history[0].content, "history", 9), context.currentUserText, history), null, "Do not search another index");
  assert.equal(locate(span(history[0].content), context.currentUserText, history), null, "Do not fall back to history");
  assert.equal(locate(span(context.currentUserText, "history", 0), context.currentUserText, history), null, "Do not fall back to current User");
  assert.equal(locate(span("没有出现过的原文")), null);
  assert.equal(locate({ ...span("难堪"), end: 2 }, "难堪，难堪"), null, "Even exact offsets cannot disambiguate repeated text");
  const emoji = locate(span("我只是想说一下。"), "😔我只是想说一下。"); assert(emoji);
  assert.equal(emoji.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0].start, 2, "UTF-16 offset includes surrogate pair");
  assert.equal(locate(span("我只是想说一下。"), "我只是想说一下。又说我只是想说一下。"), null);
  assert.equal(normalizePlannedFunctionSemanticEvidence(originalB, saved.cases.B.reply), null, "No User source cannot locate purpose evidence");
  const wrongText = structuredClone(originalB); wrongText.positiveFunction!.ordinaryUseObservation!.purposeEvidence[0].text = "这是伪造的用户原话。";
  assert.equal(normalizePlannedFunctionSemanticEvidence(wrongText, saved.cases.B.reply, context.currentUserText, []), null);
  console.log(JSON.stringify({ passed: true, savedRealDefaultProviderReplays: 2, localProviderRequests, sourceCases,
    externalRequests: 0, rawResponsesUnchanged: true, savedARejectedForRepetition: true, savedBLocatedButLegacyUseUnproven: true,
    modelRecognitionOrGenerationAccuracyEstablished: false }));
};
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const n of names) { if (env[n] === undefined) delete process.env[n]; else process.env[n] = env[n]; }
});
