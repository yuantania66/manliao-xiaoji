# P2 Model-Free Publication Fixture Guide

Status: Stage B internal evaluation only
Production availability: impossible by contract (`NODE_ENV=production` returns 404)

## Purpose

This fixture proves only the mobile-web publication state machine:

`temporary / unconfirmed → committed / confirmed`

It does not call Qwen, does not measure conversation quality, and is not a replacement for `/chat/p2-preview` real-Qwen streaming. The UI must continuously show **模拟评测流（非真实 Qwen）**.

## Isolation

- Dedicated page: `/chat/p2-preview/fixture`
- Dedicated API: `/api/chat/p2-publication/fixture`
- Store: request-scoped memory only
- Model/provider calls: 0
- Message/Event/Memory/Session/Authority/Prisma/file writes: 0
- Required flags: both `P2_PUBLICATION_ENABLED=1` and `P2_PUBLICATION_FIXTURE_ENABLED=1`
- Default: off
- Production process: always unavailable, regardless of flags
- V1 and the live `/api/chat/p2-publication/eval` route do not import this fixture.

## Local Run

Use an isolated RC process with all model keys unset:

```bash
unset QWEN_API_KEY DASHSCOPE_API_KEY OPENAI_API_KEY
export P2_PUBLICATION_ENABLED=1
export P2_PUBLICATION_FIXTURE_ENABLED=1
export P2_PUBLICATION_FIXTURE_DELAY_MS=1200
npm run dev -- --port <unused-port>
```

Open:

```text
http://<local-ip>:<unused-port>/chat/p2-preview/fixture
```

The banner must read:

```text
模拟评测流（非真实 Qwen）· 仅验证临时→已确认状态机 · 零模型调用
```

## Failure Scenarios

- Reattach/recovery: `/chat/p2-preview/fixture?fixtureScenario=reattach`
- Commit failure: `/chat/p2-preview/fixture?fixtureScenario=commit_failure`
- Output Safety rejection: `/chat/p2-preview/fixture?fixtureScenario=output_reject`

Reattach emits `stream_in_progress` and then resumes the same publication ID through temporary to confirmed. Commit failure may show temporary content followed by failure, but must never show `已确认`. Output rejection must not show either temporary or confirmed candidate content.

## Rollback

Unset either flag and restart the local process. The fixture page's API calls must return 404. Because its store is request-scoped memory, no fixture message content remains on disk or in a database.

## Explicitly Untested

- Real-Qwen latency, tone, quality, or conversation experience
- Production traffic, real-user data, production database, or rollout
- Covert-risk/full-recall Safety behavior
- Product-level memory deletion/forget API (only disposal of the isolated memory store is exercised)
