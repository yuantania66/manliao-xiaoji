import type { CommittedAssistantMove } from "@/conversation-os";

import type {
  CommittedHelpingMove,
  HillGoalFamily,
  HillIntention,
  HillSkill,
} from "./hillHelpingTypes";

export const COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION = 1 as const;

export type FormalCommittedHelpingMoveMetadataV1 = {
  schemaVersion: typeof COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION;
  state: "formal";
  move: CommittedHelpingMove;
};

export type CommittedAssistantMoveMetadata = CommittedAssistantMove & {
  helping?: FormalCommittedHelpingMoveMetadataV1;
};

export type CommittedAssistantMoveMetadataParseResult =
  | { status: "absent" }
  | { status: "invalid"; reasons: string[] }
  | {
      status: "valid";
      source: "legacy_ordinary" | "formal_v1";
      assistantMove: CommittedAssistantMove;
      helping: CommittedHelpingMove | null;
    };

const GOALS = ["exploration", "insight", "action"] as const satisfies readonly HillGoalFamily[];
const EXPLORATION_INTENTIONS = [
  "offer_support",
  "facilitate_narrative_exploration",
  "facilitate_thought_exploration",
  "facilitate_feeling_exploration",
  "clarify_shared_understanding",
  "allow_pause_without_abandonment",
] as const satisfies readonly HillIntention[];
const INSIGHT_INTENTIONS = [
  "assess_insight_readiness",
  "foster_awareness",
  "facilitate_collaborative_insight",
  "explore_supported_discrepancy",
  "process_current_helping_relationship",
] as const satisfies readonly HillIntention[];
const ACTION_INTENTIONS = [
  "clarify_action_goal",
  "explore_options",
  "provide_relevant_information",
  "support_decision_making",
  "rehearse_behavior_or_wording",
  "plan_small_adjustable_step",
  "review_action_result",
  "support_low_risk_regulation_practice",
] as const satisfies readonly HillIntention[];
const ALL_INTENTIONS = [
  ...EXPLORATION_INTENTIONS,
  ...INSIGHT_INTENTIONS,
  ...ACTION_INTENTIONS,
  "repair_current_helping_relationship",
] as const satisfies readonly HillIntention[];

const EXPLORATION_SKILLS = [
  "attending_and_support",
  "minimal_encourager",
  "supportive_pause",
  "restatement",
  "summary",
  "thought_question_or_probe",
  "feeling_question_or_probe",
  "feeling_reflection",
] as const satisfies readonly HillSkill[];
const INSIGHT_SKILLS = [
  "awareness_challenge",
  "insight_question_or_probe",
  "tentative_interpretation",
  "current_relationship_processing",
] as const satisfies readonly HillSkill[];
const ACTION_SKILLS = [
  "action_question_or_probe",
  "information_giving",
  "option_generation",
  "direct_guidance",
  "strategy_disclosure",
  "behavioral_rehearsal",
  "decision_support",
  "small_step_planning",
  "action_review",
  "low_risk_relaxation_or_mindfulness",
] as const satisfies readonly HillSkill[];
const ALL_SKILLS = [
  ...EXPLORATION_SKILLS,
  ...INSIGHT_SKILLS,
  ...ACTION_SKILLS,
  "relationship_repair",
] as const satisfies readonly HillSkill[];

type MissingIntention = Exclude<HillIntention, (typeof ALL_INTENTIONS)[number]>;
type MissingSkill = Exclude<HillSkill, (typeof ALL_SKILLS)[number]>;
const INTENTIONS_ARE_EXHAUSTIVE: MissingIntention extends never ? true : never = true;
const SKILLS_ARE_EXHAUSTIVE: MissingSkill extends never ? true : never = true;
void INTENTIONS_ARE_EXHAUSTIVE;
void SKILLS_ARE_EXHAUSTIVE;

