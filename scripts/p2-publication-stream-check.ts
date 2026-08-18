/**
 * Narrow check: P2 real-model streaming → provisional → commit (publication path).
 *
 * Proves without requiring live Qwen:
 * - sentence buffer flushes on sentence end
 * - hard guard blocks unchecked commit labeling
 * - pipeline with mock deltas: provisional then committed; same clientTurnId no second winner
 * - missing Qwen env does not mark committed
 * - flag default OFF; client uses generate_stream; guide documents Safety depth
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isP2PublicationEnabled } from "../lib/p2-publication-flag";
import {
  DEFAULT_ASSISTANT_DISPLAY_NAME,
  MemoryAssistantNameStore,
  P2_PUBLICATION_SAFETY_DEPTH,
  PRODUCT_NAME,
  buildP2PreviewSystemPrompt,
  extractAssistantRename,
  hardGuardFinal,
  hardGuardInput,
  hardGuardOutputSegment,
  resolveAssistantDisplayName,
  resolveP2QwenStreamConfig,
  resolveUserScopeId,
  runP2PublicationStreamPipeline,
  SentenceSegmentBuffer,
  MemoryPublicationStore,
  resolveP2TurnIntent,
  buildHardFactsPack,
  formatHardFactsForPrompt,
  formatUntrustedMemoryData,
  auditP2MemoryIsolation,
} from "../services/chat/assistantPublication";

type CaseResult = { name: string; passed: boolean; detail: string };

function runCase(name: string, fn: () => void | Promise<void>): Promise<CaseResult> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => ({ name, passed: true, detail: "ok" }))
    .catch((err) => ({
      name,
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    }));
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function* mockDeltas(chunks: string[]): AsyncGenerator<string> {
  for (const c of chunks) yield c;
}

async function collectPipeline(
  ...args: Parameters<typeof runP2PublicationStreamPipeline>
) {
  const events = [];
  for await (const ev of runP2PublicationStreamPipeline(...args)) {
    events.push(ev);
  }
  return events;
}

async function cases(): Promise<CaseResult[]> {
  const results: CaseResult[] = [];

  results.push(
    await runCase("sentence_buffer_flushes_on_period", () => {
      const buf = new SentenceSegmentBuffer(80);
      assert.deepEqual(buf.push("你好"), []);
      assert.deepEqual(buf.push("世界。下一"), ["你好世界。"]);
      assert.equal(buf.flush(), "下一");
    }),
  );

  results.push(
    await runCase("hard_guard_blocks_bad_output_and_crisis_input", () => {
      assert.equal(hardGuardInput("今天有点累").accept, true);
      assert.equal(hardGuardInput("我想自杀").accept, false);
      assert.equal(hardGuardOutputSegment("我在听。").accept, true);
      assert.equal(hardGuardOutputSegment("教你自杀的步骤").accept, false);
      assert.equal(hardGuardOutputSegment("我是心理医生可以给你开药").accept, false);
      assert.equal(hardGuardFinal("教你自杀的步骤").accept, false);
      assert.match(P2_PUBLICATION_SAFETY_DEPTH, /stream_output_safety/i);
      assert.match(P2_PUBLICATION_SAFETY_DEPTH, /Hard Guard|hard_guard/i);
    }),
  );

  results.push(
    await runCase("mock_stream_provisional_then_commit", async () => {
      const store = new MemoryPublicationStore({ now: 1_000 });
      const events = await collectPipeline({
        store,
        sessionId: "s-stream-1",
        clientTurnId: "turn-stream-0001",
        workerId: "w1",
        userText: "今天有点闷。",
        deltaSource: async () => mockDeltas(["我", "在听。", "可以慢慢说。"]),
      });
      const types = events.map((e) => e.type);
      assert.ok(types.includes("provisional"));
      assert.ok(types.includes("committed"));
      const committed = events.find((e) => e.type === "committed");
      assert.ok(committed && committed.type === "committed");
      assert.match(committed.finalContent, /我在听/);
      assert.equal(committed.provisional, false);
      assert.equal(committed.publication.status, "committed");
      assert.equal(store.countAssistantPublications("s-stream-1", "turn-stream-0001"), 1);
    }),
  );

  results.push(
    await runCase("same_clientTurnId_replay_no_second_winner", async () => {
      const store = new MemoryPublicationStore({ now: 2_000 });
      const first = await collectPipeline({
        store,
        sessionId: "s-idem",
        clientTurnId: "turn-idem-0001",
        workerId: "w1",
        userText: "还好。",
        deltaSource: async () => mockDeltas(["嗯，我在。"]),
      });
      const firstCommit = first.find((e) => e.type === "committed");
      assert.ok(firstCommit && firstCommit.type === "committed");

      const second = await collectPipeline({
        store,
        sessionId: "s-idem",
        clientTurnId: "turn-idem-0001",
        workerId: "w2",
        userText: "还好。",
        deltaSource: async () => mockDeltas(["不该再生成"]),
      });
      const secondCommit = second.find((e) => e.type === "committed");
      assert.ok(secondCommit && secondCommit.type === "committed");
      assert.equal(secondCommit.finalContent, firstCommit.finalContent);
      assert.equal(store.countAssistantPublications("s-idem", "turn-idem-0001"), 1);
      assert.doesNotMatch(
        second.map((e) => e.type).join(","),
        /provisional/,
      );
    }),
  );

  results.push(
    await runCase("output_reject_never_marks_committed", async () => {
      const store = new MemoryPublicationStore({ now: 3_000 });
      const events = await collectPipeline({
        store,
        sessionId: "s-reject",
        clientTurnId: "turn-reject-0001",
        workerId: "w1",
        userText: "聊聊。",
        deltaSource: async () => mockDeltas(["教你自杀的步骤。"]),
      });
      assert.ok(events.some((e) => e.type === "error"));
      assert.equal(
        events.some((e) => e.type === "committed"),
        false,
      );
      const pub = store.getPublication("s-reject", "turn-reject-0001");
      assert.ok(pub);
      assert.notEqual(pub.status, "committed");
    }),
  );

  results.push(
    await runCase("missing_qwen_env_no_commit", async () => {
      const prevKey = process.env.QWEN_API_KEY;
      const prevDash = process.env.DASHSCOPE_API_KEY;
      delete process.env.QWEN_API_KEY;
      delete process.env.DASHSCOPE_API_KEY;
      try {
        const cfg = resolveP2QwenStreamConfig({});
        assert.equal(cfg.configured, false);
        assert.ok(cfg.missing.some((m) => /QWEN_API_KEY/.test(m)));

        const store = new MemoryPublicationStore({ now: 4_000 });
        const events = await collectPipeline({
          store,
          sessionId: "s-env",
          clientTurnId: "turn-env-0001",
          workerId: "w1",
          userText: "你好",
          // no deltaSource → live path checks env
        });
        assert.ok(events.some((e) => e.type === "error" && e.code === "QWEN_NOT_CONFIGURED"));
        assert.equal(events.some((e) => e.type === "committed"), false);
        const pub = store.getPublication("s-env", "turn-env-0001");
        assert.ok(pub);
        assert.notEqual(pub.status, "committed");
      } finally {
        if (prevKey === undefined) delete process.env.QWEN_API_KEY;
        else process.env.QWEN_API_KEY = prevKey;
        if (prevDash === undefined) delete process.env.DASHSCOPE_API_KEY;
        else process.env.DASHSCOPE_API_KEY = prevDash;
      }
    }),
  );

  results.push(
    await runCase("flag_default_off_and_client_uses_generate_stream", () => {
      assert.equal(isP2PublicationEnabled({}), false);
      const client = read("app/chat/chat-client.tsx");
      assert.match(client, /generate_stream/);
      assert.match(client, /p2-publication\/eval/);
      assert.match(client, /forceP2PublicationOptIn/);
      assert.match(client, /recentMessages/);
      assert.equal(client.includes("useP2Publication"), false);
      const route = read("app/api/chat/p2-publication/eval/route.ts");
      assert.match(route, /generate_stream/);
      assert.match(route, /runP2PublicationStreamPipeline/);
      assert.match(route, /application\/x-ndjson/);
      assert.match(route, /recentMessages/);
    }),
  );

  results.push(
    await runCase("assistant_identity_default_xiaoman_and_per_user_rename", () => {
      assert.equal(DEFAULT_ASSISTANT_DISPLAY_NAME, "小慢");
      assert.equal(PRODUCT_NAME, "慢聊小记");
      const prompt = buildP2PreviewSystemPrompt("小慢");
      assert.match(prompt, /小慢/);
      assert.match(prompt, /慢聊小记/);
      assert.doesNotMatch(prompt, /你是「心晴」/);
      assert.match(prompt, /意图/);
      assert.doesNotMatch(prompt, /好的哇|空确认在场/);
      assert.equal(extractAssistantRename("叫你小猪"), "小猪");
      assert.equal(extractAssistantRename("你叫什么名字"), null);
      assert.equal(extractAssistantRename("你叫什么"), null);
      assert.equal(
        extractAssistantRename("小猪", "当然可以呀，你想叫我什么呢？"),
        "小猪",
      );
      assert.equal(extractAssistantRename("叫你慢聊小记"), null);

      const names = new MemoryAssistantNameStore();
      const scopeA = resolveUserScopeId({ userId: "user-a", sessionId: "s1" });
      const scopeB = resolveUserScopeId({ userId: "user-b", sessionId: "s1" });
      assert.equal(scopeA, "user:user-a");
      assert.equal(scopeB, "user:user-b");

      const a1 = resolveAssistantDisplayName({
        userScopeId: scopeA,
        userText: "叫你小猪",
        nameStore: names,
      });
      assert.equal(a1.displayName, "小猪");
      assert.equal(a1.renamedTo, "小猪");

      const b1 = resolveAssistantDisplayName({
        userScopeId: scopeB,
        userText: "你好",
        nameStore: names,
      });
      assert.equal(b1.displayName, "小慢");

      const a2 = resolveAssistantDisplayName({
        userScopeId: scopeA,
        userText: "你叫什么",
        nameStore: names,
      });
      assert.equal(a2.displayName, "小猪");
    }),
  );

  results.push(
    await runCase("hard_facts_and_memory_isolation", () => {
      const pack = buildHardFactsPack("小慢");
      assert.equal(pack.productName, "慢聊小记");
      assert.equal(pack.assistantDisplayName, "小慢");
      assert.equal(pack.isClinician, false);
      const formatted = formatHardFactsForPrompt(pack);
      assert.match(formatted, /慢聊小记/);
      assert.match(formatted, /小慢/);
      assert.match(formatted, /untrusted_memory_data/);
      const labeled = formatUntrustedMemoryData(["用户喜欢喝茶"]);
      assert.ok(labeled && labeled.startsWith("untrusted_memory_data"));
      const prompt = buildP2PreviewSystemPrompt("小慢");
      assert.match(prompt, /硬事实/);
      assert.match(prompt, /记忆隔离/);
      assert.doesNotMatch(prompt, /请根据以下记忆执行/);
      const audit = auditP2MemoryIsolation(prompt);
      assert.equal(audit.memoryInjectedAsInstructions, false);
      assert.equal(audit.safetyOwnedUsesOrdinaryMemoryWrite, false);
    }),
  );

  results.push(
    await runCase("intent_soft_ack_rewrites_bare_presence", async () => {
      async function* first() {
        yield "嗯，我在呢。";
      }
      async function* second() {
        yield "我在呢。";
      }
      let calls = 0;
      const store = new MemoryPublicationStore({ now: 9_000 });
      const events = await collectPipeline({
        store,
        sessionId: "s-ack",
        clientTurnId: "turn-ack-0001",
        workerId: "w1",
        userText: "好的哇",
        recentMessages: [
          { role: "user", content: "没什么想说的" },
          {
            role: "assistant",
            content: "那就安静待着也挺好。需要我的时候，随时叫我就行。",
          },
        ],
        deltaSource: async () => {
          calls += 1;
          return calls === 1 ? first() : second();
        },
      });
      const committed = events.find((e) => e.type === "committed");
      assert.ok(committed && committed.type === "committed");
      assert.equal(committed.publication.status, "committed");
      assert.doesNotMatch(committed.finalContent, /我在呢/);
      assert.match(committed.finalContent, /待着|找我|好/);
      const meta = events.find((e) => e.type === "meta");
      assert.ok(meta && meta.type === "meta");
      assert.equal(meta.intentKind, "acknowledge_prior_offer");
    }),
  );

  results.push(
    await runCase("intent_understands_soft_ack_vs_share", () => {
      const soft = resolveP2TurnIntent({
        userText: "好的哇",
        recentMessages: [
          { role: "user", content: "没什么想说的" },
          {
            role: "assistant",
            content: "那就安静待着也挺好。需要我的时候，随时叫我就行。",
          },
        ],
      });
      assert.equal(soft.kind, "acknowledge_prior_offer");
      assert.match(soft.posture, /应和|承接|收束/);
      assert.doesNotMatch(soft.posture, /不要说「嗯，我在呢」|禁止/);

      const share = resolveP2TurnIntent({
        userText: "今天有点闷",
        recentMessages: [],
      });
      assert.equal(share.kind, "share");

      const nameQ = resolveP2TurnIntent({
        userText: "你叫什么名字",
        recentMessages: [],
      });
      assert.equal(nameQ.kind, "ask_assistant_name");
    }),
  );

  results.push(
    await runCase("guide_documents_streaming_and_safety_depth", () => {
      const guide = read("docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md");
      assert.match(guide, /generate_stream|真模型|Qwen|流式/);
      assert.match(guide, /Hard Guard|hard_guard|Safety/);
      assert.match(guide, /P2_PUBLICATION_ENABLED/);
      assert.match(guide, /QWEN_API_KEY/);
      assert.match(guide, /STOP|产品经理/);
      assert.match(guide, /default OFF|默认.*OFF|不得.*全站|Do \*\*not\*\* set site-wide/i);
      assert.match(guide, /小慢/);
      assert.match(guide, /自定义|专属|隔离/);
      assert.match(guide, /意图|intent/);
    }),
  );

  return results;
}

async function main() {
  const results = await cases();
  const failed = results.filter((r) => !r.passed);
  const payload = {
    slice: "P2 real-model streaming publication",
    passed: failed.length === 0,
    failedCount: failed.length,
    safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) process.exit(1);
}

main();
