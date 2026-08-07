import type {
  ContentMeaning,
  ConversationControlContext,
  DialogueAct,
  DirectQuestion,
  GroundingReference,
  RelationalInterpretationCandidate,
  ResponseRelationKind,
  TurnInterpretation,
  TurnStateUpdate,
} from "./types";
import { projectUserMoveRelation } from "./interactionMoveHandoff";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const directQuestionFromText = (text: string): DirectQuestion | null => {
  if (/^(?:你|您)(?:到底)?是(?:不是)?(?:心理医生|心理咨询师|咨询师|治疗师)(?:吗)?[？?。！!]*$/u.test(text)) {
    return { text, kind: "clinician_identity", evidence: ["explicit clinician-identity question"] };
  }
  if (/^(?:你|您)(?:到底)?是(?:不是)?(?:AI|人工智能|机器人|真人|人类?)(?:吗)?[？?。！!]*$/u.test(text)) {
    return { text, kind: "ai_identity", evidence: ["explicit AI or human-identity question"] };
  }
  if (/^(?:你|您)(?:到底)?(?:是谁|是什么(?:东西|助手)?)(?:吗)?[？?。！!]*$/u.test(text)) {
    return { text, kind: "identity", evidence: ["explicit assistant-identity question"] };
  }
  if (/(?:发|用|说|回复).{0,4}语音|语音.{0,4}(?:发|说|回复)|(?:为什么|怎么)?(?:不会|不能)说话/u.test(text)) return { text, kind: "voice_output", evidence: ["explicit voice-output or speaking-capability question"] };
  if (/(?:听得见|听得到|听到|听见|语音输入|麦克风)/u.test(text)) return { text, kind: "voice_input", evidence: ["explicit hearing or voice-input capability question"] };
  if (/(?:看得见|看得到|看到|看见|能看|会看).{0,6}(?:我|这里|照片|环境)?/u.test(text)) return { text, kind: "perception_capability", evidence: ["explicit visual-perception capability question"] };
  if (/(?:现在几点|几点了|知道时间|当前时间)/u.test(text)) return { text, kind: "time_capability", evidence: ["explicit current-time capability question"] };
  if (/(?:记得|记住|还记不记得|记忆).{0,12}(?:我|之前|以前|聊天|事情)?/u.test(text)) return { text, kind: "memory_capability", evidence: ["explicit memory capability question"] };
  const embodiedAction = text.match(/(?:会|能|可以).{0,4}(坐|睡觉|睡|抱|拥抱|碰|触碰|走|躺)/u)?.[1];
  if (embodiedAction) {
    const subject =
      embodiedAction === "坐" ? "sit"
        : embodiedAction === "睡" || embodiedAction === "睡觉" ? "sleep"
          : embodiedAction === "抱" || embodiedAction === "拥抱" ? "hug"
            : embodiedAction === "碰" || embodiedAction === "触碰" ? "touch"
              : embodiedAction === "走" ? "walk"
                : "lie";
    return { text, kind: "body_capability", subject, evidence: ["explicit embodied capability question"] };
  }
  if (/^(?:你|您)(?:现在)?(?:在|待在).{0,5}(?:我)?(?:旁边|身边)(?:吗)?[？?。！!]*$/u.test(text)) {
    return { text, kind: "body_capability", subject: "presence", evidence: ["explicit physical-presence question"] };
  }
  if (/(?:有身体|身体是什么)/u.test(text)) {
    return { text, kind: "body_capability", subject: "body", evidence: ["explicit embodied capability question"] };
  }
  const definition = text.match(/^(.{1,20}?)(?:是什么意思|是啥意思|什么叫)[？?。！!]*$/u);
  if (definition) return { text, kind: "definition", subject: definition[1], evidence: ["explicit definition question"] };
  if (/(?:为什么|为何|怎么会|那你怎么)/u.test(text)) return { text, kind: "reason_or_contradiction", evidence: ["explicit reason or contradiction question"] };
  if (/\p{L}|\p{N}/u.test(text) && (/[？?]\s*$/u.test(text) || /(?:吗|么|呢)[。！!]*$/u.test(text))) {
    return { text, kind: "other", evidence: ["explicit interrogative form"] };
  }
  return null;
};

