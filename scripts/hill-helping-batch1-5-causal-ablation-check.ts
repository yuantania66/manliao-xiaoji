import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCausalAblationBlindPack } from "./hill-helping-batch1-5-causal-ablation-blind-lib";
import { formatResponsePlanForPrompt } from "../services/ai/promptBuilder";
import {
  CAUSAL_ABLATION_ARM_IDS,
  loadCausalAblationConfig,
  loadCausalAblationDataset,
  loadCausalAblationInputPack,
  runCausalAblation,
  type CausalAblationInputPack,
} from "./hill-helping-batch1-5-causal-ablation-lib";

const createFixturePlan = (planId: string) => ({
  planId,
  decisionOwner: "conversation_os.response_planner" as const,
  behaviorSource: "legacy_compat" as const,
  planningDepth: "minimal" as const,
  answerObligations: [],
  disclosureScope: { conversationId: "offline-fixture", turnId: "offline-turn" },
  correction: null,
  responseActions: [],
  groundingFacts: [],
  requiredDisclosure: [],
  clinicalStrategy: null,
  positiveFunctionContract: null,
  interactionMoveHandoffPlan: null,
  ordinaryPosture: null,
  questionPolicy: { mode: "none" as const, reason: "offline fixture" },
  closurePolicy: { mode: "forbid_closure" as const, reason: "offline fixture" },
  tone: ["offline fixture"],
  stance: ["offline fixture"],
  lengthGuidance: "offline fixture",
  prohibitedClaims: [],
  safetyConstraints: [],
  relevanceProvenance: [],
  evidence: ["offline fixture"],
});

