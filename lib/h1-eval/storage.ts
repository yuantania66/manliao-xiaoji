import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  H1CandidateManifest,
  H1PublicCase,
  H1ReviewPayload,
  H1Selection,
  H1SelectionStore,
} from "./types";

export const H1_STATE_DIR = join(process.cwd(), ".h1-eval");
export const H1_ROUND_ONE_MANIFEST = join(H1_STATE_DIR, "round-1-manifest.json");
export const H1_ROUND_TWO_MANIFEST = join(H1_STATE_DIR, "round-2-manifest.json");
export const H1_SELECTIONS_PATH = join(H1_STATE_DIR, "selections.json");
export const H1_GENERATION_STATUS_PATH = join(H1_STATE_DIR, "generation-status.json");

const readJson = <T>(path: string): T | null => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
};

const writeJsonAtomic = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, path);
};

export const readManifest = (round: 1 | 2) =>
  readJson<H1CandidateManifest>(round === 1 ? H1_ROUND_ONE_MANIFEST : H1_ROUND_TWO_MANIFEST);

export const writeManifest = (manifest: H1CandidateManifest) =>
  writeJsonAtomic(manifest.round === 1 ? H1_ROUND_ONE_MANIFEST : H1_ROUND_TWO_MANIFEST, manifest);

export const readSelections = (): H1SelectionStore =>
  readJson<H1SelectionStore>(H1_SELECTIONS_PATH) ?? { version: 1, selections: [] };

export const writeSelection = (selection: H1Selection) => {
  const store = readSelections();
  const current = store.selections.find(
    (item) => item.round === selection.round && item.caseId === selection.caseId
  );
  if (current && current.updatedAt > selection.updatedAt) return store;
  const withoutCurrent = store.selections.filter(
    (item) => !(item.round === selection.round && item.caseId === selection.caseId)
  );
  const next: H1SelectionStore = {
    version: 1,
    selections: [...withoutCurrent, selection].sort(
      (left, right) => left.round - right.round || left.caseId.localeCompare(right.caseId)
    ),
  };
  writeJsonAtomic(H1_SELECTIONS_PATH, next);
  return next;
};

type GenerationStatus = {
  status: "idle" | "running" | "failed";
  message: string | null;
  updatedAt: string;
};

export const readGenerationStatus = (): GenerationStatus =>
  readJson<GenerationStatus>(H1_GENERATION_STATUS_PATH) ?? {
    status: "idle",
    message: null,
    updatedAt: new Date(0).toISOString(),
  };

export const writeGenerationStatus = (status: GenerationStatus) =>
  writeJsonAtomic(H1_GENERATION_STATUS_PATH, status);

export const toPublicCases = (manifest: H1CandidateManifest | null): H1PublicCase[] =>
  manifest?.cases.map((item) => ({
    ...item,
    candidates: item.candidates.map(({ label, text }) => ({ label, text })),
  })) ?? [];

export const buildReviewPayload = (): H1ReviewPayload => {
  const roundOne = readManifest(1);
  const roundTwo = readManifest(2);
  const activeRound: 1 | 2 = roundTwo ? 2 : 1;
  const status = readGenerationStatus();

  return {
    activeRound,
    availableRounds: [roundOne ? 1 : null, roundTwo ? 2 : null].filter(
      (round): round is 1 | 2 => round !== null
    ),
    publicCases: toPublicCases(activeRound === 2 ? roundTwo : roundOne),
    selections: readSelections().selections,
    generationStatus: status.status,
    generationMessage: status.message,
  };
};

export const isRoundComplete = (round: 1 | 2) => {
  const manifest = readManifest(round);
  if (!manifest) return false;
  const selections = readSelections().selections.filter((item) => item.round === round && item.best);
  return selections.length === manifest.cases.length;
};
