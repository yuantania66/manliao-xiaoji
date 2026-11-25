import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";

import { assembleConversationControlContext, buildDialogueState, interpretTurnDeterministically } from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import { AppError } from "../lib/errors";
import { isCommittedPublicationOnly, isExecutionPublishable, toUserSafeExecutionStatus, type ChatExecutionTrace } from "../services/ai/chatExecutionLifecycle";
import { createChatReply } from "../services/ai/chatOrchestrationService";
import { beginChatSupervisedPublication, formatSafetyRewrite, type ChatSupervisionLimits } from "../services/ai/chatSupervisedPublication";
import type { ChatRiskDecision, ChatSafetyReview, ChatSupervisionInput, ChatSupervisor } from "../services/ai/chatSupervision";
import type { AiConversationMessage, AiGenerationResult, AiModelMessage } from "../services/ai/types";

const input: ChatSupervisionInput = {
  currentTurnId: "offline-current-turn",
  currentUserMessage: "朋友说她现在不安全。",
  recentMessages: [{ id: "offline-previous", role: "user", content: "我在替朋友问。" }],
};
const ordinary: ChatRiskDecision = { route: "ordinary", subject: "none", currentness: "unclear", evidence: [] };
const danger: ChatRiskDecision = { route: "needs_safety_check", subject: "third_party", currentness: "current", evidence: [{ sourceId: input.currentTurnId, quote: "她现在不安全" }] };
const uncertain: ChatRiskDecision = { route: "uncertain", subject: "unclear", currentness: "unclear", evidence: [{ sourceId: input.currentTurnId, quote: "她现在不安全" }] };
const approved: ChatSafetyReview = { approved: true, issues: [] };
const declined: ChatSafetyReview = { approved: false, issues: [{
  code: "wrong_subject_or_time", candidateQuote: "你正面临危险", sourceId: input.currentTurnId, sourceQuote: "朋友说她现在不安全", requiredChange: "Keep the user's friend as the subject throughout.",
}] };
const draftText = "你正面临危险。打字可以先放一放。";
const repairText = "先顾好朋友眼下的安全。如果能安全联系，可以帮她联系能到场的人。";
const generation = (text: string): AiGenerationResult => ({ text, model: "offline", promptVersion: "offline", latencyMs: 0, finalReplySource: "llm" });
const limits: ChatSupervisionLimits = { totalMs: 2_000, classificationMs: 1_000, requestMs: 1_000, transientRetries: 0 };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
const start = (supervisor: ChatSupervisor, overrides: Partial<ChatSupervisionLimits> = {}) =>
  beginChatSupervisedPublication(input, { supervisor, limits: { ...limits, ...overrides } });
type Result = Awaited<ReturnType<ReturnType<typeof start>["finish"]>>;

const traceFor = (result: Result): ChatExecutionTrace => {
  const attempts: ChatExecutionTrace["attempts"] = result.candidates.map((candidate, index) => ({
    attemptId: `attempt-${index + 1}`,
    phase: candidate === result.generation ? "GENERATED" : "REJECTED",
    generation: candidate,
  }));
  return {
    requestId: "offline-request", conversationId: "offline-conversation", turnId: input.currentTurnId,
    planId: "offline-plan", phase: result.generation ? "GENERATED" : "FAILED",
    planPreflight: { passed: true, failureReasons: [] }, transitions: [], attempts,
    publication: { ...result.publication, ...(result.generation ? { winnerAttemptId: attempts.at(-1)?.attemptId } : {}) },
  };
};

const assertWithheld = (result: Result, reason: NonNullable<Result["publication"]["failure"]>["reason"]) => {
  assert.equal(result.generation, null);
  assert.equal(result.publication.outcome, "withheld");
  assert.equal(result.publication.failure?.reason, reason);
  assert.equal(isExecutionPublishable(traceFor(result)), false);
};