const ASSISTANT_MOVE_KEYS = new Set([
  "purpose",
  "claims",
  "assumptions",
  "questionOrRequest",
  "expectedUserContribution",
  "userBurden",
  "sourceTurnId",
  "evidence",
  "helping",
]);
const CLAIM_KEYS = new Set(["text", "subject", "source", "provenance"]);
const ASSUMPTION_KEYS = new Set(["text", "status"]);
const QUESTION_OR_REQUEST_KEYS = new Set(["kind", "text"]);
const HELPING_METADATA_KEYS = new Set(["schemaVersion", "state", "move"]);
const HELPING_MOVE_KEYS = new Set([
  "assistantTurnId",
  "planId",
  "primaryGoal",
  "supportingGoal",
  "relationshipPriority",
  "intention",
  "primarySkill",
  "supportingSkill",
  "assumptions",
  "evidence",
  "expectedUserResponse",
  "stopOrReassessWhen",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasExactKeys = (value: Record<string, unknown>, allowed: Set<string>) =>
  Object.keys(value).every((key) => allowed.has(key));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);

const isMember = <T extends readonly string[]>(value: unknown, members: T): value is T[number] =>
  typeof value === "string" && members.includes(value as T[number]);

const intentionMatchesGoal = (goal: HillGoalFamily, intention: HillIntention) =>
  goal === "exploration"
    ? isMember(intention, EXPLORATION_INTENTIONS)
    : goal === "insight"
      ? isMember(intention, INSIGHT_INTENTIONS)
      : isMember(intention, ACTION_INTENTIONS);

const skillMatchesGoal = (goal: HillGoalFamily, skill: HillSkill) =>
  goal === "exploration"
    ? isMember(skill, EXPLORATION_SKILLS)
    : goal === "insight"
      ? isMember(skill, INSIGHT_SKILLS)
      : isMember(skill, ACTION_SKILLS);

const validateClaim = (value: unknown) => {
  if (!isRecord(value) || !hasExactKeys(value, CLAIM_KEYS)) return false;
  if (!isNonEmptyString(value.text) || !isStringArray(value.provenance)) return false;
  if (
    value.subject !== undefined &&
    !isMember(value.subject, ["user", "assistant", "system", "conversation"] as const)
  ) return false;
  if (
    value.source !== undefined &&
    !isMember(
      value.source,
      ["current_turn", "adjacent_turn", "interaction_state", "system_truth", "safety"] as const
    )
  ) return false;
  return true;
};

const validateAssumption = (value: unknown) =>
  isRecord(value) &&
  hasExactKeys(value, ASSUMPTION_KEYS) &&
  isNonEmptyString(value.text) &&
  value.status === "hypothesized";

const validateQuestionOrRequest = (value: unknown) => {
  if (value === null) return true;
  if (!isRecord(value) || !hasExactKeys(value, QUESTION_OR_REQUEST_KEYS)) return false;
  if (!isMember(value.kind, ["question", "request"] as const)) return false;
  return value.text === undefined || isNonEmptyString(value.text);
};

const validateAssistantMove = (value: unknown): value is CommittedAssistantMoveMetadata => {
  if (!isRecord(value) || !hasExactKeys(value, ASSISTANT_MOVE_KEYS)) return false;
  return isStringArray(value.purpose) &&
    Array.isArray(value.claims) && value.claims.every(validateClaim) &&
    Array.isArray(value.assumptions) && value.assumptions.every(validateAssumption) &&
    validateQuestionOrRequest(value.questionOrRequest) &&
    isMember(value.expectedUserContribution, ["answer", "choose_topic", "share", "none"] as const) &&
    isMember(value.userBurden, ["none", "low", "medium", "high"] as const) &&
    isNonEmptyString(value.sourceTurnId) &&
    isStringArray(value.evidence);
};

const validateHelpingMove = (value: unknown): value is CommittedHelpingMove => {
  if (!isRecord(value) || !hasExactKeys(value, HELPING_MOVE_KEYS)) return false;
  if (
    !isNonEmptyString(value.assistantTurnId) ||
    !isNonEmptyString(value.planId) ||
    !isMember(value.relationshipPriority, ["none", "repair", "process_current_relationship"] as const) ||
    !isMember(value.intention, ALL_INTENTIONS) ||
    !isMember(value.primarySkill, ALL_SKILLS) ||
    !isStringArray(value.assumptions) ||
    !isNonEmptyStringArray(value.evidence) ||
    !isNonEmptyStringArray(value.expectedUserResponse) ||
    !isNonEmptyStringArray(value.stopOrReassessWhen)
  ) return false;

  if (value.relationshipPriority === "repair") {
    return value.primaryGoal === undefined &&
      value.supportingGoal === undefined &&
      value.intention === "repair_current_helping_relationship" &&
      value.primarySkill === "relationship_repair" &&
      value.supportingSkill === undefined;
  }

  if (!isMember(value.primaryGoal, GOALS)) return false;
  if (!intentionMatchesGoal(value.primaryGoal, value.intention)) return false;
  if (!skillMatchesGoal(value.primaryGoal, value.primarySkill)) return false;
  if (value.supportingGoal !== undefined && !isMember(value.supportingGoal, GOALS)) return false;
  if (value.supportingSkill !== undefined && !isMember(value.supportingSkill, ALL_SKILLS)) return false;
  if (
    isMember(value.supportingGoal, GOALS) &&
    isMember(value.supportingSkill, ALL_SKILLS) &&
    !skillMatchesGoal(value.supportingGoal, value.supportingSkill)
  ) return false;
  return true;
};

const validateFormalHelpingMetadata = (
  value: unknown
): value is FormalCommittedHelpingMoveMetadataV1 =>
  isRecord(value) &&
  hasExactKeys(value, HELPING_METADATA_KEYS) &&
  value.schemaVersion === COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION &&
  value.state === "formal" &&
  validateHelpingMove(value.move);

const cloneJsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class CommittedAssistantMoveMetadataError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(`Invalid committed Assistant move metadata: ${reasons.join(", ")}`);
    this.name = "CommittedAssistantMoveMetadataError";
    this.reasons = reasons;
  }
}

