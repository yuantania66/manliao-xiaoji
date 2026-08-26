import type { CommittedAssistantMove } from "@/conversation-os";
import {
  serializeCommittedAssistantMoveMetadata,
  type CommittedHelpingMove,
  type FormalHelpingMoveFixtureRecord,
} from "@/services/helping";

export const BATCH2B_FIXTURE_SESSION_ID = "batch2b-session-current";
export const BATCH2B_OTHER_SESSION_ID = "batch2b-session-other";

export const buildBatch2BOrdinaryMove = (sourceTurnId: string): CommittedAssistantMove => ({
  purpose: ["acknowledge_without_psychologizing"],
  claims: [],
  assumptions: [],
  questionOrRequest: null,
  expectedUserContribution: "none",
  userBurden: "none",
  sourceTurnId,
  evidence: ["Batch 2B fixture ordinary move."],
});

export const buildBatch2BHelpingMove = (
  assistantTurnId: string,
  planId = `plan-${assistantTurnId}`
): CommittedHelpingMove => ({
  assistantTurnId,
  planId,
  primaryGoal: "exploration",
  relationshipPriority: "none",
  intention: "offer_support",
  primarySkill: "attending_and_support",
  assumptions: [],
  evidence: [`Formal fixture evidence for ${assistantTurnId}.`],
  expectedUserResponse: ["The user may respond, stay brief, or change topic."],
  stopOrReassessWhen: ["The user rejects the move, pauses, or changes topic."],
});

export const buildBatch2BFormalRecord = ({
  messageId,
  committedOrder,
  sessionId = BATCH2B_FIXTURE_SESSION_ID,
  helpingAssistantTurnId = messageId,
  role = "assistant",
}: {
  messageId: string;
  committedOrder: number;
  sessionId?: string;
  helpingAssistantTurnId?: string;
  role?: "user" | "assistant";
}): FormalHelpingMoveFixtureRecord => ({
  sessionId,
  messageId,
  role,
  committedOrder,
  interactionMetadata: JSON.parse(JSON.stringify(serializeCommittedAssistantMoveMetadata({
    assistantMove: buildBatch2BOrdinaryMove(`user-for-${messageId}`),
    helping: buildBatch2BHelpingMove(helpingAssistantTurnId),
  }))),
});

const formalRecords = Array.from({ length: 10 }, (_, index) =>
  buildBatch2BFormalRecord({
    messageId: `assistant-formal-${String(index + 1).padStart(2, "0")}`,
    committedOrder: index + 1,
  })
);

const ordinaryRecord: FormalHelpingMoveFixtureRecord = {
  sessionId: BATCH2B_FIXTURE_SESSION_ID,
  messageId: "assistant-ordinary",
  role: "assistant",
  committedOrder: 11,
  interactionMetadata: buildBatch2BOrdinaryMove("user-ordinary"),
};

const shadowSource = buildBatch2BFormalRecord({
  messageId: "assistant-shadow",
  committedOrder: 12,
});
const shadowRecord: FormalHelpingMoveFixtureRecord = {
  ...shadowSource,
  interactionMetadata: {
    ...(shadowSource.interactionMetadata as Record<string, unknown>),
    helping: {
      ...((shadowSource.interactionMetadata as { helping: Record<string, unknown> }).helping),
      state: "shadow",
    },
  },
};

const unknownVersionSource = buildBatch2BFormalRecord({
  messageId: "assistant-unknown-version",
  committedOrder: 13,
});
const unknownVersionRecord: FormalHelpingMoveFixtureRecord = {
  ...unknownVersionSource,
  interactionMetadata: {
    ...(unknownVersionSource.interactionMetadata as Record<string, unknown>),
    helping: {
      ...((unknownVersionSource.interactionMetadata as { helping: Record<string, unknown> }).helping),
      schemaVersion: 2,
    },
  },
};

export const BATCH2B_FORMAL_FIXTURE_RECORDS: FormalHelpingMoveFixtureRecord[] = [
  ...formalRecords,
  ordinaryRecord,
  shadowRecord,
  unknownVersionRecord,
  buildBatch2BFormalRecord({
    messageId: "user-cannot-own-formal-move",
    committedOrder: 14,
    role: "user",
  }),
  buildBatch2BFormalRecord({
    messageId: "assistant-binding-mismatch",
    helpingAssistantTurnId: "another-assistant-turn",
    committedOrder: 15,
  }),
  buildBatch2BFormalRecord({
    messageId: "assistant-other-session",
    committedOrder: 16,
    sessionId: BATCH2B_OTHER_SESSION_ID,
  }),
  {
    sessionId: BATCH2B_FIXTURE_SESSION_ID,
    messageId: "assistant-full-shadow-trace",
    role: "assistant",
    committedOrder: 17,
    interactionMetadata: {
      mode: "shadow",
      enabled: true,
      decision: null,
      provider: { attempted: false, used: false, reason: "Batch 2B fixture." },
      inputEvidence: [],
    },
  },
];
