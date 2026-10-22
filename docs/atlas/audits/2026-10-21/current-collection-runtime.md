# Current collection runtime — local, default off

Date: 2026-10-22. This closes the missing runtime supply for the existing current-collection GET. It does not activate ownership, install SQL, create credentials, or change production.

## Implemented scope

- New `frontend/atlas-customer/lib/server/collection-runtime.mjs` composes the unchanged `createCardOwnershipReadService` with actual `CustomerAuth` and a separately owned restricted client. The client is lazy and single-flight; invalid newly owned clients are disposed, the general customer client is never reused/disposed, and explicit close drains active work then disconnects once. No import or construction I/O.
- Optional `ATLAS_CUSTOMER_COLLECTION=1` and `ATLAS_CUSTOMER_COLLECTION_DATABASE_URL` are parsed only. Absent or malformed values leave collection unavailable without preventing ordinary customer routes. The reader URL must target the same database/endpoint with different role/password, exact `atlas_ownership` schema, production TLS, and fixed pool/connect bounds. No environment values were set.
- Existing `/api/customer/collection` delegates before the common ingress branch. Its handler admits the original GET exactly once with a synchronous-void trusted guard, validates actual CustomerAuth/config/cookie proofs and strict body/query shape, then pins the original request, auth/config/ingress/read method across the awaited read. Final drift/abort suppresses private output without a second signed admission. Responses remain private/no-store; unavailable and valid empty remain distinct.
- The underlying reader still checks the dedicated role and live SQL session/title projection; no SQL, reader, writer or grading changes. The new database credential marker is rejected by the existing browser-bundle leak checker.

## Qualification

Exact envelope: `/Users/markthomas/.codex/atlas-handoffs/atlas-collection-runtime-20261022/qualification-03/qualification.json`, SHA256 `8022c8768bd14d4561a5b139848f65ceaac30e0cc51b6dc17a8062ee04edd744`. It pins25 changed/retained source files and copies plus10 evidence files.

- Node22.16.0, macOS OS-level network denial:41 focused tests pass; ordinary `node --test test/*.test.mjs` passes340 with zero skips. A later marker-only checker/regression amendment passes its two boundary tests separately; the340-test result is not misrepresented as rerun after that amendment. Scoped lint and changed-file whitespace check pass.
- Tests exercise actual CustomerAuth, real route-proof signer/verifier, existing HTTP dispatcher, unchanged read service and ownership projector. Synthetic transaction rows provide the SQL boundary; this run opens no database. Deferred reads prove request/auth/config/ingress/same-object reader-method drift refusal and one admission. Lazy client/close/invalid-client scenarios prove disposal ownership and no late result. Existing session/history routes remain covered.
- Preserved first wildcard attempt:336 pass/four failures because an older mounted account fixture used an incomplete plain auth configuration. Root approved replacing only that fixture configuration with actual `makeConfig`; all mounted assertions stayed unchanged. The next wildcard run passes340. Earlier40-pass focused evidence is also retained.

## Limits and remaining activation work

No PostgreSQL, public/native/provider call, listener, browser, build, credential, role/grant, SQL installation or production action was performed by this qualification. This is local application wiring over an existing qualified reader, not a new deployed-role or database proof. Root owns app build, commit and any future separately reviewed installation/configuration/release. Actual live ownership data and the restricted role remain prerequisites for activation; ownership proof policy and offer delivery are not inferred. Current collection, claim history, display, preferences and comp curation remain separate capabilities.

The public approved-evidence adapter and preference UI/adapters are separately owned work and are not activated by this runtime. All30 master requirements and R1 remain open at their existing evidence-based statuses.
