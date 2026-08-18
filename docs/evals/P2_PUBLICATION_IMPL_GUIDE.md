# P2 Publication Implementation — Flagged DB/Service/API

## Scope

Authorized P2 implementation slice:

- Prisma `AssistantPublication` model + migration
- Publication service (retry/takeover/commit semantics)
- Feature flag `P2_PUBLICATION_ENABLED` **default off**
- Flagged entries: `/api/chat/p2-publication/eval` and messages route when `useP2Publication=true`
- §13 fault-injection automation

Production V1 writer remains default. No P3. No full traffic switch.

## Run check

```bash
npx tsx scripts/p2-publication-impl-check.ts
# or
npm run check:p2-publication
```

## Enable controlled eval (not production default)

```bash
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_STORE=file   # or memory | prisma
# prisma requires migration applied against DATABASE_URL
```

GET `/api/chat/p2-publication/eval` reports flag state without mutating.


## Controlled trial (PM-authorized)

See `docs/evals/P2_PUBLICATION_CONTROLLED_TRIAL_GUIDE.md`.

```bash
npm run check:p2-publication-trial
```

Prefer `P2_PUBLICATION_STORE=file`. Do not enable site-wide default traffic without a new PM decision.

## Client provisional UI + real model streaming（PM-authorized）

See `docs/evals/P2_PUBLICATION_CLIENT_UI_GUIDE.md`.

```bash
npm run check:p2-publication-client-ui
npm run check:p2-publication-stream
```

Preview requires explicit:

```bash
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_STORE=file
export QWEN_API_KEY=...   # or DASHSCOPE_API_KEY
```

Then open `/chat/p2-preview`. Production V1 writer remains default.

