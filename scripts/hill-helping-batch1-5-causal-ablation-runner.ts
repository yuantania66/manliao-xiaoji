import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  callModel,
  getAiProvider,
  isAiProviderConfigured,
} from "../services/ai/modelProvider";
import {
  CAUSAL_ABLATION_CONFIG_PATH,
  loadCausalAblationFixture,
  loadCausalAblationInputPack,
  runCausalAblation,
} from "./hill-helping-batch1-5-causal-ablation-lib";

loadEnvConfig(process.cwd());

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const inputPath = getArg("input");
const outputPath = getArg("output");
const sourceId = getArg("source-id");
const fixturePath = getArg("fixture");
const configPath = getArg("config") || CAUSAL_ABLATION_CONFIG_PATH;

for (const [field, value] of [
  ["input", inputPath],
  ["output", outputPath],
  ["source-id", sourceId],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}

const main = async () => {
  const loaded = loadCausalAblationInputPack({ path: inputPath, configPath });
  const expectedRows =
    loaded.experiment.scenarios.length *
    loaded.experiment.config.arms.length *
    loaded.experiment.config.repetitionsPerCell;
  const fixture = fixturePath
    ? loadCausalAblationFixture({
        path: fixturePath,
        experimentVersion: loaded.experiment.config.experimentVersion,
        expectedRows,
      })
    : null;

  if (!fixture) {
    assert(isAiProviderConfigured(), "A configured real AI provider or --fixture is required.");
    assert.equal(
      getAiProvider(),
      loaded.inputPack.provider,
      "Configured provider does not match the frozen input pack."
    );
  }

  const artifact = await runCausalAblation({
    sourceId,
    inputPath,
    configPath,
    execute: async ({ scenario, arm, repetition, messages, model, temperature }) => {
      if (!fixture) return callModel({ messages, model, temperature });
      const key = `${scenario.id}:${arm.id}:${repetition}`;
      const response = fixture.get(key);
      if (!response) throw new Error(`Missing fixture response: ${key}`);
      return {
        text: response.text,
        model: response.model ?? `fixture:${model}`,
        latencyMs: response.latencyMs ?? 0,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
      };
    },
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(JSON.stringify({ outputPath, ...artifact.summary }, null, 2));
  if (artifact.summary.completedRows !== artifact.summary.expectedRows) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
