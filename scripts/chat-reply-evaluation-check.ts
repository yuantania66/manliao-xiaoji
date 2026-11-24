import assert from "node:assert/strict";

import { evaluateChatReply } from "../services/ai/chatReplyEvaluation";
import type { readReplyFeedbackSnapshot } from "../services/ai/chatReplyFeedback";

type Snapshot = NonNullable<Awaited<ReturnType<typeof readReplyFeedbackSnapshot>>>;

const input: Snapshot = {
  assistantMessage: { id: "reply-1", content: "先把这一句说完就好。" },
  userMessage: { id: "user-1", content: "我只想说一句，不想被追问。" },
  feedback: [],
  version: "synthetic-version-1",
};
const makeResponse = () => {
  const evidence = [{ sourceId: "reply-1", quote: "先把这一句说完" }];
  const score = { score: 4, reason: "回应短，留了空间。", evidence };
  return {
    scores: { understanding: { ...score }, responsiveness: { ...score }, boundaries: { ...score }, expression: { ...score } },
    strengths: [{ dimension: "boundaries", observation: "保留用户只想说一句的界限。", evidence }],
    weaknesses: [{ dimension: "expression", observation: "还可以少一点指令口气。", evidence, nextAction: "用更自然的承接表达，不增加问题。" }],
    reportedImpact: null as { sourceId: string; quote: string } | null,
  };
};
const verify = (snapshot: Snapshot, value: unknown) => evaluateChatReply(snapshot, async () => JSON.stringify(value));

const main = async () => {
  const response = makeResponse();
  const result = await evaluateChatReply(input, async (messages) => {
    const supplied = JSON.stringify(messages);
    assert(supplied.includes(input.assistantMessage.content));
    assert(supplied.includes(input.userMessage!.content));
    return JSON.stringify(response);
  });
  assert.deepEqual(result.scores, response.scores);
  assert.deepEqual(result.strengths, response.strengths);
  assert.deepEqual(result.weaknesses, response.weaknesses);
  assert.deepEqual(result.reportedImpact, { status: "unknown" });
  assert.equal(result.evidenceVersion, input.version);
  assert.equal(result.reviewStatus, "pending_human_review");

  const withFeedback: Snapshot = {
    ...input,
    version: "synthetic-version-2",
    feedback: [{
      id: "manual-1",
      signal: "HELPFUL",
      tags: null,
      comment: "我觉得这里很有帮助。",
      sourceMessage: { id: "later-1", content: "这句让我觉得轻松一点。" },
    }],
  };
  for (const ref of [
    { sourceId: "later-1", quote: "让我觉得轻松一点" },
    { sourceId: "feedback:manual-1", quote: "我觉得这里很有帮助" },
  ]) {
    const linked = await verify(withFeedback, { ...response, reportedImpact: ref });
    assert.deepEqual(linked.reportedImpact, { status: "user_reported", ...ref });
    assert.equal(linked.evidenceVersion, withFeedback.version);
  }
  await assert.rejects(() => verify(input, { ...response, reportedImpact: { sourceId: "later-1", quote: "轻松" } }));
  await assert.rejects(() => verify(withFeedback, {
    ...response, reportedImpact: { sourceId: "user-1", quote: "我只想说一句" },
  }), "The initial request cannot become a later report of impact");
  await assert.rejects(() => verify(withFeedback, {
    ...response, reportedImpact: { sourceId: "later-1", quote: "我很开心" },
  }), "A report requires an exact quotation");

  for (const score of [0, 4.5, 6]) {
    const invalid = makeResponse();
    invalid.scores.understanding.score = score;
    await assert.rejects(() => verify(input, invalid));
  }
  const fullScoreWithWeakness = makeResponse();
  fullScoreWithWeakness.scores.expression.score = 5;
  await assert.rejects(() => verify(input, fullScoreWithWeakness));

  for (const evidence of [[], [{ sourceId: "other", quote: "先把这一句说完" }], [{ sourceId: "reply-1", quote: "已经治愈了" }]]) {
    const invalid = makeResponse();
    invalid.scores.understanding.evidence = evidence;
    await assert.rejects(() => verify(input, invalid));
  }
  const uncoupledWeakness = makeResponse();
  uncoupledWeakness.weaknesses[0].nextAction = " ";
  await assert.rejects(() => verify(input, uncoupledWeakness), "A weakness must specify a concrete change field");
  await assert.rejects(() => verify(input, { ...response, autoTrain: true }));
  const privateOutput = "invalid synthetic private output";
  await assert.rejects(() => evaluateChatReply(input, async () => privateOutput),
    (err: Error) => !err.message.includes(privateOutput));

  console.log("Chat reply evaluation checks passed (local evaluator stub, no model or database).");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