const deferredParallel = async (first: "draft" | "classification") => {
  const risk = deferred<ChatRiskDecision>();
  const draft = deferred<AiGenerationResult>();
  const started: string[] = [];
  const publication = start({
    classify: async (received) => {
      started.push("classification");
      assert.deepEqual(received, input);
      assert(!JSON.stringify(received).includes(draftText));
      return risk.promise;
    },
    review: async () => assert.fail("An ordinary reply must not be reviewed"),
  });
  let completed = false;
  const finish = publication.finish(async () => { started.push("draft"); return draft.promise; }).then(result => { completed = true; return result; });
  await tick();
  assert.deepEqual(started.toSorted(), ["classification", "draft"]);
  if (first === "draft") draft.resolve(generation(draftText));
  else risk.resolve(ordinary);
  await tick();
  assert(!completed, `The ${first} cannot determine publication alone`);
  if (first === "draft") risk.resolve(ordinary);
  else draft.resolve(generation(draftText));
  const result = await finish;
  assert.equal(result.generation?.text, draftText);
  assert.equal(result.publication.outcome, "ordinary");
  assert.equal(result.publication.reviews.length, 0);
  const trace = traceFor(result);
  assert(isExecutionPublishable(trace));
  assert(!isExecutionPublishable({ ...trace, planPreflight: { passed: false, failureReasons: ["offline-invalid-plan"] } }));
  assert(!isExecutionPublishable({ ...trace, phase: "VALIDATED" }));
  assert(isExecutionPublishable({ ...trace, publication: undefined, phase: "VALIDATED" }));
  assert(!isExecutionPublishable({ ...trace, publication: undefined }));
  assert(!isExecutionPublishable({ ...trace, publication: { ...trace.publication!, winnerAttemptId: "stale" } }));
};

const reviewAndRepair = async (risk: ChatRiskDecision, secondVerdict: ChatSafetyReview) => {
  const reviews: string[] = [];
  let generations = 0;
  const result = await start({
    classify: async () => risk,
    review: async (received, currentRisk, candidate) => {
      assert.deepEqual(received, input);
      assert.deepEqual(currentRisk, risk);
      reviews.push(candidate);
      return reviews.length === 1 ? declined : secondVerdict;
    },
  }).finish(async (_signal, rewrite) => {
    generations++;
    if (!rewrite) return generation(draftText);
    assert.deepEqual(rewrite, { priorReply: draftText, review: declined });
    return generation(repairText);
  });
  assert.equal(generations, 2);
  assert.deepEqual(reviews, [draftText, repairText]);
  assert.deepEqual(result.candidates.map(candidate => candidate.text), reviews);
  assert.deepEqual(result.publication.reviews, [{ attempt: 1, verdict: declined }, { attempt: 2, verdict: secondVerdict }]);
  if (secondVerdict.approved) {
    assert.equal(result.generation?.text, repairText);
    assert.equal(result.publication.outcome, "safety_checked");
    const trace = traceFor(result);
    assert(isExecutionPublishable(trace));
    assert(!isExecutionPublishable({ ...trace, publication: { ...trace.publication!, winnerAttemptId: trace.attempts[0].attemptId } }));
    assert(!isExecutionPublishable({ ...trace, publication: { ...trace.publication!, reviews: trace.publication!.reviews.slice(0, 1) } }));
  } else assertWithheld(result, "safety_issues_after_one_repair");
};

