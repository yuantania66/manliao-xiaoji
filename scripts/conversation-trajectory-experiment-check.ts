import assert from "node:assert/strict";

import { buildChatPrompt } from "../services/ai/promptBuilder";
import {
  GROUNDEDNESS_VARIANTS,
  applyGroundednessHistoryAdapter,
  getGroundednessExperimentDataset,
  getGroundednessPromptAdapter,
} from "./conversation-trajectory-experiment-adapters";
import { buildTurnResult, locateRepeatedOpeningSkeletons } from "./conversation-trajectory-eval-lib";

assert.deepEqual(GROUNDEDNESS_VARIANTS, ["a0", "a1", "a2", "a3"]);
assert.equal(getGroundednessPromptAdapter("a0"), null);
assert.equal(getGroundednessPromptAdapter("a3"), null);
assert.equal(getGroundednessPromptAdapter("a1")?.id, "exp-bl-012a-a1");
assert.equal(getGroundednessPromptAdapter("a2")?.id, "exp-bl-012a-a2");

const dataset = getGroundednessExperimentDataset();
assert.equal(dataset.datasetVersion, "exp-bl-012a-issue-19-v1");
assert.deepEqual(
  dataset.trajectories.map((trajectory) => trajectory.id),
  [
    "EXP19-FREE-SINGLE-001",
    "EXP19-FREE-SEQUENCE-001",
    "EXP19-ESTABLISHED-SCALE-001",
    "EXP19-ESTABLISHED-CHOICE-001",
    "EXP19-EXPLICIT-COUNT-001",
    "EXP19-ASSISTANT-GUESS-HISTORY-001",
  ]
);

const canonicalPrompt = buildChatPrompt({ userMessage: "1", recentMessages: [] });
assert.equal(canonicalPrompt.messages.some((message) => message.content.includes("Eval-only registered adapter")), false);

const a1 = getGroundednessPromptAdapter("a1");
assert(a1);
const treatmentPrompt = buildChatPrompt({ userMessage: "1", recentMessages: [], evaluationAdapter: a1 });
assert(treatmentPrompt.messages.some((message) => message.content.includes("Eval-only registered adapter: exp-bl-012a-a1")));
assert(treatmentPrompt.messages.some((message) => message.content.includes("Preserve conversation movement")));

const guessedHistory = [
  { role: "user" as const, content: "1" },
  { role: "assistant" as const, content: "像是松口气。" },
];
assert.deepEqual(applyGroundednessHistoryAdapter("a0", guessedHistory), guessedHistory);
assert.deepEqual(applyGroundednessHistoryAdapter("a3", guessedHistory), [guessedHistory[0]]);

const scaleHistory = [
  { role: "assistant" as const, content: "请用 1–10 给现在的紧张打个分。" },
];
assert.deepEqual(applyGroundednessHistoryAdapter("a3", scaleHistory), scaleHistory);

const sampleTurn = dataset.trajectories[0].turns[0];
const synonymousObservationTurns = [
  "看到这个 1 了。你可以继续发。",
  "注意到你发了 2。你可以继续。",
  "收到了这个 3。想怎么继续都行。",
].map((assistant) => buildTurnResult({ turn: sampleTurn, assistant, mode: "real" }));
assert(
  locateRepeatedOpeningSkeletons(synonymousObservationTurns).some(
    (flag) => flag.rule === "repeated_opening_skeleton_locator" && flag.matchedText.includes("<observe><token>")
  ),
  "synonymous observation openings must normalize to one candidate skeleton"
);

console.log(
  JSON.stringify(
    {
      experiment: dataset.datasetVersion,
      variants: GROUNDEDNESS_VARIANTS,
      trajectories: dataset.trajectories.length,
      canonicalPromptUnchanged: true,
      a3DropsAssistantGuess: true,
      a3PreservesExplicitScale: true,
      synonymOpeningLocator: true,
      realModelCallsInCheck: false,
    },
    null,
    2
  )
);
