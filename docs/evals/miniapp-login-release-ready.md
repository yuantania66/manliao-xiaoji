# Miniapp Login Entry — Local Release Acceptance

## Outcome

The Home and Me login entries use the server session as authority, fail closed
for malformed or expired local authentication, preserve a locally valid session
on transport failure, and require an explicit privacy-policy confirmation before
starting WeChat login.

## Boundaries

- Local-only validation; no real WeChat request or deployment.
- No backend, chat, Composer, or database changes.
- The platform-owned `envVersion` is authoritative: release, trial, unknown and
  API failures always use the official HTTPS origin. Stored environment and URL
  overrides are read only when `envVersion` is `develop`.

## Automated acceptance

`npm run check:miniapp-login` covers valid, expired and malformed auth; production
origin locking against simultaneous stored environment and URL tampering;
duplicate server checks; transport degradation; stale async
results after guest selection; privacy confirmation; empty WeChat codes; and Me
login failure without implicit guest-mode mutation.

The general miniapp syntax gate remains `npm run check:miniapp-js`.
