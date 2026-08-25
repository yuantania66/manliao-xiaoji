import assert from "node:assert/strict";

import { buildComposerShadowInputFromSnapshotV1, hashComposerValue, runComposerShadowV1, type ComposerShadowInputV1, type ShadowProviderV1 } from "../lib/composer-shadow-v1";
import { createFrozenV1ObservationSnapshotV1, hashFrozenObservationValue } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { SYNTHETIC_BASELINE_CASES_V1, SYNTHETIC_BASELINE_SAMPLE_HASH } from "./hot-cold-p0-frozen-replay";

const RUNNER_VERSION = "composer_real_qwen_12x3_runner_mechanism_v1";
const PROMPT_VERSION = "composer_shadow_prompt_v1";
const ORDINARY_CASES = SYNTHETIC_BASELINE_CASES_V1.filter((item) => item.expectedSafetyOwnership === "ordinary");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

type TokenUsage = Readonly<{ promptTokens: number | null; completionTokens: number | null }>;
type ProviderFactory = (input: ComposerShadowInputV1, usage: { value: TokenUsage }) => ShadowProviderV1;

const snapshotFor = (caseId: string) => createFrozenV1ObservationSnapshotV1({
  baselineSet: SYNTHETIC_BASELINE_CASES_V1,
  caseId,
  fixtureOwner: "explicit_local_v1_fixture",
  executionOutcome: createV1ExecutionOutcomeIntegrityResultV1({
    resultStatus: "COMMITTED", committedWinnerHash: hashFrozenObservationValue(`local-v1-winner:${caseId}`),
    failureCategory: null, retryable: false, blockingQwenCalls: 1, plannerAttempts: 1,
    surfaceCandidates: 1, serverElapsedMs: 1, episodeSelectedIdHash: null,
    committedEdge: null, writeSetHash: hashFrozenObservationValue(`local-v1-write-set:${caseId}`),
  }),
});

const validOutputFor = (input: ComposerShadowInputV1) => ({
  schemaVersion: "composer_shadow_output_v1", turnId: input.turnId,
  purpose: "accompany", reply: "这是仅用于本地机制校验的合成回复。",
  episodeRef: null, groundingRefs: [], eventRef: null,
});

const runConfigHashFor = (model: string) => hashComposerValue({
  runnerVersion: RUNNER_VERSION, sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH,
  model, promptVersion: PROMPT_VERSION, schemaVersion: "composer_shadow_output_v1",
  temperature: 0, stream: false, enableThinking: false, responseFormat: "json_object",
});

const runComposer12x3MechanismV1 = async ({ model, evidenceSource, providerFactory }: Readonly<{
  model: string; evidenceSource: "real_qwen" | "injected_mock"; providerFactory: ProviderFactory;
}>) => {
  assert.equal(ORDINARY_CASES.length, 12, "authoritative ordinary case count changed");
  const runConfigHash = runConfigHashFor(model);
  const observations = [];
  for (const baselineCase of ORDINARY_CASES) {
    for (const independentAttempt of [1, 2, 3] as const) {
      const snapshot = snapshotFor(baselineCase.caseId);
      const attemptId = `${baselineCase.caseId}:independent:${independentAttempt}`;
      const input = buildComposerShadowInputFromSnapshotV1(snapshot, hashComposerValue({ runConfigHash, attemptId }));
      const usage = { value: { promptTokens: null, completionTokens: null } as TokenUsage };
      const result = await runComposerShadowV1({ snapshot, input, clock: { nowMs: () => performance.now() }, provider: providerFactory(input, usage) });
      assert(result, "ordinary case must invoke Composer");
      observations.push(Object.freeze({
        caseId: baselineCase.caseId, independentAttempt, attemptIdHash: hashComposerValue(attemptId),
        runConfigHash, invocationStatus: result.invocationStatus, providerCalls: result.calls,
        repairUsed: result.repairUsed, inputHash: hashComposerValue(input), outputHash: result.outputHash,
        replyLength: result.output?.reply.length ?? null, segmentCount: result.timings.segmentCount,
        timings: result.timings, promptTokens: usage.value.promptTokens,
        completionTokens: usage.value.completionTokens,
      }));
    }
  }
  assert.equal(observations.length, 36);
  assert.equal(new Set(observations.map((row) => row.caseId)).size, 12);
  assert.equal(new Set(observations.map((row) => row.attemptIdHash)).size, 36);
  assert(observations.every((row) => row.runConfigHash === runConfigHash && SHA256.test(row.inputHash)));
  return Object.freeze({
    schemaVersion: "composer_real_qwen_12x3_runner_result_v1" as const,
    runnerVersion: RUNNER_VERSION, evidenceSource, sampleSetHash: SYNTHETIC_BASELINE_SAMPLE_HASH,
    runConfigHash, ordinaryCaseCount: 12, independentAttemptsPerCase: 3,
    observationCount: 36, observations: Object.freeze(observations),
    incrementalTimingEvidence: false as const,
    behaviorEvidenceStatus: evidenceSource === "real_qwen" ? "candidate_requires_ledger_authority_validation" as const : "mechanism_only_not_evidence" as const,
  });
};

