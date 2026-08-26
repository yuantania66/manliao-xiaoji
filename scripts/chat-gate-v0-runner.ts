import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  CHAT_GATE_V0_DATASET_PATH,
  CHAT_GATE_V0_RUNNER_VERSION,
  loadChatGateDataset,
  normalizeOfficialEntrypointResponse,
  sha256,
  type ChatGateEpisodeRun,
  type ChatGateRunArtifact,
  type OfficialEntrypointTurnResult,
} from "./chat-gate-v0-lib";

loadEnvConfig(process.cwd());

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const side = getArg("side");
const sourceId = getArg("source-id");
const sourceArchiveSha256 = getArg("source-sha256");
const baseUrl = getArg("base-url").replace(/\/+$/u, "");
const outputPath = getArg("output");
const repeatCount = Number.parseInt(getArg("repeat") || "3", 10);
const provider = process.env.AI_PROVIDER?.trim() || "unconfigured";
const model = process.env.AI_MAIN_MODEL?.trim() || "unconfigured";

for (const [field, value] of [
  ["side", side],
  ["source-id", sourceId],
  ["source-sha256", sourceArchiveSha256],
  ["base-url", baseUrl],
  ["output", outputPath],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}
if (!/^https?:\/\/[^/]+(?::\d+)?$/u.test(baseUrl)) {
  throw new Error(`--base-url must contain only an HTTP(S) origin: ${baseUrl}`);
}
if (!/^[a-f0-9]{64}$/u.test(sourceArchiveSha256)) {
  throw new Error("--source-sha256 must be a lowercase SHA-256 digest.");
}
if (repeatCount !== 3) throw new Error("Chat Gate v0 requires --repeat=3.");
if (provider === "unconfigured" || model === "unconfigured") {
  throw new Error("AI_PROVIDER and AI_MAIN_MODEL must be configured.");
}

const dataset = loadChatGateDataset();

const postTurn = async ({
  turnId,
  user,
  recentMessages,
}: {
  turnId: string;
  user: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string; promptVersion?: string | null }>;
}): Promise<OfficialEntrypointTurnResult> => {
  const requestStartedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/chat/guest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-debug-trace": "1",
        "x-forwarded-for": "127.0.0.1",
      },
      body: JSON.stringify({
        turnId,
        content: user,
        recentMessages,
        debugTrace: true,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const bodyText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { nonJsonBody: bodyText };
    }
    const completedAt = new Date().toISOString();
    return {
      turnId,
      user,
      ...normalizeOfficialEntrypointResponse({
        httpStatus: response.status,
        body,
        startedAt: requestStartedAt,
        completedAt,
        latencyMs: Math.round(performance.now() - started),
      }),
    };
  } catch (error) {
    return {
      turnId,
      user,
      startedAt: requestStartedAt,
      completedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      httpStatus: null,
      apiOk: false,
      executionStatus: "transport_error",
      assistantMessage: null,
      systemStatus: null,
      judge: null,
      debugTrace: null,
      rawResponse: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const run = async () => {
  const startedAt = new Date().toISOString();
  const episodeRuns: ChatGateEpisodeRun[] = [];

  for (let runIndex = 1; runIndex <= repeatCount; runIndex += 1) {
    for (const episode of dataset.episodes) {
      const recentMessages: Array<{
        role: "user" | "assistant";
        content: string;
        promptVersion?: string | null;
      }> = [];
      const turns: OfficialEntrypointTurnResult[] = [];

      for (const turn of episode.turns) {
        const turnId = `gate:${side}:${episode.id}:r${runIndex}:${turn.id}`;
        const result = await postTurn({
          turnId,
          user: turn.user,
          recentMessages,
        });
        if (
          (result.executionStatus === "committed" || result.executionStatus === "committed_legacy") &&
          (typeof result.debugTrace !== "object" || result.debugTrace === null)
        ) {
          throw new Error(
            `Committed turn is missing required debug trace: ${episode.id}/run-${runIndex}/${turn.id}`
          );
        }
        turns.push(result);
        recentMessages.push({ role: "user", content: turn.user });
        if (result.assistantMessage) {
          recentMessages.push({
            role: "assistant",
            content: result.assistantMessage.content,
            promptVersion: result.assistantMessage.promptVersion,
          });
        }
      }

      episodeRuns.push({
        episodeId: episode.id,
        category: episode.category,
        targetStatus: episode.targetStatus,
        openInteraction: episode.openInteraction,
        evidenceLimitations: episode.evidenceLimitations,
        runIndex,
        turns,
      });
    }
  }

  const artifact: ChatGateRunArtifact = {
    schemaVersion: 1,
    runnerVersion: CHAT_GATE_V0_RUNNER_VERSION,
    datasetVersion: dataset.datasetVersion,
    datasetSha256: sha256(readFileSync(CHAT_GATE_V0_DATASET_PATH)),
    side,
    sourceId,
    sourceArchiveSha256,
    baseUrl,
    provider,
    model,
    startedAt,
    completedAt: new Date().toISOString(),
    repeatCount,
    officialEntrypoint: "/api/chat/guest",
    evaluationAdapter: "none",
    historyAdapter: "none",
    episodeRuns,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

  const turnResults = episodeRuns.flatMap((episodeRun) => episodeRun.turns);
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        side,
        sourceId,
        datasetVersion: dataset.datasetVersion,
        episodeRuns: episodeRuns.length,
        turns: turnResults.length,
        committed: turnResults.filter(
          (turn) => turn.executionStatus === "committed" || turn.executionStatus === "committed_legacy"
        ).length,
        failed: turnResults.filter(
          (turn) => turn.executionStatus === "failed" || turn.executionStatus === "transport_error"
        ).length,
        provider,
        model,
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
