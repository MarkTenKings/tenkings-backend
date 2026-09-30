# One-time ATLAS test-card reset — 2026-09-30

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
