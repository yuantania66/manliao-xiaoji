import type { ConversationControlContext, DialogueAct, DirectQuestion, GroundingReference, TurnInterpretation } from "./types";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const directQuestionFromText = (text: string): DirectQuestion | null => {
  if (
    /^(?:你|您)(?:到底)?(?:是谁|是什么(?:东西|助手)?|是(?:不是)?(?:AI|人工智能|机器人|人类?|心理医生|心理咨询师|咨询师|治疗师))(?:吗)?[？?。！!]*$/u.test(text)
  ) return { text, kind: "identity", evidence: ["explicit identity or role question"] };
  if (/(?:发|用|说|回复).{0,4}语音|语音.{0,4}(?:发|说|回复)|(?:为什么|怎么)?(?:不会|不能)说话/u.test(text)) return { text, kind: "voice_output", evidence: ["explicit voice-output or speaking-capability question"] };
  if (/(?:听得见|听到|听见|语音输入|麦克风)/u.test(text)) return { text, kind: "voice_input", evidence: ["explicit hearing or voice-input capability question"] };
  if (/(?:看得见|看到|看见|能看|会看).{0,6}(?:我|这里|照片|环境)?/u.test(text)) return { text, kind: "perception_capability", evidence: ["explicit visual-perception capability question"] };
  if (/(?:现在几点|几点了|知道时间|当前时间)/u.test(text)) return { text, kind: "time_capability", evidence: ["explicit current-time capability question"] };
  if (/(?:记得|记住|还记不记得|记忆).{0,12}(?:我|之前|以前|聊天|事情)?/u.test(text)) return { text, kind: "memory_capability", evidence: ["explicit memory capability question"] };
  if (/(?:会|能|可以).{0,4}(?:坐|抱|拥抱|碰|触碰|走|躺)|(?:有身体|身体是什么)/u.test(text)) return { text, kind: "body_capability", evidence: ["explicit embodied capability question"] };
  const definition = text.match(/^(.{1,20}?)(?:是什么意思|是啥意思|什么叫)[？?。！!]*$/u);
  if (definition) return { text, kind: "definition", subject: definition[1], evidence: ["explicit definition question"] };
  if (/(?:为什么|为何|怎么会|那你怎么)/u.test(text)) return { text, kind: "reason_or_contradiction", evidence: ["explicit reason or contradiction question"] };
  if (/\p{L}|\p{N}/u.test(text) && (/[？?]\s*$/u.test(text) || /(?:吗|么|呢)[。！!]*$/u.test(text))) {
    return { text, kind: "other", evidence: ["explicit interrogative form"] };
  }
  return null;
};

const groundingReferenceForQuestion = (question: DirectQuestion | null, context: ConversationControlContext): GroundingReference => {
  if (!question) return context.repairSignal ? "previous_wording" : "none";
  if (question.kind === "identity") return "identity";
  if (question.kind === "body_capability") return "body";
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
  if (question?.kind === "identity") return "ask_identity";
  if (question?.kind === "definition") return "ask_definition";
  if (question?.kind === "reason_or_contradiction") return "challenge_contradiction";
  if (/建议|怎么办|怎么做|下一步/u.test(context.currentUserMessage)) return "request_action_support";
  if (question) return question.kind.includes("capability") || question.kind.startsWith("voice_") ? "ask_capability" : "ask_information";
  if (context.repairSignal) return "correct_assistant";
  if (context.interaction.contentAvailability === "no_topic") return "yield_initiative";
  if (context.interaction.affect === "negative") return "seek_emotional_support";
  return "share";
};

export const interpretTurnDeterministically = (context: ConversationControlContext): TurnInterpretation => {
  const text = normalize(context.currentUserMessage);
  const question = directQuestionFromText(text);
  const primaryDialogueAct = primaryActFor(context, question);
  const secondarySignals: DialogueAct[] = [];
  if (
    context.interaction.affect === "negative" &&
    primaryDialogueAct !== "seek_emotional_support" &&
    !context.interaction.stopIntent
  ) secondarySignals.push("seek_emotional_support");
  if (question && context.repairSignal) secondarySignals.push("correct_assistant");
  if (context.interaction.contentAvailability === "no_topic" && primaryDialogueAct !== "yield_initiative") secondarySignals.push("yield_initiative");
  return {
    literalMeaning: text,
    primaryDialogueAct,
    secondarySignals,
    directQuestions: question ? [question] : [],
    interaction: context.interaction,
    repairSignal: context.repairSignal,
    groundingReference: groundingReferenceForQuestion(question, context),
    confidence: question || context.interaction.stopIntent ? 0.96 : 0.72,
    evidenceSources: ["current_user_message", ...(context.adjacentTurns.length ? (["adjacent_turn"] as const) : []), ...(question || context.interaction.stopIntent ? (["deterministic_boundary"] as const) : [])],
    notes: ["Deterministic interpretation covers explicit questions, capability boundaries, pause/stop, and existing interaction evidence."],
  };
};

const isDialogueAct = (value: unknown): value is DialogueAct => typeof value === "string" && [
  "share", "answer", "ask_information", "ask_identity", "ask_capability", "ask_definition", "challenge_contradiction",
  "correct_assistant", "yield_initiative", "request_pause", "end_conversation", "seek_emotional_support",
  "request_action_support", "acknowledge",
].includes(value);

export const mergeModelInterpretation = (deterministic: TurnInterpretation, model: Partial<TurnInterpretation> | null): TurnInterpretation => {
  if (!model) return deterministic;
  const modelSecondary = Array.isArray(model.secondarySignals) ? model.secondarySignals.filter(isDialogueAct) : [];
  const deterministicBoundaryOwnsPrimary = Boolean(
    deterministic.directQuestions.length ||
    deterministic.interaction.stopIntent ||
    deterministic.repairSignal ||
    deterministic.interaction.contentAvailability === "no_topic" ||
    deterministic.interaction.affect === "negative" ||
    deterministic.primaryDialogueAct === "request_action_support"
  );
  const primaryDialogueAct = deterministicBoundaryOwnsPrimary
    ? deterministic.primaryDialogueAct
    : isDialogueAct(model.primaryDialogueAct) ? model.primaryDialogueAct : deterministic.primaryDialogueAct;
  return {
    ...deterministic,
    literalMeaning: typeof model.literalMeaning === "string" && model.literalMeaning.trim() ? model.literalMeaning.trim() : deterministic.literalMeaning,
    primaryDialogueAct,
    secondarySignals: Array.from(new Set([...deterministic.secondarySignals, ...modelSecondary])),
    confidence: typeof model.confidence === "number" ? Math.max(0, Math.min(1, model.confidence)) : deterministic.confidence,
    evidenceSources: Array.from(new Set([...deterministic.evidenceSources, "model_interpretation"])),
    notes: [...deterministic.notes, ...(Array.isArray(model.notes) ? model.notes.filter((item): item is string => typeof item === "string") : [])],
  };
};
