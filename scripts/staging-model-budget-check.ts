import assert from "node:assert/strict";
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stagingBudgetUpperCost, STAGING_BUDGET_DIRECTORY, STAGING_BUDGET_MODE, STAGING_VERIFIED_PRICE } from "../services/ai/stagingModelBudget";

type Provider = typeof import("../services/ai/modelProvider");
type Ledger = typeof import("../services/ai/stagingBudgetLedger");
const messages = [{ role: "user" as const, content: "合成预算检查；无私人数据" }];
const model = "qwen3.7-max";
const reservation = 12_049_512;

async function main() {
  assert(!fs.existsSync(STAGING_BUDGET_DIRECTORY) && !path.resolve(process.cwd()).startsWith("/var/www/"),
    "Local fixtures only: never run this check against the installed staging ledger.");
  const sourceRoot = path.resolve(process.cwd());
  const temporaryRoot = await promises.mkdtemp(path.join(os.tmpdir(), "staging-model-budget-"));
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalRename = promises.rename;
  const originalEnv = { ...process.env };
  const monotonicStart = performance.now();
  // Freeze only the price's calendar date, preserving elapsed-time behavior.
  Date.now = () => Date.parse("2026-11-10T10:39:26.000Z") + Math.floor(performance.now() - monotonicStart);
  let dispatches = 0;
  let fixtureIndex = 0;
  let transport: typeof fetch = async () => { throw new Error("Synthetic transport was not configured"); };
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => { dispatches += 1; return transport(...args); };
  const checks: string[] = [];
  const response = (usage: unknown = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }, responseModel = model) =>
    new Response(JSON.stringify({ model: responseModel, choices: [{ message: { content: "synthetic transport response" } }], usage }), { status: 200 });
  const configure = () => {
    for (const key of ["STAGING_MODEL_BUDGET_MODE", "STAGING_MODEL_BUDGET_TRIAL_ENABLED", "QWEN_API_KEY", "DASHSCOPE_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ZHIPU_API_KEY", "QWEN_BASE_URL", "DASHSCOPE_BASE_URL"]) delete process.env[key];
    Object.assign(process.env, { AI_PROVIDER: "qwen", QWEN_API_KEY: "SYNTHETIC_NOT_A_CREDENTIAL", AI_TIMEOUT_MS: "45000",
      STAGING_MODEL_BUDGET_MODE: STAGING_BUDGET_MODE, STAGING_MODEL_BUDGET_TRIAL_ENABLED: "1",
      AI_MAIN_MODEL: model, AI_SAFETY_MODEL: model, AI_PROACTIVE_GREETING_MODEL: model, AI_EXTRACTOR_MODEL: model });
  };
  const fixture = async () => {
    const root = path.join(temporaryRoot, String(fixtureIndex++));
    const ledgerDirectory = path.join(root, "ledger");
    await promises.mkdir(path.join(root, "services/ai"), { recursive: true });
    await promises.mkdir(ledgerDirectory);
    await promises.symlink(path.join(sourceRoot, "node_modules"), path.join(root, "node_modules"));
    await promises.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": [path.join(sourceRoot, "*")] }, esModuleInterop: true } }));
    // The only production-source substitution is the fixed ledger directory.
    // No test override is introduced into the deployed implementation.
    for (const name of ["modelProvider.ts", "egressProjection.ts", "piiRedaction.ts", "stagingModelBudget.ts", "stagingBudgetLedger.ts", "types.ts"]) {
      const original = await promises.readFile(path.join(sourceRoot, "services/ai", name), "utf8");
      const copied = name === "stagingModelBudget.ts" ? original.replace(JSON.stringify(STAGING_BUDGET_DIRECTORY), JSON.stringify(ledgerDirectory)) : original;
      if (name === "stagingModelBudget.ts") assert.notEqual(copied, original, "Expected one fixed ledger path substitution");
      await promises.writeFile(path.join(root, "services/ai", name), copied);
    }
    const provider = await import(pathToFileURL(path.join(root, "services/ai/modelProvider.ts")).href) as Provider;
    const ledger = await import(pathToFileURL(path.join(root, "services/ai/stagingBudgetLedger.ts")).href) as Ledger;
    const ledgerPath = path.join(ledgerDirectory, "ledger.json");
    await promises.writeFile(ledgerPath, `${JSON.stringify(ledger.INITIAL_STAGING_BUDGET_LEDGER)}\n`, { flag: "wx", mode: 0o600 });
    return { provider, ledger, ledgerPath, call: () => provider.callModel({ messages, model }) };
  };
  try {
    configure();
    const ordinary = await fixture();
    delete process.env.STAGING_MODEL_BUDGET_MODE;
    delete process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED;
    process.env.AI_PROVIDER = "mock";
    assert((await ordinary.call()).model.startsWith("mock:"));
    assert.equal(dispatches, 0);
    process.env.AI_PROVIDER = "qwen";
    transport = async (_url, init) => {
      assert.equal(init?.redirect, undefined);
      assert.equal(JSON.parse(String(init?.body)).max_completion_tokens, undefined);
      return response();
    };
    await ordinary.call();
    assert.equal(dispatches, 1);
    assert.equal((await ordinary.ledger.readBudgetSnapshot(ordinary.ledgerPath)).ledger.reservations.length, 0);
    checks.push("ordinary-mode-existing-mock-and-transport-unchanged");

    configure();
    const estimate = { provider: "qwen", model, baseUrl: STAGING_VERIFIED_PRICE.endpoint };
    const verifiedAt = Date.parse("2026-11-10T10:39:26.000Z");
    const expiresAt = Date.parse(STAGING_VERIFIED_PRICE.validUntil);
    assert.equal(expiresAt - verifiedAt, 7 * 24 * 60 * 60 * 1000, "Approved evidence validity is exactly seven days");
    assert.equal(stagingBudgetUpperCost({ ...estimate, now: expiresAt - 1 }), reservation);
    for (const now of [expiresAt, expiresAt + 1, expiresAt + 86400000]) {
      assert.throws(() => stagingBudgetUpperCost({ ...estimate, now }), /费用保护/);
    }
    assert.equal(stagingBudgetUpperCost(estimate), reservation);
    for (const invalid of [{ model: "unknown" }, { provider: "openai" }, { baseUrl: "https://unverified.invalid/v1" }, { now: Date.parse(STAGING_VERIFIED_PRICE.validUntil) }, { now: NaN }]) {
      assert.throws(() => stagingBudgetUpperCost({ ...estimate, ...invalid }));
    }
    const denied = await fixture();
    const beforeDenied = dispatches;
    delete process.env.STAGING_MODEL_BUDGET_MODE;
    process.env.APP_ENV = "staging";
    try {
      await assert.rejects(denied.call(), { details: { budgetGuard: "CONFIGURATION_REQUIRED" } });
    } finally {
      delete process.env.APP_ENV;
      configure();
    }
    const clock = Date.now;
    try {
      Date.now = () => expiresAt;
      await assert.rejects(denied.call(), { details: { budgetGuard: "PRICE_NOT_CURRENT" } });
    } finally {
      Date.now = clock;
    }
    delete process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED;
    await assert.rejects(denied.call());
    process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED = "0";
    await assert.rejects(denied.call());
    process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED = "1";
    await assert.rejects(denied.provider.callModel({ messages, model: "unverified-model" }));
    delete process.env.QWEN_API_KEY;
    await assert.rejects(denied.call());
    process.env.AI_PROVIDER = "mock";
    await assert.rejects(denied.call());
    configure();
    process.env.STAGING_MODEL_BUDGET_MODE = "invalid";
    await assert.rejects(denied.call());
    assert.equal(dispatches, beforeDenied);
    assert.equal((await denied.ledger.readBudgetSnapshot(denied.ledgerPath)).ledger.reservations.length, 0);
    checks.push("closed-trial-no-key-no-mock-invalid-config-model-and-expired-price-denied-before-send");

    configure();
    const privacy = await fixture();
    const occupied = Array.from({ length: 0xf8ff - 0xe000 + 1 }, (_, i) => String.fromCharCode(0xe000 + i)).join("");
    const beforePrivacy = dispatches;
    await assert.rejects(privacy.provider.callModel({ messages: [{ role: "user", content: `${occupied} 密码:A` }], model }));
    assert.equal(dispatches, beforePrivacy);
    assert.equal((await privacy.ledger.readBudgetSnapshot(privacy.ledgerPath)).ledger.reservations.length, 0);
    checks.push("privacy-capacity-failure-before-queue-reservation-and-fetch");

    const cancelled = await fixture();
    const queued = new AbortController();
    const flightPath = `${cancelled.ledgerPath}.flight`;
    await promises.mkdir(flightPath);
    const pending = cancelled.provider.callModel({ messages, model, signal: queued.signal });
    const aborted = assert.rejects(pending, { name: "ModelCallCancelledError" });
    await new Promise(resolve => setTimeout(resolve, 25));
    queued.abort();
    await aborted;
    assert((await promises.lstat(flightPath)).isDirectory(), "never remove the lock held by another operation");
    assert.equal(dispatches, beforePrivacy, "queued cancellation never dispatches");
    assert.equal((await cancelled.ledger.readBudgetSnapshot(cancelled.ledgerPath)).ledger.reservations.length, 0);
    checks.push("queued-cancellation-leaves-the-active-flight-and-does-not-reserve");

    const normal = await fixture();
    let active = 0;
    let peak = 0;
    transport = async (url, init) => {
      assert.equal(String(url), `${STAGING_VERIFIED_PRICE.endpoint}/chat/completions`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_completion_tokens, 4096);
      assert.equal(body.enable_thinking, false);
      assert.equal(init?.redirect, "error");
      const held = await normal.ledger.readBudgetSnapshot(normal.ledgerPath);
      assert.equal(held.ledger.reservations.filter(entry => entry.actualMicroCny === null).length, 1);
      assert(held.committedMicroCny >= reservation);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 25));
      active -= 1;
      return response();
    };
    await Promise.all(Array.from({ length: 4 }, () => normal.call()));
    assert.equal(peak, 1);
    const settled = await normal.ledger.readBudgetSnapshot(normal.ledgerPath);
    assert.equal(settled.committedMicroCny, 4 * 264);
    assert.equal(settled.ledger.reservations.length, 4);
    assert.equal(settled.ledger.halted, false);
    checks.push("actual-provider-transport-is-serial-reserves-before-send-and-settles-trusted-usage");

    transport = async () => response();
    for (let i = 4; i < 100; i += 1) await normal.call();
    const beforeLimit = dispatches;
    await assert.rejects(normal.call());
    await assert.rejects(normal.call());
    assert.equal(dispatches, beforeLimit);
    const exhausted = await normal.ledger.readBudgetSnapshot(normal.ledgerPath);
    assert.equal(exhausted.ledger.reservations.length, 100);
    assert.equal(exhausted.committedMicroCny, 100 * 264);
    assert.equal(exhausted.ledger.halted, true);
    checks.push("100-total-reservations-persist-and-101st-plus-retries-never-dispatch");

    const monetary = await fixture();
    transport = async () => response({ prompt_tokens: 700000, completion_tokens: 0, total_tokens: 700000 });
    await monetary.call();
    const beforeMoney = dispatches;
    await assert.rejects(monetary.call());
    await assert.rejects(monetary.call());
    assert.equal(dispatches, beforeMoney);
    const moneyState = await monetary.ledger.readBudgetSnapshot(monetary.ledgerPath);
    assert.equal(moneyState.committedMicroCny, 8_400_000);
    assert.equal(moneyState.ledger.halted, true);
    checks.push("insufficient-remaining-money-halts-before-send-without-treating-reservations-as-spend");

    const settledCancellation = await fixture();
    const sent = new AbortController();
    const syntheticEmail = "label@example.invalid";
    transport = async (_url, init) => {
      assert(!String(init?.body).includes(syntheticEmail), "staging dispatch redacts the synthetic identifier");
      sent.abort();
      return response();
    };
    await assert.rejects(settledCancellation.provider.callModel({
      messages: [{ role: "user", content: syntheticEmail }], model, signal: sent.signal,
    }), { name: "ModelCallCancelledError" });
    const cancelledAfterSend = await settledCancellation.ledger.readBudgetSnapshot(settledCancellation.ledgerPath);
    assert.equal(cancelledAfterSend.committedMicroCny, 264, "trusted usage is settled even if the caller canceled");
    assert.equal(cancelledAfterSend.ledger.halted, false);
    checks.push("staging-redacts-outbound-text-and-settles-verified-usage-on-cancellation");

    const failures: Array<[string, typeof fetch]> = [
      ["http-failure", async () => new Response("{}", { status: 503 })],
      ["unknown-usage", async () => response(null)],
      ["usage-total-mismatch", async () => response({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 99 })],
      ["model-mismatch", async () => response(undefined, "unverified-model")],
      ["timeout", async (_url, init) => new Promise((_resolve, reject) => {
        const fail = () => reject(new DOMException("Synthetic timeout", "AbortError"));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      })],
    ];
    for (const [name, handler] of failures) {
      configure();
      const failed = await fixture();
      process.env.AI_TIMEOUT_MS = "30";
      transport = handler;
      const before: number = dispatches;
      await assert.rejects(failed.call());
      assert.equal(dispatches, before + 1, name);
      const state = await failed.ledger.readBudgetSnapshot(failed.ledgerPath);
      assert.equal(state.committedMicroCny, reservation, name);
      assert.equal(state.ledger.reservations[0].actualMicroCny, null, name);
      assert.equal(state.ledger.halted, true, name);
      transport = async () => response();
      await assert.rejects(failed.call());
      assert.equal(dispatches, before + 1, `${name}: retry must not dispatch`);
    }
    checks.push("http-timeout-unknown-usage-and-model-mismatch-retain-full-reservation-and-stop-retries");

    configure();
    const ioFailure = await fixture();
    const realLedgerPath = await promises.realpath(ioFailure.ledgerPath);
    transport = async () => {
      promises.rename = async (...args: Parameters<typeof promises.rename>) => {
        if (String(args[1]) === realLedgerPath) throw Object.assign(new Error("Synthetic settlement I/O failure"), { code: "EIO" });
        return originalRename(...args);
      };
      syncBuiltinESMExports();
      return response();
    };
    await assert.rejects(ioFailure.call());
    promises.rename = originalRename;
    syncBuiltinESMExports();
    const raw = JSON.parse(await promises.readFile(ioFailure.ledgerPath, "utf8"));
    assert.equal(raw.reservations[0].actualMicroCny, null);
    assert((await promises.lstat(`${ioFailure.ledgerPath}.lock`)).isDirectory());
    assert((await promises.lstat(`${ioFailure.ledgerPath}.flight`)).isDirectory());
    const beforeIO = dispatches;
    // Exercise the same serial entry with a shorter permitted queue timeout.
    // Never remove an uncertain lock to make the fixture proceed.
    await assert.rejects(ioFailure.ledger.withBudgetReservation(ioFailure.ledgerPath, reservation,
      async () => { dispatches += 1; throw new Error("Locked dispatch must be unreachable"); }, 40));
    assert.equal(dispatches, beforeIO);
    checks.push("settlement-persistence-failure-retains-reservation-and-both-locks-no-automatic-takeover");

    configure();
    delete process.env.STAGING_MODEL_BUDGET_TRIAL_ENABLED;
    const beforeAuxiliary = dispatches;
    const safety = await import("../services/ai/chatSafety");
    const greeting = await import("../services/ai/proactiveGreeting");
    const understanding = await import("../services/understanding/extractService");
    const summary = await import("../services/memory/episodeSummaryService");
    assert.equal((await safety.triageSafety({ currentUserMessage: "合成普通测试消息", recentMessages: [] })).status, "blocked");
    await assert.rejects(greeting.generateProactiveGreeting({ kind: "initial", recentMessages: [] }));
    await understanding.extractUnderstandingFromMessage({ userId: "synthetic", sourceType: "chat", sourceId: "synthetic", content: "合成普通测试消息", createdAt: new Date(), recentMessages: [] });
    await assert.rejects(summary.defaultEpisodeSummaryProvider({ sessionId: "synthetic", previousSummary: null,
      committedMessages: [{ id: "synthetic", role: "user", content: "合成普通测试消息", createdAt: new Date().toISOString() }] }));
    assert.equal(dispatches, beforeAuxiliary);
    const callers = ["services/ai/proactiveGreeting.ts", "services/ai/chatSafety.ts", "services/ai/turnInterpretationAdapter.ts", "services/ai/aiService.ts", "services/ai/purposeSubjectOwnershipAuthority.ts", "services/ai/plannedFunctionSemanticValidator.ts", "services/helping/hillHelpingDecisionService.ts", "services/understanding/extractService.ts", "services/experience/experienceExtractorService.ts", "services/memory/episodeSummaryService.ts"];
    // A later integrated wallpaper restoration adds one ordinary, non-restoring caller.
    const warmCopy = "services/notes/noteWarmCopyService.ts";
    if (fs.existsSync(path.join(sourceRoot, warmCopy))) callers.push(warmCopy);
    for (const file of callers) {
      const source = fs.readFileSync(path.join(sourceRoot, file), "utf8");
      assert(/import[\s\S]*?callModel[\s\S]*?from\s+["'][^"']*modelProvider["']/.test(source), file);
      assert(!/\bfetch\s*\(|\bhttps?\.(?:request|get)\s*\(/.test(source), `${file}: unexpected direct transport`);
    }
    checks.push("real-safety-greeting-understanding-memory-and-all-known-auxiliary-callers-cannot-bypass-closed-trial");
    console.log(JSON.stringify({ status: "PASS_LOCAL_ONLY", checks, syntheticTransportRequests: dispatches,
      realExternalRequests: 0, capMicroCny: 20_000_000, requestLimit: 100,
      sourceFixtureDifference: "fixed ledger directory only", installedTrialEnabled: false }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    promises.rename = originalRename;
    syncBuiltinESMExports();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
