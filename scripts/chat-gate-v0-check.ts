import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHAT_GATE_V0_DATASET_PATH,
  loadChatGateDataset,
  normalizeOfficialEntrypointResponse,
  sha256,
} from "./chat-gate-v0-lib";

const dataset = loadChatGateDataset();
assert.equal(dataset.episodes.length, 4);
assert.equal(new Set(dataset.episodes.map((episode) => episode.id)).size, 4);
assert.equal(dataset.gateContract.runsPerSide, 3);
assert.equal(dataset.gateContract.episodeRunsPerSide, 12);
assert.equal(dataset.episodes.flatMap((episode) => episode.turns).length, 6);
assert.equal(dataset.episodes.filter((episode) => episode.targetStatus === "evidence_limited").length, 1);
assert(dataset.limitations.some((limitation) => limitation.includes("No held-out")));
assert(dataset.limitations.some((limitation) => limitation.includes("non-target")));
assert.equal(dataset.episodes.filter((episode) => episode.targetStatus === "target").length, 3);
assert.equal(dataset.episodes.filter((episode) => episode.openInteraction).length, 4);
assert.equal(dataset.gateContract.criticalFailures.length, 8);
assert.equal(sha256(readFileSync(CHAT_GATE_V0_DATASET_PATH)).length, 64);

const normalize = (body: unknown, httpStatus = 200) =>
  normalizeOfficialEntrypointResponse({
    httpStatus,
    body,
    startedAt: "2026-07-30T00:00:00.000Z",
    completedAt: "2026-07-30T00:00:01.000Z",
    latencyMs: 1000,
  });

const validLegacy = normalize({
  ok: true,
  data: {
    assistantMessage: {
      id: "legacy-1",
      role: "assistant",
      content: "我在，刚才那个“1”是有特定意思，还是只是随手发的？",
      createdAt: "2026-07-30T00:00:01.000Z",
      promptVersion: "legacy",
    },
  },
});
assert.equal(validLegacy.executionStatus, "committed_legacy");
assert(validLegacy.assistantMessage);

const validCurrent = normalize({
  ok: true,
  data: {
    status: "committed",
    assistantMessage: {
      id: "current-1",
      role: "assistant",
      content: "我不确定这个“1”代表什么。你想让我怎么理解它？",
      createdAt: "2026-07-30T00:00:01.000Z",
      promptVersion: "current",
    },
  },
});
assert.equal(validCurrent.executionStatus, "committed");
assert(validCurrent.assistantMessage);

const counterexamples: Array<{ name: string; body: unknown; status?: number }> = [
  { name: "explicit failed status", body: { ok: true, data: { status: "failed", systemStatus: { code: "GENERATION_NONCONFORMANT" } } } },
  { name: "failed status with leaked assistant", body: { ok: true, data: { status: "failed", assistantMessage: { content: "internal failure" } } } },
  { name: "api false", body: { ok: false, error: { code: "INTERNAL_ERROR" } }, status: 500 },
  { name: "missing envelope", body: {} },
  { name: "null body", body: null },
  { name: "array body", body: [] },
  { name: "missing data", body: { ok: true } },
  { name: "null data", body: { ok: true, data: null } },
  { name: "missing assistant", body: { ok: true, data: { status: "committed" } } },
  { name: "null assistant", body: { ok: true, data: { assistantMessage: null } } },
  { name: "empty assistant", body: { ok: true, data: { assistantMessage: { content: "" } } } },
  { name: "space assistant", body: { ok: true, data: { assistantMessage: { content: "   " } } } },
  { name: "number assistant", body: { ok: true, data: { assistantMessage: { content: 1 } } } },
  { name: "boolean assistant", body: { ok: true, data: { assistantMessage: { content: true } } } },
  { name: "object assistant content", body: { ok: true, data: { assistantMessage: { content: {} } } } },
  { name: "assistant array", body: { ok: true, data: { assistantMessage: [] } } },
  { name: "wrong ok type", body: { ok: "true", data: { assistantMessage: { content: "reply" } } } },
  { name: "http 429 envelope", body: { ok: false, error: { code: "RATE_LIMITED" } }, status: 429 },
  { name: "http 404 non-json stand-in", body: { nonJsonBody: "not found" }, status: 404 },
  { name: "system status only", body: { ok: true, data: { systemStatus: { message: "请重试" } } } },
  { name: "judge only", body: { ok: true, data: { judge: { passed: true } } } },
  { name: "debug trace only", body: { ok: true, data: { debugTrace: { requestId: "x" } } } },
  { name: "legacy fallback flag only", body: { ok: true, data: { fallbackUsed: true } } },
  { name: "assistant at wrong level", body: { ok: true, assistantMessage: { content: "reply" } } },
];

for (const counterexample of counterexamples) {
  const result = normalize(counterexample.body, counterexample.status);
  assert.equal(result.executionStatus, "failed", `${counterexample.name} must not be accepted as committed`);
  assert.equal(result.assistantMessage, null, `${counterexample.name} must not expose Assistant dialogue`);
}

console.log(
  JSON.stringify(
    {
      datasetVersion: dataset.datasetVersion,
      independentCapturedEpisodes: dataset.episodes.length,
      turnsPerSide: dataset.episodes.flatMap((episode) => episode.turns).length * dataset.gateContract.runsPerSide,
      episodeRunsPerSide: dataset.gateContract.episodeRunsPerSide,
      normalizedLegacyCommitted: validLegacy.executionStatus,
      normalizedCurrentCommitted: validCurrent.executionStatus,
      counterexamples: counterexamples.length,
      realModelCalls: false,
    },
    null,
    2
  )
);
