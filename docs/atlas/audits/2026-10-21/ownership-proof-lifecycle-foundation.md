# Private ownership proof and claim lifecycle — local foundation

This is disabled, unregistered source. No production migration, role, storage policy, route, runtime adapter or claim was enabled. The new source is excluded from gallery releasec1815115. Fingerprint is a separate offline feasibility proposal; these ownership proof files do not implement or activate it.

## Implemented behavior

Metadata reservations bind the signed-in account, exact latest PUBLISHED approval/report, proof-policy and upload-policy revisions, each original hash/length/MIME, private object path and expiry/retention schedule. A newer PENDING report does not replace the current published reference. Bounds are1–6 files,20MiB each/60MiB total, three unfinished bundles and one unresolved object-upload lease per account. Accepted proof kinds, formats/validators, retention and deletion references default to disabled/unconfigured. No business proof policy is chosen.

A separate trusted ingestor may sign a five-minute conditional/checksummed PUT. Its adapter pins the exact configured HTTPS storage origin and object path, required signed headers, checksum and byte count. Completion uses HEAD followed by exact version/ETag-bound GET, verifies bounded bytes/hash, decodes the original and atomically retains the exact observation after refreshed account/source/policy checks. Retention includes object version/ETag/decoder evidence; the immutable manifest hash remains stable when a bundle is consumed. Customers cannot provide a verified flag, storage receipt, key or account identity. No signed download, delete/list or automatic write retry is exposed.

Original JPEG/PNG and supported SDR HEIC are decoded without creating a replacement image. Unsupported PDF, HDR/auxiliary/multiframe and malformed inputs remain unavailable. The decoder runs only with an explicitly injected launcher; its requested limits include no network, private input/read-only decoder closure, bounded native memory/time/output. **No production sandbox launcher is supplied or qualified.** Decoder unit fixtures explicitly use a local unsandboxed launcher; they prove decoding/source preservation and child cleanup, not host isolation.

Submit creates a pending claim, not current ownership. Read-only request recovery is account-bound. Withdrawal appends a new claim revision without rejection/title fabrication, even when new-evidence policy is unavailable. Replacement retains the claim ID and earlier evidence, appends a new revision, and requires a newly retained bundle. An independent currently granted reviewer, current source/policy and exact revision are required for a decision; self-review and stale/revoked/foreign access fail. The successor blocks the old reviewer path from bypassing replacement rules while preserving both preexisting and new ordinary v1 claims. Historical verification remains distinct from current title.

New restricted customer/reviewer/ingestor roles are inert grant proposals, each with only its intended gateway. Services verify role capability closure and pinned guard source. Live authorization and source checks repeat after lock waits; external object IO never holds a database transaction open. There is no runtime registration.

## Actual qualification

Root reran39 focused tests:15 contract/lifecycle plus24 storage/service/decoder, all passing. Independent source reviews closed two concrete findings: unfinished-bundle/upload-lease enforcement and the immutable manifest's complete source/object binding. SQL installation/runtime then caught two narrow defects in disposable PostgreSQL: PG01 an unparenthesized CASE expression, PG02 an array alias colliding with a PL/pgSQL local. Exact failed sources/results are preserved; both clusters stopped. Corrected predicates retain their original meaning and assertions.

PG03 on Node22.16.0/PostgreSQL17.11 passes eight actual groups: v1 compatibility/disabled defaults; published source/quota/recovery; SQL/Node hashes, persistent upload lease and capability denial; pending/withdrawal recovery without title; replacement/history/policy/v1 bypass protection; independent reviewer authority; actual customer/reviewer waits before real expiry plus discard recheck; sixteen-table preservation and empty private guards. Waiter66793 blocked by66782 at01:08:33.791UTC before customer expiry01:08:35.789; reviewer66795 blocked by66782 at01:08:35.925 before grant expiry01:08:37.896. Both refused after unlock/expiry. These are observed waiters, not sleep-only expiry tests.

Evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-lifecycle-pg-03/`. `postgres-result.json` SHA256`eb7dd24c44ced24e052811ce61355c515115d698378976cff73a73faf966ad65`; `cleanup.json` SHA256`02a8aa070313546d40726de50d42b2b170591cc83624a3386185df1bf84b665c` reports stoppedVerified:true for the exact owned cluster. Synthetic trusted ingestor observations test durable DB binding only; PG tests do not contact storage or qualify proof authenticity. Zero production/provider/storage/notification/financial effects.

| Qualified source under packages/atlas-connected-manual | SHA256 |
|---|---|
| `sql/card-ownership-proof-objects-proposal.sql` | `0bf8dfd062fa36e7f0ac29c12a3d6248620e03a30cbd688081ee04539a1f6a8a` |
| `sql/card-ownership-lifecycle-successor-proposal.sql` | `e4cd3109efff541670c23ef815a8eeab24122dbe4b669f5eae872e1b6cd8b1eb` |
| `src/card-ownership-proof-contract.mjs` | `3ff35f9bcd129a842db11d79e08115b91ca2238b88b86bd7a984e2faa3eb0ccd` |
| `src/card-ownership-lifecycle-service.mjs` | `3751b2cf60af3c591087f9a714103ecb23daeb368310124c38ffe733fc4220dc` |
| `src/card-ownership-proof-storage.mjs` | `7b5aff05b096e55997d26e2bc5030551e15cdc2f7cce80053976275b05daedc6` |
| `src/card-ownership-proof-service.mjs` | `9da524b36e75d282a206d920013f0fdb211a901197e9b773fa33168237d6b8cf` |
| `src/card-ownership-proof-validator.mjs` | `e31187fd7ac650916fe0de1192573476d1192212d9f7db0d52a12889f65d8b34` |
| `test/fixtures/card-ownership-lifecycle-postgres.mjs` | `f9b3adcf302be30cac1e7d819a4820703210794d63d022211863b65632fedb13` |

Original writer SQL00720728…, evidence SQLba9171ca… and evidence service037e0f09… remain byte-identical. No package, lockfile or registered migration was changed.

## Remaining operational gates

Choose actual accepted proof, private-access/raw/orphan/audit retention, deletion/hold authority and named independent reviewer account pairing/expiry. Qualify real private storage conditional PUT/checksum/CORS/version/ETag behavior, a genuinely enforced decoder sandbox and full authenticated upload/readback lifecycle. Implement evidence access/delivery and actual deletion/hold handling; a scheduled deletion timestamp does not prove deletion. Integrate the disabled UI/configuration/certificate lookup/private routes and role provisioning, then qualify migrations/releases and real claims. No current feature requires approving a real claim or changing ownership to test it. The current front-end prototype is separate work, not proof these operations are live.