const main = async () => {
  const experiment = loadCausalAblationDataset();
  assert.equal(experiment.scenarios.length, 6);
  assert.deepEqual(experiment.config.arms.map((arm) => arm.id), [...CAUSAL_ABLATION_ARM_IDS]);
  assert.equal(experiment.config.repetitionsPerCell, 5);
  assert.equal(experiment.config.arms.find((arm) => arm.id === "S")?.temperature, 0);
  assert.equal(experiment.config.arms.find((arm) => arm.id === "A")?.surfaceMode, "closed_choice");

  const tempDirectory = mkdtempSync(join(tmpdir(), "batch1-5-causal-ablation-"));
  try {
  const inputPath = join(tempDirectory, "input.json");
  const resultPath = join(tempDirectory, "result.json");
  const invalidResultPath = join(tempDirectory, "invalid-result.json");
  const inputPack: CausalAblationInputPack = {
    schemaVersion: 1,
    experimentVersion: experiment.config.experimentVersion,
    configSha256: experiment.sha256,
    sourceDatasetSha256: experiment.datasetSha256,
    provider: "fixture",
    model: "fixture-model",
    createdAt: "2026-08-03T00:00:00.000Z",
    cases: experiment.scenarios.map((scenario) => {
      const productionPlan = createFixturePlan(`production:${scenario.id}`);
      const oraclePlan = createFixturePlan(`oracle:${scenario.id}`);
      const productionProjection = formatResponsePlanForPrompt(productionPlan);
      const oracleProjection = formatResponsePlanForPrompt(oraclePlan);
      return {
        scenarioId: scenario.id,
        productionPlan,
        oraclePlan,
        planProjections: {
          production: productionProjection,
          oracle: oracleProjection,
        },
        prompts: {
          production: [
            { role: "developer", content: `${productionProjection}\nFrozen common input.` },
          ],
          oracle_plan: [
            { role: "developer", content: `${oracleProjection}\nFrozen common input.` },
          ],
          diagnostic: [
            { role: "developer", content: `${productionProjection}\nFrozen diagnostic input.` },
          ],
          surface_control: [
            {
              role: "developer",
              content: `${productionProjection}\nSelect exactly one candidate id: KEEP_CURRENT or RETURN_FOCUS.`,
            },
          ],
        },
        surfaceCandidates: [
          { id: "KEEP_CURRENT", text: "先停在你刚才明确说的这部分。" },
          { id: "RETURN_FOCUS", text: "你可以只从刚才这份感受里选一点说。" },
        ],
      };
    }),
  };
  writeFileSync(inputPath, `${JSON.stringify(inputPack, null, 2)}\n`);
  const loadedInput = loadCausalAblationInputPack({ path: inputPath });
  assert.equal(loadedInput.inputPack.cases.length, 6);

  let timestamp = 0;
  const artifact = await runCausalAblation({
    sourceId: "offline-self-check",
    inputPath,
    now: () => `2026-08-03T00:00:${String(timestamp++).padStart(2, "0")}.000Z`,
    selectIndex: (upperExclusive) => upperExclusive - 1,
    execute: async ({ arm, repetition }) => ({
      text:
        arm.id === "A"
          ? JSON.stringify({ choiceId: "RETURN_FOCUS" })
          : arm.id === "C" && repetition === 1
            ? "  先回应你刚才明确说的这部分。\n"
            : "先回应你刚才明确说的这部分。",
      model: "fixture:fixture-model",
      latencyMs: 1,
    }),
  });
  assert.equal(artifact.summary.expectedRows, 150);
  assert.equal(artifact.summary.recordedRows, 150);
  assert.equal(artifact.summary.completedRows, 150);
  assert.equal(artifact.summary.invalidSurfaceControls, 0);
  assert.equal(artifact.summary.providerErrors, 0);
  for (const armId of CAUSAL_ABLATION_ARM_IDS) {
    assert.equal(artifact.rows.filter((row) => row.armId === armId).length, 30);
  }
  const control = artifact.rows.find((row) => row.armId === "C");
  const plan = artifact.rows.find((row) => row.armId === "P");
  assert(control && plan);
  assert.notEqual(control.planSha256, plan.planSha256);
  assert.equal(control.rawModelOutput, "  先回应你刚才明确说的这部分。\n");
  assert.equal(control.responseText, "先回应你刚才明确说的这部分。");
  assert.equal(artifact.rows.find((row) => row.armId === "S")?.sampling.temperature, 0);
  assert(artifact.rows.filter((row) => row.armId === "A").every((row) => row.surfaceChoiceId === "RETURN_FOCUS"));

  const randomizedExecutionOrder: string[] = [];
  await runCausalAblation({
    sourceId: "offline-randomized-schedule-check",
    inputPath,
    selectIndex: () => 0,
    execute: async ({ scenario, arm, repetition }) => {
      randomizedExecutionOrder.push(`${scenario.id}:${arm.id}:${repetition}`);
      return {
        text: arm.id === "A" ? "KEEP_CURRENT" : "只回应当前内容。",
        model: "fixture:fixture-model",
        latencyMs: 1,
      };
    },
  });
  assert.notEqual(
    randomizedExecutionOrder[0],
    `${experiment.scenarios[0]?.id}:C:1`,
    "The execution scheduler must be able to reorder frozen cells."
  );

  writeFileSync(resultPath, `${JSON.stringify(artifact, null, 2)}\n`);
  const blindPack = buildCausalAblationBlindPack({
    resultPath,
    selectIndex: (upperExclusive) => upperExclusive - 1,
  });
  assert.equal(blindPack.review.items.length, 150);
  assert.equal(blindPack.key.items.length, 150);
  assert.equal(blindPack.adjudication.reviews.length, 150);
  assert.equal(blindPack.keyCommitment.length, 64);
  assert.equal(blindPack.adjudication.reviewedBeforeKeyRead, false);
  assert.equal(new Set(blindPack.review.items.map((item) => item.reviewId)).size, 150);
  assert(!blindPack.reviewSource.includes("offline-self-check"));
  assert(!blindPack.reviewSource.includes("fixture-model"));
  for (const scenario of experiment.scenarios) {
    assert(!blindPack.reviewSource.includes(scenario.id));
  }

  const invalidArtifact = await runCausalAblation({
    sourceId: "offline-invalid-surface-check",
    inputPath,
    selectIndex: (upperExclusive) => upperExclusive - 1,
    execute: async ({ arm, scenario, repetition }) => ({
      text:
        arm.id === "A" && scenario.id === experiment.scenarios[0]?.id && repetition === 1
          ? JSON.stringify({ choiceId: "UNKNOWN" })
          : arm.id === "A"
            ? "KEEP_CURRENT"
            : "只回应当前内容。",
      model: "fixture:fixture-model",
      latencyMs: 1,
    }),
  });
  assert.equal(invalidArtifact.summary.invalidSurfaceControls, 1);
  writeFileSync(invalidResultPath, `${JSON.stringify(invalidArtifact, null, 2)}\n`);
  assert.throws(
    () => buildCausalAblationBlindPack({ resultPath: invalidResultPath }),
    /completed response in every cell/u
  );

  const duplicateCellPath = join(tempDirectory, "duplicate-cell-result.json");
  const duplicateCellRows = artifact.rows.map((row) => ({ ...row }));
  duplicateCellRows[duplicateCellRows.length - 1] = {
    ...duplicateCellRows[0]!,
    resultId: "synthetically-unique-but-duplicate-cell",
  };
  writeFileSync(
    duplicateCellPath,
    `${JSON.stringify({ ...artifact, rows: duplicateCellRows }, null, 2)}\n`
  );
  assert.throws(
    () => buildCausalAblationBlindPack({ resultPath: duplicateCellPath }),
    /cells are incomplete or duplicated/u
  );

  const tamperedPath = join(tempDirectory, "tampered-input.json");
  writeFileSync(
    tamperedPath,
    `${JSON.stringify({ ...inputPack, configSha256: "0".repeat(64) }, null, 2)}\n`
  );
  assert.throws(
    () => loadCausalAblationInputPack({ path: tamperedPath }),
    /commitment mismatch/u
  );

  const mixedPlanPromptPath = join(tempDirectory, "mixed-plan-prompt-input.json");
  const mixedPlanCases = inputPack.cases.map((inputCase, index) =>
    index === 0
      ? {
          ...inputCase,
          prompts: {
            ...inputCase.prompts,
            oracle_plan: [
              ...inputCase.prompts.oracle_plan,
              { role: "developer" as const, content: "Extra non-plan intervention." },
            ],
          },
        }
      : inputCase
  );
  writeFileSync(
    mixedPlanPromptPath,
    `${JSON.stringify({ ...inputPack, cases: mixedPlanCases }, null, 2)}\n`
  );
  assert.throws(
    () => loadCausalAblationInputPack({ path: mixedPlanPromptPath }),
    /oracle prompt must differ only/u
  );

  const fakeProjectionPath = join(tempDirectory, "fake-plan-projection-input.json");
  const fakeProjectionCases = inputPack.cases.map((inputCase, index) =>
    index === 0
      ? {
          ...inputCase,
          planProjections: { production: "must", oracle: "may" },
          prompts: {
            ...inputCase.prompts,
            production: [{ role: "developer" as const, content: "You must answer." }],
            oracle_plan: [{ role: "developer" as const, content: "You may answer." }],
            diagnostic: [{ role: "developer" as const, content: "Keep must for diagnosis." }],
            surface_control: [
              {
                role: "developer" as const,
                content: "Keep must; choose KEEP_CURRENT or RETURN_FOCUS.",
              },
            ],
          },
        }
      : inputCase
  );
  writeFileSync(
    fakeProjectionPath,
    `${JSON.stringify({ ...inputPack, cases: fakeProjectionCases }, null, 2)}\n`
  );
  assert.throws(
    () => loadCausalAblationInputPack({ path: fakeProjectionPath }),
    /not bound to their frozen plan objects/u
  );

  const tamperedMetricsConfigPath = join(tempDirectory, "tampered-metrics-config.json");
  writeFileSync(
    tamperedMetricsConfigPath,
    `${JSON.stringify({
      ...experiment.config,
      humanReview: {
        ...experiment.config.humanReview,
        metrics: ["functionalPass", "wouldContinue", "inventedMetric"],
      },
    }, null, 2)}\n`
  );
  assert.throws(
    () => loadCausalAblationConfig(tamperedMetricsConfigPath),
    /humanReview.metrics is invalid/u
  );

  const tamperedCategoriesConfigPath = join(tempDirectory, "tampered-categories-config.json");
  writeFileSync(
    tamperedCategoriesConfigPath,
    `${JSON.stringify({
      ...experiment.config,
      humanReview: {
        ...experiment.config.humanReview,
        failureCategories: ["invented_failure"],
      },
    }, null, 2)}\n`
  );
  assert.throws(
    () => loadCausalAblationConfig(tamperedCategoriesConfigPath),
    /humanReview.failureCategories is invalid/u
  );
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }

  console.log("Batch 1.5 causal ablation offline framework checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
