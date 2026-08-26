import assert from "node:assert/strict";

import {
  assembleConversationControlContext,
  buildDialogueState,
  createResponsePlan,
  interpretTurnDeterministically,
  type ConversationControlContext,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import {
  PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION,
  PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
  PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION,
  runPurposeSubjectOwnershipAuthority,
  type PurposeSubjectOwnership,
  type PurposeSubjectOwnershipProvider,
} from "../services/ai/purposeSubjectOwnershipAuthority";

const contextFor = (message: string): ConversationControlContext => assembleConversationControlContext({
  conversationId: "purpose-subject-check",
  currentTurnId: "purpose-subject-check:turn-1",
  userMessage: message,
  recentMessages: [],
  conversationState: determineConversationState({ currentUserMessage: message, recentMessages: [] }),
  episodeMemoryCandidates: [],
});

const outputFor = (message: string, ownership: PurposeSubjectOwnership) => JSON.stringify({
  schemaVersion: PURPOSE_SUBJECT_OWNERSHIP_SCHEMA_VERSION,
  authorityVersion: PURPOSE_SUBJECT_OWNERSHIP_AUTHORITY_VERSION,
  contractSha256: PURPOSE_SUBJECT_OWNERSHIP_CONTRACT_SHA256,
  conversationId: "purpose-subject-check",
  turnId: "purpose-subject-check:turn-1",
  question: { text: message, start: 0, end: message.length },
  ownership,
  evidence: [{ text: message, start: 0, end: message.length }],
});

const run = async ({
  message,
  ownership,
  provider,
  mutateContext,
}: {
  message: string;
  ownership?: PurposeSubjectOwnership;
  provider?: PurposeSubjectOwnershipProvider;
  mutateContext?: (context: ConversationControlContext) => void;
}) => {
  const context = contextFor(message);
  mutateContext?.(context);
  const deterministic = interpretTurnDeterministically(context);
  let calls = 0;
  const selectedProvider: PurposeSubjectOwnershipProvider | undefined = provider ?? (ownership
    ? async () => {
        calls += 1;
        return outputFor(message, ownership);
      }
    : undefined);
  const result = await runPurposeSubjectOwnershipAuthority({
    context,
    interpretation: deterministic,
    provider: selectedProvider
      ? async (input) => {
          if (provider) calls += 1;
          return selectedProvider(input);
        }
      : undefined,
  });
  return { context, deterministic, result, calls };
};

const main = async () => {
for (const message of [
  "为什么我总会这样",
  "我总是这样，为什么",
  "我的情绪为什么总反复",
  "这件事为什么总让我退缩",
  "为什么我总会这样🙂",
]) {
  const { context, result, calls } = await run({ message, ownership: "current_user_self" });
  assert.equal(calls, 1, `${message}: exactly one authority call`);
  assert.equal(result.trace.ownership, "current_user_self");
  assert.equal(result.interpretation.directQuestions.length, 0);
  assert.equal(result.interpretation.ordinaryPostureProposal?.mode, "explore");
  assert.equal(result.interpretation.stateUpdate.obligationChanges.length, 0);
  const dialogueState = buildDialogueState(context, result.interpretation);
  const responsePlan = createResponsePlan({
    context,
    interpretation: result.interpretation,
    dialogueState,
    clinicalAdviceProvider: () => null,
  });
  assert.equal(responsePlan.answerObligations.length, 0);
  assert.equal(responsePlan.ordinaryPosture?.mode, "explore");
}

for (const message of ["为什么会下雨", "这个接口为什么报错", "她为什么总躲着我"]) {
  const { result, calls } = await run({ message, ownership: "external_or_other" });
  assert.equal(calls, 1);
  assert.equal(result.interpretation.directQuestions.length, 1);
  assert.equal(result.interpretation.directQuestions[0]?.subjectOwnership, "external_or_other");
  assert.equal(result.interpretation.ordinaryPostureProposal, null);
}

{
  const message = "为什么总这样";
  const { result, calls } = await run({ message, ownership: "uncertain" });
  assert.equal(calls, 1);
  assert.equal(result.interpretation.directQuestions.length, 1);
  assert.equal(result.interpretation.directQuestions[0]?.subjectOwnership, "uncertain");
  assert.equal(result.interpretation.ordinaryPostureProposal, null);
}

const invalidEvidence = JSON.parse(
  outputFor("为什么我总会这样", "current_user_self")
) as { evidence: Array<{ start: number }> };
invalidEvidence.evidence[0]!.start = 1;
const substringEvidence = JSON.parse(
  outputFor("为什么我总会这样", "current_user_self")
) as { evidence: Array<{ text: string; start: number; end: number }> };
substringEvidence.evidence = [{ text: "我", start: 3, end: 4 }];
const duplicateEvidence = JSON.parse(
  outputFor("为什么我总会这样", "current_user_self")
) as { evidence: Array<{ text: string; start: number; end: number }> };
duplicateEvidence.evidence.push({ ...duplicateEvidence.evidence[0]! });

for (const failure of [
  "not-json",
  JSON.stringify({}),
  outputFor("为什么我总会这样", "current_user_self").replace('"turnId":"purpose-subject-check:turn-1"', '"turnId":"wrong"'),
  outputFor("为什么我总会这样", "current_user_self").replace('"start":0,"end":8', '"start":1,"end":8'),
  JSON.stringify(invalidEvidence),
  JSON.stringify(substringEvidence),
  JSON.stringify(duplicateEvidence),
]) {
  const { deterministic, result, calls } = await run({
    message: "为什么我总会这样",
    provider: async () => failure,
  });
  assert.equal(calls, 1);
  assert.equal(result.trace.used, false);
  assert.equal(result.interpretation.directQuestions.length, deterministic.directQuestions.length);
  assert.equal(result.interpretation.ordinaryPostureProposal, null);
}

{
  const context = contextFor("为什么我总会这样");
  const interpretation = interpretTurnDeterministically(context);
  interpretation.directQuestions[0]!.targetTurnId = "assistant-claim-turn";
  interpretation.directQuestions[0]!.targetProposition = "已经提交的助手命题";
  let calls = 0;
  const result = await runPurposeSubjectOwnershipAuthority({
    context,
    interpretation,
    provider: async () => {
      calls += 1;
      return outputFor(context.currentUserMessage, "current_user_self");
    },
  });
  assert.equal(calls, 0, "committed-claim-bound question must call zero times");
  assert.equal(result.interpretation.directQuestions.length, 1);
}

{
  const { deterministic, result, calls } = await run({
    message: "为什么我总会这样",
    provider: async () => { throw new Error("fixture provider failure"); },
  });
  assert.equal(calls, 1);
  assert.equal(result.trace.used, false);
  assert.equal(result.interpretation.directQuestions.length, deterministic.directQuestions.length);
}

for (const exclusion of [
  { message: "今天怎么样", mutate: undefined },
  { message: "为什么我总会这样", mutate: (context: ConversationControlContext) => { context.interaction.stopIntent = true; } },
  { message: "为什么我总会这样", mutate: (context: ConversationControlContext) => { context.repairSignal = true; } },
  { message: "为什么我总会这样", mutate: (context: ConversationControlContext) => { context.safety.triggered = true; } },
]) {
  const { result, calls } = await run({
    message: exclusion.message,
    provider: async () => outputFor(exclusion.message, "current_user_self"),
    mutateContext: exclusion.mutate,
  });
  assert.equal(calls, 0, `${exclusion.message}: excluded paths must call zero times`);
  assert.equal(result.trace.attempted, false);
}

{
  const context = contextFor("为什么我总会这样");
  const interpretation = interpretTurnDeterministically(context);
  const result = await runPurposeSubjectOwnershipAuthority({ context, interpretation });
  assert.equal(result.trace.reason, "provider_not_authorized");
  assert.equal(result.interpretation.directQuestions.length, 1);
}

console.log("purpose subject-ownership authority check: PASS");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
