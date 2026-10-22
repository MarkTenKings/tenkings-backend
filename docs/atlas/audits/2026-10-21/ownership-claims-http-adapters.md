# Inactive customer claim HTTP adapters

Four new files provide an unregistered customer HTTP handler, an injected browser transport and dedicated tests. They do not modify existing routes, runtime composition, database roles, SQL, private bridge allowlists, package dependencies or operational configuration. Missing capabilities return unavailable before dispatch.

The handler uses existing CustomerAuth cookie/CSRF verification and an independently injected restricted live-account reader before and after service execution. Every result must match that account; foreign, malformed or post-dispatch access-lost replies are withheld. Exact fixed GET routes cover configuration, certificate target, own claim, bundle and request recovery. Exact POST routes cover reservation, submission, withdrawal, replacement, signing and retention completion. Inputs cannot select arbitrary actions or supply account/reviewer/storage authority. Metadata is capped at 8KiB; binary originals are never embedded in JSON. Responses use private no-store headers and sanitized errors.

The browser transport has no default fetch or automatic retries. Same-origin requests use the existing account path and explicit CSRF for POST. Original PUTs omit credentials, refuse redirects, and bind the configured private origin, fixed object path, original Blob, conditional-create and exact signed headers. A failed HTTP response never becomes proof that a mutation rolled back; uncertain requests retain normal recovery semantics.

Root reran all 13 focused Node22 tests successfully, with zero skips. Specialist scoped lint and independent source review pass. Tests use actual CustomerAuth, the handler, browser transport, v2 projector and state coordinator in process, with synthetic services and bytes. They cover missing capability denial, exact routing, origin/CSRF/framing/size refusal, management without storage, pre/post account binding and foreign-result refusal, explicit upload/submission, lost-response recovery without replay, and strict direct PUT boundaries. They make no database, network, storage or production calls.

Production composition remains unfinished. A dedicated live access/configuration reader and lifecycle-aware target/history successor are required. The older v1 workflow reader incorrectly treats withdrawn v2 claims as pending and cannot represent replacement evidence; it is deliberately not used as a fallback. History and reviewer-queue routes are omitted from this increment. Operational proof rules, retention/reviewer grants, real storage and sandbox qualification, private evidence delivery and deletion execution are still required before enabling real claims.

Qualified source hashes:

- HTTP handler: `0f365a713b46a76c75ff6dc4845acb3bd1153a3a51581c20ec08693029757385`
- Browser transport: `0908696669f11e109616f3608f96dde6a1ed05dbca807de4730cf951dbfafebb`
- HTTP tests: `5662652fda346d06eb081b5d4e3f9b0d188aea37cbe63930b5922f72aff5a7b4`
- Transport tests: `ee7ed915bf3a3a941f1fb0a3e57029caa79cb92bd61a5f9859d2119e3ef5cda7`
