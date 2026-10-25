import { mergeModelInterpretation, type ConversationControlContext, type TurnInterpretation, type OrdinaryPostureSourceSpan } from "@/conversation-os/control";

import { callModel, getDefaultAiModel } from "./modelProvider";
import type { AiModelMessage } from "./types";
import { inspectPromptBeforeExternalCall } from "./externalPromptInspection";

const extractJsonObject = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Partial<TurnInterpretation>;
  } catch {
    return null;
  }
};

// Invalid quote binding must stop this turn, not silently become a fallback plan.
export class InterpretationQuoteLocationError extends Error {
  constructor(public readonly rawOutput: string) {
    super("Interpretation quote must uniquely match its declared User turn.");
    this.name = "InterpretationQuoteLocationError";
  }
}

export const locateInterpretationQuotes = (rawOutput: string, context: ConversationControlContext) => {
  const parsed = extractJsonObject(rawOutput);
  if (!parsed) return parsed;
  const fail = (): never => { throw new InterpretationQuoteLocationError(rawOutput); };
  const locateSpan = (raw: unknown): OrdinaryPostureSourceSpan => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const span = raw as Record<string, unknown>;
    const keys = Object.keys(span).sort().join(",");
    if (keys !== "source,sourceTurnId,text" && keys !== "end,source,sourceTurnId,start,text") return fail();
    if (typeof span.sourceTurnId !== "string" || typeof span.text !== "string" || !span.text.trim()) return fail();
    const sources = span.source === "current_user_turn"
      ? (span.sourceTurnId === context.currentTurnId ? [context.currentUserMessage] : [])
      : span.source === "adjacent_committed_user_turn"
        ? context.adjacentTurns.filter((turn) => turn.role === "user" && turn.status === "saved" && turn.id === span.sourceTurnId).map((turn) => turn.content)
        : [];
    if (sources.length !== 1) return fail();
    const source = sources[0];
    const start = source.indexOf(span.text);
    if (start < 0 || source.indexOf(span.text, start + 1) !== -1) return fail();
    return { source: span.source as OrdinaryPostureSourceSpan["source"], sourceTurnId: span.sourceTurnId,
      text: span.text, start, end: start + span.text.length };
  };
  const relation = parsed.acknowledgmentTreatmentEvidence;
  let acknowledgmentTreatmentEvidence: TurnInterpretation["acknowledgmentTreatmentEvidence"];
  if (relation !== undefined && relation !== null) {
    if (typeof relation !== "object" || Array.isArray(relation) ||
        Object.keys(relation).sort().join(",") !== "acknowledgment,treatment") return fail();
    const acknowledgment = locateSpan(relation.acknowledgment);
    const treatment = locateSpan(relation.treatment);
    if (acknowledgment.source !== "current_user_turn" || treatment.source !== "current_user_turn") return fail();
    acknowledgmentTreatmentEvidence = { acknowledgment, treatment };
  } else acknowledgmentTreatmentEvidence = relation;
  const proposal = parsed.ordinaryPostureProposal;
  if (!proposal) return { ...parsed, ...(relation !== undefined ? { acknowledgmentTreatmentEvidence } : {}) };
  if (!Array.isArray(proposal.sourceSpans) || !proposal.sourceSpans.length) return fail();
  const sourceSpans = proposal.sourceSpans.map(locateSpan);
  return { ...parsed, ...(relation !== undefined ? { acknowledgmentTreatmentEvidence } : {}),
    ordinaryPostureProposal: { ...proposal, sourceSpans } };
};

