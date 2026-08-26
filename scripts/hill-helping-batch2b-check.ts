import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT,
  loadFormalCommittedHelpingMoveFixtures,
  lookupAssociatedCommittedHelpingMove,
  type FormalHelpingMoveFixtureRecord,
  type HelpingAssociationSemanticEvidence,
} from "@/services/helping";

import {
  BATCH2B_FIXTURE_SESSION_ID,
  BATCH2B_FORMAL_FIXTURE_RECORDS,
  buildBatch2BFormalRecord,
  buildBatch2BOrdinaryMove,
} from "./hill-helping-batch2b-fixtures";

const root = process.cwd();
const target01 = "assistant-formal-01";
const target09 = "assistant-formal-09";
const target10 = "assistant-formal-10";
const currentUserTurnId = "user-current-001";
const evidence = ({
  targetAssistantTurnId,
  relation,
  sourceUserTurnId = currentUserTurnId,
  evidenceText = `${relation} evidence for ${targetAssistantTurnId}`,
}: {
  targetAssistantTurnId: string;
  relation: HelpingAssociationSemanticEvidence["relation"];
  sourceUserTurnId?: string;
  evidenceText?: string;
}): HelpingAssociationSemanticEvidence => ({
  sourceUserTurnId,
  targetAssistantTurnId,
  relation,
  evidence: [evidenceText],
});

assert.equal(FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT, 8);
assert.equal(BATCH2B_FORMAL_FIXTURE_RECORDS.length, 17);

