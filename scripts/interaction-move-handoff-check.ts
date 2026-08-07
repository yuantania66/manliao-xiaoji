import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProactiveGreetingAssistantMoveEnvelope,
  buildResponsePlanAssistantMoveEnvelope,
  type CommittedAssistantMove,
} from "../conversation-os";
import {
  assembleConversationControlContext,
  interpretTurnDeterministically,
  mergeModelInterpretation,
  projectUserMoveRelation,
  type ActiveInteractionMoveHandoffTarget,
  type RelationalInterpretationCandidate,
  type UserMoveRelationKind,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { AiConversationMessage } from "../services/ai/types";

const greetingEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "assistant-greeting-1",
  generationId: "greeting-generation-1",
  greetingMove: "light_question",
});

const greetingMessage = ({
  id = "assistant-greeting-1",
  status = "saved" as const,
}: {
  id?: string;
  status?: AiConversationMessage["status"];
} = {}): AiConversationMessage => ({
  id,
  role: "assistant",
  content: "今天有没有吃到什么还不错的东西？",
  status,
  promptVersion: "generation-provenance-only",
  interactionMoveEnvelope: greetingEnvelope,
});

const buildContext = ({
  userMessage = "吃了个炒饭",
  currentTurnId = "user-turn-1",
  recentMessages = [greetingMessage()],
}: {
  userMessage?: string;
  currentTurnId?: string;
  recentMessages?: AiConversationMessage[];
} = {}) => assembleConversationControlContext({
  conversationId: "phm-a-check",
  currentTurnId,
  userMessage,
  recentMessages,
  conversationState: determineConversationState({
    currentUserMessage: userMessage,
    recentMessages,
  }),
});

const context = buildContext();
assert.equal(
  context.adjacentTurns.at(-1)?.interactionMoveEnvelope?.assistantMoveId,
  "assistant-greeting-1"
);
assert.deepEqual(context.interactionMoveHandoffTarget, {
  sourceAssistantMoveId: "assistant-greeting-1",
  sourceGreetingFunction: "ask_one_bounded_low_burden_question",
  envelope: greetingEnvelope,
});

const interpretation = interpretTurnDeterministically(context);
assert(interpretation.userMoveRelation);
assert.equal(interpretation.userMoveRelation.sourceUserTurnId, "user-turn-1");
assert.equal(
  interpretation.userMoveRelation.targetAssistantMoveId,
  "assistant-greeting-1"
);
assert.equal(
  interpretation.userMoveRelation.targetFunction,
  "ask_one_bounded_low_burden_question"
);
assert(interpretation.userMoveRelation.candidates.length > 0);

const exactText = "  回来啦  ";
const exactContext = buildContext({ userMessage: exactText, currentTurnId: "user-turn-exact" });
const exactProjection = interpretTurnDeterministically(exactContext).userMoveRelation;
assert(exactProjection);
for (const candidate of exactProjection.candidates) {
  assert.deepEqual(candidate.evidence, [{
    source: "current_user_turn",
    sourceUserTurnId: "user-turn-exact",
    start: 0,
    end: exactText.length,
    text: exactText,
  }]);
}

const target = context.interactionMoveHandoffTarget as ActiveInteractionMoveHandoffTarget;
const relationCases: Array<{
  relation: RelationalInterpretationCandidate["relation"];
  expected: UserMoveRelationKind;
  semanticEvidenceStatus?: "sufficient" | "insufficient";
}> = [
  { relation: "acknowledges_previous_move", expected: "reciprocates_move" },
  { relation: "answers_previous_move", expected: "answers_move" },
  { relation: "continues_active_thread", expected: "continues_from_move" },
  { relation: "opens_new_thread", expected: "opens_or_redirects_thread" },
  { relation: "challenges_move_fit", expected: "challenges_move_fit" },
  { relation: "rejects_or_declines_move", expected: "rejects_or_declines_move" },
  { relation: "requests_pause", expected: "sets_boundary_or_pause" },
  {
    relation: "continues_active_thread",
    expected: "unclear",
    semanticEvidenceStatus: "insufficient",
  },
];

for (const [index, relationCase] of relationCases.entries()) {
  const projection = projectUserMoveRelation({
    target,
    sourceUserTurnId: `user-turn-kind-${index + 1}`,
    currentUserText: `relation evidence ${index + 1}`,
    semanticEvidenceStatus: relationCase.semanticEvidenceStatus ?? "sufficient",
    responseRelation: {
      candidates: [{
        relation: relationCase.relation,
        confidence: 0.8,
        targetTurnId: target.sourceAssistantMoveId,
        evidence: ["free explanatory labels are not projected as evidence"],
      }],
      ambiguous: false,
    },
  });
  assert.equal(projection?.candidates[0]?.kind, relationCase.expected);
  assert.equal(projection?.candidates[0]?.confidence, 0.8);
  assert.equal(typeof projection?.candidates[0]?.evidence[0], "object");
}
assert.equal(new Set(relationCases.map((item) => item.expected)).size, 8);