const unverifiedResourcesCannotUseModelApproval = async () => {
  const plainNumber = "请拨打000联系紧急服务。";
  const shortLink = "点开 [紧急求助](https://t.invalid/a)。";
  const timeAndQuantity = "她在 22:10 报警了，已经等了 120 分钟。" + repairText;
  const cases = [
    { risk: danger, first: plainNumber, second: timeAndQuantity, allowed: timeAndQuantity },
    { risk: danger, first: "请拨打 ０－０－０ 联系紧急服务。", second: repairText, allowed: repairText },
    { risk: uncertain, first: "请拨打零 零 零。", second: repairText, allowed: repairText },
    { risk: uncertain, first: shortLink, second: "请访问t.invalid/a求助。", allowed: null },
  ];
  for (const { risk, first, second, allowed } of cases) {
    const reviewed: string[] = [];
    const result = await start({
      classify: async () => risk,
      review: async (_input, _risk, candidate) => { reviewed.push(candidate); return approved; },
    }).finish(async (_signal, rewrite) => {
      if (!rewrite) return generation(first);
      assert.match(formatSafetyRewrite(rewrite), /Remove concrete phone numbers and links/i);
      return generation(second);
    });
    assert.deepEqual(reviewed, [first, second], "Model approval cannot bypass the resource check or add another repair");
    assert.deepEqual(result.candidates.map(candidate => candidate.text), [first, second]);
    assert.deepEqual(result.publication.reviews.map(({ verdict }) => verdict), [approved, approved]);
    if (allowed === null) {
      assertWithheld(result, "unverified_resource");
      assert.equal(result.publication.failure?.retryable, false);
      continue;
    }
    assert.equal(result.generation?.text, allowed);
    const trace = traceFor(result);
    assert(isExecutionPublishable(trace, allowed));
    trace.attempts.at(-1)!.generation = generation(first);
    assert(!isExecutionPublishable(trace, first), "A substituted winning body requires its own resource check");
  }
  const ordinaryResult = await start({
    classify: async () => ordinary,
    review: async () => assert.fail("An ordinary body must not be reviewed"),
  }).finish(async (_signal, rewrite) => {
    assert.equal(rewrite, undefined);
    return generation(plainNumber);
  });
  assert.equal(ordinaryResult.generation?.text, plainNumber);
  assert.deepEqual(ordinaryResult.publication.reviews, []);
  assert(isExecutionPublishable(traceFor(ordinaryResult), plainNumber));
};

const uncertainNeedsReview = async () => {
  const review = deferred<ChatSafetyReview>();
  let reviewed = false;
  let completed = false;
  const finish = start({
    classify: async () => uncertain,
    review: async (_input, risk, text) => {
      assert.deepEqual(risk, uncertain);
      assert.equal(text, draftText);
      reviewed = true;
      return review.promise;
    },
  }).finish(async (_signal, rewrite) => {
    assert.equal(rewrite, undefined);
    return generation(draftText);
  }).then(result => { completed = true; return result; });
  await tick();
  assert(reviewed && !completed);
  review.resolve(approved);
  const result = await finish;
  assert.equal(result.generation?.text, draftText);
  assert.equal(result.publication.outcome, "safety_checked");
  assert(isExecutionPublishable(traceFor(result)));
};

const failedClassification = async () => {
  const invalid = deferred<ChatRiskDecision>();
  let classifications = 0;
  const publication = start({
    classify: async () => { classifications++; return invalid.promise; },
    review: async () => assert.fail("Missing classification cannot release a body review"),
  }, { transientRetries: 1 });
  const finish = publication.finish(async () => generation(draftText));
  await tick();
  invalid.reject(new AppError("AI_JUDGE_FAILED", "offline invalid classification", 502, { failureType: "invalid_output" }));
  const result = await finish;
  assertWithheld(result, "invalid_output");
  assert.equal(classifications, 1);
  assert.deepEqual(result.candidates.map(candidate => candidate.text), [draftText]);
};

const timedOutReview = async () => {
  const review = deferred<ChatSafetyReview>();
  let reviewSignal: AbortSignal | undefined;
  const publication = start({
    classify: async () => danger,
    review: async (_input, _risk, _body, signal) => { reviewSignal = signal; return review.promise; },
  }, { requestMs: 35 });
  const result = await publication.finish(async () => generation(draftText));
  assertWithheld(result, "timeout");
  assert.equal(result.publication.failure?.stage, "safety_review");
  assert(reviewSignal?.aborted);
  review.resolve(approved);
  await tick();
  assert.equal(result.generation, null);
  assert.equal(result.publication.reviews.length, 0);
  assert.deepEqual(result.candidates.map(candidate => candidate.text), [draftText]);
};

const lateCancellation = async () => {
  const draft = deferred<AiGenerationResult>();
  let generationSignal: AbortSignal | undefined;
  const publication = start({ classify: async () => ordinary, review: async () => assert.fail("No review after cancellation") });
  const finish = publication.finish(async signal => { generationSignal = signal; return draft.promise; });
  await tick();
  publication.cancel();
  const result = await finish;
  assertWithheld(result, "timeout");
  assert(generationSignal?.aborted);
  assert.equal(result.publication.risk?.route, "ordinary");
  draft.resolve(generation(draftText));
  await tick();
  assert.deepEqual(result.candidates, []);
};

