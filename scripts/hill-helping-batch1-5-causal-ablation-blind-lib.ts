import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  loadCausalAblationDataset,
  readCausalAblationRunArtifact,
  type CausalAblationRunArtifact,
} from "./hill-helping-batch1-5-causal-ablation-lib";

export type CausalAblationBlindReview = {
  schemaVersion: 1;
  experimentVersion: string;
  reviewType: "single_response_five_arm_randomized";
  keyCommitment: string;
  resultArtifactCommitment: string;
  reviewContract: {
    metrics: string[];
    failureCategories: string[];
    instruction: string;
  };
  items: Array<{
    reviewId: string;
    context: {
      recentMessages: Array<{ role: string; content: string }>;
      userMessage: string;
    };
    assistantResponse: string;
  }>;
};

export type CausalAblationBlindKey = {
  schemaVersion: 1;
  experimentVersion: string;
  resultArtifactCommitment: string;
  configSha256: string;
  sourceDatasetSha256: string;
  items: Array<{
    reviewId: string;
    resultId: string;
    scenarioId: string;
    armId: string;
    repetition: number;
  }>;
};

export type CausalAblationAdjudicationTemplate = {
  schemaVersion: 1;
  experimentVersion: string;
  reviewedBeforeKeyRead: false;
  reviewer: "";
  keyCommitment: string;
  reviews: Array<{
    reviewId: string;
    functionalPass: null;
    appropriateConversationOutcome: null;
    wouldContinue: null;
    failureCategories: string[];
    notes: string;
  }>;
};

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const shuffled = <T>(items: T[], selectIndex: (upperExclusive: number) => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = selectIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index) {
      throw new Error("Blind-pack random index is out of range.");
    }
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
};

const assertArtifactMatchesExperiment = (
  artifact: CausalAblationRunArtifact,
  experimentVersion: string,
  configSha256: string,
  sourceDatasetSha256: string,
  expectedCells: string[]
) => {
  if (artifact.schemaVersion !== 1) throw new Error("Causal ablation result schema is invalid.");
  if (artifact.experimentVersion !== experimentVersion) {
    throw new Error("Causal ablation result experiment version is invalid.");
  }
  if (artifact.configSha256 !== configSha256 || artifact.sourceDatasetSha256 !== sourceDatasetSha256) {
    throw new Error("Causal ablation result commitments do not match the frozen experiment.");
  }
  const expectedRows = expectedCells.length;
  if (
    artifact.summary.expectedRows !== expectedRows ||
    artifact.summary.recordedRows !== expectedRows ||
    artifact.rows.length !== expectedRows
  ) {
    throw new Error("Causal ablation result is incomplete.");
  }
  if (artifact.rows.some((row) => row.executionStatus !== "completed" || !row.responseText.trim())) {
    throw new Error("Blind review requires a completed response in every cell.");
  }
  if (new Set(artifact.rows.map((row) => row.resultId)).size !== artifact.rows.length) {
    throw new Error("Causal ablation result ids are not unique.");
  }
  const actualCells = artifact.rows.map(
    (row) => `${row.scenarioId}:${row.armId}:${row.repetition}`
  );
  if (
    new Set(actualCells).size !== actualCells.length ||
    !expectedCells.every((cell) => actualCells.includes(cell))
  ) {
    throw new Error("Causal ablation result cells are incomplete or duplicated.");
  }
};

export const buildCausalAblationBlindPack = ({
  resultPath,
  configPath,
  selectIndex = (upperExclusive) => randomInt(upperExclusive),
}: {
  resultPath: string;
  configPath?: string;
  selectIndex?: (upperExclusive: number) => number;
}) => {
  const experiment = loadCausalAblationDataset(configPath);
  const resultSource = readFileSync(resultPath);
  const artifact = readCausalAblationRunArtifact(resultPath);
  const expectedCells = experiment.scenarios.flatMap((scenario) =>
    experiment.config.arms.flatMap((arm) =>
      Array.from(
        { length: experiment.config.repetitionsPerCell },
        (_, index) => `${scenario.id}:${arm.id}:${index + 1}`
      )
    )
  );
  assertArtifactMatchesExperiment(
    artifact,
    experiment.config.experimentVersion,
    experiment.sha256,
    experiment.datasetSha256,
    expectedCells
  );
  const scenarios = new Map(experiment.scenarios.map((scenario) => [scenario.id, scenario]));
  const ordered = shuffled(artifact.rows, selectIndex);
  const key: CausalAblationBlindKey = {
    schemaVersion: 1,
    experimentVersion: experiment.config.experimentVersion,
    resultArtifactCommitment: sha256(resultSource),
    configSha256: experiment.sha256,
    sourceDatasetSha256: experiment.datasetSha256,
    items: ordered.map((row, index) => ({
      reviewId: `CA${String(index + 1).padStart(3, "0")}`,
      resultId: row.resultId,
      scenarioId: row.scenarioId,
      armId: row.armId,
      repetition: row.repetition,
    })),
  };
  const keySource = `${JSON.stringify(key, null, 2)}\n`;
  const keyCommitment = sha256(keySource);
  const review: CausalAblationBlindReview = {
    schemaVersion: 1,
    experimentVersion: experiment.config.experimentVersion,
    reviewType: "single_response_five_arm_randomized",
    keyCommitment,
    resultArtifactCommitment: key.resultArtifactCommitment,
    reviewContract: {
      metrics: [...experiment.config.humanReview.metrics],
      failureCategories: [...experiment.config.humanReview.failureCategories],
      instruction:
        "Judge only the visible context and response. Complete all reviews and freeze the adjudication before reading the key.",
    },
    items: ordered.map((row, index) => {
      const scenario = scenarios.get(row.scenarioId);
      if (!scenario) throw new Error(`Blind pack references unknown scenario: ${row.scenarioId}`);
      return {
        reviewId: `CA${String(index + 1).padStart(3, "0")}`,
        context: {
          recentMessages: scenario.recentMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          userMessage: scenario.userMessage,
        },
        assistantResponse: row.responseText,
      };
    }),
  };
  const adjudication: CausalAblationAdjudicationTemplate = {
    schemaVersion: 1,
    experimentVersion: experiment.config.experimentVersion,
    reviewedBeforeKeyRead: false,
    reviewer: "",
    keyCommitment,
    reviews: review.items.map((item) => ({
      reviewId: item.reviewId,
      functionalPass: null,
      appropriateConversationOutcome: null,
      wouldContinue: null,
      failureCategories: [],
      notes: "",
    })),
  };
  const reviewSource = `${JSON.stringify(review, null, 2)}\n`;
  const adjudicationSource = `${JSON.stringify(adjudication, null, 2)}\n`;
  const forbiddenValues = [
    artifact.sourceId,
    artifact.provider,
    artifact.model,
    ...artifact.armIds,
    ...experiment.config.arms.map((arm) => arm.label),
    ...artifact.rows.map((row) => row.resultId),
    ...experiment.scenarios.map((scenario) => scenario.id),
  ].filter((value) => value.length > 1);
  for (const forbidden of forbiddenValues) {
    if (reviewSource.includes(forbidden)) {
      throw new Error(`Blind review leaks hidden identity: ${forbidden}`);
    }
  }
  return {
    review,
    reviewSource,
    key,
    keySource,
    adjudication,
    adjudicationSource,
    keyCommitment,
  };
};