const ambiguousProjection = projectUserMoveRelation({
  target,
  sourceUserTurnId: "user-turn-ambiguous",
  currentUserText: "也算回答了，不过我想换一件事",
  semanticEvidenceStatus: "sufficient",
  responseRelation: {
    candidates: [
      {
        relation: "answers_previous_move",
        confidence: 0.82,
        targetTurnId: target.sourceAssistantMoveId,
        evidence: ["answer candidate"],
      },
      {
        relation: "opens_new_thread",
        confidence: 0.78,
        targetTurnId: target.sourceAssistantMoveId,
        evidence: ["redirect candidate"],
      },
    ],
    ambiguous: true,
  },
});
assert.deepEqual(
  ambiguousProjection?.candidates.map((candidate) => candidate.kind),
  ["answers_move", "opens_or_redirects_thread"]
);
assert.equal(ambiguousProjection?.ambiguous, true);

const modelMerged = mergeModelInterpretation(
  interpretation,
  {
    responseRelation: {
      candidates: [{
        relation: "opens_new_thread",
        confidence: 0.91,
        targetTurnId: target.sourceAssistantMoveId,
        evidence: ["model free explanation must not become source evidence"],
      }],
      ambiguous: false,
    },
    confidence: 0.91,
  },
  context
);
assert(modelMerged.userMoveRelation?.candidates.some(
  (candidate) => candidate.kind === "opens_or_redirects_thread"
));
assert(!JSON.stringify(modelMerged.userMoveRelation).includes("model free explanation"));

const reciprocalEnvelope = buildProactiveGreetingAssistantMoveEnvelope({
  assistantMoveId: "assistant-reciprocal-greeting",
  generationId: "generation-reciprocal-greeting",
  greetingMove: "simple_greeting",
});
const reciprocalText = "嗨";
const reciprocalContext = {
  ...buildContext({
    userMessage: reciprocalText,
    currentTurnId: "user-turn-reciprocal",
    recentMessages: [{
      id: reciprocalEnvelope.assistantMoveId,
      role: "assistant",
      content: "嗨，又见面了。",
      status: "saved",
      interactionMoveEnvelope: reciprocalEnvelope,
    }],
  }),
  semanticEvidence: {
    status: "insufficient" as const,
    source: "none" as const,
    reason: "Reproduces the persisted low-information reciprocal trace.",
  },
};
const reciprocalDeterministic = interpretTurnDeterministically(reciprocalContext);
const mergeReciprocalCandidates = (
  candidates: RelationalInterpretationCandidate[]
) => mergeModelInterpretation(
  reciprocalDeterministic,
  {
    responseRelation: {
      candidates,
      ambiguous: candidates.length > 1,
    },
    confidence: 0.91,
  },
  reciprocalContext
);
const modelCandidate = (
  relation: RelationalInterpretationCandidate["relation"],
  confidence = 0.91,
  targetTurnId = reciprocalEnvelope.assistantMoveId
): RelationalInterpretationCandidate => ({
  relation,
  confidence,
  targetTurnId,
  evidence: [`model ${relation} relation`],
});
const reciprocalMerged = mergeReciprocalCandidates([
  modelCandidate("acknowledges_previous_move"),
]);
assert.deepEqual(
  reciprocalMerged.userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move"]
);
assert.deepEqual(
  reciprocalMerged.responseRelation.candidates.map((candidate) => candidate.relation),
  ["acknowledges_previous_move", "shares_initiative"]
);
assert(!reciprocalMerged.responseRelation.candidates.some((candidate) =>
  candidate.relation === "continues_active_thread"
));
assert.deepEqual(reciprocalMerged.userMoveRelation?.candidates[0]?.evidence, [{
  source: "current_user_turn",
  sourceUserTurnId: "user-turn-reciprocal",
  start: 0,
  end: reciprocalText.length,
  text: reciprocalText,
}]);

assert.deepEqual(
  mergeModelInterpretation(
    reciprocalDeterministic,
    null,
    reciprocalContext
  ).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move", "unclear"]
);
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("acknowledges_previous_move", 0.54),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move", "unclear"]
);
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("acknowledges_previous_move", 0.91, "wrong-assistant-target"),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move", "unclear"]
);
const targetlessReciprocalMerged = mergeReciprocalCandidates([{
  relation: "acknowledges_previous_move",
  confidence: 0.91,
  evidence: ["model targetless reciprocal relation"],
}]);
assert.deepEqual(
  targetlessReciprocalMerged.userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move", "unclear"]
);
assert(targetlessReciprocalMerged.responseRelation.candidates.some((candidate) =>
  candidate.relation === "continues_active_thread" &&
  candidate.confidence === 0.68
));
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("continues_active_thread"),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["unclear", "reciprocates_move"]
);
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("acknowledges_previous_move"),
    modelCandidate("continues_active_thread", 0.87),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["reciprocates_move", "unclear"]
);
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("opens_new_thread"),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["opens_or_redirects_thread", "reciprocates_move"]
);
assert.deepEqual(
  mergeReciprocalCandidates([
    modelCandidate("opens_new_thread", 0.93),
    modelCandidate("acknowledges_previous_move", 0.88),
  ]).userMoveRelation?.candidates.map((candidate) => candidate.kind),
  ["opens_or_redirects_thread", "reciprocates_move"]
);

