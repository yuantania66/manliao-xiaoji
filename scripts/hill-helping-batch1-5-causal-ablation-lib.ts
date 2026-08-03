import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";

import type { AiModelMessage, AiProviderResponse } from "../services/ai/types";
import type { ResponsePlan } from "../conversation-os/control";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import {
  loadPreservationDataset,
  type PreservationScenario,
} from "./hill-helping-batch1-5-preservation-lib";

export const CAUSAL_ABLATION_CONFIG_PATH =
  "clinical-evals/hill-helping-batch1-5-causal-ablation.json";

export const CAUSAL_ABLATION_ARM_IDS = ["C", "P", "Q", "S", "A"] as const;
export const CAUSAL_ABLATION_REVIEW_METRICS = [
  "functionalPass",
  "appropriateConversationOutcome",
  "wouldContinue",
] as const;
export const CAUSAL_ABLATION_FAILURE_CATEGORIES = [
  "unknown_content_or_second_topic",
  "unsupported_cause_or_event",
  "generic_normalization",
  "unrequested_pause_or_closure",
  "missing_selected_function",
  "continued_rejected_move",
  "other_contract_failure",
] as const;
export type CausalAblationArmId = (typeof CAUSAL_ABLATION_ARM_IDS)[number];
export type CausalAblationPromptSlot =
  | "production"
  | "oracle_plan"
  | "diagnostic"
  | "surface_control";
export type CausalAblationPlanSource = "production_frozen" | "oracle_frozen";
export type CausalAblationSurfaceMode = "free_text" | "closed_choice";

export type CausalAblationArm = {
  id: CausalAblationArmId;
  label: string;
  planSource: CausalAblationPlanSource;
  promptSlot: CausalAblationPromptSlot;
  surfaceMode: CausalAblationSurfaceMode;
  temperature: number;
  seed: number | null;
};

export type CausalAblationConfig = {
  schemaVersion: 1;
  experimentVersion: string;
  status: "approved_offline_experiment";
  purpose: string;
  sourceDataset: { path: string; sha256: string };
  scenarioIds: string[];
  repetitionsPerCell: number;
  arms: CausalAblationArm[];
  humanReview: {
    metrics: Array<"functionalPass" | "appropriateConversationOutcome" | "wouldContinue">;
    failureCategories: string[];
  };
};

export type CausalAblationInputCase = {
  scenarioId: string;
  productionPlan: Record<string, unknown>;
  oraclePlan: Record<string, unknown>;
  planProjections: { production: string; oracle: string };
  prompts: Record<CausalAblationPromptSlot, AiModelMessage[]>;
  surfaceCandidates: Array<{ id: string; text: string }>;
};

export type CausalAblationInputPack = {
  schemaVersion: 1;
  experimentVersion: string;
  configSha256: string;
  sourceDatasetSha256: string;
  provider: string;
  model: string;
  createdAt: string;
  cases: CausalAblationInputCase[];
};

export type CausalAblationFixtureResponse = {
  scenarioId: string;
  armId: CausalAblationArmId;
  repetition: number;
  text: string;
  model?: string;
  latencyMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
};

export type CausalAblationFixture = {
  schemaVersion: 1;
  experimentVersion: string;
  responses: CausalAblationFixtureResponse[];
};

export type CausalAblationRow = {
  resultId: string;
  scenarioId: string;
  armId: CausalAblationArmId;
  repetition: number;
  planSource: CausalAblationPlanSource;
  planSha256: string;
  promptSlot: CausalAblationPromptSlot;
  promptSha256: string;
  surfaceMode: CausalAblationSurfaceMode;
  sampling: { temperature: number; seed: number | null };
  executionStatus: "completed" | "surface_control_invalid" | "provider_error";
  responseText: string;
  rawModelOutput: string;
  surfaceChoiceId: string | null;
  model: string;
  latencyMs: number;
  tokenInput?: number;
  tokenOutput?: number;
  error: string | null;
};

