# Report experience and early geometry — September 22, 2026

## Current checkpoint

**The software release is live and verified.** Exact-source/native/PostgreSQL qualification, additive staff migrations43/44, native startup, the Caddy route, five control bindings, public promotion and final hosted checks all pass. The new private container started at **16:41:03.952315934 UTC**. Actual live staff and customer pages render the ATLAS black/gold design. Owner real-card acceptance and physical finishing remain separate.

Private evidence is retained outside Git at `/Users/markthomas/.codex/atlas-handoffs/atlas-report-early-20260922-09df/release/`, abbreviated `R` below. Original photographs, credentials and signed media links are not included here. Documentation changes do not change the frozen application identity.

| Identity | Verified value |
| --- | --- |
| Application source | `79483f13000c23dfed62c0c03f1239beb8f74dfb` |
| Source tree | `b92bf0fdd60063ed092c716736ec161df8a6867a` |
| Native image | `sha256:098a24a2a6cd13cb3a9e73d7148bd5b4349582dfe59d7b1ad921266f078d3fe7` |
| Source manifest | 627 files; `903ce1b0548e1e3e5a71ca44d3cc49a35810f5c1a89b37c497fc546d4ac3e674` |
| New private container | `aba32d6d1898d82dc4d922266e9178a1bb8152d9b762bdb04312dccf1ac46df8` |
| Runtime name | `atlas-manual-connected-20260917` |
| New configuration custody | `/opt/atlas/manual-report-early-20260922-09df/private.env` |
| Staff schema | 44 applied migrations, including only the two additions below |
| Scoped manual privileges | 18 tables and 11 nontrigger functions |

## Implemented behavior

Each selected side can begin physical-edge detection, preparation and printed-border detection as soon as its verified working image is ready. It does not wait for card identification, completed identity fields or the other photograph. Durable per-side intent, claims and recovery keep at most two geometry jobs active. Cache keys bind the selected upload, working frame, geometry settings and engine identity. Late work cannot overwrite a replaced source or human geometry; initialization adopts matching cached preparation instead of repeating CPU work or inventing temporary card details. Identification and final human review retain their own requirements.

The client shows per-side progress and real physical outlines, preserves typed details and reconciles saved status on reopening. Transient scheduling failures use bounded backoff; successful requests are deduplicated. Terminal detector failures require deliberate retry, and authentication refusal stops reconciliation. Existing original-photo recovery and the qualified Back-edge correction are retained.

Staff, customer and public report surfaces reuse the existing ATLAS logo and black/gold identity. The shared report supports linked findings and numbered markers, Front/Back and category navigation, verified-photo zoom/pan/pinch and minimap, physical/printed geometry layers, finding close-ups and the stored calculation detail. Printing expands the evidence and waits for verified photographs. Browser print/save PDF is a report copy, not a stored PDF-generation service.

Exact human report approval now commits a durable publication intent with the immutable approval. Delivery projects only that approval's report, geometry, media and measurements into a versioned public packet. A stable ATLAS report number/token and immutable approval versions support sharing and explicit delivery retry without approving again. Public reads use a dedicated signed native bridge and current public control; private staff/proposal/storage details stay private. Legacy V1 parsing and display-grade behavior remain unchanged. No report was approved on Mark's behalf during this release.

Implementation references: `packages/atlas-connected-manual/src/early-geometry.mjs`, `early-geometry-store.mjs`, `publication.mjs` and `publication-repository.mjs`; `frontend/atlas-app/lib/early-geometry-client.mjs`; `frontend/atlas-app/components/ManualCards.jsx`; and `packages/atlas-report-view`.

## Qualification and immutable fixture correction

The source-only native build preserved all 16 native artifacts and the shared CPU engines. Build result `R/native-context-79483f13/build-evidence/result.json` has SHA256 `839175eb228fede2564e4700e8784ece502d9e84f06992c9f1f2f5709a4d2adc`. Exact-source CI run `35748898956` passed all 14 jobs; raw receipt `R/ci-79483f13-final.json` has SHA256 `45ebf0e25eb0dd854bd9816ed98a2ab7029d9be6b76edfc1739287694c924893`.

