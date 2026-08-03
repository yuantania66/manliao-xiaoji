import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { CommittedAssistantMove } from "@/conversation-os";
import {
  COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION,
  CommittedAssistantMoveMetadataError,
  parseCommittedAssistantMoveMetadata,
  serializeCommittedAssistantMoveMetadata,
  type CommittedHelpingMove,
} from "@/services/helping";

const root = process.cwd();

const ordinaryMove = (): CommittedAssistantMove => ({
  purpose: ["offer_emotional_support"],
  claims: [{
    text: "你现在有些担心",
    subject: "user",
    source: "current_turn",
    provenance: ["turn-user-001"],
  }],
  assumptions: [{ text: "可能需要降低表达压力", status: "hypothesized" }],
  questionOrRequest: null,
  expectedUserContribution: "none",
  userBurden: "low",
  sourceTurnId: "turn-user-001",
  evidence: ["current user turn"],
});

const helpingMove = (): CommittedHelpingMove => ({
  assistantTurnId: "turn-assistant-001",
  planId: "hill-plan-001",
  primaryGoal: "exploration",
  relationshipPriority: "none",
  intention: "offer_support",
  primarySkill: "attending_and_support",
  assumptions: [],
  evidence: ["validated formal Hill plan"],
  expectedUserResponse: ["The user may continue or stay brief."],
  stopOrReassessWhen: ["The user asks to pause or changes the topic."],
});

const expectInvalid = (value: unknown, label: string) => {
  const result = parseCommittedAssistantMoveMetadata(value);
  assert.equal(result.status, "invalid", label);
};

assert.equal(COMMITTED_HELPING_MOVE_METADATA_SCHEMA_VERSION, 1);
assert.deepEqual(parseCommittedAssistantMoveMetadata(null), { status: "absent" });

const legacyResult = parseCommittedAssistantMoveMetadata(ordinaryMove());
assert.equal(legacyResult.status, "valid");
if (legacyResult.status === "valid") {
  assert.equal(legacyResult.source, "legacy_ordinary");
  assert.equal(legacyResult.helping, null);
  assert.deepEqual(legacyResult.assistantMove, ordinaryMove());
}

const serialized = serializeCommittedAssistantMoveMetadata({
  assistantMove: ordinaryMove(),
  helping: helpingMove(),
});
assert.deepEqual(serialized.helping, {
  schemaVersion: 1,
  state: "formal",
  move: helpingMove(),
});

const roundTrip = parseCommittedAssistantMoveMetadata(JSON.parse(JSON.stringify(serialized)));
assert.equal(roundTrip.status, "valid");
if (roundTrip.status === "valid") {
  assert.equal(roundTrip.source, "formal_v1");
  assert.deepEqual(roundTrip.assistantMove, ordinaryMove());
  assert.deepEqual(roundTrip.helping, helpingMove());
  assert.equal("helping" in roundTrip.assistantMove, false);
}

const serializedOrdinary = serializeCommittedAssistantMoveMetadata({ assistantMove: ordinaryMove() });
assert.equal("helping" in serializedOrdinary, false);
assert.equal(parseCommittedAssistantMoveMetadata(serializedOrdinary).status, "valid");

expectInvalid({ ...ordinaryMove(), unknownField: true }, "unknown top-level fields must fail closed");
expectInvalid(
  { ...ordinaryMove(), claims: [{ ...ordinaryMove().claims[0], unknownField: true }] },
  "unknown nested Assistant move fields must fail closed"
);
expectInvalid({ ...ordinaryMove(), sourceTurnId: " " }, "empty sourceTurnId must fail closed");
expectInvalid({ ...ordinaryMove(), purpose: [1] }, "bad ordinary array types must fail closed");
expectInvalid(
  { ...ordinaryMove(), expectedUserContribution: "explain" },
  "unknown ordinary enum values must fail closed"
);

