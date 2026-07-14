import assert from "node:assert/strict";

import { H1_EVAL_CASES } from "../lib/h1-eval/cases";
import { detectHardViolations, renderCandidateMarkdown } from "../lib/h1-eval/generator";
import { toPublicCases } from "../lib/h1-eval/storage";
import type { H1CandidateManifest } from "../lib/h1-eval/types";

assert.equal(H1_EVAL_CASES.length, 40);
assert.equal(new Set(H1_EVAL_CASES.map((item) => item.id)).size, 40);
assert.equal(H1_EVAL_CASES.filter((item) => item.cohort === "confirmed").length, 28);
assert.equal(H1_EVAL_CASES.filter((item) => item.cohort === "pending").length, 4);
assert.equal(H1_EVAL_CASES.filter((item) => item.cohort === "guard").length, 8);
assert.deepEqual(
  Object.fromEntries(["S1", "S2", "S3", "S4"].map((group) => [group, H1_EVAL_CASES.filter((item) => item.group === group).length])),
  { S1: 21, S2: 7, S3: 9, S4: 3 }
);
assert.equal(H1_EVAL_CASES.find((item) => item.id === "018")?.cohort, "pending");
assert.deepEqual(
  H1_EVAL_CASES.filter((item) => item.cohort === "pending").map((item) => item.id),
  ["018", "067", "036", "057"]
);
assert.ok(H1_EVAL_CASES.every((item) => item.userInput && item.baselineReply && item.necessaryContext));

const rejectedChallenges = [
  ["我听到了。", "累"],
  ["听到你说累了。", "累"],
  ["我听见了。", "怕"],
  ["我看到你发了 1。", "1"],
  ["我看到这个符号。", "🙂"],
  ["我接住了。", "烦"],
  ["这个我接住了。", "怕"],
  ["嗯，我在这里。", "空"],
  ["先放在这里。", "累"],
  ["没关系，你可以继续。", "1"],
  ["你可能得了抑郁症。", "累"],
  ["这需要诊断。", "烦"],
  ["我给你一个治疗方案。", "怕"],
  ["建议开始药物治疗。", "睡不好"],
  ["1", "1"],
  ["有点累", "有点累"],
  ["🙂", "🙂"],
  ["……", "……"],
  ["同一句", "别的", ["同一句"]],
  ["回复", "其它", ["回复"]],
  ["a".repeat(221), "x"],
  ["", "x"],
] as const;

for (const [reply, input, existing = []] of rejectedChallenges) {
  assert.ok(detectHardViolations(reply, input, [...existing]).length > 0, `Expected rejection: ${reply}`);
}

const acceptedChallenges = [
  ["可以讲讲为什么发 1 吗？", "1"],
  ["这个“怕”更靠近担心，还是眼下正在发生的害怕？", "怕"],
  ["今天最难撑的是哪一段？", "今天不太行。"],
  ["重逢却没有开口，梦里最清楚的是沉默还是那个人？", "梦见朋友"],
  ["“空”对你来说是一个感受，还是你只是想发这个字？", "空"],
] as const;
for (const [reply, input] of acceptedChallenges) {
  assert.deepEqual(detectHardViolations(reply, input), [], `Expected pass: ${reply}`);
}

const manifest: H1CandidateManifest = {
  version: 1,
  round: 1,
  generatedAt: new Date(0).toISOString(),
  model: "test-model",
  cases: [{
    id: "001",
    group: "S1",
    cohort: "confirmed",
    userInput: "1",
    necessaryContext: "single turn",
    candidates: [{ label: "A", text: "为什么发 1 呢？", origin: "baseline", action: "secret", model: "secret-model" }],
  }],
};
const serializedPublic = JSON.stringify(toPublicCases(manifest));
assert.ok(!serializedPublic.includes("baseline"));
assert.ok(!serializedPublic.includes("secret"));
assert.ok(!serializedPublic.includes("model"));
assert.ok(serializedPublic.includes("为什么发 1"));

const blindMarkdown = renderCandidateMarkdown(manifest);
assert.ok(blindMarkdown.includes("## Case 001"));
assert.ok(blindMarkdown.includes("候选 A："));
assert.ok(blindMarkdown.includes("- 最优：A / 全部不行"));
assert.ok(!blindMarkdown.includes("secret-model"));
assert.ok(!blindMarkdown.includes("secret"));

console.log("PASS: H1 case cohorts total 28 confirmed, 4 pending, 8 guards");
console.log("PASS: S1/S2/S3/S4 coverage totals 21/7/9/3");
console.log(`PASS: ${rejectedChallenges.length} hard-boundary counterexamples rejected`);
console.log(`PASS: ${acceptedChallenges.length} non-assumptive response counterexamples accepted`);
console.log("PASS: public review payload hides origin, action, and model provenance");
console.log("PASS: blind Markdown hides candidate provenance");
