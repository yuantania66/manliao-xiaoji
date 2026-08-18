/**
 * Narrow check: client provisional UI consumes P2 publication markers.
 *
 * Proves:
 * - resolvePublicationUiState: V1 (no fields) → none; provisional → provisional; committed → committed
 * - chat-client wires opt-in (?p2Publication=1), marker render, USER_COPY provisional text
 * - site-wide flag default remains OFF (source contract)
 * - no P3 / no default P2_PUBLICATION_ENABLED=1
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isP2PublicationEnabled } from "../lib/p2-publication-flag";
import {
  isP2PublicationClientOptIn,
  publicationMarkerLabel,
  resolvePublicationUiState,
} from "../lib/p2-publication-ui";
import { USER_COPY } from "../services/chat/assistantPublication/types";

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

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function cases(): CaseResult[] {
  const results: CaseResult[] = [];

  results.push(
    runCase("ui_state_v1_no_fields_is_none", () => {
      assert.equal(resolvePublicationUiState(null), "none");
      assert.equal(resolvePublicationUiState({}), "none");
      assert.equal(publicationMarkerLabel("none"), null);
    }),
  );

  results.push(
    runCase("ui_state_provisional_shows_temporary_copy", () => {
      const state = resolvePublicationUiState({
        provisional: true,
        provisionalMarkedTemporary: true,
        provisionalMarker: USER_COPY.provisional,
        publicationStatus: "streaming",
      });
      assert.equal(state, "provisional");
      assert.equal(publicationMarkerLabel(state), USER_COPY.provisional);
      assert.match(USER_COPY.provisional, /临时/);
    }),
  );

  results.push(
    runCase("ui_state_committed_becomes_final_or_confirmed", () => {
      const state = resolvePublicationUiState({
        provisional: false,
        provisionalMarkedTemporary: true,
        publicationStatus: "committed",
      });
      assert.equal(state, "committed");
      const label = publicationMarkerLabel(state);
      assert.ok(label === "已确认" || label === null);
      assert.equal(label, "已确认");
    }),
  );

  results.push(
    runCase("opt_in_query_only", () => {
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("")), false);
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2Publication=0")), false);
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2Publication=1")), true);
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2Publication=true")), true);
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2Publication")), true);
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2=1")), true);
      // Over-encoded equals: key becomes literally "p2Publication=1"
      assert.equal(isP2PublicationClientOptIn(new URLSearchParams("p2Publication%3D1")), true);
    }),
  );

  results.push(
    runCase("flag_still_default_off", () => {
      assert.equal(isP2PublicationEnabled({}), false);
      assert.equal(isP2PublicationEnabled({ P2_PUBLICATION_ENABLED: "0" }), false);
    }),
  );

  results.push(
    runCase("chat_client_consumes_markers_on_opt_in_only", () => {
      const client = read("app/chat/chat-client.tsx");
      assert.match(client, /isP2PublicationClientOptIn/);
      assert.match(client, /resolvePublicationUiState/);
      assert.match(client, /publicationMarkerLabel/);
      assert.match(client, /data-publication-state/);
      assert.match(client, /p2-publication\/eval/);
      assert.match(client, /generate_stream/);
      assert.match(client, /p2PublicationOptIn/);
      assert.match(client, /data-p2-publication-opt-in/);
      // Default V1 messages POST must not force useP2Publication.
      assert.equal(client.includes("useP2Publication"), false);
      // V1 path keeps ordinary content POST (turnId optional depending on base).
      assert.match(client, /content:\s*text/);
      assert.match(client, /debugTrace:\s*showAiDebugTrace/);
    }),
  );

  results.push(
    runCase("helper_and_guide_present", () => {
      assert.ok(fs.existsSync(path.join(process.cwd(), "lib/p2-publication-ui.ts")));
      const guide = read("docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md");
      assert.match(guide, /p2Publication=1/);
      assert.match(guide, /临时内容，确认后才会保留/);
      assert.match(guide, /已确认|终稿/);
      assert.match(guide, /P2_PUBLICATION_ENABLED/);
      assert.match(guide, /STOP|产品经理/);
      assert.match(guide, /Do \*\*not\*\* set site-wide|不.*全站.*默认|default OFF|defaults? off/i);
      assert.doesNotMatch(guide, /enable site-wide default ON|默认开启全站 P2/);
    }),
  );

  results.push(
    runCase("messages_route_still_dual_gated", () => {
      const route = read("app/api/chat/sessions/[sessionId]/messages/route.ts");
      assert.match(
        route,
        /isP2PublicationEnabled\(\)\s*&&\s*body\.useP2Publication\s*===\s*true/,
      );
    }),
  );

  return results;
}

function main() {
  const results = cases();
  const failed = results.filter((r) => !r.passed);
  const payload = {
    slice: "P2 client provisional UI",
    passed: failed.length === 0,
    failedCount: failed.length,
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) process.exit(1);
}

main();