export const buildInterpretationMessages = (context: ConversationControlContext): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      "Interpret one conversational turn as structured evidence. Do not write a reply or choose a response strategy.",
      "Use adjacent turns and preserve multiple plausible response relations with separate confidence values.",
      "Use opens_new_thread only when the current User turn contains concrete content that independently introduces or redirects to a topic, proposition, or activity that the next reply can continue without first eliciting that content.",
      "A greeting, phatic acknowledgment, receipt, lack of topic content, or generic willingness to chat is not by itself opens_new_thread.",
      "Use continues_active_thread only when the current User turn contains concrete content that extends an already established topic, proposition, answer frame, or activity.",
      "Mere adjacency, reciprocal contact, a receipt, or a generic greeting is not by itself continues_active_thread.",
      "Use acknowledges_previous_move when the current User turn acknowledges, receives, or reciprocates the targeted move; preserve it alongside opens_new_thread or continues_active_thread when the same turn also independently satisfies that relation's concrete-content preconditions.",
      "Preserve multiple candidates only when each distinct semantic reading independently satisfies its own typed preconditions; do not add opens_new_thread or continues_active_thread as a generic hedge alongside acknowledgment.",
      "Do not infer emotion from message length, product category, or lack of topic content.",
      "Optionally propose ordinaryPostureProposal for this turn only. It is non-authoritative and must not carry over a prior mode.",
      "ordinaryPostureProposal is null or an object with exactly { mode: accompany|explore, sourceSpans, proposedContribution, evidence }. Each sourceSpans item has exactly { source: current_user_turn|adjacent_committed_user_turn, sourceTurnId: string, text: string }. Copy currentTurnId for the current User turn or the supplied adjacent committed User turn id; never invent an id or cite Assistant text. Copy an exact non-empty quote that occurs only once in that source turn. The program computes its UTF-16 start/end offsets; do not supply offsets.",
      "Report acknowledgmentTreatmentEvidence as an independent top-level field, not inside ordinaryPostureProposal or proposedContribution. It is null or exactly { acknowledgment: { source: current_user_turn, sourceTurnId: string, text: string }, treatment: { source: current_user_turn, sourceTurnId: string, text: string } }. Report this factual relation whenever the current User explicitly acknowledges a point and also explicitly expresses discomfort with a related way of being treated, whether or not you propose a posture. The treatment actor is any relevant party in the User-described event, including how that party acts or speaks toward the User; it is not restricted to the Assistant. Identify the actor from the current User text and supplied adjacent context, never default to the Assistant. A treatment actor other than the Assistant is not a reason to return null. If the actor is not established, do not invent one; report null when that uncertainty prevents establishing the stated relation. Each role must quote different non-overlapping current User content exactly and uniquely, with the supplied currentTurnId. The treatment quote includes the treatment and discomfort, not a feeling word alone. Report null if either role or their relation is uncertain or unavailable; do not infer hidden psychology. Report only the User's expressed semantic roles, not a response purpose, purpose support, or strategy. The program computes quote offsets and the Planner owns the response decision.",
      "proposedContribution has exactly { targetSpanIndexes: integer[], instruction: string }. It remains optional posture-proposal data only: targetSpanIndexes indexes that proposal's sourceSpans, and instruction briefly summarizes User content for legacy compatibility without assigning a reply goal. Never use its absence, presence or summary to decide whether to report independent acknowledgmentTreatmentEvidence. evidence is string[], not an array of objects.",
      "Use explore only when the User has already expressed inner material, a tension, recurring pattern, choice, meaning question, or an explicit wish to understand themselves. Do not diagnose or infer childhood, personality, causes, or hidden motives.",
      "When evidence is ambiguous, propose accompany. proposedContribution.instruction may briefly summarize the User content for legacy compatibility but never assigns a reply goal or action. Report the explicit User roles and relationship independently of that text; do not decide on feeling validation, a follow-up question or any other response strategy.",
      "Do not convert an interpretation into a response action. Do not force one primary intent.",
      "Use repairs_previous_move only when the current turn rejects a concrete proposition in the targeted assistant turn; a different answer or topic continuation alone is not repair.",
      "When the User asks what a committed Assistant claim means, why it was said, whether it was intended, or directly questions that claim, bind requests_answer to the exact prior Assistant turn and exact committed claim. Do not set the target to the current User question.",
      "For any candidate that semantically targets a committed Assistant claim, copy targetProposition exactly from that turn's committedAssistantMove or interactionMoveEnvelope claim and set targetOperation to explain, answer, affirm, or repair_or_withdraw. Never paraphrase or invent the target proposition.",
      "Use targetOperation=explain or answer for clarification and direct questions about the claim; both must bind the exact committed claim. Use affirm only when the User explicitly accepts, permits, or positively continues that exact claim, and only with continues_active_thread or acknowledges_previous_move. Use repair_or_withdraw only when the User disputes or asks to retract that claim. Omit both claim fields when no exact committed claim is targeted.",
      "When interactionEvidence identifies an active Assistant handoff target, every responseRelation candidate must keep targetTurnId bound to that exact Assistant turn, including acknowledgment, topic redirect, or initiative sharing. This target-turn binding is separate from targetProposition and targetOperation; omit only those two claim fields when no committed claim is targeted.",
      "Use challenges_move_fit when the current turn challenges the targeted assistant interaction move as unnecessary, repetitive, pressuring, or mismatched, even when it rejects no factual proposition.",
      "Use rejects_or_declines_move when the current turn rejects or declines the targeted assistant move or its requested contribution without establishing a proposition repair.",
      "Return one JSON object only with: literalMeaning (non-empty string), responseRelation (object with candidates array), acknowledgmentTreatmentEvidence (independent factual-role object as specified above, or null), optional ordinaryPostureProposal (object as specified above, or null), confidence (number from 0 to 1), notes (string[]; a single note is a one-item array). All evidence arrays contain strings, never objects. These types apply even when an array has only one item.",
      "responseRelation.candidates is an array of { relation, confidence, targetTurnId (required on every candidate, including opens_new_thread, and equal to the exact active Assistant handoff target turn id whenever interactionEvidence identifies one; otherwise optional), targetProposition?, targetOperation?, evidence[] }; targetOperation is one of explain, answer, affirm, repair_or_withdraw.",
      "Allowed relations: requests_answer, answers_previous_move, repairs_previous_move, challenges_move_fit, rejects_or_declines_move, continues_active_thread, opens_new_thread, yields_initiative, shares_initiative, requests_pause, requests_action_support, shares_distress, acknowledges_previous_move.",
      "Direct questions, stop evidence, Grounding references, common-ground rejection, and deterministic interaction evidence are resolved elsewhere and cannot be overridden.",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify({
      currentTurnId: context.currentTurnId,
      currentUserMessage: context.currentUserMessage,
      adjacentTurns: context.adjacentTurns,
      interactionEvidence: context.interaction,
      semanticEvidence: context.semanticEvidence,
      repairSignal: context.repairSignal,
      correction: context.correction,
    }),
  },
];