const defaultLoad = loadFormalCommittedHelpingMoveFixtures({
  records: BATCH2B_FORMAL_FIXTURE_RECORDS,
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
assert.deepEqual(
  defaultLoad.moves.map((item) => item.messageId),
  Array.from({ length: 8 }, (_, index) =>
    `assistant-formal-${String(index + 3).padStart(2, "0")}`
  ),
  "the default window must contain the latest eight formal moves in commit order"
);
assert.ok(defaultLoad.moves.every((item) => item.move.assistantTurnId === item.messageId));
assert.equal(defaultLoad.trace.filter((item) => item.reason === "ordinary_without_helping").length, 1);
assert.equal(defaultLoad.trace.filter((item) => item.reason === "metadata_invalid").length, 3);
assert.equal(defaultLoad.trace.filter((item) => item.reason === "non_assistant_role").length, 1);
assert.equal(defaultLoad.trace.filter((item) => item.reason === "assistant_turn_mismatch").length, 1);
assert.equal(defaultLoad.trace.filter((item) => item.reason === "different_session").length, 1);

const explicitOlderTargetLoad = loadFormalCommittedHelpingMoveFixtures({
  records: [...BATCH2B_FORMAL_FIXTURE_RECORDS].reverse(),
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
  explicitTargetAssistantTurnId: target01,
});
assert.deepEqual(
  explicitOlderTargetLoad.moves.map((item) => item.messageId),
  [target01, "assistant-formal-04", "assistant-formal-05", "assistant-formal-06",
    "assistant-formal-07", "assistant-formal-08", target09, target10],
  "an explicit older target must replace one window slot without breaking the bound"
);
assert.equal(explicitOlderTargetLoad.moves.length, FORMAL_HELPING_MOVE_FIXTURE_WINDOW_LIMIT);
assert.deepEqual(
  explicitOlderTargetLoad.moves.map((item) => item.committedOrder),
  [1, 4, 5, 6, 7, 8, 9, 10],
  "input order must not override committed order"
);

const sourceRecord = buildBatch2BFormalRecord({
  messageId: "assistant-clone-isolation",
  committedOrder: 18,
});
const isolatedLoad = loadFormalCommittedHelpingMoveFixtures({
  records: [sourceRecord],
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
const sourceMetadata = sourceRecord.interactionMetadata as {
  helping: { move: { planId: string } };
};
sourceMetadata.helping.move.planId = "mutated-after-load";
assert.notEqual(isolatedLoad.moves[0].move.planId, "mutated-after-load", "loaded moves must be cloned");

const duplicateIdRecords = [
  buildBatch2BFormalRecord({ messageId: "assistant-duplicate", committedOrder: 20 }),
  buildBatch2BFormalRecord({ messageId: "assistant-duplicate", committedOrder: 21 }),
];
const duplicateIdLoad = loadFormalCommittedHelpingMoveFixtures({
  records: duplicateIdRecords,
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
assert.equal(duplicateIdLoad.moves.length, 0);
assert.ok(duplicateIdLoad.trace.every((item) => item.reason === "duplicate_message_id"));

const duplicateOrderRecords = [
  buildBatch2BFormalRecord({ messageId: "assistant-order-a", committedOrder: 22 }),
  buildBatch2BFormalRecord({ messageId: "assistant-order-b", committedOrder: 22 }),
];
const duplicateOrderLoad = loadFormalCommittedHelpingMoveFixtures({
  records: duplicateOrderRecords,
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
assert.equal(duplicateOrderLoad.moves.length, 0);
assert.ok(duplicateOrderLoad.trace.every((item) => item.reason === "duplicate_committed_order"));

const boundaryRecords: FormalHelpingMoveFixtureRecord[] = [
  {
    sessionId: BATCH2B_FIXTURE_SESSION_ID,
    messageId: "assistant-absent",
    role: "assistant",
    committedOrder: 30,
    interactionMetadata: null,
  },
  {
    sessionId: BATCH2B_FIXTURE_SESSION_ID,
    messageId: "assistant-bad-order",
    role: "assistant",
    committedOrder: Number.NaN,
    interactionMetadata: buildBatch2BOrdinaryMove("user-bad-order"),
  },
];
const boundaryLoad = loadFormalCommittedHelpingMoveFixtures({
  records: boundaryRecords,
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
assert.equal(boundaryLoad.moves.length, 0);
assert.deepEqual(boundaryLoad.trace.map((item) => item.reason), [
  "metadata_absent",
  "invalid_committed_order",
]);

const directAssociation = lookupAssociatedCommittedHelpingMove({
  loadedMoves: explicitOlderTargetLoad.moves,
  currentUserTurnId,
  explicitReplyToAssistantTurnId: target01,
  semanticEvidence: [evidence({ targetAssistantTurnId: target01, relation: "direct_response" })],
});
assert.equal(directAssociation.status, "associated");
if (directAssociation.status === "associated") {
  assert.equal(directAssociation.targetAssistantTurnId, target01);
  assert.equal(directAssociation.relation, "direct_response");
}

const semanticOnlyAssociation = lookupAssociatedCommittedHelpingMove({
  loadedMoves: defaultLoad.moves,
  currentUserTurnId,
  semanticEvidence: [evidence({ targetAssistantTurnId: target09, relation: "continues_move" })],
});
assert.equal(semanticOnlyAssociation.status, "associated");

const correctionAssociation = lookupAssociatedCommittedHelpingMove({
  loadedMoves: explicitOlderTargetLoad.moves,
  currentUserTurnId,
  correctionTargetAssistantTurnId: target01,
  semanticEvidence: [evidence({ targetAssistantTurnId: target01, relation: "rejects_move" })],
});
assert.equal(correctionAssociation.status, "associated");

const expectNoAssociation = ({
  reason,
  loadedMoves = defaultLoad.moves,
  explicitReplyToAssistantTurnId,
  correctionTargetAssistantTurnId,
  semanticEvidence,
}: {
  reason: string;
  loadedMoves?: typeof defaultLoad.moves;
  explicitReplyToAssistantTurnId?: string;
  correctionTargetAssistantTurnId?: string;
  semanticEvidence: HelpingAssociationSemanticEvidence[];
}) => {
  const result = lookupAssociatedCommittedHelpingMove({
    loadedMoves,
    currentUserTurnId,
    explicitReplyToAssistantTurnId,
    correctionTargetAssistantTurnId,
    semanticEvidence,
  });
  assert.deepEqual(result, { status: "not_associated", reason });
};

expectNoAssociation({
  reason: "missing_target_bound_semantic_evidence",
  explicitReplyToAssistantTurnId: target10,
  semanticEvidence: [],
});
expectNoAssociation({
  reason: "non_associating_relation",
  explicitReplyToAssistantTurnId: target10,
  semanticEvidence: [evidence({ targetAssistantTurnId: target10, relation: "topic_shift" })],
});
expectNoAssociation({
  reason: "non_associating_relation",
  semanticEvidence: [evidence({ targetAssistantTurnId: target10, relation: "unclear" })],
});
expectNoAssociation({
  reason: "ambiguous_semantic_target",
  semanticEvidence: [
    evidence({ targetAssistantTurnId: target09, relation: "direct_response" }),
    evidence({ targetAssistantTurnId: target10, relation: "continues_move" }),
  ],
});
expectNoAssociation({
  reason: "ambiguous_relation",
  explicitReplyToAssistantTurnId: target10,
  semanticEvidence: [
    evidence({ targetAssistantTurnId: target10, relation: "direct_response" }),
    evidence({ targetAssistantTurnId: target10, relation: "topic_shift" }),
  ],
});
expectNoAssociation({
  reason: "missing_target_bound_semantic_evidence",
  explicitReplyToAssistantTurnId: target10,
  semanticEvidence: [evidence({
    targetAssistantTurnId: target10,
    relation: "direct_response",
    sourceUserTurnId: "stale-user-turn",
  })],
});
expectNoAssociation({
  reason: "target_not_formal",
  explicitReplyToAssistantTurnId: "assistant-ordinary",
  semanticEvidence: [evidence({
    targetAssistantTurnId: "assistant-ordinary",
    relation: "direct_response",
  })],
});
expectNoAssociation({
  reason: "target_not_formal",
  semanticEvidence: [
    evidence({ targetAssistantTurnId: target10, relation: "direct_response" }),
    evidence({ targetAssistantTurnId: "unknown-target", relation: "continues_move" }),
  ],
});
expectNoAssociation({
  reason: "correction_relation_mismatch",
  correctionTargetAssistantTurnId: target10,
  semanticEvidence: [evidence({ targetAssistantTurnId: target10, relation: "direct_response" })],
});

const conflictingTargets = lookupAssociatedCommittedHelpingMove({
  loadedMoves: defaultLoad.moves,
  currentUserTurnId,
  explicitReplyToAssistantTurnId: target09,
  correctionTargetAssistantTurnId: target10,
  semanticEvidence: [
    evidence({ targetAssistantTurnId: target09, relation: "direct_response" }),
    evidence({ targetAssistantTurnId: target10, relation: "rejects_move" }),
  ],
});
assert.deepEqual(conflictingTargets, {
  status: "not_associated",
  reason: "conflicting_explicit_targets",
});

const invalidEvidence = lookupAssociatedCommittedHelpingMove({
  loadedMoves: defaultLoad.moves,
  currentUserTurnId,
  semanticEvidence: [{
    sourceUserTurnId: currentUserTurnId,
    targetAssistantTurnId: target10,
    relation: "direct_response",
    evidence: [],
  }],
});
assert.deepEqual(invalidEvidence, { status: "not_associated", reason: "invalid_semantic_evidence" });

const classEvidence = Object.assign(
  new (class SemanticEvidence {})(),
  evidence({ targetAssistantTurnId: target10, relation: "direct_response" })
);
assert.deepEqual(
  lookupAssociatedCommittedHelpingMove({
    loadedMoves: defaultLoad.moves,
    currentUserTurnId,
    semanticEvidence: [classEvidence],
  }),
  { status: "not_associated", reason: "invalid_semantic_evidence" }
);

const ordinaryOnlyLoad = loadFormalCommittedHelpingMoveFixtures({
  records: [{
    sessionId: BATCH2B_FIXTURE_SESSION_ID,
    messageId: "ordinary-only",
    role: "assistant",
    committedOrder: 40,
    interactionMetadata: buildBatch2BOrdinaryMove("user-ordinary-only"),
  }],
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
});
assert.equal(ordinaryOnlyLoad.moves.length, 0);
assert.deepEqual(
  lookupAssociatedCommittedHelpingMove({
    loadedMoves: ordinaryOnlyLoad.moves,
    currentUserTurnId,
    semanticEvidence: [evidence({ targetAssistantTurnId: "ordinary-only", relation: "direct_response" })],
  }),
  { status: "not_associated", reason: "no_formal_moves" }
);

const productionSources = [
  "services/ai/chatOrchestrationService.ts",
  "app/api/chat/sessions/[sessionId]/messages/route.ts",
  "conversation-os/control/responsePlanner.ts",
  "services/ai/promptBuilder.ts",
  "services/ai/responsePlanValidator.ts",
  "services/memory/responseContextService.ts",
  "services/chat/proactiveGreetingService.ts",
];
let productionIntegrationDetected = false;
for (const sourcePath of productionSources) {
  const source = readFileSync(path.join(root, sourcePath), "utf8");
  productionIntegrationDetected ||= /loadFormalCommittedHelpingMoveFixtures/u.test(source) ||
    /lookupAssociatedCommittedHelpingMove/u.test(source);
  assert.doesNotMatch(source, /loadFormalCommittedHelpingMoveFixtures/u, sourcePath);
  assert.doesNotMatch(source, /lookupAssociatedCommittedHelpingMove/u, sourcePath);
}
const orchestrationSource = readFileSync(
  path.join(root, "services/ai/chatOrchestrationService.ts"),
  "utf8"
);
assert.doesNotMatch(
  orchestrationSource,
  /buildHillHelpingInput\(\{[\s\S]{0,500}recentCommittedHelpingMoves/u,
  "ordinary production orchestration must not read Helping decision state"
);
const associationSource = readFileSync(
  path.join(root, "services/helping/committedHelpingMoveAssociation.ts"),
  "utf8"
);
assert.doesNotMatch(associationSource, /initiativeOwner|initiativeDirection|assistant_invited/u);
assert.doesNotMatch(associationSource, /AiModelMessage|provider|promptMessages|memoryContext/u);

console.log(JSON.stringify({
  gate: "Batch 2B Fixture Load and Association",
  formalFixtureRecords: BATCH2B_FORMAL_FIXTURE_RECORDS.length,
  defaultFormalWindow: defaultLoad.moves.length,
  explicitOlderTargetLoaded: explicitOlderTargetLoad.moves.some((item) => item.messageId === target01),
  associationPasses: [directAssociation, semanticOnlyAssociation, correctionAssociation]
    .filter((result) => result.status === "associated").length,
  isolation: {
    shadowLoaded: defaultLoad.moves.some((item) => item.messageId.includes("shadow")),
    ordinaryLoaded: ordinaryOnlyLoad.moves.length > 0,
    productionIntegrationDetected,
  },
}, null, 2));
