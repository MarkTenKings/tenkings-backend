# R1 activation preparation — October 22, 2026

This is a reviewable preparation plan. It has not been executed and does not qualify the candidate for release. Current evidence and source pins are in [lead takeover](r1-lead-takeover.md). Candidate `a0f4951f` adds account preferences, truthful current-owner collection/display and staff saved-comp reads/Skip/No suitable. It preserves the `cf5fcefa` grading/label release. Claims/history, selected-sale guidance, public browsing, offers, listings and payments stay disabled.

## Resolve build and authority prerequisites

1. Supply sufficient local disk space or a separate build host. Freeze the exact candidate after rechecking for a newer production successor. Use the actual native Linux package and staff/customer/public production builds, source/served-asset closure and browser-secret checks. Reuse unchanged component/SQL evidence; the newer label transport and combined packager specifically need candidate qualification. Do not build experimental Fingerprint work on grading resources.
2. Use the standalone manifest/migrator for only the reviewed 009→011 suffix. SQL010 SHA256 is `a6de21a978dc5b3bb5e21dbdf408d60709fa2c724a3e17376ff11502e6ef42a9`; SQL011 is `aa19879134c9ad6261fa33ad96ed0f5be6ee2e498b601c3e2f12deee407fe36a`. Preserve baseline/002–009 bytes and ledger. Do not reinstall baseline, run Prisma migration history/db push, use fixture installers or repair observed drift. Neither suffix seeds title, reviewer authority, policy or grants.
3. Prepare three separate non-owner LOGIN roles with distinct credentials, bounded clients and the same verified database/TLS endpoint. Proposed names (not created) are `atlas_collection_reader_r1`, `atlas_collection_preferences_r1` and `atlas_comp_curation_r1`. Fail if a name exists unexpectedly. No role membership, ownership, CREATE/TEMPORARY or unrelated effective rights are permitted. The read-only census found no PUBLIC database grants, no PUBLIC executable application routines and only public-schema USAGE; recheck immediately before provisioning. Existing application schema owners are `doadmin`; verify actual new schema/routine owners after migration instead of assuming or accepting drift.

| Role | Exact authority |
| --- | --- |
| Current collection | `cardOwnershipReadGrantSQL`: USAGE on `atlas_ownership`; EXECUTE only `atlas_ownership.customer_read(text,text,jsonb,text,jsonb)`; no direct table/sequence access |
| Preferences | `cardOwnershipPreferencesGrantSQL`: USAGE on `atlas_ownership_preferences`; EXECUTE only `atlas_ownership_preferences.customer_call(text,text,jsonb,text,jsonb)`; no combined ownership writer or direct tables |
| Native comp | Reviewed `comp-curation-role-proposal.sql`: USAGE on `atlas_manual`/`atlas_manual_intake`; EXECUTE only `atlas_manual.authenticate(text,text,jsonb,text[])`; SELECT on exactly manual action/approval/card/comp_curation/presentation_market/public_report_identity/publication plus intake card/discarded_card; INSERT only comp_curation; UPDATE(id) on the two card tables solely for row-lock admission, with pinned immutable triggers denying actual updates including `id=id` |

4. Prepare a separate native GET-only object-storage identity scoped to the reviewed immutable saved-artifact prefix, with no reuse of manual/customer keys. Verify actual provider permissions and SDK cleanup/abort behavior, exact PUBLIC_REPORT/MARKET_PREVIEW reference bytes/hash/lineage, and lack of write capability through policy/effective-rights evidence. Do not issue a production canary write to test denial. The current code's bounded synthetic tests do not prove provider permissions. If the provider cannot enforce the required scope, resolve that before activation rather than broadening privileges.

## Bind configuration without expanding scope

