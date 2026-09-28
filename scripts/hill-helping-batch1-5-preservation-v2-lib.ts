import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildCommittedResponseMove } from "../conversation-os";
import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import type { ConversationMessage } from "../conversation-os/types";
import {
  parseCommittedAssistantMoveMetadata,
  serializeCommittedAssistantMoveMetadata,
} from "../services/helping/committedHelpingMoveMetadata";
import { validateResponsePlanOutput } from "../services/ai/responsePlanValidator";
import {
  PRESERVATION_DATASET_PATH,
  type PreservationDataset,
} from "./hill-helping-batch1-5-preservation-lib";

export const PRESERVATION_V2_DATASET_PATH =
  "clinical-evals/hill-helping-batch1-5-preservation-v2-committed-history.json";
export const PRESERVATION_V2_DATASET_VERSION =
  "hill-helping-batch1-5-preservation-v2-committed-history-2026-09-28";
export const PRESERVATION_V1_SHA256 =
  "12bd41f3c6c4370ddc3593cf997203037bc321a3b40d890ce196e9f6bcd6f243";
export const PRESERVATION_V2_GENERATOR = "scripts/hill-helping-batch1-5-preservation-v2-generate.ts";

const IDENTITY_REFERENCE = /(?:名字|叫什么|你是谁|你是.{0,4}(?:AI|人工智能|机器人|真人|医生)|慢聊|小记)/iu;

export type HistoryDerivation =
  | {
      assistantTurnId: string;
      outcome: "explicit_empty_claims";
      sourceUserTurnId: string;
      derivedPlanId: string;
      derivedPlanActions: string[];
      derivedQuestionPolicy: string;
      groundingFactCount: 0;
      requiredDisclosureCount: 0;
      openObligationCount: 0;
      assistantTextValidatesUnderDerivedPlan: boolean;
      metadataRoundTrip: "valid";
    }
  | {
      assistantTurnId: string;
      outcome: "unchanged_claims_unconfirmed";
      reasons: string[];
    };

const deriveAssistantTurn = ({
  scenarioId,
  userTurn,
  assistantTurn,
}: {
  scenarioId: string;
  userTurn: ConversationMessage | undefined;
  assistantTurn: ConversationMessage;
}): { message: ConversationMessage; derivation: HistoryDerivation } => {
  const assistantTurnId = assistantTurn.id ?? "";
  const reasons: string[] = [];
  if (!assistantTurnId) reasons.push("assistant_turn_id_missing");
  if (!userTurn || userTurn.role !== "user" || !userTurn.id) reasons.push("source_user_turn_missing");
  if (assistantTurn.committedAssistantMove !== undefined || assistantTurn.interactionMoveEnvelope !== undefined) {
    reasons.push("existing_committed_history_present");
  }
  if (userTurn && (IDENTITY_REFERENCE.test(userTurn.content) || IDENTITY_REFERENCE.test(assistantTurn.content))) {
    reasons.push("identity_reference_may_require_disclosure_claims");
  }
  if (reasons.length > 0 || !userTurn?.id) {
    return { message: assistantTurn, derivation: { assistantTurnId, outcome: "unchanged_claims_unconfirmed", reasons } };
  }

  const conversationId = `preservation-v2:${scenarioId}`;
  const conversationState = determineConversationState({
    currentUserMessage: userTurn.content,
    recentMessages: [],
  });
  const context = assembleConversationControlContext({
    conversationId,
    currentTurnId: userTurn.id,
    userMessage: userTurn.content,
    recentMessages: [],
    conversationState,
  });
  const interpretation = interpretTurnDeterministically(context);
  const dialogueState = buildDialogueState(context, interpretation);
  const plan = createResponsePlan({
    context,
    interpretation,
    dialogueState,
    clinicalAdviceProvider: () => ({
      strategy: "preservation-v2-history-derivation",
      intent: "support",
      questionFunction: "none",
      toneConstraints: [],
      interventionBoundaries: [],
      evidence: ["Claims never depend on clinical advice; this provider only satisfies the Planner signature."],
    }),
  });
  if (plan.groundingFacts.length > 0) reasons.push("derived_plan_has_grounding_facts");
  if (plan.requiredDisclosure.length > 0) reasons.push("derived_plan_has_required_disclosure");
  if (dialogueState.openObligations.length > 0) reasons.push("derived_turn_has_open_obligations");

  const committedMove = buildCommittedResponseMove({
    plan,
    replyText: assistantTurn.content,
    sourceUserTurnId: userTurn.id,
    planId: plan.planId,
    requestId: `${conversationId}:history-derivation`,
  });
  if (committedMove.claims.length > 0) reasons.push("production_builder_emitted_claims");
  const metadata = serializeCommittedAssistantMoveMetadata({ assistantMove: committedMove });
  const readBack = parseCommittedAssistantMoveMetadata(JSON.parse(JSON.stringify(metadata)));
  if (readBack.status !== "valid") reasons.push("metadata_round_trip_invalid");
  if (readBack.status === "valid" && readBack.assistantMove.claims.length !== 0) {
    reasons.push("metadata_round_trip_claims_not_empty");
  }
  if (reasons.length > 0 || readBack.status !== "valid") {
    return { message: assistantTurn, derivation: { assistantTurnId, outcome: "unchanged_claims_unconfirmed", reasons } };
  }

  return {
    message: {
      ...assistantTurn,
      status: "saved",
      replyToMessageId: userTurn.id,
      committedAssistantMove: readBack.assistantMove,
    },
    derivation: {
      assistantTurnId,
      outcome: "explicit_empty_claims",
      sourceUserTurnId: userTurn.id,
      derivedPlanId: plan.planId,
      derivedPlanActions: plan.responseActions,
      derivedQuestionPolicy: plan.questionPolicy.mode,
      groundingFactCount: 0,
      requiredDisclosureCount: 0,
      openObligationCount: 0,
      assistantTextValidatesUnderDerivedPlan: validateResponsePlanOutput({
        plan,
        reply: assistantTurn.content,
      }).passed,
      metadataRoundTrip: "valid",
    },
  };
};

