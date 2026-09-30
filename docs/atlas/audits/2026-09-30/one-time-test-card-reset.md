# One-time ATLAS test-card reset — 2026-09-30

## Subsequent staff discard guard release

The private reviewer-discard API now blocks deletion of a card with saved grading/review evidence, approval, publication or customer/finishing obligations. A truly ungraded active intake card may still be discarded. This is a server-side guard, with no permanent owner delete control. Source `3919369b3b9ef85baa953663bf24070b5dc2c1c5` is serving in image `sha256:6884e70ae0e129a779f9124253794c0d3057e3540e34882004481bd1b3f7bc44`, container `316fa50b62fca49379774176b0aca35998ee2fac8958ffc85b70035b4d1bd18c`. Qualification passed 1,463 Node and 43 Python tests with zero failures/skips, plus 11 disposable PostgreSQL checks. Private readiness, signed TLS 401/404/200 probes, canonical public checks and independent database preservation passed. No additional card retirement or physical deletion occurred. The existing staff Delete button may still appear for a graded card; the API rejects the attempt with 409.

Release evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-delete-guard-20260930`. Cutover receipt SHA-256 `69d89583f1af18c6c0417a1836222de904062412fe0feb8661bd68629c51ec31`; ready `e4f6623daa83c86ba6f238c57689b50224ed5b82a8e95df14a09f49c6b7eb7d2`; post-cutover database preservation `27eb6e4502ae4735884c9dd3bea6aa3d4d33963634cbc48418bf2ff85d46256b`; signed private probes `40605ff94b8f3297aa977c792fa5e09f36911129ff602e80eba14a4fa3953f38`; public postflight `10f77d65c559c3a50ad2daaf1106b57ca37cec2e12d9ea86f0952dd071bf5780`. The reset evidence and state described below were verified before this private-only release and remain valid on read-only postflight.

## Verified current state

- Public source `32caa582fd58f69346baa1fff167d9c23ee70337` and deployment `dpl_Ho28FUJDKT3PgaacSa7b7t9Dn8ZS` serve all four public aliases. PublicReader is revision 33. Homepage release `4cdbbf3d2b33f301` has zero featured cards; all 55 removed static test-card, Alakazam and marketing paths returned 404.
- The owner-authorized one-shot retirement cleared 51 active manual-intake cards. Read-only database postflight found 80 total server cards, zero active, 80 server-card tombstones, 85 total tombstones and three receipts. A full-row CAS of three legacy cohort controls left all six old records retained and zero cards visible in the selected cohort. Four immutable publication rows remain, but zero reports satisfy the live public visibility predicate.
- Final read-only canonical checks found 404 for all four old dynamic report URLs and tested old dynamic image endpoints, with the homepage still 200. The first Drake Maye read briefly returned 503; independent repeats returned 404. No retry of the reset transaction occurred.
- Historical grades, grading actions, approvals, publications, original uploads, photos and accounting remain retained. Staff deployment `dpl_9nBoH4R6E8Z6RJb26hKpaR8dKRw5`, Staff 51 / STAFF SMS 49, private source `81efc8ae4228b99e520cea72b536936a1fad8af2`, private image/container, customer 15/13 and scoring rule `ATLAS_2026_09_30_DAMAGE_1_5_V1` did not change. No Set Ops operation or migration occurred.

Future approved individual `/reports/[token]` links can appear through normal publication. Featuring an approved card on the static homepage requires a separate site update. Older immutable provider deployments and caches may retain historical bytes outside current canonical routes. Unsynced device-only drafts require ordinary device reconciliation.

## Evidence

Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-reset-20260930`.

- `postflight-32c/public-postflight-before-reset.json`: SHA-256 `f4ea835a0ad04db9701baf895349c1fec31ea0fd48938ac245dd55f9dd589d35`; canonical homepage and 55 removed paths after public promotion, before data retirement. A later optional provider GET returned 403; immediate promotion readback and canonical checks passed.
- `delete-dryrun-specialist/postflight-1.receipt.json`: SHA-256 `14fb89718c2a840f48db1f71b85a9984350e0637e678350cacd5e42be328f4f6`; independent read-only database postflight after exact-request commit reconciliation.
- `postflight-32c/public-post-reset-readonly.json`: SHA-256 `4ff91482c4b40c135dbd09d458a7ef5b8530bcc8667513117d2d467b40e8730d`; independent final read-only public checks at 20:03:24 UTC, including all four report 404s, homepage release, PublicReader revision 33 and no provider/database writes.
- `docs/handoffs/SESSION_LOG.md` records planned actions, one-shot execution, reconciliation and observed results. Consumed mutation intents must not be replayed.