| Target | Server-only bindings |
| --- | --- |
| Customer reader | `ATLAS_CUSTOMER_COLLECTION=1`; new `_DATABASE_URL`, `schema=atlas_ownership`, separate role/password from existing customer client |
| Customer preferences | `ATLAS_CUSTOMER_COLLECTION_PREFERENCES=1`; its `_DATABASE_URL`, `schema=atlas_ownership_preferences`, and verified `_SCHEMA_OWNER` |
| Approved Front display | `ATLAS_CUSTOMER_COLLECTION_DISPLAY=1`; fixed `https://atlasgrading.com/api/reports/<token>?v=<version>` and `/images/FRONT?v=<version>`, no new customer storage keys, no cookies/redirects, existing 2 MiB image cap |
| Native comp | `ATLAS_STAFF_COMP_CURATION=1`; `ATLAS_COMP_DATABASE_URL`, `_DATABASE_ROLE`, `_SCHEMA_OWNER`, `_SCHEMA_SHA256`, and separate `ATLAS_COMP_STORAGE_ENDPOINT`, `ATLAS_COMP_STORAGE_REGION`, `ATLAS_COMP_STORAGE_BUCKET`, `ATLAS_COMP_STORAGE_PREFIX`, `ATLAS_COMP_STORAGE_ACCESS_KEY`, `ATLAS_COMP_STORAGE_SECRET_KEY` |
| Staff comp frontend | `ATLAS_STAFF_COMP_CURATION=1`, existing manual enabled/service origin/transport key, dedicated authenticated GET/POST browser endpoints |
| Public router | Exact new staff/customer immutable origins and constructor-computed control bindings; approved versioned report JSON route included |

Pin normalized comp schema `a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7`; never replace it with an observed unexpected hash. Keep native policy null and `ATLAS_CUSTOMER_OWNERSHIP_HISTORY` unset. No credential has a NEXT_PUBLIC counterpart. Native database pool remains 2, storage concurrency 2, with the existing finite deadlines. Retain working scoring, approved labels and all worker startup/exclusion protections.

Both gateway path rules already match the private comp aliases. Retain their current configuration unless fresh exact evidence shows a gap. Candidate qualification must still prove public route → signed private alias → restricted runtime, including exact method/query/raw body, nonce behavior, private-alias browser 404, direct-host refusal and separate staff/customer cookies/CSRF.

## Execute only after exact candidate readiness

Before any migration, deploy or restart, append the concrete intended action and immutable inputs to SESSION_LOG. Use fresh before snapshots, expected control revisions and one-use effect identities; do not reuse consumed historical release plans. Obtain the established bounded admission, wait for natural drain and gracefully stop only the identified current native processes where needed. Preserve old containers/images, resource/security/network settings, worker fence and all unrelated controls/data.

Apply only the additive suffix and exact grants under the reviewed protocol, record outcomes, then qualify effective role privileges and owner/source pins. Install the qualified native/web targets and router/control bindings. No title, reviewer, claim or policy seeds are permitted. Unexpected/uncertain outcomes require read-only reconciliation before any next action; do not replay an effect because its client response was lost.

Postflight must preserve established protected table/provider/report/photo/label state and include the new 010/011 schemas, catalog, rights and receipts. Close technical checks and explicitly release/verify absence of the holder without waiting indefinitely for a human browser session. Record measured downtime if any; do not claim zero downtime.

Use ordinary staff/customer sign-in for acceptance. Account settings and a truthful empty collection can pass without titles. Approved Front and per-card settings require a genuinely recorded current owner; leave those positive cases pending if none exists. Do not create ownership for testing. Staff saved-pool acceptance may record an explicitly intended Skip/No suitable receipt with exact recovery while preserving report/market bytes and making no provider acquisition. No grading decision, paid search, message, print or money movement is justified merely by this release's testing.

Rollback must preserve additive schema/data and reconcile actual outcomes. Disable the affected optional surface or restore the exact prior qualified targets/control bindings through a fresh recorded plan. Do not drop 010/011, delete receipts, restore stale business rows or reactivate retired workers speculatively. All further R2/R3 master-plan work and independent offline Fingerprint remain tracked separately.