const adjacentAssistantUsesMatchingEmbodiment = (
  question: DirectQuestion,
  context: ConversationControlContext
) => {
  if (question.kind !== "body_capability" || !question.subject) return false;
  const previousAssistant = [...context.adjacentTurns]
    .reverse()
    .find((turn) => turn.role === "assistant")
    ?.content ?? "";
  if (!previousAssistant) return false;
  const patterns: Record<string, RegExp> = {
    sit: /坐/u,
    sleep: /睡/u,
    hug: /抱|拥抱/u,
    touch: /碰|触碰/u,
    walk: /走/u,
    lie: /躺/u,
    presence: /旁边|身边|在这(?:里|儿).{0,5}陪|陪.{0,5}在这(?:里|儿)/u,
    body: /身体/u,
  };
  return patterns[question.subject]?.test(previousAssistant) ?? false;
};

const groundingReferenceForQuestion = (question: DirectQuestion | null, context: ConversationControlContext): GroundingReference => {
  if (!question) return context.correction ? "none" : context.repairSignal ? "previous_wording" : "none";
  if (question.kind === "identity") return "identity";
  if (question.kind === "ai_identity") return "ai_identity";
  if (question.kind === "clinician_identity") return "clinician_identity";
  if (question.kind === "body_capability") {
    if (question.subject === "presence") {
      return adjacentAssistantUsesMatchingEmbodiment(question, context)
        ? "physical_presence_metaphor"
        : "physical_presence";
    }
    return adjacentAssistantUsesMatchingEmbodiment(question, context) ? "body_metaphor" : "body";
  }
  if (question.kind === "voice_input") return "voice_input";
  if (question.kind === "voice_output") return "voice_output";
  if (question.kind === "perception_capability") return "vision";
  if (question.kind === "time_capability") return "time";
  if (question.kind === "memory_capability") return "memory";
  if (question.kind === "definition" || question.kind === "reason_or_contradiction") return "previous_wording";
  return "none";
};

const primaryActFor = (context: ConversationControlContext, question: DirectQuestion | null): DialogueAct => {
  if (context.interaction.stopIntent) return context.interaction.engagement === "stop_requested" ? "end_conversation" : "request_pause";
  if (question && ["identity", "ai_identity", "clinician_identity"].includes(question.kind)) return "ask_identity";
  if (question?.kind === "definition") return "ask_definition";
  if (question?.kind === "reason_or_contradiction") return "challenge_contradiction";
  if (context.repairSignal) return "correct_assistant";
  if (context.evidenceSignals.explicitAdviceRequest) return "request_action_support";
  if (question) return question.kind.includes("capability") || question.kind.startsWith("voice_") ? "ask_capability" : "ask_information";
  if (context.interaction.contentAvailability === "no_topic") return "yield_initiative";
  if (context.interaction.affect === "negative") return "seek_emotional_support";
  return "share";
};

