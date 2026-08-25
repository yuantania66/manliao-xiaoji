import assert from "node:assert/strict";

import {
  assembleConversationControlContext,
  interpretTurnDeterministically,
} from "../conversation-os/control";
import { determineConversationState } from "../conversation-os/state";
import {
  qwenPurposeSubjectOwnershipProvider,
  runPurposeSubjectOwnershipAuthority,
  type PurposeSubjectOwnership,
} from "../services/ai/purposeSubjectOwnershipAuthority";

const fixtures: Array<{ id: string; message: string; expected: PurposeSubjectOwnership }> = [
  { id: "self-prefix", message: "我为什么总会这样", expected: "current_user_self" },
  { id: "self-question-first", message: "为什么我总会这样", expected: "current_user_self" },
  { id: "self-question-last", message: "我总是这样，为什么", expected: "current_user_self" },
  { id: "self-possessive", message: "我的情绪为什么总反复", expected: "current_user_self" },
  { id: "self-reaction", message: "这件事为什么总让我退缩", expected: "current_user_self" },
  { id: "external-event", message: "为什么会下雨", expected: "external_or_other" },
  { id: "external-system", message: "这个接口为什么报错", expected: "external_or_other" },
  { id: "external-person", message: "她为什么总躲着我", expected: "external_or_other" },
  { id: "ambiguous-owner", message: "为什么总这样", expected: "uncertain" },
];

const main = async () => {
const failures: string[] = [];
for (const fixture of fixtures) {
  const context = assembleConversationControlContext({
    conversationId: `purpose-qwen-${fixture.id}`,
    currentTurnId: `purpose-qwen-${fixture.id}:turn-1`,
    userMessage: fixture.message,
    recentMessages: [],
    conversationState: determineConversationState({ currentUserMessage: fixture.message, recentMessages: [] }),
    episodeMemoryCandidates: [],
  });
  const result = await runPurposeSubjectOwnershipAuthority({
    context,
    interpretation: interpretTurnDeterministically(context),
    provider: qwenPurposeSubjectOwnershipProvider,
  });
  const actual = result.trace.ownership ?? result.trace.reason;
  if (actual !== fixture.expected) failures.push(`${fixture.id}: expected=${fixture.expected} actual=${actual}`);
  console.log(JSON.stringify({ id: fixture.id, expected: fixture.expected, actual }));
}

assert.deepEqual(failures, []);
console.log(`purpose subject-ownership Qwen eval: PASS (${fixtures.length}/${fixtures.length})`);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
