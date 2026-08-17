/**
 * P2 Publication Implementation check — design §13 fault injection + flag/schema gates.
 *
 * Uses the service-layer MemoryPublicationStore (test DB equivalent in-process).
 * Does not switch production V1 writer. Does not require live Postgres.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isP2PublicationEnabled } from "../lib/p2-publication-flag";
import {
  FilePublicationStore,
  LEASE_MS,
  MAX_ATTEMPT,
  MemoryPublicationStore,
  TOMBSTONE_RETENTION_MS,
  appendProvisional,
  assertInvariants,
  commitFinal,
  commitSafetyOwned,
  deleteCommittedAssistant,
  expireLease,
  ingress,
  leaseLive,
  pubKey,
  startStreaming,
} from "../services/chat/assistantPublication";

type CaseResult = { name: string; passed: boolean; detail: string };

function runCase(name: string, fn: () => void): CaseResult {
  try {
    fn();
    return { name, passed: true, detail: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, passed: false, detail: message };
  }
}

function section13Cases(): CaseResult[] {
  const results: CaseResult[] = [];

  results.push(
    runCase("duplicate_retry_before_generation", () => {
      const store = new MemoryPublicationStore({ now: 1_000_000 });
      const sid = "s1";
      const tid = "t-before-gen";
      const r1 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "hi",
        workerId: "w1",
      });
      assert.equal(r1.kind, "ok");
      if (r1.kind !== "ok") return;
      assert.equal(r1.action, "created");
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "hi",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "attached");
      assert.equal(store.countUsers(sid, tid), 1);
      assert.equal(store.countAssistantPublications(sid, tid), 1);
      assert.equal(r1.publication.id, r2.publication.id);
    }),
  );

  results.push(
    runCase("duplicate_retry_during_live_stream", () => {
      const store = new MemoryPublicationStore({ now: 2_000_000 });
      const sid = "s2";
      const tid = "t-live-stream";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "stream",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      const emitted = appendProvisional(store, sid, tid, "w1", "你好，", true);
      assert.equal(emitted.emitted, true);
      assert.equal(emitted.provisionalMarkedTemporary, true);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "stream",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "attached");
      assert.equal(r2.body, "你好，");
      assert.equal(r2.provisionalMarkedTemporary, true);
      assert.equal(store.countAssistantPublications(sid, tid), 1);
      assert.equal(r2.regenerated, false);
    }),
  );

  results.push(
    runCase("worker_crash_before_first_segment", () => {
      const store = new MemoryPublicationStore({ now: 3_000_000 });
      const sid = "s3";
      const tid = "t-crash-before";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "x",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      expireLease(store, sid, tid);
      const before = store.getPublication(sid, tid)!;
      assert.equal(before.status, "streaming");
      assert.equal(leaseLive(before, store.clock.now), false);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "x",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "takeover");
      assert.equal(r2.publication.attempt, 2);
      assert.equal(r2.publication.leaseOwner, "w2");
      assert.equal(store.countAssistantPublications(sid, tid), 1);
      assert.equal(store.listLiveZombies().length, 0);
    }),
  );

  results.push(
    runCase("worker_crash_after_provisional", () => {
      const store = new MemoryPublicationStore({ now: 4_000_000 });
      const sid = "s4";
      const tid = "t-crash-after";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "y",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      appendProvisional(store, sid, tid, "w1", "临时段落", true);
      expireLease(store, sid, tid);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "y",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "takeover");
      assert.equal(r2.publication.draftContent, "");
      assert.equal(r2.publication.id, store.getPublication(sid, tid)!.id);
      assert.equal(store.countAssistantPublications(sid, tid), 1);
      assert.equal(store.listLiveZombies().length, 0);
    }),
  );

  results.push(
    runCase("commit_failure_after_provisional", () => {
      const store = new MemoryPublicationStore({ now: 5_000_000 });
      const sid = "s5";
      const tid = "t-commit-fail";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "z",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      appendProvisional(store, sid, tid, "w1", "可见草稿", true);
      const outcome = commitFinal(store, {
        sessionId: sid,
        clientTurnId: tid,
        workerId: "w1",
        finalContent: "最终",
        outputSafetyPass: true,
        conversationCommitOk: false,
      });
      assert.equal(outcome.success, false);
      assert.equal(outcome.reason, "conversation_commit_failed");
      assert.equal(outcome.publication.status, "failed_retryable");
      assert.equal(
        [...store.assistants.values()].filter((m) => m.clientTurnId === tid).length,
        0,
      );
    }),
  );

  results.push(
    runCase("output_safety_rejects_final", () => {
      const store = new MemoryPublicationStore({ now: 6_000_000 });
      const sid = "s6";
      const tid = "t-safety-reject";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "bad",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      appendProvisional(store, sid, tid, "w1", "ok段", true);
      const outcome = commitFinal(store, {
        sessionId: sid,
        clientTurnId: tid,
        workerId: "w1",
        finalContent: "unsafe final",
        outputSafetyPass: false,
        conversationCommitOk: true,
      });
      assert.equal(outcome.success, false);
      assert.equal(outcome.publication.status, "failed_terminal");
      assert.equal(outcome.publication.failureCode, "output_safety_reject");
    }),
  );

  results.push(
    runCase("committed_retry", () => {
      const store = new MemoryPublicationStore({ now: 7_000_000 });
      const sid = "s7";
      const tid = "t-committed";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "ok",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      const committed = commitFinal(store, {
        sessionId: sid,
        clientTurnId: tid,
        workerId: "w1",
        finalContent: "精确终稿",
        outputSafetyPass: true,
        conversationCommitOk: true,
      });
      assert.equal(committed.success, true);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "ok",
        workerId: "w9",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "replay_committed");
      assert.equal(r2.body, "精确终稿");
      assert.equal(r2.regenerated, false);
    }),
  );

  results.push(
    runCase("deleted_committed_retry", () => {
      const store = new MemoryPublicationStore({ now: 8_000_000 });
      const sid = "s8";
      const tid = "t-deleted";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "del",
        workerId: "w1",
      });
      startStreaming(store, sid, tid, "w1");
      assert.equal(
        commitFinal(store, {
          sessionId: sid,
          clientTurnId: tid,
          workerId: "w1",
          finalContent: "将被删除",
          outputSafetyPass: true,
          conversationCommitOk: true,
        }).success,
        true,
      );
      deleteCommittedAssistant(store, sid, tid);
      const pub = store.getPublication(sid, tid)!;
      assert.equal(pub.finalContent, null);
      assert.equal(pub.draftContent, "");
      assert(pub.tombstoneUntil !== null);
      assert.equal(pub.tombstoneUntil! - store.clock.now, TOMBSTONE_RETENTION_MS);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "del",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "deleted");
      assert.equal(r2.body, null);
      assert.equal(r2.failureCode, "deleted");
      assert.equal(r2.regenerated, false);
    }),
  );

  results.push(
    runCase("failed_retryable_retry", () => {
      const store = new MemoryPublicationStore({ now: 9_000_000 });
      const sid = "s9";
      const tid = "t-retryable";
      const r1 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "r",
        workerId: "w1",
      });
      assert.equal(r1.kind, "ok");
      if (r1.kind !== "ok") return;
      const pub = store.getPublication(sid, tid)!;
      pub.status = "failed_retryable";
      pub.failureCode = "provider_timeout";
      pub.leaseOwner = null;
      pub.leaseExpiresAt = null;
      store.putPublication(pub);
      const attemptBefore = pub.attempt;
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "r",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "retry_same_row");
      assert.equal(r2.publication.id, r1.publication.id);
      assert.equal(r2.publication.attempt, attemptBefore + 1);
    }),
  );

  results.push(
    runCase("failed_terminal_retry", () => {
      const store = new MemoryPublicationStore({ now: 10_000_000 });
      const sid = "s10";
      const tid = "t-terminal";
      const r1 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "term",
        workerId: "w1",
      });
      assert.equal(r1.kind, "ok");
      if (r1.kind !== "ok") return;
      const pub = store.getPublication(sid, tid)!;
      pub.status = "failed_terminal";
      pub.failureCode = "input_validation";
      pub.leaseOwner = null;
      pub.leaseExpiresAt = null;
      store.putPublication(pub);
      const r2 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "term",
        workerId: "w2",
      });
      assert.equal(r2.kind, "ok");
      if (r2.kind !== "ok") return;
      assert.equal(r2.action, "terminal");
      assert.equal(r2.failureCode, "input_validation");
      assert.equal(r2.regenerated, false);
    }),
  );

  return results;
}

function extraCases(): CaseResult[] {
  const results: CaseResult[] = [];

  results.push(
    runCase("max_attempt_becomes_terminal", () => {
      const store = new MemoryPublicationStore({ now: 11_000_000 });
      const sid = "s11";
      const tid = "t-max";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "m",
        workerId: "w1",
      });
      const pub = store.getPublication(sid, tid)!;
      pub.status = "failed_retryable";
      pub.attempt = MAX_ATTEMPT;
      pub.failureCode = "provider_timeout";
      pub.leaseOwner = null;
      pub.leaseExpiresAt = null;
      store.putPublication(pub);
      const r = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "m",
        workerId: "w2",
      });
      assert.equal(r.kind, "ok");
      if (r.kind !== "ok") return;
      assert.equal(r.action, "terminal");
      assert.equal(r.failureCode, "max_attempt");
      assert.equal(MAX_ATTEMPT, 3);
    }),
  );

  results.push(
    runCase("safety_uses_same_publication_row", () => {
      const store = new MemoryPublicationStore({ now: 12_000_000 });
      const sid = "s12";
      const tid = "t-safety-row";
      const r1 = ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "危机",
        workerId: "w1",
      });
      assert.equal(r1.kind, "ok");
      if (r1.kind !== "ok") return;
      const outcome = commitSafetyOwned(store, {
        sessionId: sid,
        clientTurnId: tid,
        workerId: "w1",
        safetyReply: "安全回应",
      });
      assert.equal(outcome.success, true);
      assert.equal(outcome.publication.id, r1.publication.id);
      assert.equal(store.countAssistantPublications(sid, tid), 1);
    }),
  );

  results.push(
    runCase("exit_gate_no_zombie_after_takeover", () => {
      const store = new MemoryPublicationStore({ now: 13_000_000 });
      const sid = "s13";
      const tid = "t-zombie";
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "z",
        workerId: "w1",
      });
      expireLease(store, sid, tid);
      assert.equal(store.listLiveZombies().length, 1);
      ingress(store, {
        sessionId: sid,
        clientTurnId: tid,
        userText: "z",
        workerId: "w2",
      });
      assert.equal(store.listLiveZombies().length, 0);
      assertInvariants(store, sid, tid, "post-takeover");
    }),
  );

  results.push(
    runCase("feature_flag_defaults_off", () => {
      assert.equal(isP2PublicationEnabled({}), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "" }), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "0" }), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "false" }), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "1" }), true);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "true" }), true);
    }),
  );

  results.push(
    runCase("prisma_schema_has_unique_and_five_states", () => {
      const schema = fs.readFileSync(
        path.join(process.cwd(), "prisma/schema.prisma"),
        "utf8",
      );
      assert.match(schema, /model AssistantPublication/);
      assert.match(schema, /@@unique\(\[sessionId, clientTurnId, role\]\)/);
      for (const status of [
        "reserved",
        "streaming",
        "committed",
        "failed_retryable",
        "failed_terminal",
      ]) {
        assert.match(schema, new RegExp(`\\b${status}\\b`));
      }
      assert.match(schema, /provisionalMarkedTemporary/);
      assert.match(schema, /tombstoneUntil/);
      assert.match(schema, /leaseExpiresAt/);
      const migration = fs.readFileSync(
        path.join(
          process.cwd(),
          "prisma/migrations/20260816000100_add_assistant_publication/migration.sql",
        ),
        "utf8",
      );
      assert.match(
        migration,
        /AssistantPublication_sessionId_clientTurnId_role_key/,
      );
    }),
  );

  results.push(
    runCase("file_store_durable_roundtrip", () => {
      const filePath = path.join(
        process.cwd(),
        ".data",
        `p2-check-${process.pid}.json`,
      );
      try {
        fs.rmSync(filePath, { force: true });
        const store = new FilePublicationStore(filePath, { now: 20_000_000 });
        const sid = "s-file";
        const tid = "t-file-1";
        ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "persist",
          workerId: "w1",
        });
        startStreaming(store, sid, tid, "w1");
        appendProvisional(store, sid, tid, "w1", "草稿", true);
        store.persist();
        const reloaded = new FilePublicationStore(filePath, { now: 20_000_000 });
        const pub = reloaded.getPublication(sid, tid);
        assert(pub);
        assert.equal(pub.status, "streaming");
        assert.equal(pub.draftContent, "草稿");
        assert.equal(reloaded.countUsers(sid, tid), 1);
        assert.equal(pubKey(sid, tid).endsWith("::assistant"), true);
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }),
  );

  return results;
}

function main(): void {
  const results = [...section13Cases(), ...extraCases()];
  const failed = results.filter((r) => !r.passed);
  const report = {
    schemaVersion: "p2_publication_impl_check_v1",
    leaseMs: LEASE_MS,
    maxAttempt: MAX_ATTEMPT,
    tombstoneRetentionMs: TOMBSTONE_RETENTION_MS,
    section13Cases: [
      "duplicate_retry_before_generation",
      "duplicate_retry_during_live_stream",
      "worker_crash_before_first_segment",
      "worker_crash_after_provisional",
      "commit_failure_after_provisional",
      "output_safety_rejects_final",
      "committed_retry",
      "deleted_committed_retry",
      "failed_retryable_retry",
      "failed_terminal_retry",
    ],
    frozenDefaults: {
      safetySharesAssistantPublicationRow: true,
      provisionalMarkedTemporary: true,
      maxAttempt: 3,
      tombstoneDays: 30,
      featureFlagDefaultOff: true,
      productionWriterUnchanged: true,
    },
    results,
    passed: failed.length === 0,
    failedCount: failed.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => `${f.name}: ${f.detail}`).join("\n"));
    process.exit(1);
  }
}

main();
