import { createHash } from "node:crypto";

import type {
  ConversationControlContext,
  DirectQuestion,
  OrdinaryPostureProposal,
  PurposeSubjectOwnershipAuthorityTrace,
  TurnInterpretation,
} from "@/conversation-os/control";

import { callModel, getDefaultAiModel } from "./modelProvider";
import type { AiModelMessage } from "./types";

export const PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION =
  "purpose-subject-ownership-authority-v1" as const;
export const PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION = 1 as const;
export const PURPOSE_SUBJECT_OWNERSHIP_CONTRACT = [
  "Classify only the grammatical/semantic owner of one unbound reason_or_contradiction question.",
  "current_user_self means the question explicitly asks about the current User's own experience, action, pattern, emotion, choice, or reaction.",
  "external_or_other means the question asks about another person, the Assistant, an object, event, system, fact, or other external subject.",
  "uncertain means the owner cannot be established from the supplied current turn alone.",
  "Do not infer a hidden owner, cause, diagnosis, personality, motive, history, or truth.",
  "Evidence must contain exactly one UTF-16 span equal to the echoed whole question span. Output must echo all authority bindings exactly.",
].join("\n");
export const PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256 = createHash("sha256")
  .update(PURPOSE_SUBJECT_OWNERSHIP_CONTRACT, "utf8")
  .digest("hex");

export type PurposeSubjectOwnership =
  | "current_user_self"
  | "external_or_other"
  | "uncertain";

export type PurposeSubjectOwnershipEvidenceSpan = {
  text: string;
  start: number;
  end: number;
};

export type PurposeSubjectOwnershipDecision = {
  schemaVersion: typeof PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION;
  authorityVersion: typeof PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION;
  contractSha256: typeof PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256;
  conversationId: string;
  turnId: string;
  question: PurposeSubjectOwnershipEvidenceSpan;
  ownership: PurposeSubjectOwnership;
  evidence: PurposeSubjectOwnershipEvidenceSpan[];
};

export type PurposeSubjectOwnershipProvider = (input: {
  messages: AiModelMessage[];
}) => Promise<{ text: string; model: string; latencyMs: number } | string>;

const OWNERSHIP = new Set<PurposeSubjectOwnership>([
  "current_user_self",
  "external_or_other",
  "uncertain",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const fail = (reason: string): never => {
  throw new Error(`invalid_purpose_subject_ownership:${reason}`);
};

const parseSpan = ({
  value,
  currentUserMessage,
  field,
}: {
  value: unknown;
  currentUserMessage: string;
  field: string;
}): PurposeSubjectOwnershipEvidenceSpan => {
  if (!isRecord(value) || !hasExactKeys(value, ["text", "start", "end"])) {
    return fail(`${field}_keys`);
  }
  if (
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    !Number.isInteger(value.start) ||
    !Number.isInteger(value.end)
  ) return fail(`${field}_types`);
  const start = value.start as number;
  const end = value.end as number;
  if (start < 0 || end <= start || currentUserMessage.slice(start, end) !== value.text) {
    return fail(`${field}_utf16_binding`);
  }
  return { text: value.text, start, end };
};

export const parsePurposeSubjectOwnershipDecision = ({
  rawOutput,
  context,
  question,
}: {
  rawOutput: string;
  context: ConversationControlContext;
  question: PurposeSubjectOwnershipEvidenceSpan;
}): PurposeSubjectOwnershipDecision => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return fail("invalid_json");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, [
    "schemaVersion",
    "authorityVersion",
    "contractSha256",
    "conversationId",
    "turnId",
    "question",
    "ownership",
    "evidence",
  ])) return fail("root_keys");
  if (parsed.schemaVersion !== PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION) return fail("schema_version");
  if (parsed.authorityVersion !== PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION) return fail("authority_version");
  if (parsed.contractSha256 !== PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256) return fail("contract_sha256");
  if (parsed.conversationId !== context.conversationId) return fail("conversation_binding");
  if (parsed.turnId !== context.currentTurnId) return fail("turn_binding");
  const boundQuestion = parseSpan({ value: parsed.question, currentUserMessage: context.currentUserMessage, field: "question" });
  if (
    boundQuestion.text !== question.text ||
    boundQuestion.start !== question.start ||
    boundQuestion.end !== question.end
  ) return fail("question_binding");
  if (typeof parsed.ownership !== "string" || !OWNERSHIP.has(parsed.ownership as PurposeSubjectOwnership)) {
    return fail("ownership");
  }
  if (!Array.isArray(parsed.evidence) || parsed.evidence.length !== 1) return fail("evidence_cardinality");
  const evidence = parsed.evidence.map((item) => parseSpan({
    value: item,
    currentUserMessage: context.currentUserMessage,
    field: "evidence_0",
  }));
  const ownershipEvidence = evidence[0]!;
  if (
    ownershipEvidence.text !== boundQuestion.text ||
    ownershipEvidence.start !== boundQuestion.start ||
    ownershipEvidence.end !== boundQuestion.end
  ) return fail("evidence_must_equal_question");
  return {
    schemaVersion: PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION,
    authorityVersion: PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION,
    contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
    conversationId: context.conversationId,
    turnId: context.currentTurnId,
    question: boundQuestion,
    ownership: parsed.ownership as PurposeSubjectOwnership,
    evidence,
  };
};

