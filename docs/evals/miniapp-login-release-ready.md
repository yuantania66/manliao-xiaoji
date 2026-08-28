# Miniapp Login Entry — Local Release Acceptance

## Outcome

The Home and Me login entries use the server session as authority, fail closed
for malformed or expired local authentication, preserve a locally valid session
on transport failure, and require explicit privacy-policy confirmation before
the user can open WeChat's native phone-number selector. A verified phone number
and WeChat identity create or enter one account; two existing accounts are never
silently merged.

## Boundaries

- Local and isolated-database validation; real WeChat authorization remains a
  required device gate.
- No chat or AI behavior changes. SMS verification is not part of this flow.
- The platform-owned `envVersion` is authoritative: release, trial, unknown and
  API failures always use the official HTTPS origin. Stored environment and URL
  overrides are read only when `envVersion` is `develop`.

## Automated acceptance

`npm run check:miniapp-login` covers valid, expired and malformed auth; production
origin locking against simultaneous stored environment and URL tampering;
duplicate server checks; transport degradation; stale async results after guest
selection; privacy confirmation; denied phone authorization; empty WeChat login
codes; and Me login failure without implicit guest-mode mutation.

`npm run check:wechat-phone-login-e2e` covers the real route and database
transaction for new registration, existing phone or WeChat binding, conflict
rejection, invalid phone responses and concurrent use of one phone number.

The general miniapp syntax gate remains `npm run check:miniapp-js`.