export const serializeCommittedAssistantMoveMetadata = ({
  assistantMove,
  helping,
}: {
  assistantMove: CommittedAssistantMove;
  helping?: CommittedHelpingMove;
}): CommittedAssistantMoveMetadata => {
  const candidate = {
    ...assistantMove,
    ...(helping
      ? {
          helping: {
            schemaVersion: COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION,
            state: "formal" as const,
            move: helping,
          },
        }
      : {}),
  };
  const parsed = parseCommittedAssistantMoveMetadata(candidate);
  if (parsed.status !== "valid") {
    throw new CommittedAssistantMoveMetadataError(
      parsed.status === "invalid" ? parsed.reasons : ["metadata_absent"]
    );
  }
  return cloneJsonValue(candidate);
};

export const parseCommittedAssistantMoveMetadata = (
  value: unknown
): CommittedAssistantMoveMetadataParseResult => {
  if (value === null || value === undefined) return { status: "absent" };
  if (!validateAssistantMove(value)) {
    return { status: "invalid", reasons: ["invalid_committed_assistant_move"] };
  }

  const { helping: helpingMetadata, ...assistantMove } = value;
  if (helpingMetadata === undefined) {
    return {
      status: "valid",
      source: "legacy_ordinary",
      assistantMove,
      helping: null,
    };
  }
  if (!validateFormalHelpingMetadata(helpingMetadata)) {
    return { status: "invalid", reasons: ["invalid_formal_helping_metadata_v1"] };
  }
  return {
    status: "valid",
    source: "formal_v1",
    assistantMove,
    helping: helpingMetadata.move,
  };
};