const exactQuestionSpan = (
  context: ConversationControlContext,
  question: DirectQuestion
): PurposeSubjectOwnershipEvidenceSpan | null => {
  const start = context.currentUserMessage.indexOf(question.text);
  if (start < 0 || context.currentUserMessage.indexOf(question.text, start + 1) >= 0) return null;
  return { text: question.text, start, end: start + question.text.length };
};

const hasCommittedClaimAuthority = (context: ConversationControlContext) =>
  context.adjacentTurns.some((turn) => turn.role === "assistant" && turn.status !== "blocked" && (
    (turn.committedAssistantMove?.claims.length ?? 0) > 0 ||
    (turn.interactionMoveEnvelope?.committedMove.claims.length ?? 0) > 0
  ));

export const getPurposeSubjectOwnershipEligibility = ({
  context,
  interpretation,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
}): { question: DirectQuestion; span: PurposeSubjectOwnershipEvidenceSpan } | null => {
  if (
    context.safety.triggered ||
    context.interaction.stopIntent ||
    context.correction ||
    interpretation.repairSignal ||
    hasCommittedClaimAuthority(context) ||
    interpretation.responseRelation.candidates.some((candidate) =>
      candidate.relation === "requests_pause" ||
      candidate.relation === "repairs_previous_move" ||
      candidate.targetProposition ||
      candidate.targetOperation
    )
  ) return null;
  const candidates = interpretation.directQuestions.filter((question) =>
    question.kind === "reason_or_contradiction" &&
    !question.targetTurnId &&
    !question.targetProposition
  );
  if (candidates.length !== 1) return null;
  const span = exactQuestionSpan(context, candidates[0]);
  return span ? { question: candidates[0], span } : null;
};

export const buildPurposeSubjectOwnershipMessages = ({
  context,
  question,
}: {
  context: ConversationControlContext;
  question: PurposeSubjectOwnershipEvidenceSpan;
}): AiModelMessage[] => [
  {
    role: "developer",
    content: [
      PURPOSE_SUBJECT_OWNERSHIP_CONTRACT,
      "Return exactly one JSON object and no Markdown or explanation.",
      `Exact root keys: schemaVersion, authorityVersion, contractSha256, conversationId, turnId, question, ownership, evidence.`,
      `question and the one evidence item must have exactly: text, start, end. start/end are UTF-16 offsets into currentUserMessage.`,
      "Copy the complete question object into evidence as its only item. Do not select a substring and do not calculate new offsets.",
      `Echo schemaVersion=${PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION}, authorityVersion=${PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION}, contractSha256=${PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256}.`,
      "Use only currentUserMessage. Do not use adjacent conversation history.",
    ].join("\n"),
  },
  {
    role: "user",
    content: JSON.stringify({
      schemaVersion: PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION,
      authorityVersion: PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION,
      contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
      conversationId: context.conversationId,
      turnId: context.currentTurnId,
      currentUserMessage: context.currentUserMessage,
      question,
    }),
  },
];

/** Explicit local/eval provider. Never selected by production orchestration implicitly. */
export const qwenPurposeSubjectOwnershipProvider: PurposeSubjectOwnershipProvider = async ({ messages }) => {
  const response = await callModel({
    model: process.env.AI_MAIN_MODEL?.trim() || getDefaultAiModel(),
    messages,
    temperature: 0,
    responseFormat: "json_object",
  });
  return { text: response.text, model: response.model, latencyMs: response.latencyMs };
};

const applySelfOwnership = ({
  interpretation,
  context,
  decision,
}: {
  interpretation: TurnInterpretation;
  context: ConversationControlContext;
  decision: PurposeSubjectOwnershipDecision;
}): TurnInterpretation => {
  const directQuestions = interpretation.directQuestions.filter((question) =>
    !(question.kind === "reason_or_contradiction" && question.text === decision.question.text)
  );
  const candidates = interpretation.responseRelation.candidates.filter((candidate) =>
    candidate.relation !== "requests_answer"
  );
  const responseCandidates = candidates.length > 0 ? candidates : [{
    relation: "opens_new_thread" as const,
    confidence: 0.96,
    evidence: ["purpose_subject_ownership=current_user_self"],
  }];
  const ordinaryPostureProposal: OrdinaryPostureProposal = {
    mode: "explore",
    sourceSpans: [{
      source: "current_user_turn",
      sourceTurnId: context.currentTurnId,
      ...decision.question,
    }],
    proposedContribution: {
      targetSpanIndexes: [0],
      instruction: "整理用户已经明确提出的自我经验或反复，不把未知原因当成可确证事实。",
    },
    evidence: [
      `authority=${PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION}`,
      `contractSha256=${PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256}`,
      ...decision.evidence.map((span) => `ownershipEvidence=${span.start}-${span.end}:${span.text}`),
    ],
  };
  const contentMeaning = { ...interpretation.contentMeaning, directQuestions };
  const stateUpdate = {
    ...interpretation.stateUpdate,
    obligationChanges: interpretation.stateUpdate.obligationChanges.filter((change) =>
      change.targetProposition !== decision.question.text
    ),
    initiativeProposal: "user" as const,
  };
  return {
    ...interpretation,
    contentMeaning,
    responseRelation: { candidates: responseCandidates, ambiguous: false },
    stateUpdate,
    interpretations: responseCandidates.map((candidate, index) => ({
      id: `${context.currentTurnId}:purpose-ownership-${index + 1}`,
      contentMeaning,
      responseRelation: candidate,
      stateUpdate,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })),
    ordinaryPostureProposal,
    primaryDialogueAct: "share",
    directQuestions,
    groundingReference: "none",
    notes: [...interpretation.notes, "Purpose Subject-Ownership Authority removed the unbound self-question answer obligation."],
  };
};

