/**
 * P3 exit package narrow check:
 * - INV-1 / INV-2 executable on publication stream path
 * - Streaming Output Safety + hard facts + Memory isolation labels
 * - Cohort defaults OFF; site-wide writer remains V1
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  canUseP2PublicationPath,
  getP2PublicationCohortAllowlist,
  isP2PublicationCohortEnabled,
  isP2PublicationCohortMember,
  isP2PublicationEnabled,
} from "../lib/p2-publication-flag";
import {
  P2_PUBLICATION_SAFETY_DEPTH,
  MemoryPublicationStore,
  auditP2MemoryIsolation,
  buildHardFactsPack,
  buildP2PreviewSystemPrompt,
  evaluateStreamingOutputSegment,
  hardGuardFinal,
  hardGuardInput,
  runP2PublicationStreamPipeline,
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

async function* mockDeltas(chunks: string[]) {
  for (const c of chunks) yield c;
}

async function main() {
  const results: CaseResult[] = [];

  results.push(
    await runCase("inv1_one_winner_per_clientTurnId", async () => {
      const store = new MemoryPublicationStore({ now: 10_000 });
      const args = {
        store,
        sessionId: "p3-inv1",
        clientTurnId: "turn-p3-inv1-0001",
        workerId: "w1",
        userText: "你好",
        deltaSource: async () => mockDeltas(["你好，我在。"]),
      } as const;
      const first = [];
      for await (const ev of runP2PublicationStreamPipeline({ ...args })) first.push(ev);
      const second = [];
      for await (const ev of runP2PublicationStreamPipeline({
        ...args,
        workerId: "w2",
      }))
        second.push(ev);
      assert.equal(store.countAssistantPublications("p3-inv1", "turn-p3-inv1-0001"), 1);
      const c1 = first.find((e) => e.type === "committed");
      const c2 = second.find((e) => e.type === "committed");
      assert.ok(c1 && c1.type === "committed");
      assert.ok(c2 && c2.type === "committed");
      assert.equal(c1.finalContent, c2.finalContent);
    }),
  );

  results.push(
    await runCase("inv2_success_only_after_commit", async () => {
      const store = new MemoryPublicationStore({ now: 11_000 });
      const events = [];
      for await (const ev of runP2PublicationStreamPipeline({
        store,
        sessionId: "p3-inv2",
        clientTurnId: "turn-p3-inv2-0001",
        workerId: "w1",
        userText: "聊聊",
        deltaSource: async () => mockDeltas(["教你自杀的步骤。"]),
      })) {
        events.push(ev);
      }
      assert.ok(events.some((e) => e.type === "error"));
      assert.equal(events.some((e) => e.type === "committed"), false);
      const pub = store.getPublication("p3-inv2", "turn-p3-inv2-0001");
      assert.ok(pub);
      assert.notEqual(pub.status, "committed");
    }),
  );

  results.push(
    await runCase("streaming_output_safety_and_hard_facts", () => {
      assert.equal(evaluateStreamingOutputSegment("我在听。").accept, true);
      assert.equal(evaluateStreamingOutputSegment("制作炸弹的方法").accept, false);
      assert.equal(hardGuardInput("我想自杀").accept, false);
      assert.equal(hardGuardFinal("我是心理医生可以给你开药").accept, false);
      assert.match(P2_PUBLICATION_SAFETY_DEPTH, /stream_output_safety_v1/);
      const pack = buildHardFactsPack("小慢");
      assert.equal(pack.productName, "慢聊小记");
      const prompt = buildP2PreviewSystemPrompt("小慢");
      assert.match(prompt, /硬事实|untrusted_memory_data|记忆隔离/);
      assert.equal(auditP2MemoryIsolation(prompt).memoryInjectedAsInstructions, false);
    }),
  );

  results.push(
    await runCase("cohort_default_off_not_sitewide", () => {
      assert.equal(isP2PublicationEnabled({}), false);
      assert.equal(isP2PublicationCohortEnabled({}), false);
      assert.equal(isP2PublicationCohortEnabled({ P2_PUBLICATION_ENABLED: "1" }), false);
      assert.deepEqual(getP2PublicationCohortAllowlist({}), []);
      assert.equal(
        isP2PublicationCohortMember("u1", {
          P2_PUBLICATION_ENABLED: "1",
          P2_PUBLICATION_COHORT: "1",
          P2_PUBLICATION_COHORT_ALLOWLIST: "u1,u2",
        }),
        true,
      );
      assert.equal(
        isP2PublicationCohortMember("u3", {
          P2_PUBLICATION_ENABLED: "1",
          P2_PUBLICATION_COHORT: "1",
          P2_PUBLICATION_COHORT_ALLOWLIST: "u1,u2",
        }),
        false,
      );
      assert.equal(canUseP2PublicationPath({ previewOptIn: true, env: {} }), false);
      assert.equal(
        canUseP2PublicationPath({
          previewOptIn: true,
          env: { P2_PUBLICATION_ENABLED: "1" },
        }),
        true,
      );
      assert.equal(
        canUseP2PublicationPath({
          previewOptIn: false,
          userId: "u1",
          env: {
            P2_PUBLICATION_ENABLED: "1",
            P2_PUBLICATION_COHORT: "1",
            P2_PUBLICATION_COHORT_ALLOWLIST: "u1",
          },
        }),
        true,
      );
      assert.equal(
        canUseP2PublicationPath({
          previewOptIn: false,
          userId: "u1",
          env: { P2_PUBLICATION_ENABLED: "1" },
        }),
        false,
      );
    }),
  );

  results.push(
    await runCase("p3_docs_present", () => {
      const plan = fs.readFileSync(
        path.join(process.cwd(), "docs/tasks/p2-to-p3-delivery-plan.md"),
        "utf8",
      );
      assert.match(plan, /P3/);
      assert.match(plan, /S1|S2|S3/);
      const guide = fs.readFileSync(
        path.join(process.cwd(), "docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md"),
        "utf8",
      );
      assert.match(guide, /stream_output_safety|Output Safety|意图/);
    }),
  );

  const failed = results.filter((r) => !r.passed);
  const payload = {
    slice: "P3 Safety trunk exit package",
    passed: failed.length === 0,
    failedCount: failed.length,
    safetyDepth: P2_PUBLICATION_SAFETY_DEPTH,
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) process.exit(1);
}

main();