All five intended-image groups pass: source, boundary, **736 package tests**, **96 staff tests** and **10 detector tests**. Containers used network none, read-only roots, nonroot execution, 1 CPU, 3 GiB memory/swap and 256 PIDs, with no OOM and unchanged unrelated containers. The original package run passed 733/736: three privilege-catalog tests could not read the test-only `packages/database/prisma/schema.prisma`. That failed result and log remain retained. A separately reviewed fresh run added only the exact frozen schema as a read-only test mount: 132,651 bytes, SHA256 `547488b20ddef331ef99cb5855aa3eebfde8516f78b1eae7019c6a92a0777a09`. No runtime image, source, original plan or failed receipt was replaced. Original source/boundary receipts and fresh package/staff/detector receipts form the accepted qualification.

Full isolated PostgreSQL 44 qualification passed ACL/storage and memory groups, all seven early-geometry groups, all eight publication groups, 25 memory assertions, migration no-op replays, narrow grants and native identity preservation. Result `R/pg-context-79483f13/pg-evidence/result.json` has SHA256 `0c8c90b3e4625e077666176fe108b04507f0d0991b5f8aeac14816522b37bc25`. Actual connected fixture approval produced a published version 1, exact replay retained it and later approval produced immutable version 2. These are disposable fixtures, not production-card approvals.

Local browser qualification covered first-side readiness before Back or identification, cached initialization preserving typed details, report interaction/printing, and staff/customer responsive branding. The measured 6.1-second first-side path and 97-ms cached initialization are local fixture measurements, not production latency promises. The prior four-original decoding and Back-geometry proofs remain dated evidence; this release does not claim a new actual-original replay or Mark's optical acceptance.

## Applied schema and native startup

The sealed action is `R/sealed-action-79483f13-1/action.json`, SHA256 `c92d2edee31bc42fd8a2a4243b53bf6137115d7193ba8a281824bc34c89addcd`. Private configuration preparation passed and preserved existing credentials while adding the separate public-read key. The predecessor `b95a7bf5…` exited cleanly and remains stopped and networkless as `atlas-manual-connected-20260917-retained-053768-20260922`; its configuration and earlier retired services are retained.

Normal staff Prisma deployment applied only:

- `20260922010000_manual_early_geometry`, byte-identical to its approved proposal, SHA256 `e9ee058ab782adb5019c817f64901596ded37dd1b66fcccee3c9372ac4a46cd6`.
- `20260922020000_manual_publication`, byte-identical to its approved proposal, SHA256 `907459adea8d2974235ed8c49a1f9b1efaa1e0da7a37cacd3a753223be54e637`.

Exact additive grants and their replay were checked before commit; the second migration deployment was a no-op. Full before/after validation preserved the original 42 staff ledger entries, freshly observed public Inventory ledger, 14 manual histories, 15 controls, existing catalogs, roles and ACLs. All four new tables were empty and all five manual activity counters were zero. Ordinary Inventory data writes were not count-fenced. Schema result `R/schema-evidence-apply-79483f13-1/runner/result.json` has SHA256 `9186b514e0898f77c163317a0138c33deebbb3a4f34ec60ccbd0cca81259a80f`; its eight raw receipts and capped host result `ef00f37b854744b926f40750dfb9d12f3afc14dc6207dd4d4ce85768b307f9ac` passed independent review.

The first startup attempt stopped before creating a startup intent or container: PostgreSQL's default psql search path rendered catalog type/function definitions differently from Prisma's `atlas_staff` path. A fresh read with transaction-local `SET LOCAL search_path = atlas_staff` matched the complete granted schema snapshot exactly; no catalog or ACL field was ignored. Pre-effect reconciliation confirmed the missing intent/result/candidate and unchanged stopped predecessor. Gate 2 changed only that read-only SQL setting and its hash; the frozen action, source, private dispatcher and schema remained unchanged.

The explicitly reviewed second startup passed at 16:41:05 UTC. Receipt `R/private-CREATE_START_NEW-2.receipt.json` has SHA256 `bc1e5d1661f6a0afa9ff10eea128fdacd7eb8a8e85b9aa363bd19327893383ed`; normalized schema read SHA256 is `2c3e257218cbe891d47427205f8746636162c10fc67624803e76138022fa0d4f`, and gate 2 SHA256 is `4790ba843c8ef1cdc5a49d42f14b3044b262547bd8d6e7ede99d39b51fd4fcb4`. The new runtime has one private alias, no OOM, and preserves unrelated containers and Caddy at this startup checkpoint. This receipt explicitly leaves Caddy reload and control rebinding pending.

Consumed phase intents and receipts are history, not retry authorization. A future recovery requires fresh observed state and an explicit reviewed action; do not restart the schema-42 predecessor against schema 44 as an automatic rollback.

