# Account Cancellation Release V1

Account cancellation first locks the original user row, then keeps one new anonymous `CANCELLED` user tombstone and removes the original user identity, identifiers, and all user-owned relational data through database cascades. The lock ensures a concurrent child write either finishes before the cleanup scan or fails after the original identity is removed. The tombstone deliberately receives a different ID so an already-authorized late write cannot reconnect data to the cancelled identity. Retained feedback is stripped of its user link, contact, user agent, and original free text.

Private note uploads are copied into a persistent deletion queue inside the same transaction that revokes the account and removes upload ownership. File deletion happens only after commit. Successful tasks are removed immediately. A failed deletion retains only its private storage locator and low-cardinality failure state for an idempotent retry; database rollback creates neither a queue task nor a partial cancellation. A secret-protected internal endpoint drains pending tasks and must be scheduled by the deployment platform.

The local release check covers the anonymous tombstone, sessions, notes, uploads, Raw Memory, P4 profile cache, P6 derived snapshot, feedback anonymization, private file deletion, rollback, and cross-user isolation. It uses only synthetic records in an isolated PostgreSQL database.

Deployment must configure `ACCOUNT_CANCELLATION_CLEANUP_SECRET` and schedule `POST /api/internal/account-cancellation-files`. Immediate access revocation does not depend on the retry schedule.
