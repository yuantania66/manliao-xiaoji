# Miniapp Note Frontend — Local Release Acceptance

The note editor preserves one device-local draft across auth expiry and restores
its stable `clientRequestId`. Every selected image is copied into WeChat's persistent
user-data path before entering a draft, regardless of auth mode. Authenticated creation sends the
same request identity through retries and best-effort deletes unbound uploads
after partial upload or note-creation failure. Failed cleanup is retained as a
device-local URL-only queue and retried after authentication; success alone removes
those entries. Removing a draft image, or completing an authenticated save, removes
the no-longer-referenced local persistent copy.

History and search walk every server page. Request generations prevent an older
response from replacing a newer query or refresh, and search results retain the
record date used by detail navigation. Detail supports guarded text updates for
both authenticated and guest notes. Malformed storage fails empty.

The backend owns idempotent creation, private upload authorization and deletion
cascade semantics. A note is valid with text, owned images, or both. An
image-only note stores empty text and creates no text RawMemory. Authenticated
creates require a stable `clientRequestId`: an exact replay returns the original
note and a different payload returns 409. Deletion removes NOTE RawMemory and
makes private uploads unreadable before file cleanup. This local acceptance
slice does not change chat or Composer behavior and does not use production or
real-user data.
