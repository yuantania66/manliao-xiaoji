import { loadEnvConfig } from "@next/env";

import { generateH1CandidateRound } from "../lib/h1-eval/generator";

loadEnvConfig(process.cwd());

const getNumberArgument = (name: string, fallback: number) => {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --${name}: ${raw}`);
  return value;
};

const round = getNumberArgument("round", 1);
if (round !== 1 && round !== 2) throw new Error("--round must be 1 or 2");

generateH1CandidateRound({ round, concurrency: getNumberArgument("concurrency", 4) })
  .then(({ manifest, outputPath }) => {
    console.log(JSON.stringify({ round, cases: manifest.cases.length, outputPath, realModelRequired: true }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