expectInvalid(
  { ...ordinaryMove(), helping: helpingMove() },
  "unversioned Helping move must not enter formal state"
);
expectInvalid(
  { ...serialized, helping: { ...serialized.helping!, schemaVersion: 2 } },
  "unknown Helping metadata versions must fail closed"
);
expectInvalid(
  { ...serialized, helping: { ...serialized.helping!, state: "shadow" } },
  "Shadow state must not parse as formal state"
);
expectInvalid(
  { ...serialized, helping: { mode: "shadow", move: helpingMove() } },
  "Shadow trace shape must not parse as formal state"
);
expectInvalid(
  {
    ...serialized,
    helping: { ...serialized.helping!, unknownField: "shadow-provenance" },
  },
  "unknown Helping envelope fields must fail closed"
);
expectInvalid(
  {
    ...serialized,
    helping: {
      ...serialized.helping!,
      move: { ...helpingMove(), mode: "shadow" },
    },
  },
  "Shadow markers must not be hidden inside a formal move"
);
expectInvalid(
  {
    ...serialized,
    helping: {
      ...serialized.helping!,
      move: { ...helpingMove(), assistantTurnId: "" },
    },
  },
  "empty formal identity fields must fail closed"
);
expectInvalid(
  {
    ...serialized,
    helping: {
      ...serialized.helping!,
      move: { ...helpingMove(), evidence: [] },
    },
  },
  "formal Helping moves require evidence"
);
expectInvalid(
  {
    ...serialized,
    helping: {
      ...serialized.helping!,
      move: { ...helpingMove(), primarySkill: "direct_guidance" },
    },
  },
  "goal-skill mismatch must fail closed"
);
expectInvalid(
  {
    ...serialized,
    helping: {
      ...serialized.helping!,
      move: {
        ...helpingMove(),
        relationshipPriority: "repair",
        intention: "repair_current_helping_relationship",
        primarySkill: "relationship_repair",
      },
    },
  },
  "repair records must pause goal selection"
);

const validRepair = serializeCommittedAssistantMoveMetadata({
  assistantMove: ordinaryMove(),
  helping: {
    assistantTurnId: "turn-assistant-repair",
    planId: "hill-plan-repair",
    relationshipPriority: "repair",
    intention: "repair_current_helping_relationship",
    primarySkill: "relationship_repair",
    assumptions: [],
    evidence: ["current relationship strain"],
    expectedUserResponse: ["The user may accept, reject, or correct the repair."],
    stopOrReassessWhen: ["The user rejects the repair."],
  },
});
assert.equal(parseCommittedAssistantMoveMetadata(validRepair).status, "valid");

assert.throws(
  () => serializeCommittedAssistantMoveMetadata({
    assistantMove: ordinaryMove(),
    helping: { ...helpingMove(), planId: "" },
  }),
  CommittedAssistantMoveMetadataError,
  "the serializer must not emit invalid formal metadata"
);
assert.throws(
  () => serializeCommittedAssistantMoveMetadata({
    assistantMove: { ...ordinaryMove(), unknownField: undefined } as CommittedAssistantMove,
  }),
  CommittedAssistantMoveMetadataError,
  "the serializer must reject unknown fields before JSON cloning can erase them"
);

const shadowTrace = {
  mode: "shadow",
  enabled: true,
  decision: { status: "decided", plan: {} },
  provider: { attempted: true, used: true, reason: "fixture" },
  inputEvidence: [],
};
expectInvalid(shadowTrace, "a complete Shadow trace must not parse as committed state");

const classInstance = Object.assign(new (class Metadata {})(), ordinaryMove());
expectInvalid(classInstance, "non-JSON object prototypes must fail closed");

const routeSource = readFileSync(
  path.join(root, "app/api/chat/sessions/[sessionId]/messages/route.ts"),
  "utf8"
);
assert.match(routeSource, /parseCommittedAssistantMoveMetadata\(item\.interactionMetadata\)/u);
assert.doesNotMatch(routeSource, /interactionMetadata\s+as\s+[\s\S]{0,120}lastCommittedAssistantMove/u);
assert.doesNotMatch(
  routeSource,
  /parsedMetadata\.helping/u,
  "Batch 2A must not feed formal Helping history into current decisions"
);

console.log("Hill Helping Batch 2A contract check passed.");
console.log("- versioned formal metadata round-trip: pass");
console.log("- strict legacy ordinary projection: pass");
console.log("- unknown/invalid schema rejection: pass");
console.log("- formal/Shadow isolation: pass");
console.log("- no Helping decision-state injection: pass");
