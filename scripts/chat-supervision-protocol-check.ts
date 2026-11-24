import assert from "node:assert/strict";
import { AppError } from "../lib/errors";
import { createChatSupervisor, type ChatRiskDecision, type ChatSupervisionInput } from "../services/ai/chatSupervision";
import { ModelCallCancelledError } from "../services/ai/modelProvider";

const originalFetch = globalThis.fetch;
const envKeys = ["AI_PROVIDER", "QWEN_API_KEY", "DASHSCOPE_API_KEY", "AI_MAIN_MODEL", "AI_SAFETY_MODEL", "QWEN_BASE_URL"] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const requests: Array<{ model: string; temperature: number; messages: Array<{ role: string; content: string }> }> = [];
const pending: Array<(signal?: AbortSignal | null) => Promise<Response>> = [];
const cases: string[] = [];
const supervisor = createChatSupervisor();
const signal = () => new AbortController().signal;
const input: ChatSupervisionInput = { currentTurnId: "u-current", currentUserMessage: "我正在被打", recentMessages: [] };
const risk: ChatRiskDecision = { route: "needs_safety_check", subject: "user", currentness: "current", evidence: [{ sourceId: input.currentTurnId, quote: input.currentUserMessage }] };
const ordinary: ChatRiskDecision = { route: "ordinary", subject: "none", currentness: "current", evidence: [] };
const enqueue = (value: unknown, status = 200) => pending.push(async () => new Response(JSON.stringify(status === 200
  ? { model: "qwen-test", choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] }
  : { error: { message: "fixture private provider data" } }), { status, headers: { "content-type": "application/json" } }));