const cancelledBeforeSelection = async () => {
  const publication = start({ classify: async () => ordinary, review: async () => assert.fail("Ordinary needs no review") });
  const cancelAfter = (remaining: number) => queueMicrotask(() => {
    if (remaining === 1) publication.cancel();
    else cancelAfter(remaining - 1);
  });
  const result = await publication.finish(async () => {
    cancelAfter(4);
    return generation(draftText);
  });
  assertWithheld(result, "cancelled");
  assert.equal(result.publication.failure?.retryable, false);
  assert.deepEqual(result.candidates.map(candidate => candidate.text), [draftText]);
};

const oneTransientAllowance = async () => {
  const transient = () => new AppError("AI_JUDGE_FAILED", "offline temporary failure", 502, { retryable: true });
  let classifications = 0;
  let reviews = 0;
  const result = await start({
    classify: async () => { if (++classifications === 1) throw transient(); return danger; },
    review: async () => { reviews++; throw transient(); },
  }, { transientRetries: 1 }).finish(async () => generation(draftText));
  assertWithheld(result, "provider_failure");
  assert.equal(result.publication.failure?.stage, "safety_review");
  assert.equal(classifications, 2);
  assert.equal(reviews, 1);
  assert.deepEqual(result.publication.stages.filter(item => item.stage === "classification").map(item => item.status), ["provider_failure", "ok"]);
};

const previousAssistantMetadata = () => {
  const previous: AiConversationMessage = { id: "last-assistant", role: "assistant", content: "今天吃了什么？", status: "saved" };
  const stateFor = (message: AiConversationMessage) => {
    const userMessage = "炒饭。";
    const recentMessages = [message];
    const context = assembleConversationControlContext({
      conversationId: "offline-history", currentTurnId: "current", userMessage, recentMessages,
      conversationState: determineConversationState({ currentUserMessage: userMessage, recentMessages }),
    });
    return buildDialogueState(context, interpretTurnDeterministically(context));
  };
  assert.equal(stateFor({ ...previous, committedAssistantMove: null }).lastCommittedAssistantMove, null);
  const legacy = stateFor(previous).lastCommittedAssistantMove;
  assert.equal(legacy?.sourceTurnId, previous.id);
  assert.equal(legacy?.questionOrRequest?.kind, "question");
  assert.equal(legacy?.expectedUserContribution, "answer");
};