const uniqueRelationCandidates = (candidates: RelationalInterpretationCandidate[]) => {
  const selected = new Map<string, RelationalInterpretationCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.relation}:${candidate.targetTurnId ?? ""}`;
    const existing = selected.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      selected.set(key, candidate);
    } else if (candidate.confidence === existing.confidence) {
      selected.set(key, {
        ...existing,
        evidence: Array.from(new Set([...existing.evidence, ...candidate.evidence])),
      });
    }
  }
  return [...selected.values()];
};

const ADJACENCY_FALLBACK_EVIDENCE =
  "Current user turn follows an adjacent assistant turn.";

const buildContentMeaning = (
  context: ConversationControlContext,
  text: string,
  directQuestions: DirectQuestion[]
): ContentMeaning => ({
  literalText: text,
  semanticEvidence: context.semanticEvidence,
  explicitPropositions: text
    ? [{
        id: `${context.currentTurnId}:proposition-1`,
        text,
        sourceTurnId: context.currentTurnId,
        confidence: 1,
        evidence: ["Current user utterance; no inferred affect, motive, or world fact added."],
      }]
    : [],
  directQuestions,
  contentAvailabilityEvidence: context.interaction.evidence.filter((item) =>
    item.startsWith("contentAvailability=")
  ),
  affectEvidence: context.interaction.affectEvidence,
});

const buildResponseRelations = ({
  context,
  question,
}: {
  context: ConversationControlContext;
  question: DirectQuestion | null;
}): RelationalInterpretationCandidate[] => {
  const candidates: RelationalInterpretationCandidate[] = [];
  const lastAssistantTurn = [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant") ?? null;
  const targetTurnId = lastAssistantTurn?.id;

  if (context.interaction.stopIntent) {
    candidates.push({
      relation: "requests_pause",
      confidence: 0.99,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: context.interaction.evidence.filter((item) => item.includes("stop") || item.includes("pause")),
    });
  }
  if (context.correction) {
    candidates.push({
      relation: "repairs_previous_move",
      confidence: 0.99,
      targetTurnId: context.correction.targetTurnId,
      evidence: context.correction.evidence,
    });
    if (context.correction.stillOpenUserIntent) {
      candidates.push({
        relation: "yields_initiative",
        confidence: 0.9,
        targetTurnId: context.correction.stillOpenUserIntent.sourceTurnId,
        evidence: [
          "A turn-scoped user activity remains open after the rejected assistant proposition is withdrawn.",
          ...context.correction.evidence,
        ],
      });
    }
  }
  if (question) {
    candidates.push({
      relation: "requests_answer",
      confidence: 0.98,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: question.evidence,
    });
  }
  if (context.activeAnswerFrame.compatible && targetTurnId) {
    candidates.push({
      relation: "answers_previous_move",
      confidence: 0.94,
      targetTurnId,
      evidence: [
        `activeAnswerFrame.type=${context.activeAnswerFrame.type ?? "unknown"}`,
        "Current turn is compatible with the immediately available answer frame.",
      ],
    });
  }
  if (context.evidenceSignals.explicitAdviceRequest) {
    candidates.push({
      relation: "requests_action_support",
      confidence: 0.9,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: ["Existing conversation evidence reports an explicit action-support request; this remains one relational candidate, not a response action."],
    });
  }
  if (context.interaction.affect === "negative") {
    candidates.push({
      relation: "shares_distress",
      confidence: 0.86,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: context.interaction.affectEvidence.map((span) =>
        `affectEvidence=${span.category}:${span.intensity}:${span.object}:${span.start}-${span.end}`
      ),
    });
  }
  if (context.interaction.initiativeDirection === "assistant_invited") {
    candidates.push({
      relation: "yields_initiative",
      confidence: context.interaction.contentAvailability === "no_topic" ? 0.91 : 0.72,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: context.interaction.evidence,
    });
  } else if (context.interaction.initiativeDirection === "shared") {
    candidates.push({
      relation: "shares_initiative",
      confidence: 0.82,
      ...(targetTurnId ? { targetTurnId } : {}),
      evidence: context.interaction.evidence,
    });
  }

  if (!context.interaction.stopIntent) {
    candidates.push(lastAssistantTurn
      ? {
          relation: "continues_active_thread",
          confidence: 0.68,
          ...(targetTurnId ? { targetTurnId } : {}),
          evidence: [ADJACENCY_FALLBACK_EVIDENCE],
        }
      : {
          relation: "opens_new_thread",
          confidence: 0.76,
          evidence: ["No adjacent assistant turn establishes an active response relation."],
        });
  }

  return uniqueRelationCandidates(candidates);
};

const buildStateUpdate = (
  context: ConversationControlContext,
  contentMeaning: ContentMeaning,
  candidates: RelationalInterpretationCandidate[]
): TurnStateUpdate => {
  const requestsPause = candidates.some((candidate) => candidate.relation === "requests_pause");
  const primaryCandidate = [...candidates].sort((left, right) => right.confidence - left.confidence)[0];
  const lastAssistantTurn = [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant") ?? null;
  return {
    commonGround: [
      ...contentMeaning.explicitPropositions.map((proposition) => ({
        propositionId: proposition.id,
        proposition: proposition.text,
        operation: "confirm" as const,
        subject: "user" as const,
        speaker: "user" as const,
        epistemicStatus: "asserted_by_user" as const,
        sourceTurnId: proposition.sourceTurnId,
        confidence: proposition.confidence,
        evidence: proposition.evidence,
      })),
      ...context.unconfirmedHypotheses.map((hypothesis, index) => ({
        propositionId: `${context.currentTurnId}:hypothesis-${index + 1}`,
        proposition: hypothesis,
        operation: "hypothesize" as const,
        subject: "user" as const,
        speaker: "system" as const,
        epistemicStatus: "selected_memory" as const,
        sourceTurnId: context.currentTurnId,
        confidence: 0.5,
        evidence: ["Unconfirmed context remains a hypothesis and cannot become common-ground fact."],
      })),
      ...(context.correction?.challengedPropositions.map((proposition) => ({
        propositionId: proposition.id,
        proposition: proposition.text,
        operation: "reject" as const,
        subject: "assistant" as const,
        speaker: "user" as const,
        epistemicStatus: "rejected_by_user" as const,
        sourceTurnId: proposition.sourceTurnId,
        confidence: 1,
        evidence: context.correction?.evidence ?? [],
      })) ?? []),
    ],
    obligationChanges: contentMeaning.directQuestions.map((question) => ({
      operation: "open" as const,
      sourceTurnId: context.currentTurnId,
      targetProposition: question.text,
      evidence: question.evidence,
    })),
    initiativeProposal: initiativeForCandidates(candidates),
    activeThreadProposal: requestsPause
      ? {
          sourceTurnId: context.currentTurnId,
          relation: "pause",
          evidence: ["A relational candidate requests pause."],
        }
      : primaryCandidate?.relation === "acknowledges_previous_move"
        ? {
            sourceTurnId: lastAssistantTurn?.id ?? context.currentTurnId,
            relation: "close",
            evidence: primaryCandidate.evidence,
          }
        : {
          sourceTurnId: lastAssistantTurn?.id ?? context.currentTurnId,
          relation: lastAssistantTurn ? "continue" : "open",
          evidence: [lastAssistantTurn ? "Adjacent assistant turn supplies the active thread." : "Current turn opens the thread."],
        },
    repairProposal: context.correction
      ? {
          targetTurnId: context.correction.targetTurnId,
          rejectedPropositionIds: context.correction.challengedPropositions.map((item) => item.id),
          evidence: context.correction.evidence,
        }
      : null,
  };
};

function initiativeForCandidates(
  candidates: RelationalInterpretationCandidate[]
): TurnStateUpdate["initiativeProposal"] {
  if (candidates.some((candidate) => candidate.relation === "requests_pause")) return "paused";
  if (candidates.some((candidate) =>
    candidate.relation === "requests_answer" || candidate.relation === "yields_initiative"
  )) return "assistant";
  if (candidates.some((candidate) => candidate.relation === "shares_initiative")) return "shared";
  return "user";
}

const buildRelationalInterpretation = (
  context: ConversationControlContext,
  contentMeaning: ContentMeaning,
  candidates: RelationalInterpretationCandidate[]
) => {
  const stateUpdate = buildStateUpdate(context, contentMeaning, candidates);
  const sorted = [...candidates].sort((left, right) => right.confidence - left.confidence);
  const ambiguous = sorted.length > 1 &&
    sorted[0].confidence - sorted[1].confidence <= 0.2;
  return {
    contentMeaning,
    responseRelation: { candidates: sorted, ambiguous },
    userMoveRelation: projectUserMoveRelation({
      target: context.interactionMoveHandoffTarget,
      sourceUserTurnId: context.currentTurnId,
      currentUserText: context.currentUserMessage,
      semanticEvidenceStatus: context.semanticEvidence.status,
      responseRelation: { candidates: sorted, ambiguous },
    }),
    stateUpdate,
    interpretations: sorted.map((candidate, index) => ({
      id: `${context.currentTurnId}:interpretation-${index + 1}`,
      contentMeaning,
      responseRelation: candidate,
      stateUpdate,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })),
  };
};

export const interpretTurnDeterministically = (context: ConversationControlContext): TurnInterpretation => {
  const text = normalize(context.currentUserMessage);
  const correction = context.correction
    ? {
        ...context.correction,
        challengedPropositions: context.correction.challengedPropositions.map((proposition) => {
          const challengedQuestion = directQuestionFromText(normalize(proposition.text));
          return {
            ...proposition,
            ...(challengedQuestion
              ? { groundingReference: groundingReferenceForQuestion(challengedQuestion, context) }
              : {}),
          };
        }),
      }
    : null;
  // A meta-conversational denial may quote an interrogative proposition. Once
  // Context Assembly has targeted it as a correction, it must not reopen a new
  // capability/identity obligation from the quoted words.
  const question =
    context.correction || context.interaction.contentAvailability === "no_topic"
      ? null
      : directQuestionFromText(text);
  const primaryDialogueAct = primaryActFor(context, question);
  const secondarySignals: DialogueAct[] = [];
  if (
    context.interaction.affect === "negative" &&
    primaryDialogueAct !== "seek_emotional_support" &&
    !context.interaction.stopIntent
  ) secondarySignals.push("seek_emotional_support");
  if (question && context.repairSignal) secondarySignals.push("correct_assistant");
  if (context.interaction.contentAvailability === "no_topic" && primaryDialogueAct !== "yield_initiative") secondarySignals.push("yield_initiative");
  const contentMeaning = buildContentMeaning(context, text, question ? [question] : []);
  const relational = buildRelationalInterpretation(
    context,
    contentMeaning,
    buildResponseRelations({ context, question })
  );
  return {
    ...relational,
    literalMeaning: text,
    primaryDialogueAct,
    secondarySignals,
    directQuestions: question ? [question] : [],
    interaction: context.interaction,
    repairSignal: context.repairSignal,
    correction,
    groundingReference: groundingReferenceForQuestion(question, context),
    confidence: question || context.interaction.stopIntent || context.correction ? 0.96 : 0.72,
    evidenceSources: ["current_user_message", ...(context.adjacentTurns.length ? (["adjacent_turn"] as const) : []), ...(question || context.interaction.stopIntent || context.correction ? (["deterministic_boundary"] as const) : [])],
    notes: ["Deterministic interpretation covers explicit questions, capability boundaries, pause/stop, and existing interaction evidence."],
  };
};

const isDialogueAct = (value: unknown): value is DialogueAct => typeof value === "string" && [
  "share", "answer", "ask_information", "ask_identity", "ask_capability", "ask_definition", "challenge_contradiction",
  "correct_assistant", "yield_initiative", "request_pause", "end_conversation", "seek_emotional_support",
  "request_action_support", "acknowledge",
].includes(value);

const isResponseRelationKind = (value: unknown): value is ResponseRelationKind =>
  typeof value === "string" && [
    "requests_answer",
    "answers_previous_move",
    "repairs_previous_move",
    "challenges_move_fit",
    "rejects_or_declines_move",
    "continues_active_thread",
    "opens_new_thread",
    "yields_initiative",
    "shares_initiative",
    "requests_pause",
    "requests_action_support",
    "shares_distress",
    "acknowledges_previous_move",
  ].includes(value);

const modelRelationCandidates = (model: Partial<TurnInterpretation> | null) => {
  if (!model || typeof model.responseRelation !== "object" || model.responseRelation === null) return [];
  const candidates = (model.responseRelation as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate): RelationalInterpretationCandidate[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    if (!isResponseRelationKind(value.relation)) return [];
    const confidence = typeof value.confidence === "number"
      ? Math.max(0, Math.min(1, value.confidence))
      : 0;
    if (confidence < 0.55) return [];
    return [{
      relation: value.relation,
      confidence,
      ...(typeof value.targetTurnId === "string" ? { targetTurnId: value.targetTurnId } : {}),
      evidence: Array.isArray(value.evidence)
        ? value.evidence.filter((item): item is string => typeof item === "string")
        : ["Model supplied a relational interpretation candidate."],
    }];
  });
};

export const mergeModelInterpretation = (
  deterministic: TurnInterpretation,
  model: Partial<TurnInterpretation> | null,
  context?: ConversationControlContext
): TurnInterpretation => {
  if (!model) return deterministic;
  const deterministicBoundaryOwnsPrimary = Boolean(
    deterministic.directQuestions.length ||
    deterministic.interaction.stopIntent ||
    deterministic.repairSignal ||
    deterministic.interaction.contentAvailability === "no_topic" ||
    deterministic.interaction.affect === "negative" ||
    deterministic.primaryDialogueAct === "request_action_support"
  );
  const modelConfidence = typeof model.confidence === "number"
    ? Math.max(0, Math.min(1, model.confidence))
    : deterministic.confidence;
  const modelCorrectionIsHighConfidence =
    model.primaryDialogueAct !== "correct_assistant" || modelConfidence >= 0.93;
  const modelSecondary = Array.isArray(model.secondarySignals)
    ? model.secondarySignals
        .filter(isDialogueAct)
        .filter((act) => act !== "correct_assistant" || modelConfidence >= 0.93)
    : [];
  const primaryDialogueAct = deterministicBoundaryOwnsPrimary
    ? deterministic.primaryDialogueAct
    : isDialogueAct(model.primaryDialogueAct) && modelCorrectionIsHighConfidence
      ? model.primaryDialogueAct
      : deterministic.primaryDialogueAct;
  const acceptedModelCandidates = modelRelationCandidates(model);
  const activeHandoffTargetId = context?.interactionMoveHandoffTarget?.sourceAssistantMoveId;
  const modelSupersedesAdjacencyFallback = Boolean(
    activeHandoffTargetId &&
    acceptedModelCandidates.some((candidate) =>
      candidate.relation !== "continues_active_thread" &&
      candidate.targetTurnId === activeHandoffTargetId
    )
  );
  const deterministicCandidates = modelSupersedesAdjacencyFallback
    ? deterministic.responseRelation.candidates.filter((candidate) => !(
        candidate.relation === "continues_active_thread" &&
        candidate.confidence === 0.68 &&
        candidate.evidence.length === 1 &&
        candidate.evidence[0] === ADJACENCY_FALLBACK_EVIDENCE
      ))
    : deterministic.responseRelation.candidates;
  const candidates = uniqueRelationCandidates([
    ...deterministicCandidates,
    ...acceptedModelCandidates,
  ]).sort((left, right) => right.confidence - left.confidence);
  const modelRepair = candidates.find((candidate) =>
    candidate.relation === "repairs_previous_move" && candidate.confidence >= 0.93
  );
  const repairTarget = modelRepair?.targetTurnId && context
    ? context.adjacentTurns.find((turn) => turn.id === modelRepair.targetTurnId)
    : context
      ? [...context.adjacentTurns].reverse().find((turn) => turn.role === "assistant")
      : null;
  const inferredRepairUpdate =
    !deterministic.stateUpdate.repairProposal &&
    modelRepair &&
    repairTarget &&
    repairTarget.role === "assistant"
      ? {
          propositionId: `${repairTarget.id ?? "assistant-turn"}:model-rejected-1`,
          proposition: repairTarget.content,
          operation: "reject" as const,
          subject: "assistant" as const,
          speaker: "user" as const,
          epistemicStatus: "rejected_by_user" as const,
          sourceTurnId: repairTarget.id ?? "assistant-turn",
          confidence: modelRepair.confidence,
          evidence: modelRepair.evidence,
        }
      : null;
  const stateUpdate: TurnStateUpdate = {
    ...deterministic.stateUpdate,
    commonGround: inferredRepairUpdate
      ? [...deterministic.stateUpdate.commonGround, inferredRepairUpdate]
      : deterministic.stateUpdate.commonGround,
    initiativeProposal: initiativeForCandidates(candidates),
    activeThreadProposal: candidates.some((candidate) => candidate.relation === "requests_pause")
      ? {
          sourceTurnId: deterministic.contentMeaning.explicitPropositions[0]?.sourceTurnId ?? "current-turn",
          relation: "pause",
          evidence: candidates
            .filter((candidate) => candidate.relation === "requests_pause")
            .flatMap((candidate) => candidate.evidence),
        }
      : candidates[0]?.relation === "acknowledges_previous_move"
        ? {
            sourceTurnId: candidates[0].targetTurnId ??
              deterministic.contentMeaning.explicitPropositions[0]?.sourceTurnId ??
              "current-turn",
            relation: "close",
            evidence: candidates[0].evidence,
          }
        : deterministic.stateUpdate.activeThreadProposal,
    repairProposal: inferredRepairUpdate
      ? {
          targetTurnId: inferredRepairUpdate.sourceTurnId,
          rejectedPropositionIds: [inferredRepairUpdate.propositionId],
          evidence: inferredRepairUpdate.evidence,
        }
      : deterministic.stateUpdate.repairProposal,
  };
  const ambiguous = candidates.length > 1 &&
    candidates[0].confidence - candidates[1].confidence <= 0.2;
  return {
    ...deterministic,
    literalMeaning: typeof model.literalMeaning === "string" && model.literalMeaning.trim() ? model.literalMeaning.trim() : deterministic.literalMeaning,
    primaryDialogueAct,
    secondarySignals: Array.from(new Set([...deterministic.secondarySignals, ...modelSecondary])),
    responseRelation: { candidates, ambiguous },
    userMoveRelation: context
      ? projectUserMoveRelation({
          target: context.interactionMoveHandoffTarget,
          sourceUserTurnId: context.currentTurnId,
          currentUserText: context.currentUserMessage,
          semanticEvidenceStatus: context.semanticEvidence.status,
          responseRelation: { candidates, ambiguous },
        })
      : deterministic.userMoveRelation,
    stateUpdate,
    interpretations: candidates.map((candidate, index) => ({
      id: `${deterministic.contentMeaning.explicitPropositions[0]?.sourceTurnId ?? "turn"}:interpretation-${index + 1}`,
      contentMeaning: deterministic.contentMeaning,
      responseRelation: candidate,
      stateUpdate,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })),
    confidence: modelConfidence,
    evidenceSources: Array.from(new Set([...deterministic.evidenceSources, "model_interpretation"])),
    notes: [...deterministic.notes, ...(Array.isArray(model.notes) ? model.notes.filter((item): item is string => typeof item === "string") : [])],
  };
};