export const derivePreservationV2Dataset = ({
  source,
  sourceSha256,
}: {
  source: PreservationDataset;
  sourceSha256: string;
}) => {
  const provenance: Array<{ scenarioId: string; derivations: HistoryDerivation[] }> = [];
  const scenarios = source.scenarios.map((scenario) => {
    const derivations: HistoryDerivation[] = [];
    const recentMessages = scenario.recentMessages.map((message, index) => {
      if (message.role !== "assistant") return message;
      const { message: derived, derivation } = deriveAssistantTurn({
        scenarioId: scenario.id,
        userTurn: scenario.recentMessages[index - 1],
        assistantTurn: message,
      });
      derivations.push(derivation);
      return derived;
    });
    if (derivations.length > 0) provenance.push({ scenarioId: scenario.id, derivations });
    return { ...scenario, recentMessages };
  });
  return {
    schemaVersion: source.schemaVersion,
    datasetVersion: PRESERVATION_V2_DATASET_VERSION,
    status: source.status,
    purpose: source.purpose,
    gate: source.gate,
    derivedFrom: {
      path: PRESERVATION_DATASET_PATH,
      datasetVersion: source.datasetVersion,
      sha256: sourceSha256,
    },
    derivation: {
      generator: PRESERVATION_V2_GENERATOR,
      method: [
        "Each Assistant history turn is rebuilt as production commits it: buildCommittedResponseMove over the production deterministic ResponsePlan for its preceding User turn, then serializeCommittedAssistantMoveMetadata and parseCommittedAssistantMoveMetadata as the next-turn read path does.",
        "claims: [] is written only when the derived plan has no grounding facts, no required disclosure and no open obligations, neither text references Assistant identity, and the round-tripped metadata is valid with zero claims.",
        "Any other Assistant turn is left unchanged, so missing or unconfirmed claims never become claims: [].",
        "No interaction-move envelope is written: production envelopes require validated commit evidence that a fixture cannot supply.",
      ],
      differences: [
        "Assistant turns that pass derivation gain status=saved, replyToMessageId=<preceding User turn id> and committedAssistantMove; content, ids, User turns, userMessage, expectedAction and gate are unchanged.",
      ],
      comparability: [
        "v2 is not equivalent to v1. v1 60/60 was measured with Assistant history carrying no committed move, so claims were unavailable; v2 measures the same 20 scenarios under production-protocol committed history.",
        "Emotional-support scenarios have no history and are input-identical between v1 and v2.",
        "Ordinary-repair scenarios differ in committed claims authority and lastCommittedAssistantMove (purpose, questionOrRequest), which can change interpretation and planning; v2 results must not be read as a v1 re-run.",
        "The committed move is derived from the deterministic plan because the historical Assistant texts were authored, not generated; assistantTextValidatesUnderDerivedPlan records whether that text would pass the derived plan.",
      ],
      provenance,
    },
    scenarios,
  };
};

export const loadPreservationV1Source = () => {
  const bytes = readFileSync(PRESERVATION_DATASET_PATH);
  return {
    source: JSON.parse(bytes.toString("utf8")) as PreservationDataset,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

export const serializePreservationV2Dataset = (dataset: ReturnType<typeof derivePreservationV2Dataset>) =>
  `${JSON.stringify(dataset, null, 2)}\n`;
