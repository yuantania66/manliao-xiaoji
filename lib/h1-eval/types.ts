export const H1_GROUPS = ["S1", "S2", "S3", "S4"] as const;
export type H1Group = (typeof H1_GROUPS)[number];

export type H1Cohort = "confirmed" | "pending" | "guard";
export type CandidateOrigin = "baseline" | "generated";

export const H1_REASON_TAGS = [
  "猜了",
  "没回应",
  "机械复述",
  "太像模板",
  "封口",
  "逼问",
  "太空",
  "回错重点",
  "太快建议",
  "其它",
] as const;

export type H1ReasonTag = (typeof H1_REASON_TAGS)[number];

export type H1EvalCase = {
  id: string;
  group: H1Group;
  cohort: H1Cohort;
  userInput: string;
  necessaryContext: string;
  baselineReply: string;
};

export type H1Candidate = {
  label: string;
  text: string;
  origin: CandidateOrigin;
  action: string;
  model: string;
};

export type H1CandidateCase = {
  id: string;
  group: H1Group;
  cohort: H1Cohort;
  userInput: string;
  necessaryContext: string;
  candidates: H1Candidate[];
};

export type H1CandidateManifest = {
  version: 1;
  round: 1 | 2;
  generatedAt: string;
  model: string;
  cases: H1CandidateCase[];
};

export type H1PublicCandidate = Pick<H1Candidate, "label" | "text">;

export type H1PublicCase = Omit<H1CandidateCase, "candidates"> & {
  candidates: H1PublicCandidate[];
};

export type H1Selection = {
  caseId: string;
  round: 1 | 2;
  best: string | "all_unacceptable" | null;
  secondBest: string | null;
  unacceptable: string[];
  reasonTags: H1ReasonTag[];
  note: string;
  willingToContinue: boolean | null;
  updatedAt: string;
};

export type H1SelectionStore = {
  version: 1;
  selections: H1Selection[];
};

export type H1ReviewPayload = {
  activeRound: 1 | 2;
  availableRounds: Array<1 | 2>;
  publicCases: H1PublicCase[];
  selections: H1Selection[];
  generationStatus: "idle" | "running" | "failed";
  generationMessage: string | null;
};
