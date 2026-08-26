import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CHAT_GATE_V0_DATASET_PATH = "clinical-evals/chat-gate-v0.json";
export const CHAT_GATE_V0_RUNNER_VERSION = "chat-gate-v0-official-entrypoint-runner-v1";

export type ChatGateTurn = {
  id: string;
  user: string;
  observedAssistant: string;
};

export type ChatGateEpisode = {
  id: string;
  category: string;
  sourceKind: "screenshot_confirmed";
  capturedAt: string;
  captureEnvironment: string;
  targetStatus: "target" | "non_target" | "evidence_limited";
  openInteraction: boolean;
  evidenceLimitations: string[];
  turns: ChatGateTurn[];
};

export type ChatGateDataset = {
  schemaVersion: 1;
  datasetVersion: string;
  status: "provisional";
  sourceDocument: string;
  limitations: string[];
  episodes: ChatGateEpisode[];
  gateContract: {
    runsPerSide: number;
    episodeRunsPerSide: number;
    criticalFailureMaximum: number;
    absolutePassMinimumByEpisode: number;
    absolutePassMinimumTotal: number;
    appropriateConversationOutcomeMinimum: number;
    clearlyWorseThanBaselineMaximum: number;
    targetBetterThanBaselineMinimumByEpisode: number;
    nonTargetNotWorseMinimumByEpisode: number;
    wouldContinueAppliesOnlyWhenOpenInteraction: boolean;
    criticalFailures: string[];
  };
};

export type OfficialEntrypointTurnResult = {
  turnId: string;
  user: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  apiOk: boolean;
  executionStatus: "committed" | "committed_legacy" | "failed" | "transport_error";
  assistantMessage: {
    id: string;
    role: string;
    content: string;
    createdAt: string | null;
    promptVersion: string | null;
  } | null;
  systemStatus: unknown;
  judge: unknown;
  debugTrace: unknown;
  rawResponse: unknown;
  error: string | null;
};

export type ChatGateEpisodeRun = {
  episodeId: string;
  category: string;
  targetStatus: ChatGateEpisode["targetStatus"];
  openInteraction: boolean;
  evidenceLimitations: string[];
  runIndex: number;
  turns: OfficialEntrypointTurnResult[];
};

export type ChatGateRunArtifact = {
  schemaVersion: 1;
  runnerVersion: string;
  datasetVersion: string;
  datasetSha256: string;
  side: string;
  sourceId: string;
  sourceArchiveSha256: string;
  baseUrl: string;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  repeatCount: number;
  officialEntrypoint: "/api/chat/guest";
  evaluationAdapter: "none";
  historyAdapter: "none";
  episodeRuns: ChatGateEpisodeRun[];
};

const assertString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
};

const assertStringArray = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array.`);
  }
};

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export const loadChatGateDataset = (path = CHAT_GATE_V0_DATASET_PATH): ChatGateDataset => {
  const source = readFileSync(path);
  const dataset = JSON.parse(source.toString("utf8")) as ChatGateDataset;
  if (dataset.schemaVersion !== 1 || dataset.status !== "provisional") {
    throw new Error("Chat Gate v0 dataset header is invalid.");
  }
  assertString(dataset.datasetVersion, "datasetVersion");
  assertString(dataset.sourceDocument, "sourceDocument");
  assertStringArray(dataset.limitations, "limitations");
  if (!Array.isArray(dataset.episodes) || dataset.episodes.length !== 4) {
    throw new Error("Chat Gate v0 requires exactly four independent captured episodes.");
  }

  const episodeIds = new Set<string>();
  for (const episode of dataset.episodes) {
    assertString(episode.id, "episode.id");
    if (episodeIds.has(episode.id)) throw new Error(`Duplicate episode id: ${episode.id}`);
    episodeIds.add(episode.id);
    if (episode.sourceKind !== "screenshot_confirmed") {
      throw new Error(`${episode.id} is not screenshot-confirmed.`);
    }
    if (
      episode.targetStatus !== "target" &&
      episode.targetStatus !== "non_target" &&
      episode.targetStatus !== "evidence_limited"
    ) {
      throw new Error(`${episode.id} has an unsupported targetStatus.`);
    }
    assertStringArray(episode.evidenceLimitations, `${episode.id}.evidenceLimitations`);
    if (!Array.isArray(episode.turns) || episode.turns.length < 1) {
      throw new Error(`${episode.id} must contain at least one turn.`);
    }
    const turnIds = new Set<string>();
    for (const turn of episode.turns) {
      assertString(turn.id, `${episode.id}.turn.id`);
      assertString(turn.user, `${episode.id}/${turn.id}.user`);
      assertString(turn.observedAssistant, `${episode.id}/${turn.id}.observedAssistant`);
      if (turnIds.has(turn.id)) throw new Error(`Duplicate turn id: ${episode.id}/${turn.id}`);
      turnIds.add(turn.id);
    }
  }

  if (dataset.gateContract.runsPerSide !== 3) {
    throw new Error("Chat Gate v0 requires exactly three runs per side.");
  }
  if (dataset.gateContract.episodeRunsPerSide !== dataset.episodes.length * dataset.gateContract.runsPerSide) {
    throw new Error("episodeRunsPerSide does not match episodes × runsPerSide.");
  }
  assertStringArray(dataset.gateContract.criticalFailures, "gateContract.criticalFailures");
  return dataset;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export const normalizeOfficialEntrypointResponse = ({
  httpStatus,
  body,
  startedAt,
  completedAt,
  latencyMs,
}: {
  httpStatus: number;
  body: unknown;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
}): Omit<OfficialEntrypointTurnResult, "turnId" | "user"> => {
  const envelope = asRecord(body);
  const apiOk = envelope?.ok === true;
  const data = asRecord(envelope?.data);
  const assistant = asRecord(data?.assistantMessage);
  const declaredStatus = data?.status;
  const committed =
    apiOk &&
    assistant !== null &&
    typeof assistant.content === "string" &&
    assistant.content.trim().length > 0;
  const acceptedAssistant = committed && declaredStatus !== "failed";
  const executionStatus =
    declaredStatus === "failed"
      ? "failed"
      : acceptedAssistant
        ? declaredStatus === "committed"
          ? "committed"
          : "committed_legacy"
        : "failed";

  return {
    startedAt,
    completedAt,
    latencyMs,
    httpStatus,
    apiOk,
    executionStatus,
    assistantMessage: acceptedAssistant
      ? {
          id: typeof assistant.id === "string" ? assistant.id : "",
          role: typeof assistant.role === "string" ? assistant.role : "",
          content: (assistant.content as string).trim(),
          createdAt: typeof assistant.createdAt === "string" ? assistant.createdAt : null,
          promptVersion: typeof assistant.promptVersion === "string" ? assistant.promptVersion : null,
        }
      : null,
    systemStatus: data?.systemStatus ?? null,
    judge: data?.judge ?? null,
    debugTrace: data?.debugTrace ?? null,
    rawResponse: body,
    error: executionStatus === "failed"
      ? apiOk
        ? "Official entrypoint returned a failed execution without Assistant dialogue."
        : "Official entrypoint returned an API error."
      : null,
  };
};

export const readChatGateRunArtifact = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as ChatGateRunArtifact;