export type CausalAblationRunArtifact = {
  schemaVersion: 1;
  experimentVersion: string;
  sourceId: string;
  configSha256: string;
  sourceDatasetSha256: string;
  inputPackSha256: string;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  repetitionsPerCell: number;
  scenarioCount: number;
  armIds: CausalAblationArmId[];
  summary: {
    expectedRows: number;
    recordedRows: number;
    completedRows: number;
    invalidSurfaceControls: number;
    providerErrors: number;
  };
  rows: CausalAblationRow[];
};

type ModelExecutor = (input: {
  scenario: PreservationScenario;
  arm: CausalAblationArm;
  repetition: number;
  plan: Record<string, unknown>;
  messages: AiModelMessage[];
  model: string;
  temperature: number;
}) => Promise<AiProviderResponse>;

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const assertNonEmptyString: (
  value: unknown,
  field: string
) => asserts value is string = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
};

const assertSha256: (
  value: unknown,
  field: string
) => asserts value is string = (value, field) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
};

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const arraysEqual = (left: readonly string[], right: readonly unknown[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const shuffle = <T>(items: T[], selectIndex: (upperExclusive: number) => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = selectIndex(index + 1);
    if (!Number.isInteger(other) || other < 0 || other > index) {
      throw new Error("Causal ablation schedule random index is out of range.");
    }
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
};

const validateArm = (value: unknown, index: number): CausalAblationArm => {
  const arm = asRecord(value, `arms[${index}]`);
  if (!CAUSAL_ABLATION_ARM_IDS.includes(arm.id as CausalAblationArmId)) {
    throw new Error(`arms[${index}].id is invalid.`);
  }
  assertNonEmptyString(arm.label, `arms[${index}].label`);
  if (arm.planSource !== "production_frozen" && arm.planSource !== "oracle_frozen") {
    throw new Error(`arms[${index}].planSource is invalid.`);
  }
  if (!["production", "oracle_plan", "diagnostic", "surface_control"].includes(String(arm.promptSlot))) {
    throw new Error(`arms[${index}].promptSlot is invalid.`);
  }
  if (arm.surfaceMode !== "free_text" && arm.surfaceMode !== "closed_choice") {
    throw new Error(`arms[${index}].surfaceMode is invalid.`);
  }
  if (typeof arm.temperature !== "number" || arm.temperature < 0 || arm.temperature > 2) {
    throw new Error(`arms[${index}].temperature is invalid.`);
  }
  if (arm.seed !== null && !Number.isInteger(arm.seed)) {
    throw new Error(`arms[${index}].seed is invalid.`);
  }
  return arm as CausalAblationArm;
};

const assertFrozenArmContract = (arms: CausalAblationArm[]) => {
  const byId = new Map(arms.map((arm) => [arm.id, arm]));
  if (byId.size !== CAUSAL_ABLATION_ARM_IDS.length) {
    throw new Error("The causal ablation must contain exactly five unique arms.");
  }
  const expected: Record<CausalAblationArmId, Partial<CausalAblationArm>> = {
    C: { planSource: "production_frozen", promptSlot: "production", surfaceMode: "free_text", temperature: 0.75 },
    P: { planSource: "oracle_frozen", promptSlot: "oracle_plan", surfaceMode: "free_text", temperature: 0.75 },
    Q: { planSource: "production_frozen", promptSlot: "diagnostic", surfaceMode: "free_text", temperature: 0.75 },
    S: { planSource: "production_frozen", promptSlot: "production", surfaceMode: "free_text", temperature: 0 },
    A: { planSource: "production_frozen", promptSlot: "surface_control", surfaceMode: "closed_choice", temperature: 0.75 },
  };
  for (const id of CAUSAL_ABLATION_ARM_IDS) {
    const arm = byId.get(id);
    if (!arm) throw new Error(`Missing causal ablation arm ${id}.`);
    for (const [field, expectedValue] of Object.entries(expected[id])) {
      if (arm[field as keyof CausalAblationArm] !== expectedValue) {
        throw new Error(`Arm ${id} changed frozen field ${field}.`);
      }
    }
  }
};

export const loadCausalAblationConfig = (path = CAUSAL_ABLATION_CONFIG_PATH) => {
  const source = readFileSync(path);
  const raw = JSON.parse(source.toString("utf8")) as unknown;
  const value = asRecord(raw, "config");
  if (value.schemaVersion !== 1 || value.status !== "approved_offline_experiment") {
    throw new Error("Causal ablation config header is invalid.");
  }
  assertNonEmptyString(value.experimentVersion, "experimentVersion");
  assertNonEmptyString(value.purpose, "purpose");
  const sourceDataset = asRecord(value.sourceDataset, "sourceDataset");
  assertNonEmptyString(sourceDataset.path, "sourceDataset.path");
  assertSha256(sourceDataset.sha256, "sourceDataset.sha256");
  if (!Array.isArray(value.scenarioIds) || value.scenarioIds.length !== 6) {
    throw new Error("Causal ablation requires exactly six diagnostic scenarios.");
  }
  value.scenarioIds.forEach((id, index) => assertNonEmptyString(id, `scenarioIds[${index}]`));
  if (new Set(value.scenarioIds).size !== value.scenarioIds.length) {
    throw new Error("Causal ablation scenario ids must be unique.");
  }
  if (value.repetitionsPerCell !== 5) {
    throw new Error("Causal ablation repetitions changed after approval.");
  }
  if (!Array.isArray(value.arms)) throw new Error("arms must be an array.");
  const arms = value.arms.map(validateArm);
  assertFrozenArmContract(arms);
  const humanReview = asRecord(value.humanReview, "humanReview");
  if (
    !Array.isArray(humanReview.metrics) ||
    !arraysEqual(CAUSAL_ABLATION_REVIEW_METRICS, humanReview.metrics)
  ) {
    throw new Error("humanReview.metrics is invalid.");
  }
  if (
    !Array.isArray(humanReview.failureCategories) ||
    !arraysEqual(CAUSAL_ABLATION_FAILURE_CATEGORIES, humanReview.failureCategories)
  ) {
    throw new Error("humanReview.failureCategories is invalid.");
  }
  const config = value as unknown as CausalAblationConfig;
  return { config: { ...config, arms }, sha256: sha256(source), source };
};

export const loadCausalAblationDataset = (
  configPath = CAUSAL_ABLATION_CONFIG_PATH
) => {
  const loadedConfig = loadCausalAblationConfig(configPath);
  const { dataset, sha256: datasetSha256 } = loadPreservationDataset(
    loadedConfig.config.sourceDataset.path
  );
  if (datasetSha256 !== loadedConfig.config.sourceDataset.sha256) {
    throw new Error("Causal ablation source dataset SHA-256 mismatch.");
  }
  const scenariosById = new Map(dataset.scenarios.map((scenario) => [scenario.id, scenario]));
  const scenarios = loadedConfig.config.scenarioIds.map((id) => {
    const scenario = scenariosById.get(id);
    if (!scenario) throw new Error(`Causal ablation scenario is missing: ${id}`);
    return scenario;
  });
  return { ...loadedConfig, datasetSha256, scenarios };
};

const validateMessages = (value: unknown, field: string): AiModelMessage[] => {
  if (!Array.isArray(value) || value.length < 1) throw new Error(`${field} must contain messages.`);
  return value.map((item, index) => {
    const message = asRecord(item, `${field}[${index}]`);
    if (!(["developer", "user", "assistant"] as unknown[]).includes(message.role)) {
      throw new Error(`${field}[${index}].role is invalid.`);
    }
    assertNonEmptyString(message.content, `${field}[${index}].content`);
    return message as AiModelMessage;
  });
};

export const loadCausalAblationInputPack = ({
  path,
  configPath = CAUSAL_ABLATION_CONFIG_PATH,
}: {
  path: string;
  configPath?: string;
}) => {
  const experiment = loadCausalAblationDataset(configPath);
  const source = readFileSync(path);
  const raw = JSON.parse(source.toString("utf8")) as unknown;
  const value = asRecord(raw, "inputPack");
  if (value.schemaVersion !== 1 || value.experimentVersion !== experiment.config.experimentVersion) {
    throw new Error("Causal ablation input pack header is invalid.");
  }
  if (value.configSha256 !== experiment.sha256 || value.sourceDatasetSha256 !== experiment.datasetSha256) {
    throw new Error("Causal ablation input pack commitment mismatch.");
  }
  assertNonEmptyString(value.provider, "inputPack.provider");
  assertNonEmptyString(value.model, "inputPack.model");
  assertNonEmptyString(value.createdAt, "inputPack.createdAt");
  if (!Array.isArray(value.cases) || value.cases.length !== experiment.scenarios.length) {
    throw new Error("Causal ablation input pack case count is incomplete.");
  }
  const cases = value.cases.map((item, index): CausalAblationInputCase => {
    const inputCase = asRecord(item, `cases[${index}]`);
    assertNonEmptyString(inputCase.scenarioId, `cases[${index}].scenarioId`);
    const prompts = asRecord(inputCase.prompts, `cases[${index}].prompts`);
    const parsedPrompts = Object.fromEntries(
      (["production", "oracle_plan", "diagnostic", "surface_control"] as const).map((slot) => [
        slot,
        validateMessages(prompts[slot], `cases[${index}].prompts.${slot}`),
      ])
    ) as Record<CausalAblationPromptSlot, AiModelMessage[]>;
    const productionPlan = asRecord(inputCase.productionPlan, `cases[${index}].productionPlan`);
    const oraclePlan = asRecord(inputCase.oraclePlan, `cases[${index}].oraclePlan`);
    if (Object.keys(productionPlan).length < 1 || Object.keys(oraclePlan).length < 1) {
      throw new Error(`cases[${index}] plans must not be empty.`);
    }
    const planProjections = asRecord(inputCase.planProjections, `cases[${index}].planProjections`);
    assertNonEmptyString(planProjections.production, `cases[${index}].planProjections.production`);
    assertNonEmptyString(planProjections.oracle, `cases[${index}].planProjections.oracle`);
    if (planProjections.production === planProjections.oracle) {
      throw new Error(`cases[${index}] production and oracle plan projections must differ.`);
    }
    let expectedProductionProjection = "";
    let expectedOracleProjection = "";
    try {
      expectedProductionProjection = formatResponsePlanForPrompt(
        productionPlan as unknown as ResponsePlan
      );
      expectedOracleProjection = formatResponsePlanForPrompt(
        oraclePlan as unknown as ResponsePlan
      );
    } catch (error) {
      throw new Error(
        `cases[${index}] plans cannot be projected by the production plan formatter: ${
          error instanceof Error ? error.message : "unknown projection error"
        }`
      );
    }
    if (
      planProjections.production !== expectedProductionProjection ||
      planProjections.oracle !== expectedOracleProjection
    ) {
      throw new Error(`cases[${index}] plan projections are not bound to their frozen plan objects.`);
    }
    const productionOccurrences = parsedPrompts.production.reduce(
      (total, message) => total + message.content.split(planProjections.production as string).length - 1,
      0
    );
    if (productionOccurrences !== 1) {
      throw new Error(`cases[${index}] production prompt must contain its plan projection exactly once.`);
    }
    const expectedOraclePrompt = parsedPrompts.production.map((message) => ({
      ...message,
      content: message.content.replace(
        planProjections.production as string,
        planProjections.oracle as string
      ),
    }));
    if (stableJson(expectedOraclePrompt) !== stableJson(parsedPrompts.oracle_plan)) {
      throw new Error(`cases[${index}] oracle prompt must differ only by the frozen plan projection.`);
    }
    for (const slot of ["diagnostic", "surface_control"] as const) {
      const slotText = parsedPrompts[slot].map((message) => message.content).join("\n");
      if (!slotText.includes(planProjections.production as string)) {
        throw new Error(`cases[${index}] ${slot} prompt must retain the production plan projection.`);
      }
    }
    if (!Array.isArray(inputCase.surfaceCandidates) || inputCase.surfaceCandidates.length < 2) {
      throw new Error(`cases[${index}].surfaceCandidates must contain at least two choices.`);
    }
    const surfaceCandidates = inputCase.surfaceCandidates.map((candidate, candidateIndex) => {
      const record = asRecord(candidate, `cases[${index}].surfaceCandidates[${candidateIndex}]`);
      assertNonEmptyString(record.id, `cases[${index}].surfaceCandidates[${candidateIndex}].id`);
      assertNonEmptyString(record.text, `cases[${index}].surfaceCandidates[${candidateIndex}].text`);
      return record as { id: string; text: string };
    });
    if (new Set(surfaceCandidates.map((candidate) => candidate.id)).size !== surfaceCandidates.length) {
      throw new Error(`cases[${index}].surfaceCandidates contains duplicate ids.`);
    }
    const surfacePrompt = parsedPrompts.surface_control.map((message) => message.content).join("\n");
    if (!surfaceCandidates.every((candidate) => surfacePrompt.includes(candidate.id))) {
      throw new Error(`cases[${index}] surface-control prompt must name every candidate id.`);
    }
    return {
      scenarioId: inputCase.scenarioId,
      productionPlan,
      oraclePlan,
      planProjections: planProjections as { production: string; oracle: string },
      prompts: parsedPrompts,
      surfaceCandidates,
    };
  });
  const expectedIds = new Set(experiment.scenarios.map((scenario) => scenario.id));
  if (new Set(cases.map((item) => item.scenarioId)).size !== cases.length) {
    throw new Error("Causal ablation input pack contains duplicate scenario ids.");
  }
  if (!cases.every((item) => expectedIds.has(item.scenarioId))) {
    throw new Error("Causal ablation input pack contains an unknown scenario id.");
  }
  if (![...expectedIds].every((id) => cases.some((item) => item.scenarioId === id))) {
    throw new Error("Causal ablation input pack is missing a scenario id.");
  }
  return {
    experiment,
    inputPack: { ...(value as unknown as CausalAblationInputPack), cases },
    inputPackSha256: sha256(source),
  };
};

const extractSurfaceChoiceId = (rawText: string) => {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1] ?? rawText;
  try {
    const parsed = JSON.parse(fenced.trim()) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const choiceId = (parsed as Record<string, unknown>).choiceId;
      return typeof choiceId === "string" ? choiceId.trim() : "";
    }
  } catch {
    // An exact candidate id is also an allowed closed-choice response.
  }
  return fenced.trim();
};

