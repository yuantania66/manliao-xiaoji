import type { ClinicalStrategyDefinition } from "./clinicalTypes";

export const NOOP_CLINICAL_STRATEGY: ClinicalStrategyDefinition = {
  name: "noop",
  goal: "Engineering placeholder for Clinical Logic Sprint 1 skeleton.",
  whenToUse: ["Clinical Logic contract must be traced, but concrete strategy selection is not implemented yet."],
  whenNotToUse: ["Safety crisis or high-risk path has already routed to Safety."],
  userNeed: "none_selected_in_skeleton",
  expectedExperience: "No behavior change; existing Conversation OS and LLM output remain unchanged.",
  reference: "Engineering Placeholder",
};

export const ROGERS_CLINICAL_STRATEGY: ClinicalStrategyDefinition = {
  name: "rogers",
  goal: "Dry-run empathic reflection strategy grounded in Rogers' client-centered stance.",
  whenToUse: ["Default normal Clinical Logic path in Sprint 1 dry-run."],
  whenNotToUse: ["Safety crisis or high-risk path has already routed to Safety."],
  userNeed: "feel_empathically_received_without_being_directed",
  expectedExperience: "The user feels the AI is trying to understand without diagnosing or directing.",
  reference: "Rogers",
};

export const CLINICAL_STRATEGY_DEFINITIONS: ClinicalStrategyDefinition[] = [
  NOOP_CLINICAL_STRATEGY,
  ROGERS_CLINICAL_STRATEGY,
  {
    name: "rogers_reflection",
    goal: "Reflect expressed experience without interpreting or amplifying it.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "receive_expressed_experience",
    expectedExperience: "The user feels heard without being defined.",
    reference: "Rogers",
  },
  {
    name: "rogers_validation",
    goal: "Acknowledge the understandability of the user's experience without confirming unverified facts.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "feel_allowed",
    expectedExperience: "The user feels their response can make sense without losing interpretive authority.",
    reference: "Rogers",
  },
  {
    name: "rogers_repair",
    goal: "Repair AI misunderstanding by returning interpretive authority to the user.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "misunderstanding_repaired",
    expectedExperience: "The user feels safe correcting AI.",
    reference: "Rogers",
  },
  {
    name: "cbt_fact_interpretation_separation",
    goal: "Lightly separate facts, interpretations, and feelings when the user is caught in an interpretation chain.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "gentle_cognitive_clarity",
    expectedExperience: "The user sees a little more space without being corrected.",
    reference: "CBT",
  },
  {
    name: "act_acceptance_space",
    goal: "Make room for ambiguity, mixed feelings, or not knowing without forcing resolution.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "allowed_uncertainty",
    expectedExperience: "The user feels less pressured to explain.",
    reference: "ACT",
  },
  {
    name: "mi_open_question",
    goal: "Use a low-pressure question to support user exploration or agency.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "self_exploration",
    expectedExperience: "The user feels invited, not interrogated.",
    reference: "MI",
  },
  {
    name: "mi_affirmation",
    goal: "Notice concrete effort, honesty, or self-observation without evaluating the person.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "effort_seen",
    expectedExperience: "The user feels a specific effort was seen.",
    reference: "MI",
  },
  {
    name: "mi_summary",
    goal: "Organize a current shared-understanding draft when summary is requested or useful.",
    whenToUse: [],
    whenNotToUse: [],
    userNeed: "shared_understanding_draft",
    expectedExperience: "The user feels the understanding remains editable.",
    reference: "MI",
  },
];

export const getClinicalStrategyDefinition = (name: ClinicalStrategyDefinition["name"]) =>
  CLINICAL_STRATEGY_DEFINITIONS.find((definition) => definition.name === name);