## Completed activation and final verification

Caddy validation receipt `188348a74c160879afb79b4563428b2bc7983aa79d7565c3eaada362b927e9f0` and graceful reload receipt `b4b129847474d3d875d411be2e5e07922699401438299bc7ad5a5063bd898e06` verify the exact new route, same Caddy container and inode282983, and unchanged unrelated services. Final Caddyfile SHA256 is `c1fa526768b36985c7f955caf8624520ccea3ab675af6c2a94bdd958f0a1fbda`.

The initial validation checks refused Docker's varying Mounts array order. Actual retained evidence showed every mount object and all other state were identical. Explicitly reviewed reconciliation sorts only complete mount records by unique Destination; no field, permission or other array is ignored. Original failures, intents, helpers and action bytes remain retained.

The five-control transaction receipt `5d36e3865987904806f7ca4f26f2b1be6a174039cb5ed7f00e6cc6ba14866027` verifies Staff23, STAFF SMS21, Customer7, CUSTOMER SMS5 and PublicReader1. PublicMedia remains absent. All unrelated controls, SMS budgets/policies, card and approval histories, roles and migration ledgers are preserved. Eight direct HTTPS checks before admission pass (`80c323b728b72400189499c4da272de7e46bb8446b89e93e38ff625179c407eb`); eight after admission pass (`76278671f98aa2a742c4abe7a8802beebd26d7d2536ed865b7fe6bab3b1b757f`). A signed synthetic nonexistent report returns empty404 after admission; unsigned reads remain denied. These checks do not approve a real card.

The public promotion was attempted once and returned201. All four aliases—atlasgrading.com, www.atlasgrading.com and both generated public aliases—and the production target select `dpl_5jo8bid917wkVWw6SWYHJiA5dng6`. The www redirect remains308 to the apex. The original post-check refused two expected provider metadata changes: aliasAssignedAt advanced and readySubstate changed from STAGED to PROMOTED. Independent review confirmed these were the only deployment-field differences. A fresh GET-only readback preserved actual raw evidence and passed every original promotion check with only those two fields normalized in a comparison clone; no second POST occurred.

Final evidence:

- `R/public-promotion-final-1/verified.json`, SHA256 `c8cf4c150c34292ed9b551a55a86a099acf8051f7154336ab6434a21aa2d3da4`: all aliases/target, domains, environment and upstream preservation.
- `R/host-final-1.json`, SHA256 `641971b93303474eb5a9618c6c8ae53b824877d34dde82e88701ebe26fa2d758`: running627 source files, all16 native artifacts, exact image/container/configuration, restart0/noOOM and retained stopped predecessor.
- `R/final-hosted-readonly-1/result.json`, SHA256 `0c9812cd6b7af99aed4af9c0a01990c68eacdc177c4f5e378f72365c13ab2054`: ten actual GET checks covering the public/staff/customer pages, missing-report404 and exact frozen logo/font assets in all three zones.
- Actual CUA browser inspection verifies complete rendered staff and customer sign-in pages with the new ATLAS branding. No sign-in code was sent and no production card was approved. Ordinary SMS and signed-in real-card acceptance are not inferred from page rendering.

The shared Inventory mutation window was explicitly released after verification. Remaining repository work is documentation only; consumed actions are not reusable authorization.

## Remaining owner acceptance

Mark's ordinary signed-in saved/new-card workflow, image/geometry quality and final report experience remain separate human acceptance. Physical certificate, label and NFC integration remains unfinished as described below.

## Physical certificate and NFC boundary

Stable report numbering and browser print/save PDF do not issue a physical certificate, slab label or NFC credential, or record label printing, tag programming, assembly or welding. The legacy `StaffFinishing` path requires `StaffSpecimen`, `StaffReportApproval`, `StaffPublicReport` and V1 packets; it cannot consume a manual publication without an explicit approval/version/hash-bound adapter and version-correct label projection. Certificate issuer policy remains an owner decision and must not be inferred from Ten Kings permanent-card authority.

The selected Mac/ACR1552U/F8215 workflow still needs a qualified production writer/permanent-lock proof, protected signing/pairing, hosted acknowledgement/recovery and the bounded armed finishing session. Earlier diagnostic tag writes are not production-card finishing acceptance. See [the report boundary](../../plans/ATLAS_REPORT_EXPERIENCE_20260922.md#certificate-label-and-nfc-boundary) and [Mac NFC status](../../MAC_NFC.md).