export const runCausalAblation = async ({
  sourceId,
  inputPath,
  configPath = CAUSAL_ABLATION_CONFIG_PATH,
  execute,
  now = () => new Date().toISOString(),
  selectIndex = (upperExclusive) => randomInt(upperExclusive),
}: {
  sourceId: string;
  inputPath: string;
  configPath?: string;
  execute: ModelExecutor;
  now?: () => string;
  selectIndex?: (upperExclusive: number) => number;
}): Promise<CausalAblationRunArtifact> => {
  assertNonEmptyString(sourceId, "sourceId");
  const loaded = loadCausalAblationInputPack({ path: inputPath, configPath });
  const startedAt = now();
  const inputByScenario = new Map(loaded.inputPack.cases.map((item) => [item.scenarioId, item]));
  const rows: CausalAblationRow[] = [];
  const schedule = shuffle(
    loaded.experiment.scenarios.flatMap((scenario) =>
      loaded.experiment.config.arms.flatMap((arm) =>
        Array.from(
          { length: loaded.experiment.config.repetitionsPerCell },
          (_, index) => ({ scenario, arm, repetition: index + 1 })
        )
      )
    ),
    selectIndex
  );
  for (const { scenario, arm, repetition } of schedule) {
    const inputCase = inputByScenario.get(scenario.id);
    if (!inputCase) throw new Error(`Missing loaded input case: ${scenario.id}`);
    const plan = arm.planSource === "oracle_frozen" ? inputCase.oraclePlan : inputCase.productionPlan;
    const messages = inputCase.prompts[arm.promptSlot];
    const base = {
          resultId: `${scenario.id}:arm-${arm.id}:r${repetition}`,
          scenarioId: scenario.id,
          armId: arm.id,
          repetition,
          planSource: arm.planSource,
          planSha256: sha256(stableJson(plan)),
          promptSlot: arm.promptSlot,
          promptSha256: sha256(stableJson(messages)),
          surfaceMode: arm.surfaceMode,
          sampling: { temperature: arm.temperature, seed: arm.seed },
        };
        try {
          const response = await execute({
            scenario,
            arm,
            repetition,
            plan,
            messages,
            model: loaded.inputPack.model,
            temperature: arm.temperature,
          });
          const rawModelOutput = response.text;
          const normalizedModelOutput = rawModelOutput.trim();
          if (arm.surfaceMode === "closed_choice") {
            const surfaceChoiceId = extractSurfaceChoiceId(normalizedModelOutput);
            const selected = inputCase.surfaceCandidates.find((candidate) => candidate.id === surfaceChoiceId);
            rows.push({
              ...base,
              executionStatus: selected ? "completed" : "surface_control_invalid",
              responseText: selected?.text ?? "",
              rawModelOutput,
              surfaceChoiceId: selected?.id ?? null,
              model: response.model,
              latencyMs: response.latencyMs,
              tokenInput: response.tokenInput,
              tokenOutput: response.tokenOutput,
              error: selected ? null : `Unknown surface choice: ${surfaceChoiceId || "<empty>"}`,
            });
          } else {
            rows.push({
              ...base,
              executionStatus: "completed",
              responseText: normalizedModelOutput,
              rawModelOutput,
              surfaceChoiceId: null,
              model: response.model,
              latencyMs: response.latencyMs,
              tokenInput: response.tokenInput,
              tokenOutput: response.tokenOutput,
              error: null,
            });
          }
        } catch (error) {
          rows.push({
            ...base,
            executionStatus: "provider_error",
            responseText: "",
            rawModelOutput: "",
            surfaceChoiceId: null,
            model: loaded.inputPack.model,
            latencyMs: 0,
            error: error instanceof Error ? error.message : "Unknown provider error",
          });
        }
  }
  const expectedRows =
    loaded.experiment.scenarios.length *
    loaded.experiment.config.arms.length *
    loaded.experiment.config.repetitionsPerCell;
  return {
    schemaVersion: 1,
    experimentVersion: loaded.experiment.config.experimentVersion,
    sourceId,
    configSha256: loaded.experiment.sha256,
    sourceDatasetSha256: loaded.experiment.datasetSha256,
    inputPackSha256: loaded.inputPackSha256,
    provider: loaded.inputPack.provider,
    model: loaded.inputPack.model,
    startedAt,
    completedAt: now(),
    repetitionsPerCell: loaded.experiment.config.repetitionsPerCell,
    scenarioCount: loaded.experiment.scenarios.length,
    armIds: [...CAUSAL_ABLATION_ARM_IDS],
    summary: {
      expectedRows,
      recordedRows: rows.length,
      completedRows: rows.filter((row) => row.executionStatus === "completed").length,
      invalidSurfaceControls: rows.filter((row) => row.executionStatus === "surface_control_invalid").length,
      providerErrors: rows.filter((row) => row.executionStatus === "provider_error").length,
    },
    rows,
  };
};

export const loadCausalAblationFixture = ({
  path,
  experimentVersion,
  expectedRows,
}: {
  path: string;
  experimentVersion: string;
  expectedRows: number;
}) => {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const value = asRecord(raw, "fixture");
  if (value.schemaVersion !== 1 || value.experimentVersion !== experimentVersion) {
    throw new Error("Causal ablation fixture header is invalid.");
  }
  if (!Array.isArray(value.responses) || value.responses.length !== expectedRows) {
    throw new Error("Causal ablation fixture response count is incomplete.");
  }
  const responses = value.responses as CausalAblationFixtureResponse[];
  const keys = responses.map((item) => `${item.scenarioId}:${item.armId}:${item.repetition}`);
  if (new Set(keys).size !== keys.length) throw new Error("Causal ablation fixture contains duplicate cells.");
  return new Map(responses.map((item) => [`${item.scenarioId}:${item.armId}:${item.repetition}`, item]));
};

export const readCausalAblationRunArtifact = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as CausalAblationRunArtifact;
