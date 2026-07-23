# Chat History Pagination

## Product Contract

- Opening a saved chat shows the latest 50 user/assistant messages in chronological order.
- A proactive greeting created during chat opening must be included in that latest window.
- Scrolling to the top loads the preceding 50 messages.
- Older pages are prepended without moving the currently visible messages.
- Repeated upward loading must reach the beginning of the session without duplicates or gaps.
- Search and calendar deep links may continue loading older pages until their requested message or date is present.
- Guest chat remains session-cache only and does not call the saved-history pagination API.

## API Contract

`GET /api/chat/sessions/:sessionId/messages?pageSize=50`

- Returns the newest page, with `items` ordered oldest-to-newest for display.
- Returns `hasMore` and `nextCursor`.

`GET /api/chat/sessions/:sessionId/messages?pageSize=50&before=:messageId`

- Returns messages strictly older than the cursor.
- Ordering is stable on `(createdAt, id)` so equal timestamps do not create gaps or duplicates.
- An unknown or cross-session cursor is rejected.

## Verification

Run:

```bash
npm run check:chat-history-pagination
```

The regression covers 20 boundary sizes, equal timestamps, cursor stability after newer inserts,
chronological order, duplicate prevention, and the client scroll-preservation contract.
