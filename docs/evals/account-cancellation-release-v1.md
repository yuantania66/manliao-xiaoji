# Account Cancellation Release V1

Current contract (adopted in `df1a6f41`, 2026-08-28): account cancellation locks the original user row, physically deletes that user and their feedback, and removes all user-owned relational data through database cascades. It creates no replacement `CANCELLED` user. The lock ensures a concurrent child write either finishes before cleanup or fails after the original identity is removed.

Historical note: `715aefbc` introduced an anonymous replacement user and anonymized retained feedback. That policy was superseded by `df1a6f41`; see `release-test-baseline-20260827.md`. The historical implementation and original failed test logs remain preserved; they are not the current deletion contract.

Private note uploads are copied into a persistent deletion queue inside the same transaction that revokes the account and removes upload ownership. File deletion happens only after commit. Successful tasks are removed immediately. A failed deletion retains only its private storage locator and low-cardinality failure state for an idempotent retry; database rollback creates neither a queue task nor a partial cancellation. A secret-protected internal endpoint drains pending tasks and must be scheduled by the deployment platform.

The local service check verifies deletion of the original user, no replacement tombstone, deletion by the original feedback ID, sessions, notes, uploads, Raw Memory, P4 profile cache, P6 derived snapshot, private file deletion, rollback, concurrent late writes, and cross-user isolation. The required route-level check remains `check:account-cancel-e2e`, including old-token invalidation and sensitive/derived-data deletion. Both checks use only synthetic records in an explicitly verified isolated PostgreSQL database.

Deployment must configure `ACCOUNT_CANCELLATION_CLEANUP_SECRET` and schedule `POST /api/internal/account-cancellation-files`. Immediate access revocation does not depend on the retry schedule.
