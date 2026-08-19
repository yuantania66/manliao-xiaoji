import assert from "node:assert/strict";
import fs from "node:fs";

import { NextRequest } from "next/server";

import {
  P2_PUBLICATION_FIXTURE_LABEL,
  isP2PublicationFixtureEnabled,
} from "../lib/p2-publication-fixture";
import { POST } from "../app/api/chat/p2-publication/fixture/route";
import { MemoryAssistantNameStore } from "../services/chat/assistantPublication/assistantIdentity";

type CaseResult = { id: string; passed: boolean; detail: string };

const cases: CaseResult[] = [];

async function runCase(id: string, run: () => void | Promise<void>) {
  try {
    await run();
    cases.push({ id, passed: true, detail: "ok" });
  } catch (error) {
    cases.push({
      id,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const parseNdjson = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function postFixture(args: {
  input?: string;
  scenario?: "success" | "reattach" | "commit_failure" | "output_reject";
  turn?: string;
}) {
  const request = new NextRequest(
    "http://127.0.0.1/api/chat/p2-publication/fixture",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "stage-b-fixture-session",
        clientTurnId: args.turn ?? "stage-b-fixture-turn-0001",
        workerId: "stage-b-fixture-worker",
        content: args.input ?? "你好",
        fixtureScenario: args.scenario ?? "success",
      }),
    },
  );
  const response = await POST(request);
  return { response, events: parseNdjson(await response.text()) };
}

async function main() {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const dataEntriesBefore = fs.existsSync(".data")
    ? fs.readdirSync(".data").sort()
    : [];
  const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    p2: process.env.P2_PUBLICATION_ENABLED,
    fixture: process.env.P2_PUBLICATION_FIXTURE_ENABLED,
    delay: process.env.P2_PUBLICATION_FIXTURE_DELAY_MS,
    qwen: process.env.QWEN_API_KEY,
    dashscope: process.env.DASHSCOPE_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  let attemptedExternalCalls = 0;
  globalThis.fetch = async () => {
    attemptedExternalCalls += 1;
    throw new Error("Stage B fixture must not perform external calls");
  };
  delete process.env.QWEN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  process.env.P2_PUBLICATION_FIXTURE_DELAY_MS = "0";

  try {
    await runCase("fixture_default_off_and_requires_both_flags", async () => {
      mutableEnv.NODE_ENV = "development";
      delete process.env.P2_PUBLICATION_ENABLED;
      delete process.env.P2_PUBLICATION_FIXTURE_ENABLED;
      assert.equal(isP2PublicationFixtureEnabled(), false);
      assert.equal((await postFixture({})).response.status, 404);

      process.env.P2_PUBLICATION_FIXTURE_ENABLED = "1";
      assert.equal(isP2PublicationFixtureEnabled(), false);
      assert.equal((await postFixture({})).response.status, 404);

      process.env.P2_PUBLICATION_ENABLED = "1";
      assert.equal(isP2PublicationFixtureEnabled(), true);
    });

    await runCase("fixture_refuses_production_process", async () => {
      process.env.P2_PUBLICATION_ENABLED = "1";
      process.env.P2_PUBLICATION_FIXTURE_ENABLED = "1";
      mutableEnv.NODE_ENV = "production";
      assert.equal(isP2PublicationFixtureEnabled(), false);
      assert.equal((await postFixture({})).response.status, 404);
      mutableEnv.NODE_ENV = "development";
    });

    await runCase("ordinary_fixture_provisional_then_committed", async () => {
      mutableEnv.NODE_ENV = "development";
      process.env.P2_PUBLICATION_ENABLED = "1";
      process.env.P2_PUBLICATION_FIXTURE_ENABLED = "1";
      const { response, events } = await postFixture({
        turn: "stage-b-fixture-turn-success",
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /x-ndjson/);
      assert.equal(response.headers.get("x-p2-transport"), "model-free-fixture");
      assert.equal(response.headers.get("x-p2-model-calls"), "0");
      assert.equal(response.headers.get("x-p2-production-writes"), "0");
      assert.deepEqual(events.map((event) => event.type), [
        "meta",
        "provisional",
        "committed",
        "done",
      ]);
      assert.equal(events[0]?.evaluationLabel, P2_PUBLICATION_FIXTURE_LABEL);
      assert.equal(events[1]?.provisionalMarkedTemporary, true);
      assert.equal(
        (events[1]?.publication as { status?: string }).status,
        "streaming",
      );
      assert.equal(
        (events[2]?.publication as { status?: string }).status,
        "committed",
      );
    });

    await runCase("separate_fixture_turns_have_distinct_publication_ids", async () => {
      const first = await postFixture({ turn: "stage-b-fixture-turn-unique-a" });
      const second = await postFixture({ turn: "stage-b-fixture-turn-unique-b" });
      const firstCommitted = first.events.find((event) => event.type === "committed");
      const secondCommitted = second.events.find((event) => event.type === "committed");
      const firstId = (firstCommitted?.publication as { id?: string }).id;
      const secondId = (secondCommitted?.publication as { id?: string }).id;
      assert.ok(firstId);
      assert.ok(secondId);
      assert.notEqual(firstId, secondId);
    });

    await runCase("reattach_resumes_same_publication_then_commits", async () => {
      const { events } = await postFixture({
        scenario: "reattach",
        turn: "stage-b-fixture-turn-reattach",
      });
      assert.deepEqual(events.map((event) => event.type), [
        "meta",
        "error",
        "provisional",
        "committed",
        "done",
      ]);
      const meta = events[0]?.publication as { id?: string };
      const reconnect = events[1]?.publication as { id?: string };
      const provisional = events[2]?.publication as { id?: string };
      const committed = events[3]?.publication as { id?: string };
      assert.equal(events[1]?.code, "stream_in_progress");
      assert.ok(meta.id);
      assert.equal(reconnect.id, meta.id);
      assert.equal(provisional.id, meta.id);
      assert.equal(committed.id, meta.id);
    });

    await runCase("explicit_risk_is_safety_owned_without_fixture_generation", async () => {
      const { events } = await postFixture({
        input: "我现在想自杀",
        turn: "stage-b-fixture-turn-safety",
      });
      assert.deepEqual(events.map((event) => event.type), [
        "meta",
        "provisional",
        "committed",
        "done",
      ]);
      assert.equal(events[2]?.safetyOwned, true);
      assert.equal(events[0]?.modelCalls, 0);
    });

    await runCase("commit_failure_never_reports_committed", async () => {
      const { events } = await postFixture({
        scenario: "commit_failure",
        turn: "stage-b-fixture-turn-commit-failure",
      });
      assert.ok(events.some((event) => event.type === "provisional"));
      assert.equal(events.some((event) => event.type === "committed"), false);
      assert.ok(events.some((event) => event.type === "error"));
      const error = events.find((event) => event.type === "error");
      assert.equal(
        (error?.publication as { status?: string }).status,
        "failed_retryable",
      );
    });

    await runCase("rejected_output_is_never_published", async () => {
      const { events } = await postFixture({
        scenario: "output_reject",
        turn: "stage-b-fixture-turn-output-reject",
      });
      assert.equal(events.some((event) => event.type === "provisional"), false);
      assert.equal(events.some((event) => event.type === "committed"), false);
      assert.ok(events.some((event) => event.type === "error"));
    });

    await runCase("fixture_import_and_ui_isolation", () => {
      const fixtureRoute = fs.readFileSync(
        "app/api/chat/p2-publication/fixture/route.ts",
        "utf8",
      );
      const liveRoute = fs.readFileSync(
        "app/api/chat/p2-publication/eval/route.ts",
        "utf8",
      );
      const v1Route = fs.readFileSync(
        "app/api/chat/sessions/[sessionId]/messages/route.ts",
        "utf8",
      );
      const client = fs.readFileSync("app/chat/chat-client.tsx", "utf8");
      const fixturePage = fs.readFileSync(
        "app/chat/p2-preview/fixture/page.tsx",
        "utf8",
      );
      const guide = fs.readFileSync(
        "docs/evals/P2_PUBLICATION_FIXTURE_GUIDE.md",
        "utf8",
      );
      const envExample = fs.readFileSync(".env.example", "utf8");

      assert.doesNotMatch(
        fixtureRoute,
        /createPublicationStore|runP2PublicationStreamPipeline|streamChatCompletion|qwenConfig|prisma|fileStore|fetch\(/,
      );
      assert.doesNotMatch(liveRoute, /P2_PUBLICATION_FIXTURE|model-free-fixture/);
      assert.doesNotMatch(v1Route, /p2-publication\/fixture|model_free_fixture/);
      assert.match(fixturePage, /p2PreviewTransport="fixture"/);
      assert.match(client, /模拟评测流（非真实 Qwen）/);
      assert.match(client, /真 Qwen 流式/);
      assert.match(client, /data-p2-preview-transport/);
      assert.match(client, /\/api\/chat\/p2-publication\/fixture/);
      assert.match(client, /if \(isModelFreeFixture\)/);
      assert.match(client, /setSessionId\("p2-fixture-local"\)/);
      assert.match(client, /must not read auth, sessions, cached messages/);
      assert.match(client, /连接恢复中，正在同步未确认回复/);
      assert.match(client, /text: message\.text === "\.\.\." \? ""/);
      assert.match(client, /message\.role === "user" \|\| message\.text/);
      assert.match(guide, /模拟评测流（非真实 Qwen）/);
      assert.match(guide, /does not call Qwen|Model\/provider calls: 0/i);
      assert.match(guide, /Explicitly Untested/);
      assert.match(envExample, /# P2_PUBLICATION_FIXTURE_ENABLED=1/);
      assert.match(envExample, /refused when NODE_ENV=production/);
    });

    await runCase("isolated_memory_name_store_is_forgotten_on_disposal", () => {
      const first = new MemoryAssistantNameStore();
      first.set("synthetic-user", "小树");
      assert.equal(first.get("synthetic-user"), "小树");
      const replacement = new MemoryAssistantNameStore();
      assert.equal(replacement.get("synthetic-user"), null);
    });

    await runCase("rollback_disables_fixture_without_repo_data", async () => {
      delete process.env.P2_PUBLICATION_FIXTURE_ENABLED;
      assert.equal(isP2PublicationFixtureEnabled(), false);
      assert.equal((await postFixture({})).response.status, 404);
      const dataEntriesAfter = fs.existsSync(".data")
        ? fs.readdirSync(".data").sort()
        : [];
      assert.deepEqual(dataEntriesAfter, dataEntriesBefore);
      process.env.P2_PUBLICATION_FIXTURE_ENABLED = "1";
    });

    assert.equal(attemptedExternalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("NODE_ENV", originalEnv.nodeEnv);
    restore("P2_PUBLICATION_ENABLED", originalEnv.p2);
    restore("P2_PUBLICATION_FIXTURE_ENABLED", originalEnv.fixture);
    restore("P2_PUBLICATION_FIXTURE_DELAY_MS", originalEnv.delay);
    restore("QWEN_API_KEY", originalEnv.qwen);
    restore("DASHSCOPE_API_KEY", originalEnv.dashscope);
  }

  const failed = cases.filter((item) => !item.passed);
  console.log(
    JSON.stringify(
      {
        slice: "Stage B model-free P2 preview fixture",
        passed: failed.length === 0,
        externalCalls: 0,
        productionWrites: 0,
        store: "request-scoped memory only",
        cases,
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