const preserveDirectOwnership = ({
  interpretation,
  question,
  ownership,
}: {
  interpretation: TurnInterpretation;
  question: DirectQuestion;
  ownership: Exclude<PurposeSubjectOwnership, "current_user_self">;
}): TurnInterpretation => {
  const mapQuestion = (candidate: DirectQuestion) =>
    candidate === question || (
      candidate.kind === question.kind &&
      candidate.text === question.text &&
      candidate.targetTurnId === question.targetTurnId &&
      candidate.targetProposition === question.targetProposition
    )
      ? { ...candidate, subjectOwnership: ownership }
      : candidate;
  const directQuestions = interpretation.directQuestions.map(mapQuestion);
  const contentMeaning = {
    ...interpretation.contentMeaning,
    directQuestions: interpretation.contentMeaning.directQuestions.map(mapQuestion),
  };
  return {
    ...interpretation,
    contentMeaning,
    directQuestions,
    interpretations: interpretation.interpretations.map((candidate) => ({
      ...candidate,
      contentMeaning: {
        ...candidate.contentMeaning,
        directQuestions: candidate.contentMeaning.directQuestions.map(mapQuestion),
      },
    })),
    ordinaryPostureProposal: null,
  };
};

export const runPurposeSubjectOwnershipAuthority = async ({
  context,
  interpretation,
  provider,
  inspectPrompt,
}: {
  context: ConversationControlContext;
  interpretation: TurnInterpretation;
  provider?: PurposeSubjectOwnershipProvider;
  inspectPrompt?: (input: { stage: "purpose_subject_ownership"; messages: AiModelMessage[] }) => void | Promise<void>;
}): Promise<{ interpretation: TurnInterpretation; trace: PurposeSubjectOwnershipAuthorityTrace }> => {
  const eligible = getPurposeSubjectOwnershipEligibility({ context, interpretation });
  if (!eligible) {
    return {
      interpretation,
      trace: { attempted: false, used: false, reason: "ineligible" },
    };
  }
  if (!provider) {
    const trace: PurposeSubjectOwnershipAuthorityTrace = {
      attempted: false,
      used: false,
      reason: "provider_not_authorized",
      contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
    };
    return {
      interpretation: { ...interpretation, ordinaryPostureProposal: null, purposeSubjectOwnershipAuthority: trace },
      trace,
    };
  }
  const messages = buildPurposeSubjectOwnershipMessages({ context, question: eligible.span });
  await inspectPrompt?.({ stage: "purpose_subject_ownership", messages });
  try {
    const result = await provider({ messages });
    const normalized = typeof result === "string"
      ? { text: result, model: "fixture", latencyMs: 0 }
      : result;
    const decision = parsePurposeSubjectOwnershipDecision({
      rawOutput: normalized.text,
      context,
      question: eligible.span,
    });
    const decidedInterpretation = decision.ownership === "current_user_self"
      ? applySelfOwnership({ interpretation, context, decision })
      : preserveDirectOwnership({
          interpretation,
          question: eligible.question,
          ownership: decision.ownership,
        });
    return {
      interpretation: {
        ...decidedInterpretation,
        purposeSubjectOwnershipAuthority: {
          attempted: true,
          used: true,
          reason: decision.ownership,
          ownership: decision.ownership,
          model: normalized.model,
          latencyMs: normalized.latencyMs,
          contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
        },
      },
      trace: {
        attempted: true,
        used: true,
        reason: decision.ownership,
        ownership: decision.ownership,
        model: normalized.model,
        latencyMs: normalized.latencyMs,
        contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
      },
    };
  } catch (error) {
    const trace: PurposeSubjectOwnershipAuthorityTrace = {
      attempted: true,
      used: false,
      reason: "fail_closed",
      error: error instanceof Error ? error.message : "unknown_provider_failure",
      contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
    };
    return {
      interpretation: {
        ...interpretation,
        ordinaryPostureProposal: null,
        purposeSubjectOwnershipAuthority: trace,
      },
      trace,
    };
  }
};
