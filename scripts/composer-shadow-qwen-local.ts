import assert from "node:assert/strict";

import { buildComposerShadowInputFromSnapshotV1, runComposerShadowV1 } from "../lib/composer-shadow-v1";
import { createFrozenV1ObservationSnapshotV1, hashFrozenObservationValue } from "../lib/frozen-v1-observation-snapshot-authority";
import { createV1ExecutionOutcomeIntegrityResultV1 } from "../lib/v1-execution-outcome-integrity-authority";
import { SYNTHETIC_BASELINE_CASES_V1 } from "./hot-cold-p0-frozen-replay";

const main = async () => {
assert(process.argv.includes("--allow-synthetic-qwen"), "Explicit --allow-synthetic-qwen is required; this eval never runs by default.");
const apiKey = process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim();
const baseUrl = process.env.QWEN_BASE_URL?.trim() || process.env.DASHSCOPE_BASE_URL?.trim();
assert(apiKey && baseUrl, "Explicit Qwen credentials and regional base URL are required.");
assert(process.env.COMPOSER_SHADOW_SYNTHETIC_ONLY === "true", "COMPOSER_SHADOW_SYNTHETIC_ONLY=true is required.");

const model = process.env.COMPOSER_SHADOW_QWEN_MODEL?.trim() || "qwen3.7-max";
const baselineCase = SYNTHETIC_BASELINE_CASES_V1.find((item) => item.caseId === "ordinary-first-contact")!;
const snapshot = createFrozenV1ObservationSnapshotV1({ baselineSet: SYNTHETIC_BASELINE_CASES_V1, caseId: baselineCase.caseId, fixtureOwner: "explicit_local_v1_fixture", executionOutcome: createV1ExecutionOutcomeIntegrityResultV1({ resultStatus: "COMMITTED", committedWinnerHash: hashFrozenObservationValue("local-v1-winner"), failureCategory: null, retryable: false, blockingQwenCalls: 1, plannerAttempts: 1, surfaceCandidates: 1, serverElapsedMs: 1, episodeSelectedIdHash: null, committedEdge: null, writeSetHash: hashFrozenObservationValue("local-v1-write-set") }) });
const input = buildComposerShadowInputFromSnapshotV1(snapshot, `local-${Date.now()}`);
const result = await runComposerShadowV1({
  snapshot,
  input,
  clock: { nowMs: () => performance.now() },
  provider: async ({ attempt, priorFailure, signal }) => {
    const prompt = attempt === 1
      ? `Return exact JSON for this synthetic input. No extra keys. Input: ${JSON.stringify(input)}`
      : `Repair to exact composer_shadow_output_v1 JSON. Prior failure: ${priorFailure}. Input: ${JSON.stringify(input)}`;
    const response = await fetch(`${baseUrl!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Request-Tag": "composer-shadow-local-synthetic-v1" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "You are an eval-only Conversation Composer. Return exact JSON only." }, { role: "user", content: prompt }], temperature: 0, stream: false, enable_thinking: false, response_format: { type: "json_object" } }),
    });
    if (!response.ok) throw new Error(`Qwen status ${response.status}`);
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Qwen returned no content");
    return { async *[Symbol.asyncIterator]() { yield content; } };
  },
});
assert(result, "Synthetic ordinary case must invoke Composer Shadow.");

console.log(JSON.stringify({ model, syntheticOnly: true, status: result.invocationStatus, calls: result.calls, outputHash: result.outputHash, timings: result.timings, incrementalTimingEvidence: false, note: "stream:false response; timing is request-level only and cannot satisfy incremental decoder evidence" }, null, 2));
};

void main();