const actualChatEntry = async () => {
  const overrides = {
    AI_PROVIDER: "qwen", QWEN_API_KEY: "offline-fixture", QWEN_BASE_URL: "https://publication-check.invalid/v1",
    AI_MAIN_MODEL: "offline-fixture", AI_TIMEOUT_MS: "2000", CONVERSATION_OS_INTERPRETER_MODEL_ENABLED: "true",
  };
  const original = Object.entries(overrides).map(([key, value]) => {
    const previous = process.env[key];
    process.env[key] = value;
    return [key, previous] as const;
  });
  const userMessage = "我刚吃过饭。";
  const candidate = "你肯定已经吃饱了。";
  const risk = deferred<ChatRiskDecision>();
  let surface = deferred<AiModelMessage[]>();
  const temperatures: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://publication-check.invalid/v1/chat/completions");
    const { temperature, messages } = JSON.parse(String(options?.body)) as { temperature: number; messages: AiModelMessage[] };
    temperatures.push(temperature);
    if (temperature === 0.75) surface.resolve(messages);
    const text = temperature === 0.75 ? candidate : JSON.stringify({
      literalMeaning: userMessage,
      confidence: 0.99,
      responseRelation: { candidates: [] },
      notes: [],
    });
    return Response.json({ choices: [{ message: { content: text } }] });
  };
  try {
    let completed = false;
    const identity = { requestId: "offline-entry-request", currentTurnId: "offline-entry-turn" };
    const base = {
      conversationId: "offline-entry", ...identity, userMessage, recentMessages: [],
      memoryContext: null, understandingContext: null, episodeMemoryCandidates: [],
      helpingShadowEnabled: false, helpingOrdinaryHandoffEnabled: false,
      safetySemanticProvider: async () => assert.fail("The separate classifier replaces the old Safety triage"),
      plannedFunctionSemanticProvider: async () => assert.fail("Ordinary publication cannot run a planned-function judge"),
    };
    const finish = createChatReply({
      ...base,
      supervision: { limits, supervisor: {
        classify: async received => {
          assert.equal(received.currentUserMessage, userMessage);
          assert.equal(received.currentTurnId, identity.currentTurnId);
          return risk.promise;
        },
        review: async () => assert.fail("The ordinary body does not need a safety review"),
      } },
    }).then(result => { completed = true; return result; });
    const messages = await Promise.race([surface.promise, finish.then(result => assert.fail(`Actual chat returned before Surface: ${result.execution.failure?.reason ?? result.execution.phase}`))]);
    await tick();
    assert(!completed, "Actual generation finishes before the delayed classification can permit publication");
    assert(messages.some(message => message.content.includes("Conversation OS ResponsePlan")));
    assert(messages.some(message => message.role === "user" && message.content === userMessage));
    risk.resolve(ordinary);
    const result = await finish;
    assert.equal(result.execution.requestId, identity.requestId);
    assert.equal(result.execution.turnId, identity.currentTurnId);
    assert.equal(result.controlTrace?.responsePlan.disclosureScope.turnId, identity.currentTurnId);
    assert.deepEqual(temperatures, [0.1, 0.75]);
    assert.equal(result.controlTrace?.interpretationModel.used, true);
    assert.equal(result.controlTrace?.context.currentUserMessage, userMessage);
    assert.equal(result.execution.planPreflight.passed, true);
    assert.deepEqual(result.controlTrace?.validation, []);
    assert.deepEqual(result.controlTrace?.stateUpdate.answeredObligations, []);
    assert.deepEqual(result.controlTrace?.stateUpdate.obligationTransitions, []);
    assert.equal(result.generation.text, candidate);
    assert.equal(result.judge.passed, false);
    assert(isExecutionPublishable(result.execution));
    assert(!isCommittedPublicationOnly(result.execution));
    const persisted = { ...result.execution, phase: "COMMITTED", committedMessageId: "offline-saved-assistant" };
    assert(isCommittedPublicationOnly(persisted));
    assert(!isCommittedPublicationOnly({ ...persisted, publication: undefined }));
    assert(!isCommittedPublicationOnly({ ...persisted, publication: { ...persisted.publication!, version: 2 } }));
    assert(!isCommittedPublicationOnly({ ...persisted, publication: { ...persisted.publication!, outcome: "withheld" } }));

    surface = deferred<AiModelMessage[]>();
    const failedClassification = deferred<ChatRiskDecision>();
    const heldTurn = createChatReply({
      ...base,
      requestId: "offline-held-request",
      currentTurnId: "offline-held-turn",
      supervision: { limits, supervisor: {
        classify: async () => failedClassification.promise,
        review: async () => assert.fail("No review is permitted without a valid classification"),
      } },
    });
    await Promise.race([surface.promise, heldTurn.then(() => assert.fail("No surface was generated"))]);
    await tick();
    failedClassification.reject(new AppError("AI_JUDGE_FAILED", "offline invalid classification", 502, { failureType: "invalid_output" }));
    const held = await heldTurn;
    assert.equal(held.execution.publication?.risk, null);
    assert.equal(held.execution.publication?.outcome, "withheld");
    assert.equal(held.execution.publication?.failure?.stage, "classification");
    assert.equal(held.execution.publication?.failure?.reason, "invalid_output");
    assert.equal(held.execution.failure?.code, "PROVIDER_ERROR");
    assert.equal(toUserSafeExecutionStatus(held.execution).retryable, false);
    assert.equal(held.generation.text, "");
    assert.deepEqual(held.generationAttempts.map(({ text }) => text), [candidate]);
    assert(!isExecutionPublishable(held.execution, candidate));

    const questionTurn = await createChatReply({
      ...base,
      userMessage: "你是谁？",
      requestId: "offline-question-request",
      currentTurnId: "offline-question-turn",
      supervision: { limits, supervisor: {
        classify: async () => ordinary,
        review: async () => assert.fail("Ordinary questions need no safety review"),
      } },
    });
    assert(isExecutionPublishable(questionTurn.execution));
    const questionPlan = questionTurn.controlTrace?.responsePlan;
    assert(questionPlan?.answerObligations.length);
    assert.deepEqual(questionTurn.controlTrace?.stateUpdate.remainingOpenLoops, questionPlan.answerObligations.map(({ id }) => id));
    assert.deepEqual(questionTurn.controlTrace?.stateUpdate.answeredObligations, []);
    assert.deepEqual(questionTurn.controlTrace?.stateUpdate.obligationTransitions, []);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const loggedInCommitBoundary = async ({ execution, generation }: Awaited<ReturnType<typeof actualChatEntry>>) => {
  type Insert = { content: string; role: string; status: string; aiGenerationId: string; replyToMessageId: string };
  let winner: Insert | undefined;
  let persisted: unknown;
  let transactions = 0;
  let generationWrites = 0;
  let memoryWrites = 0;
  const assistantId = "offline-saved-assistant";
  const duplicateText = "Another eligible candidate";
  const duplicateRequestId = "another-offline-request";
  const candidates = new Map([
    ["generation-1", { text: generation.text, requestId: execution.requestId }],
    ["generation-2", { text: duplicateText, requestId: duplicateRequestId }],
  ]);
  let sourceAvailable = true;
  let storedWinnerDeleted = false;
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, ...scope: unknown[]) => {
      assert.match(sql.join(" "), /FOR SHARE/u);
      assert(scope.includes(execution.turnId));
      assert(scope.includes("offline-user"));
      assert(scope.includes(execution.conversationId));
      return sourceAvailable ? [{ id: execution.turnId }] : [];
    },
    chatMessage: {
      createMany: async ({ data: [row], skipDuplicates }: { data: Insert[]; skipDuplicates: boolean }) => {
        assert(skipDuplicates);
        assert.equal(row.replyToMessageId, execution.turnId);
        assert(!Object.hasOwn(row, "interactionMetadata"));
        if (winner) return { count: 0 };
        winner = row;
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { replyToMessageId: string } }) => {
        assert(winner && where.replyToMessageId === winner.replyToMessageId);
        return { ...winner, id: assistantId, userId: "offline-user", sessionId: execution.conversationId, interactionMetadata: null, createdAt: new Date(0),
          contentDeletedAt: storedWinnerDeleted ? new Date(0) : null,
          aiGeneration: { promptVersion: generation.promptVersion, executionTrace: persisted ?? execution } };
      },
    },
    chatSession: { update: async () => undefined },
    aiGeneration: {
      findFirst: async ({ where }: { where: {
        id: string; userId: string; sessionId: string; sourceType: string; sourceId: string; turnId: string;
        requestId: string; attemptId: string; outputText: string; status: string;
      } }) => {
        assert.equal(where.userId, "offline-user");
        assert.equal(where.sessionId, execution.conversationId);
        assert.equal(where.attemptId, execution.publication?.winnerAttemptId);
        assert.equal(where.sourceType, "CHAT");
        assert.equal(where.sourceId, execution.turnId);
        assert.equal(where.turnId, execution.turnId);
        assert.equal(where.status, "GENERATED");
        const saved = candidates.get(where.id);
        return saved?.text === where.outputText && saved.requestId === where.requestId ? { id: where.id } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { executionTrace: unknown } }) => {
        assert.equal(where.id, winner?.aiGenerationId);
        generationWrites++;
        persisted = data.executionTrace;
      },
    },
  };
  const mock = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => { transactions++; return work(tx); } };
  const loader = Module as unknown as { _load: (request: string, parent: { filename?: string } | undefined, isMain?: boolean) => unknown };
  const originalLoad = loader._load;
  const servicePath = path.resolve("services/ai/chatReplyService.ts");
  const requireFromRoot = createRequire(path.resolve("package.json"));
  let picks = 0;
  let commit: typeof import("../services/ai/chatReplyService").commitValidatedAssistantMessage;
  try {
    loader._load = (request, parent, isMain) => {
      if (parent?.filename === servicePath && request === "@/lib/prisma") { picks++; return { prisma: mock }; }
      if (parent?.filename === servicePath && request === "@/services/memory/rawMemoryService") {
        return { createRawMemoryFromChatMessage: async () => { memoryWrites++; } };
      }
      return originalLoad.call(Module, request, parent, isMain);
    };
    commit = requireFromRoot(servicePath).commitValidatedAssistantMessage;
  } finally { loader._load = originalLoad; }
  assert.equal(picks, 1, "Only the commit service's Prisma dependency is replaced");
  const args = { userId: "offline-user", sessionId: execution.conversationId, content: generation.text, status: "SAVED" as const, aiGenerationId: "generation-1",
    replyToMessageId: execution.turnId, interactionMetadata: null, execution, envelopeOrigin: null };
  await assert.rejects(commit({ ...args, content: "Different from the approved winner" }), /eligible execution/);
  await assert.rejects(commit({ ...args, sessionId: "wrong-session" }), /execution scope/);
  assert.equal(transactions, 0);
  await assert.rejects(commit({ ...args, aiGenerationId: "generation-2" }), /does not match the execution/);
  assert.equal(winner, undefined);
  sourceAvailable = false;
  await assert.rejects(commit(args), /does not match the execution/);
  assert.equal(winner, undefined);
  sourceAvailable = true;
  const first = await commit(args);
  assert.equal(first.content, generation.text);
  assert.equal(first.interactionMetadata, null);
  assert.equal(first.interactionMoveEnvelope, null);
  assert(isCommittedPublicationOnly(persisted));
  const duplicate = await commit({ ...args, aiGenerationId: "generation-2", content: duplicateText, execution: {
    ...execution, requestId: duplicateRequestId, attempts: execution.attempts.map(attempt => ({
      ...attempt, generation: attempt.generation ? { ...attempt.generation, text: duplicateText } : undefined,
    })),
  } });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.content, first.content);
  assert.equal(duplicate.aiGenerationId, args.aiGenerationId);
  assert.equal(duplicate.interactionMoveEnvelope, null);
  storedWinnerDeleted = true;
  await assert.rejects(commit(args), /conversation|visibility|visible|deleted/iu);
  assert.equal(generationWrites, 1);
  assert.equal(memoryWrites, 1);
  assert.equal(transactions, 5);
};

