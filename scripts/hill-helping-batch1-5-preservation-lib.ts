import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { ResponseAction } from "../conversation-os/control";
import type { ConversationMessage } from "../conversation-os/types";

export const PRESERVATION_DATASET_PATH = "clinical-evals/hill-helping-batch1-5-preservation.json";

export type PreservationScenario = {
  id: string;
  kind: "emotional_support" | "ordinary_repair";
  userMessage: string;
  recentMessages: ConversationMessage[];
  expectedAction: ResponseAction;
};

export type PreservationDataset = {
  schemaVersion: 1;
  datasetVersion: string;
  status: "frozen_before_candidate_run";
  purpose: string;
  gate: {
    runsPerScenario: 3;
    scenarioCount: 20;
    requiredValidatedRate: 1;
    requiredExpectedActionRate: 1;
    maximumConstraintFailures: 0;
    maximumHelpingProviderCalls: 0;
    maximumRegenerationRate: number;
  };
  scenarios: PreservationScenario[];
};

export const loadPreservationDataset = (path = PRESERVATION_DATASET_PATH) => {
  const source = readFileSync(path);
  const dataset = JSON.parse(source.toString("utf8")) as PreservationDataset;
  if (dataset.schemaVersion !== 1 || dataset.status !== "frozen_before_candidate_run") {
    throw new Error("Batch 1.5 preservation dataset header is invalid.");
  }
  if (dataset.gate.runsPerScenario !== 3 || dataset.gate.scenarioCount !== 20) {
    throw new Error("Batch 1.5 preservation gate size changed after freeze.");
  }
  if (dataset.scenarios.length !== dataset.gate.scenarioCount) {
    throw new Error("Batch 1.5 preservation scenario count is incomplete.");
  }
  const ids = new Set(dataset.scenarios.map((scenario) => scenario.id));
  if (ids.size !== dataset.scenarios.length) throw new Error("Duplicate preservation scenario id.");
  if (dataset.scenarios.filter((scenario) => scenario.kind === "emotional_support").length !== 10) {
    throw new Error("Preservation dataset must contain 10 emotional-support scenarios.");
  }
  if (dataset.scenarios.filter((scenario) => scenario.kind === "ordinary_repair").length !== 10) {
    throw new Error("Preservation dataset must contain 10 ordinary-repair scenarios.");
  }
  return {
    dataset,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
};