const mismatchProjection = projectUserMoveRelation({
  target,
  sourceUserTurnId: "user-turn-mismatch",
  currentUserText: "target mismatch",
  semanticEvidenceStatus: "sufficient",
  responseRelation: {
    candidates: [{
      relation: "answers_previous_move",
      confidence: 0.99,
      targetTurnId: "another-assistant-move",
      evidence: [],
    }],
    ambiguous: false,
  },
});
assert.equal(mismatchProjection, null);

const ordinaryMove: CommittedAssistantMove = {
  purpose: ["ordinary_reply"],
  claims: [],
  assumptions: [],
  questionOrRequest: null,
  expectedUserContribution: "none",
  userBurden: "none",
  sourceTurnId: "user-turn-ordinary",
  evidence: ["committed ordinary response"],
};
const responseEnvelope = buildResponsePlanAssistantMoveEnvelope({
  assistantMoveId: "assistant-response-1",
  planId: "plan-1",
  sourceUserTurnId: "user-turn-ordinary",
  committedMove: ordinaryMove,
});

const failClosedCases: Array<[string, AiConversationMessage[]]> = [
  ["only-prompt-version", [{
    id: "assistant-greeting-1",
    role: "assistant",
    content: "你好。",
    promptVersion: "chat-proactive-greeting-v4",
  }]],
  ["mismatched-event-id", [greetingMessage({ id: "different-assistant-event" })]],
  ["blocked-uncommitted-event", [greetingMessage({ status: "blocked" })]],
  ["non-open-response-envelope", [{
    id: "assistant-response-1",
    role: "assistant",
    content: "普通回复。",
    status: "saved",
    interactionMoveEnvelope: responseEnvelope,
  }]],
  ["earlier-greeting-after-newer-assistant", [
    greetingMessage(),
    { id: "user-between", role: "user", content: "上一轮用户消息", status: "saved" },
    { id: "assistant-newer", role: "assistant", content: "更新的回复", status: "saved" },
  ]],
  ["last-event-is-user", [
    greetingMessage(),
    { id: "user-newer", role: "user", content: "更新的用户消息", status: "saved" },
  ]],
  ["malformed-envelope", [{
    id: "assistant-greeting-1",
    role: "assistant",
    content: "你好。",
    status: "saved",
    interactionMoveEnvelope: {
      ...greetingEnvelope,
      unexpected: true,
    } as unknown as typeof greetingEnvelope,
  }]],
];

for (const [name, recentMessages] of failClosedCases) {
  const failed = buildContext({ recentMessages });
  assert.equal(failed.interactionMoveHandoffTarget, null, name);
  assert.equal(interpretTurnDeterministically(failed).userMoveRelation, null, name);
}

const authenticatedContext = buildContext({ recentMessages: [greetingMessage()] });
const guestContext = buildContext({
  recentMessages: [{
    role: "assistant",
    content: greetingMessage().content,
    interactionMoveEnvelope: greetingEnvelope,
  }],
});
assert.deepEqual(
  guestContext.interactionMoveHandoffTarget,
  authenticatedContext.interactionMoveHandoffTarget
);
assert.deepEqual(
  interpretTurnDeterministically(guestContext).userMoveRelation,
  interpretTurnDeterministically(authenticatedContext).userMoveRelation
);

const handoffSource = readFileSync(
  new URL("../conversation-os/control/interactionMoveHandoff.ts", import.meta.url),
  "utf8"
);
const interpreterSource = readFileSync(
  new URL("../conversation-os/control/turnInterpreter.ts", import.meta.url),
  "utf8"
);
assert(!handoffSource.includes("RegExp"));
assert(!handoffSource.includes(".match("));
assert(!handoffSource.includes(".test("));
assert(!handoffSource.includes("promptVersion"));
assert(!interpreterSource.includes("requiredFunction"));
assert(!interpreterSource.includes("completionIntent"));
assert(!interpreterSource.includes(`"${reciprocalText}"`));

console.log(JSON.stringify({
  activeTarget: "strict adjacent opens envelope",
  candidateKinds: relationCases.map((item) => item.expected),
  failClosedCases: failClosedCases.map(([name]) => name),
  exactSpan: true,
  multipleCandidatesPreserved: true,
  adjacencyFallbackReconciled: true,
  guestAuthenticatedParity: true,
  plannerSelection: false,
}, null, 2));