const realProviderFactory = (apiKey: string, baseUrl: string, model: string): ProviderFactory => (input, usage) => async ({ attempt, priorFailure, signal }) => {
  const prompt = attempt === 1
    ? `Return exact JSON for this synthetic input. No extra keys. Input: ${JSON.stringify(input)}`
    : `Repair to exact composer_shadow_output_v1 JSON. Prior failure: ${priorFailure}. Input: ${JSON.stringify(input)}`;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Request-Tag": "composer-shadow-local-synthetic-12x3-v1" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: "You are an eval-only Conversation Composer. Return exact JSON only." }, { role: "user", content: prompt }], temperature: 0, stream: false, enable_thinking: false, response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`Qwen status ${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen returned no content");
  usage.value = { promptTokens: Number.isInteger(body.usage?.prompt_tokens) ? body.usage!.prompt_tokens! : null, completionTokens: Number.isInteger(body.usage?.completion_tokens) ? body.usage!.completion_tokens! : null };
  return { async *[Symbol.asyncIterator]() { yield content; } };
};

const mockProviderFactory: ProviderFactory = (input, usage) => async () => {
  usage.value = { promptTokens: 10, completionTokens: 8 };
  const content = JSON.stringify(validOutputFor(input));
  return { async *[Symbol.asyncIterator]() { yield content.slice(0, 17); yield content.slice(17); } };
};

const main = async () => {
  const args = process.argv.slice(2);
  assert.equal(args.length, 1, "Exactly one explicit local mode is required.");
  const mechanismOnly = args[0] === "--check-mechanism";
  const realQwen = args[0] === "--allow-synthetic-qwen";
  assert(mechanismOnly || realQwen, "Unknown local runner mode.");
  if (mechanismOnly) {
    const result = await runComposer12x3MechanismV1({ model: "injected-mock", evidenceSource: "injected_mock", providerFactory: mockProviderFactory });
    assert.equal(result.behaviorEvidenceStatus, "mechanism_only_not_evidence");
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const apiKey = process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim();
  const baseUrl = process.env.QWEN_BASE_URL?.trim() || process.env.DASHSCOPE_BASE_URL?.trim();
  assert(apiKey && baseUrl, "Explicit Qwen credentials and regional base URL are required.");
  assert.equal(process.env.COMPOSER_SHADOW_SYNTHETIC_ONLY, "true", "COMPOSER_SHADOW_SYNTHETIC_ONLY=true is required.");
  const model = process.env.COMPOSER_SHADOW_QWEN_MODEL?.trim() || "qwen3.7-max";
  const result = await runComposer12x3MechanismV1({ model, evidenceSource: "real_qwen", providerFactory: realProviderFactory(apiKey, baseUrl, model) });
  console.log(JSON.stringify(result, null, 2));
};

void main();