export const enrichTurnInterpretation = async (
  context: ConversationControlContext,
  deterministic: TurnInterpretation,
  inspectExternalPrompt?: (input: { stage: "turn_interpretation"; messages: AiModelMessage[] }) => void | Promise<void>
): Promise<{
  interpretation: TurnInterpretation;
  modelUsed: boolean;
  rawModelOutput: string | null;
  modelTrace: {
    attempted: boolean;
    used: boolean;
    reason: string;
    model?: string;
    latencyMs?: number;
    tokenInput?: number;
    tokenOutput?: number;
    promptMessages?: AiModelMessage[];
    rawOutput?: string;
    error?: string;
  };
}> => {
  const modelEnabled = process.env.CONVERSATION_OS_INTERPRETER_MODEL_ENABLED !== "false";
  const handoffTarget = context.interactionMoveHandoffTarget;
  const adjacentAssistantHasCommittedClaim = context.adjacentTurns.some((turn) =>
    turn.role === "assistant" && (
      (turn.committedAssistantMove?.claims.length ?? 0) > 0 ||
      (
        handoffTarget !== null &&
        handoffTarget.sourceAssistantMoveId === turn.id &&
        handoffTarget.envelope.committedMove.claims.length > 0
      )
    )
  );
  const needsExactPriorClaimBinding =
    deterministic.directQuestions.length > 0 && adjacentAssistantHasCommittedClaim;
  const needsModel = !deterministic.interaction.stopIntent && (
    needsExactPriorClaimBinding ||
    (deterministic.confidence < 0.8 && deterministic.directQuestions.length === 0)
  );
  if (!modelEnabled || !needsModel) {
    return {
      interpretation: deterministic,
      modelUsed: false,
      rawModelOutput: null,
      modelTrace: {
        attempted: false,
        used: false,
        reason: !modelEnabled
          ? "Interpreter model is disabled."
          : "Deterministic evidence is sufficient and no exact committed-claim binding is required.",
      },
    };
  }

  const messages = buildInterpretationMessages(context);
  await inspectPromptBeforeExternalCall(inspectExternalPrompt, {
    stage: "turn_interpretation" as const,
    messages,
  });
  try {
    const response = await callModel({
      model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
      messages,
      temperature: 0.1,
    });
    return {
      interpretation: mergeModelInterpretation(deterministic, locateInterpretationQuotes(response.text, context), context),
      modelUsed: true,
      rawModelOutput: response.text,
      modelTrace: {
        attempted: true,
        used: true,
        reason: "Low-confidence relational pragmatics require multiple-interpretation evidence before planning.",
        model: response.model,
        latencyMs: response.latencyMs,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        promptMessages: messages,
        rawOutput: response.text,
      },
    };
  } catch (error) {
    if (error instanceof InterpretationQuoteLocationError) throw error;
    return {
      interpretation: { ...deterministic, notes: [...deterministic.notes, "Model interpretation unavailable; deterministic evidence preserved."] },
      modelUsed: false,
      rawModelOutput: null,
      modelTrace: {
        attempted: true,
        used: false,
        reason: "Low-confidence relational pragmatics requested model evidence, but the provider failed.",
        promptMessages: messages,
        error: error instanceof Error ? error.message : "Unknown interpreter provider failure",
      },
    };
  }
};