const fails = async (run: () => Promise<unknown>, failureType: string, category?: string) => {
  await assert.rejects(run, error => error instanceof AppError &&
    (error.details as { failureType?: string }).failureType === failureType &&
    (!category || (error.details as { category?: string }).category === category));
};
const classifyAs = async (value: unknown, fixture = input) => {
  enqueue(value);
  return supervisor.classify(fixture, signal());
};
const main = async () => {
  process.env.AI_PROVIDER = "qwen";
  process.env.QWEN_API_KEY = "offline-fixture-key";
  process.env.QWEN_BASE_URL = "https://offline.invalid";
  process.env.AI_MAIN_MODEL = "qwen-test-main";
  process.env.AI_SAFETY_MODEL = "qwen-test-supervisor";
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const response = pending.shift();
    assert(response, "No network is allowed: every request must have an explicit fixture.");
    return response(init?.signal);
  };

  const day = { ...input, currentUserMessage: "刚下班，想随口聊聊。" };
  assert.deepEqual(await classifyAs(ordinary, day), ordinary);
  const first = requests.at(-1)!;
  assert.equal(first.model, "qwen-test-supervisor");
  assert.equal(first.temperature, 0);
  assert.deepEqual(Object.keys(JSON.parse(first.messages[1].content)), ["contextPack"]);
  assert(!first.messages[1].content.includes('"reply"'));
  cases.push("ordinary-classification-is-independent-of-candidate");

  assert.deepEqual(await classifyAs(risk), risk);
  const third: ChatSupervisionInput = { ...input, recentMessages: [
    { id: "u-owner", role: "user", content: "朋友刚发来这句话，接下来是原文。" },
    { id: "a-prior", role: "assistant", content: "你可以发来。" },
  ] };
  const thirdRisk = { ...risk, subject: "third_party" as const, evidence: [{ sourceId: "u-owner", quote: third.recentMessages[0].content }, ...risk.evidence] };
  assert.deepEqual(await classifyAs(thirdRisk, third), thirdRisk);
  const thirdPayload = JSON.parse(requests.at(-1)!.messages[1].content).contextPack;
  assert.deepEqual(Object.keys(thirdPayload), ["historicalData", "adjacent", "current"]);
  assert.equal(thirdPayload.current.text, input.currentUserMessage);
  assert.deepEqual(thirdPayload.adjacent.map((item: { role: string }) => item.role), ["user", "assistant"]);
  assert(requests.at(-1)!.messages[0].content.includes("必须同时引用那条转述/归属说明和本轮事件原话"));
  cases.push("identical-current-words-preserve-third-party-context-and-user-evidence");

  for (const [text, currentness, subject] of [["小说中的角色说自己正在被打，没有现实人物。", "quoted_or_hypothetical", "third_party"], ["那是以前的事，我现在安全。", "past", "user"]] as const) {
    const fixture = { ...input, currentUserMessage: text };
    assert.equal((await classifyAs({ route: "ordinary", subject, currentness, evidence: [{ sourceId: input.currentTurnId, quote: text }] }, fixture)).route, "ordinary");
  }
  assert.equal((await classifyAs({ ...risk, route: "uncertain", subject: "unclear", currentness: "unclear" })).route, "uncertain");
  cases.push("past-fiction-and-risk-uncertainty-are-distinct-protocol-values");

  for (const value of [
    "not json", { ...risk, reason: "extra" }, { ...risk, route: "safe" }, { ...risk, evidence: [] },
    { ...ordinary, subject: "unclear" }, { ...ordinary, currentness: "unclear" }, { ...ordinary, subject: "user" },
    { ...ordinary, evidence: risk.evidence }, { ...risk, subject: "none" }, { ...risk, subject: "unclear" }, { ...risk, currentness: "unclear" },
    { ...risk, evidence: [{ sourceId: "fabricated", quote: input.currentUserMessage }] },
    { ...risk, evidence: [{ sourceId: input.currentTurnId, quote: "不在原文里" }] }, { ...risk, evidence: [...risk.evidence, ...risk.evidence] },
  ]) await fails(() => classifyAs(value), "invalid_output");
  await fails(() => classifyAs({ ...risk, evidence: [{ sourceId: "a-prior", quote: "你可以发来。" }] }, third), "invalid_output");
  cases.push("invalid-json-schema-route-evidence-and-assistant-claims-never-release");

  const recalled: ChatSupervisionInput = { ...day, recalledContext: {
    referenceText: "过去", personCandidates: ["不应传输的人名候选"], confirmationAfterDays: 30,
    candidates: [{ sourceTurnId: "memory-u", sourceConversationId: "private-conversation", role: "user", text: "我过去受过伤。", createdAt: "2020-01-01", matchedTerms: ["过去"] }],
  } };
  await classifyAs(ordinary, recalled);
  const memoryPayload = requests.at(-1)!.messages[1].content;
  assert(!memoryPayload.includes("private-conversation"));
  assert(!memoryPayload.includes("不应传输的人名候选"));
  assert(!memoryPayload.includes("matchedTerms"));
  assert.equal(JSON.parse(memoryPayload).contextPack.historicalData[0].evidenceEligible, false);
  await fails(() => classifyAs({ ...risk, evidence: [{ sourceId: "memory-u", quote: "我过去受过伤。" }] }, recalled), "invalid_output");
  cases.push("historical-data-is-minimal-labelled-and-cannot-be-current-risk-evidence");

  const reply = "你可以继续打字，我已经报警了。";
  const issue = { code: "unsupported_medical_or_capability_claim", candidateQuote: "我已经报警了", sourceId: input.currentTurnId, sourceQuote: input.currentUserMessage, requiredChange: "删除已报警的虚构行动，提供以安全可行为条件的现实求助方向。" };
  enqueue({ approved: false, issues: [issue] });
  assert.deepEqual(await supervisor.review(input, risk, reply, signal()), { approved: false, issues: [issue] });
  const reviewedPayload = JSON.parse(requests.at(-1)!.messages[1].content);
  assert.equal(reviewedPayload.reply, reply);
  assert.deepEqual(Object.keys(reviewedPayload), ["contextPack", "reply"]);
  assert.equal(reviewedPayload.risk, undefined);
  enqueue({ approved: true, issues: [] });
  assert.equal((await supervisor.review(input, risk, "若安全可行，可以联系附近可信的人帮忙。", signal())).approved, true);
  enqueue({ approved: false, issues: [{ ...issue, code: "missed_current_danger", candidateQuote: "", requiredChange: "针对当前危险补充安全可行的现实求助方向。" }] });
  assert.equal((await supervisor.review(input, risk, "我听见了。", signal())).approved, false);
  for (const value of [
    { approved: true, issues: [issue] }, { approved: false, issues: [] }, { approved: "true", issues: [] },
    { approved: false, issues: [{ ...issue, code: "poor_style" }] },
    { approved: false, issues: [{ ...issue, candidateQuote: "未说过的候选片段" }] },
    { approved: false, issues: [{ ...issue, candidateQuote: "" }] },
    { approved: false, issues: [{ ...issue, sourceId: "a-prior", sourceQuote: "你可以发来。" }] },
    { approved: false, issues: [{ ...issue, requiredChange: " " }] },
  ]) { enqueue(value); await fails(() => supervisor.review(input, risk, reply, signal()), "invalid_output"); }
  cases.push("safety-review-checks-complete-reply-evidence-five-codes-and-consistency");

  const thirdReply = "如果安全可行，可以帮朋友联系附近可信的人。";
  enqueue({ approved: true, issues: [] });
  await supervisor.review(third, risk, thirdReply, signal());
  const reviewWithWrongAdmissionSubject = structuredClone(requests.at(-1)!.messages);
  enqueue({ approved: true, issues: [] });
  await supervisor.review(third, { ...thirdRisk, route: "uncertain", currentness: "unclear" }, thirdReply, signal());
  assert.deepEqual(requests.at(-1)!.messages, reviewWithWrongAdmissionSubject,
    "Classification subject, currentness and evidence must not bias independent review input.");
  assert(reviewWithWrongAdmissionSubject[0].content.includes("候选的称呼不是证明当事人归属的证据"));
  cases.push("review-admission-does-not-transmit-classification-conclusions");

  const reviewInstructions = reviewWithWrongAdmissionSubject[0].content;
  assert(reviewInstructions.includes("缺少这种实质帮助时必须单独列出 missed_current_danger"));
  assert(reviewInstructions.includes("确认式问句本身不是 wrong_subject_or_time"));
  assert(reviewInstructions.includes("不提供可直接复制的候选文案、例句或替换问句"));
  const simultaneousIssues = [
    { code: "wrong_subject_or_time", candidateQuote: "你正在被打", sourceId: "u-owner", sourceQuote: third.recentMessages[0].content, requiredChange: "依据前文转述范围修正整段当事人及行动对象。" },
    { code: "missed_current_danger", candidateQuote: "", sourceId: input.currentTurnId, sourceQuote: input.currentUserMessage, requiredChange: "补足适用于实际当事人的安全可行的现实求助方向，不能仅确认已有事实。" },
  ];
  enqueue({ approved: false, issues: simultaneousIssues });
  assert.deepEqual((await supervisor.review(third, thirdRisk, "你正在被打吗？", signal())).issues, simultaneousIssues);
  cases.push("review-contract-separates-missing-help-from-attribution-and-requires-semantic-changes");

  const beforeInvalidInput = requests.length;
  await fails(() => supervisor.review(day, ordinary, "普通回复", signal()), "invalid_input");
  await fails(() => supervisor.review(input, risk, "", signal()), "invalid_input");
  await fails(() => supervisor.classify({ ...input, currentTurnId: "" }, signal()), "invalid_input");
  await fails(() => supervisor.classify({ ...input, recentMessages: [{ id: input.currentTurnId, role: "user", content: "冲突" }] }, signal()), "invalid_input");
  await fails(() => supervisor.classify({ ...input, recalledContext: {} as never }, signal()), "invalid_input");
  assert.equal(requests.length, beforeInvalidInput);
  cases.push("invalid-input-and-ordinary-review-are-rejected-before-model-call");

  const noId = { ...input, recentMessages: [{ role: "user" as const, content: "这是朋友的原话。" }, { id: "blocked", role: "user" as const, content: "不应发送", status: "blocked" as const }] };
  await classifyAs({ ...thirdRisk, evidence: [{ sourceId: "adjacent:0", quote: "这是朋友的原话。" }, ...risk.evidence] }, noId);
  const noIdPayload = requests.at(-1)!.messages[1].content;
  assert(noIdPayload.includes("adjacent:0"));
  assert(!noIdPayload.includes("不应发送"));
  await fails(() => classifyAs({ ...risk, evidence: [{ sourceId: input.currentTurnId, quote: "危险" }] }, { ...input, currentUserMessage: "危险又危险" }), "invalid_output", "unbound_evidence");
  cases.push("request-local-source-aliases-do-not-include-blocked-or-ambiguous-quotes");

  delete process.env.AI_SAFETY_MODEL;
  await classifyAs(ordinary, day);
  assert.equal(requests.at(-1)!.model, "qwen-test-main");
  process.env.AI_PROVIDER = "mock";
  const beforeConfig = requests.length;
  await fails(() => supervisor.classify(day, signal()), "provider_error", "provider_unconfigured");
  process.env.AI_PROVIDER = "qwen";
  delete process.env.QWEN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  await fails(() => supervisor.classify(day, signal()), "provider_error", "provider_unconfigured");
  assert.equal(requests.length, beforeConfig);
  process.env.QWEN_API_KEY = "offline-fixture-key";
  cases.push("configured-qwen-required-and-model-selection-keeps-existing-fallback");

  for (const status of [400, 429, 503]) {
    const count = requests.length;
    enqueue(null, status);
    await assert.rejects(() => supervisor.classify(day, signal()), error => {
      assert(error instanceof AppError);
      assert.equal(error.code, "AI_GENERATION_FAILED");
      assert.deepEqual(error.details, { supervisionStage: "classify", failureType: "provider_error", category: status === 429 ? "rate_limited" : status === 400 ? "provider_4xx" : "provider_5xx", retryable: status !== 400, providerStatus: status });
      assert(!JSON.stringify(error).includes("private provider"));
      return true;
    });
    assert.equal(requests.length, count + 1, "No provider retries are permitted here.");
  }
  pending.push(async () => { throw new AppError("AI_GENERATION_FAILED", "private message", 504, { retryable: false, raw: "private data" }); });
  await assert.rejects(() => supervisor.classify(day, signal()), error => {
    assert(error instanceof AppError);
    assert.equal(error.status, 504);
    assert.equal((error.details as { retryable: boolean }).retryable, false);
    assert(!JSON.stringify(error).includes("private"));
    return true;
  });
  cases.push("provider-status-retryability-preserved-without-private-error-or-retries");

  const cancelled = new AbortController(); cancelled.abort();
  const beforeCancelled = requests.length;
  await assert.rejects(() => supervisor.classify(day, cancelled.signal), ModelCallCancelledError);
  assert.equal(requests.length, beforeCancelled);
  const pendingAbort = new AbortController();
  pending.push(async passedSignal => {
    assert(passedSignal);
    pendingAbort.abort();
    assert.equal(passedSignal.aborted, true);
    // Even a non-cooperative transport returning after abort cannot publish a result.
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ordinary) } }] }));
  });
  await assert.rejects(() => supervisor.classify(day, pendingAbort.signal), ModelCallCancelledError);
  assert.equal(pending.length, 0);
  cases.push("caller-cancellation-propagates-and-late-success-is-not-returned");
  console.log(JSON.stringify({ status: "PASS", cases, fakeProviderCalls: requests.length, realModelCalls: 0, networkCalls: 0, modelQualityNotMeasured: true }));
};

main().catch(error => { console.error(error instanceof Error ? error.message : "Protocol check failed"); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
