/**
 * P2 Publication controlled-trial dry-check (eval / opt-in only).
 *
 * Proves:
 * - flag defaults OFF (site-wide V1 writer remains default)
 * - file-store trial path: same-turn no second winner, provisional→commit, lease takeover
 * - write isolation: file store under .data/; no ChatMessage / prisma coupling in fileStore
 * - messages route + eval route remain gated (source contracts)
 *
 * Does NOT apply DB migration. Does NOT enable production default flag.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getP2PublicationStoreMode,
  isP2PublicationEnabled,
} from "../lib/p2-publication-flag";
import {
  FilePublicationStore,
  appendProvisional,
  assertInvariants,
  commitFinal,
  expireLease,
  ingress,
  startStreaming,
} from "../services/chat/assistantPublication";

type CaseResult = { name: string; passed: boolean; detail: string };

function runCase(name: string, fn: () => void | Promise<void>): CaseResult {
  try {
    const out = fn();
    if (out && typeof (out as Promise<void>).then === "function") {
      throw new Error("async case not supported; keep sync");
    }
    return { name, passed: true, detail: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, passed: false, detail: message };
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function cases(): CaseResult[] {
  const results: CaseResult[] = [];

  results.push(
    runCase("flag_default_off_and_store_defaults_file", () => {
      assert.equal(isP2PublicationEnabled({}), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "0" }), false);
      assert.equal(getP2PublicationStoreMode({}), "file");
      assert.equal(getP2PublicationStoreMode({ P2_PUBLICATION_STORE: "memory" }), "memory");
    }),
  );

  results.push(
    runCase("trial_file_store_same_turn_no_second_winner", () => {
      const filePath = path.join(
        process.cwd(),
        ".data",
        `p2-trial-check-${process.pid}-winner.json`,
      );
      try {
        fs.rmSync(filePath, { force: true });
        const store = new FilePublicationStore(filePath, { now: 30_000_000 });
        const sid = "trial-s-winner";
        const tid = "trial-turn-winner-01";
        const r1 = ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "你好",
          workerId: "w1",
        });
        assert.equal(r1.kind, "ok");
        if (r1.kind !== "ok") return;
        const r2 = ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "你好",
          workerId: "w2",
        });
        assert.equal(r2.kind, "ok");
        if (r2.kind !== "ok") return;
        assert.equal(r2.action, "attached");
        assert.equal(r1.publication.id, r2.publication.id);
        assert.equal(store.countUsers(sid, tid), 1);
        assert.equal(store.countAssistantPublications(sid, tid), 1);
        store.persist();
        const snap = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
          publications: unknown[];
        };
        assert.equal(snap.publications.length, 1);
        assertInvariants(store, sid, tid, "no-second-winner");
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }),
  );

  results.push(
    runCase("trial_file_store_provisional_to_commit", () => {
      const filePath = path.join(
        process.cwd(),
        ".data",
        `p2-trial-check-${process.pid}-commit.json`,
      );
      try {
        fs.rmSync(filePath, { force: true });
        const store = new FilePublicationStore(filePath, { now: 31_000_000 });
        const sid = "trial-s-commit";
        const tid = "trial-turn-commit-01";
        const created = ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "在吗",
          workerId: "w1",
        });
        assert.equal(created.kind, "ok");
        if (created.kind !== "ok") return;
        startStreaming(store, sid, tid, "w1");
        const emitted = appendProvisional(store, sid, tid, "w1", "我在。", true);
        assert.equal(emitted.emitted, true);
        assert.equal(emitted.provisionalMarkedTemporary, true);
        assert.equal(emitted.publication.status, "streaming");
        const okCommit = commitFinal(store, {
          sessionId: sid,
          clientTurnId: tid,
          workerId: "w1",
          finalContent: "我在。",
          outputSafetyPass: true,
          conversationCommitOk: true,
        });
        assert.equal(okCommit.success, true);
        if (!okCommit.success) return;
        assert.equal(okCommit.publication.status, "committed");
        assert.equal(okCommit.publication.finalContent, "我在。");
        // Marker may remain historically true; authority is status=committed.

        // Reset a parallel turn to prove commit failure is not success.
        const tidFail = "trial-turn-commit-fail";
        ingress(store, {
          sessionId: sid,
          clientTurnId: tidFail,
          userText: "失败路径",
          workerId: "w1",
        });
        startStreaming(store, sid, tidFail, "w1");
        appendProvisional(store, sid, tidFail, "w1", "草稿", true);
        const failCommit = commitFinal(store, {
          sessionId: sid,
          clientTurnId: tidFail,
          workerId: "w1",
          finalContent: "草稿",
          outputSafetyPass: true,
          conversationCommitOk: false,
        });
        assert.equal(failCommit.success, false);
        store.persist();
        assert.ok(fs.existsSync(filePath));
        assert.ok(filePath.includes(`${path.sep}.data${path.sep}`));
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }),
  );

  results.push(
    runCase("trial_file_store_lease_takeover", () => {
      const filePath = path.join(
        process.cwd(),
        ".data",
        `p2-trial-check-${process.pid}-lease.json`,
      );
      try {
        fs.rmSync(filePath, { force: true });
        const store = new FilePublicationStore(filePath, { now: 32_000_000 });
        const sid = "trial-s-lease";
        const tid = "trial-turn-lease-01";
        const r1 = ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "lease",
          workerId: "w1",
        });
        assert.equal(r1.kind, "ok");
        if (r1.kind !== "ok") return;
        const id = r1.publication.id;
        startStreaming(store, sid, tid, "w1");
        appendProvisional(store, sid, tid, "w1", "片段", true);
        expireLease(store, sid, tid);
        assert.equal(store.listLiveZombies().length, 1);
        const r2 = ingress(store, {
          sessionId: sid,
          clientTurnId: tid,
          userText: "lease",
          workerId: "w2",
        });
        assert.equal(r2.kind, "ok");
        if (r2.kind !== "ok") return;
        assert.equal(r2.publication.id, id);
        assert.equal(store.countAssistantPublications(sid, tid), 1);
        assert.equal(store.listLiveZombies().length, 0);
        assertInvariants(store, sid, tid, "lease-takeover");
        store.persist();
      } finally {
        fs.rmSync(filePath, { force: true });
      }
    }),
  );

  results.push(
    runCase("write_isolation_file_store_no_chatmessage_coupling", () => {
      const fileStoreSrc = read("services/chat/assistantPublication/fileStore.ts");
      assert.doesNotMatch(fileStoreSrc, /ChatMessage/);
      assert.doesNotMatch(fileStoreSrc, /from ["']@\/lib\/prisma["']/);
      assert.match(fileStoreSrc, /\.data/);
      assert.match(fileStoreSrc, /p2-publications\.json/);

      const factorySrc = read("services/chat/assistantPublication/factory.ts");
      assert.match(factorySrc, /P2 publication flag is off/);
      // prisma import is lazy and only for prisma mode
      assert.match(factorySrc, /forceMode/);
    }),
  );

  results.push(
    runCase("write_isolation_messages_route_opt_in_gate", () => {
      const route = read("app/api/chat/sessions/[sessionId]/messages/route.ts");
      assert.match(
        route,
        /isP2PublicationEnabled\(\)\s*&&\s*body\.useP2Publication\s*===\s*true/,
      );
      assert.match(route, /createReviewedChatReply/);
      // Default path comment preserved
      assert.match(route, /Default production path remains the V1 writer/);
    }),
  );

  results.push(
    runCase("write_isolation_eval_route_flag_gate", () => {
      const evalRoute = read("app/api/chat/p2-publication/eval/route.ts");
      assert.match(evalRoute, /assertFlagOn/);
      assert.match(evalRoute, /P2 publication entry is disabled/);
      assert.match(evalRoute, /productionWriter:\s*"v1"/);
      assert.match(evalRoute, /defaultOff:\s*true/);
      assert.match(evalRoute, /append_provisional/);
      assert.match(evalRoute, /op === "commit"/);
    }),
  );

  results.push(
    runCase("trial_guide_present", () => {
      const guide = read("docs/evals/P2_PUBLICATION_CONTROLLED_TRIAL_GUIDE.md");
      assert.match(guide, /Controlled Trial/);
      assert.match(guide, /no second winner/i);
      assert.match(guide, /provisional → commit|provisional->commit|provisional.*commit/i);
      assert.match(guide, /Lease takeover|lease/i);
      assert.match(guide, /P2_PUBLICATION_STORE=file/);
      assert.match(guide, /Write isolation/i);
      assert.match(guide, /site-wide default/);
      assert.match(guide, /P2_PUBLICATION_ENABLED/);
      assert.match(guide, /flip site-wide/);
      assert.match(guide, /Do \*\*not\*\*|\*\*Do not\*\*/);
    }),
  );

  results.push(
    runCase("migration_not_required_for_file_trial", () => {
      // File trial must not require applying migration; migration file may exist but is unused here.
      const mode = getP2PublicationStoreMode({ P2_PUBLICATION_STORE: "file" });
      assert.equal(mode, "file");
      const migrationDir = path.join(
        process.cwd(),
        "prisma/migrations/20260816000100_add_assistant_publication",
      );
      assert.ok(fs.existsSync(migrationDir), "migration artifact exists for optional prisma mode");
      // Explicit: this check never opens DATABASE_URL / prisma migrate
      assert.equal(process.env.P2_PUBLICATION_TRIAL_APPLY_MIGRATION ?? "", "");
    }),
  );

  return results;
}

function main(): void {
  const results = cases();
  const failed = results.filter((r) => !r.passed);
  const report = {
    schemaVersion: "p2_publication_controlled_trial_dry_check_v1",
    slice: "P2 controlled trial (eval / opt-in)",
    storePreference: "file",
    productionDefaultFlag: "OFF",
    productionWriter: "v1",
    migrationAppliedToSharedDb: false,
    writeIsolation: {
      fileStorePathPattern: ".data/p2-*.json",
      pollutesProductionChatMessageAuthority: false,
      messagesRouteRequiresFlagAndOptIn: true,
      evalPostRequiresFlag: true,
    },
    results,
    passed: failed.length === 0,
    failedCount: failed.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    console.error(
      "FAILED:",
      failed.map((f) => `${f.name}: ${f.detail}`).join("\n"),
    );
    process.exit(1);
  }
}

main();
