# Stage B Ready-Preview Acceptance Package

Status: PASS — ready-preview handoff (not deployed)
Evaluated on: 2026-08-20 Asia/Shanghai
Frozen plan: `docs/tasks/stage-b-ready-preview-plan.md`

## Release Identity

- Baseline commit: `3aaaced3b1982dfe7c0f4aebf49de780ad59518d`
- Baseline tree: `e55167d789da4fa54df32a51707c56a08fb8637b`
- RC branch: `codex/ready-preview-3aaaced`
- Reviewed implementation commit: `d4ff76f7d19c057871e3a251e3ccf8c3bac0bb0a`
- Reviewed implementation tree: `f9e6a16fbf3cbaf352c60ca03bca3c5fcda78a80`
- Main workspace dirty inventory: 103 paths, inventory SHA-256
  `270173c882a34088cd97f264a0d55272bbcadb6fce239e6af85ecda52f34c4f2`
- Main workspace handling: inventory only; no path from that dirty tree was copied wholesale.

## Delivered Result

1. The clean RC keeps the frozen deterministic Safety boundary. `你好` enters the
   ordinary generation path. Explicit self-harm, overdose, and violence are
   Safety-owned and make zero ordinary generation adapter calls.
2. A dedicated, model-free P2 publication fixture exercises mobile-web
   `provisional → committed` behavior. It requires two server flags, refuses
   production processes, uses request-scoped memory only, and is continuously
   labeled as simulated/non-Qwen.
3. The fixture has explicit commit-failure and output-rejection paths. Commit
   failure never reports success; rejected candidate text is never emitted as
   provisional or committed content.
4. The fixture is not imported by the V1 message writer or the live Qwen preview
   route. The ordinary `/chat` page has no fixture label or opt-in.

## Executed Checks

All commands below ran in the clean RC. Model keys were unset. The full launch
check used a PostgreSQL 16 database created under `/private/tmp`; it did not
connect to or migrate a production database.

- `scripts/stage-b-safety-boundary-check.ts`: PASS, 9/9; external model calls 0.
- `scripts/p2-publication-fixture-check.ts`: PASS, 11/11; external calls 0;
  production writes 0.
- `scripts/p2-publication-impl-check.ts`: PASS, 16/16.
- `scripts/p2-publication-trial-dry-check.ts`: PASS, 9/9.
- `scripts/p2-publication-client-ui-check.ts`: PASS, 8/8.
- `scripts/p2-publication-stream-check.ts`: PASS, 12/12.
- `scripts/p2-publication-p3-check.ts`: PASS, 5/5.
- `npx tsc --noEmit`: PASS.
- `npm run check:launch`: PASS, including lint, architecture/clinical/memory
  checks, Prisma schema/migration status, miniapp syntax, Stage B checks, and
  production build. One pre-existing non-blocking lint warning remains in
  `services/memory/projection/projectionRegistry.ts` for an unused symbol.
- Independent Safety/privacy review: PASS; no Safety or privacy blocker.
- Post-commit Stage B rerun: Safety 9/9 PASS; fixture 11/11 PASS; Git
  working tree clean at the reviewed implementation commit.

## Acceptance Mapping

| Frozen gate | Evidence |
|---|---|
| No second winner | P2 implementation, stream, P3, and fixture unique-turn checks PASS |
| Unchecked output is not published | Three runtime dangerous-output cases emit neither provisional nor committed events |
| Commit failure is not success | Fixture/API check and phone UI show failed state without `已确认` |
| Temporary → confirmed works | Phone UI visibly shows the temporary marker, then `已确认` |
| `你好` is ordinary | V1 orchestration runtime check: ordinary adapter calls 1, Safety skip false |
| Explicit risk remains Safety-owned | Self-harm, overdose, violence: ordinary adapter calls 0; Safety generation owns result |
| Deletion/forget boundary | Existing P2 deletion/tombstone checks PASS; fixture memory-name disposal PASS; no claim of a product-wide forget API |
| Default remains V1 | Both flags default OFF; ordinary `/chat` has no preview source label |
| Rollback | Removing the dedicated fixture flag returns 404 and creates no `.data` entry |

## Phone Evidence

The isolated development process ran at a 390 × 844 mobile viewport. The
following artifacts contain only controlled synthetic text:

- Confirmed success:
  `/private/tmp/xinqing-ready-preview-lFrCJ5/evidence/screenshots/fixture-success-confirmed.jpg`
  — SHA-256 `498616e4c4ba75cc08aa607499db3644493f42a8be6f39839f85dc78c7fbc7f7`
- Commit failure:
  `/private/tmp/xinqing-ready-preview-lFrCJ5/evidence/screenshots/fixture-commit-failure.jpg`
  — SHA-256 `1166b2e947e94f0133a097f9fc469913e959c228a3eb00e6b0105bcbc19667e5`
- Output rejected, no empty assistant bubble and no rejected text:
  `/private/tmp/xinqing-ready-preview-lFrCJ5/evidence/screenshots/fixture-output-reject-final.jpg`
  — SHA-256 `8a5029fba7a9c821be05cfa45ba548693b2e4b8aa8161a49799732e22a52f1d1`
- Reattach temporary state:
  `/private/tmp/xinqing-ready-preview-lFrCJ5/evidence/screenshots/fixture-reattach-temporary.jpg`
  — SHA-256 `c1c0d59a1dcad04bc38f995e187d164518519b5c26b98cc07bb18a97a29bfce5`
- Reattach final state:
  `/private/tmp/xinqing-ready-preview-lFrCJ5/evidence/screenshots/fixture-reattach-confirmed.jpg`
  — SHA-256 `417acc736fe65b385d8955988b74598f0c04423379162363f0d8d5b205119e60`

## Counterexample Repair

The first two-turn mobile run exposed publication-id reuse inside the
request-scoped fixture store: the second turn could relabel the first committed
bubble as temporary. The fixture now namespaces generated IDs by client turn;
a regression check proves distinct IDs. A second mobile counterexample found an
untouched `...` bubble after output rejection. The client now clears only that
placeholder while retaining the explicit failed publication marker. No
production winner, Safety rule, or V1 writer behavior changed.

The first mobile reattach attempt also showed that a browser with stored auth
could make the fixture page try to load ordinary chat sessions before the
fixture request. Fixture mode now selects a fixed local session before reading
auth, cached messages, or session APIs. The final browser run showed only the
dedicated fixture GET/POST requests, then visibly moved from the reconnect copy
on the same temporary publication to `已确认`.

## Explicitly Not Proven

- Real-Qwen tone, latency, quality, or phone experience was not tested.
- This is not `[SLO-FIRST-SAFE]`, a BUDGET decision, production readiness, or a
  public/real-user rollout.
- Covert-risk and full-recall Safety are not claimed.
- S3b-R remains parallel research with zero calls in this slice.

## Schedule

Planned: optimistic 3 / baseline 5 / pessimistic 9 natural days.
Engineering, full automated gates, and independent Safety/privacy review
completed within the first
natural day because P2/P3 already existed on the frozen baseline and the new
transport was deliberately limited to a model-free evaluation fixture. Actual
elapsed time to ready-preview handoff: 1 natural day.