const main = async () => {
  // AbortSignal.timeout does not keep Node alive. The watchdog also bounds any
  // mistaken test that stops settling before its expected deadline.
  const watchdog = setTimeout(() => assert.fail("Offline publication checks did not settle"), 5_000);
  try {
    await deferredParallel("draft");
    await deferredParallel("classification");
    await reviewAndRepair(danger, approved);
    await reviewAndRepair(uncertain, declined);
    await unverifiedResourcesCannotUseModelApproval();
    await uncertainNeedsReview();
    await failedClassification();
    await timedOutReview();
    await lateCancellation();
    await cancelledBeforeSelection();
    await oneTransientAllowance();
    const invalid = await start({ classify: async () => ordinary, review: async () => assert.fail("Empty output cannot be reviewed") }).finish(async () => generation(" \n "));
    assertWithheld(invalid, "invalid_generation");
    const unavailable = toUserSafeExecutionStatus({
      ...traceFor(invalid), publication: undefined, planId: "safety-pre-gate",
      planPreflight: { passed: false, failureReasons: ["safety_triage_unavailable"] },
      failure: { code: "SAFETY_BLOCKED", reason: "safety_semantic_provider_unconfigured", retryable: false },
    });
    assert.equal(unavailable.message, "安全检查暂时无法完成，请重试。");
    assert.equal(unavailable.retryable, true);
    previousAssistantMetadata();
    await loggedInCommitBoundary(await actualChatEntry());
    console.log(JSON.stringify({ status: "PASS", cases: 24, actualModelCalls: 0, databaseCalls: 0 }));
  } finally { clearTimeout(watchdog); }
};

void main().catch(error => { console.error(error); process.exitCode = 1; });
