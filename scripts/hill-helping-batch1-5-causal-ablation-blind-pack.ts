import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildCausalAblationBlindPack } from "./hill-helping-batch1-5-causal-ablation-blind-lib";
import { CAUSAL_ABLATION_CONFIG_PATH } from "./hill-helping-batch1-5-causal-ablation-lib";

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
};

const resultPath = getArg("result");
const reviewPath = getArg("review");
const keyPath = getArg("key");
const adjudicationPath = getArg("adjudication");
const configPath = getArg("config") || CAUSAL_ABLATION_CONFIG_PATH;

for (const [field, value] of [
  ["result", resultPath],
  ["review", reviewPath],
  ["key", keyPath],
  ["adjudication", adjudicationPath],
] as const) {
  if (!value) throw new Error(`--${field} is required.`);
}

const pack = buildCausalAblationBlindPack({ resultPath, configPath });
for (const [path, source] of [
  [reviewPath, pack.reviewSource],
  [keyPath, pack.keySource],
  [adjudicationPath, pack.adjudicationSource],
] as const) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, { encoding: "utf8", flag: "wx" });
}

console.log(
  JSON.stringify(
    {
      reviewPath,
      keyPath,
      adjudicationPath,
      keyCommitment: pack.keyCommitment,
      reviewItems: pack.review.items.length,
    },
    null,
    2
  )
);
