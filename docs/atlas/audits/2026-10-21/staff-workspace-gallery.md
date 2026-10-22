# Staff original-photo workspace gallery

The login destination `/admin/grading` aliases ManualCards. Its intake query reads the authenticated staff principal's assigned cards, excludes discarded records, sorts newest upload first and pages 30 records. It includes unfinished and completed reviews. It does not establish legal ownership or list all site inventory.

## Implemented and locally verified

The heading is **Your grading workspace**, with an explicit scope explanation. A white, emerald gallery replaces the monogram tiles. Each card uses the complete human-uploaded Front frame in a bounded display preview; no generated slab, background replacement or grading crop is used. Current saved approval, draft, changed review, changed photos and unrecorded status remain distinct. Missing photos have an honest placeholder; failures can retry. Cards and original photos open the existing card workflow. Pagination, reviewer Add cards and upload recovery remain. Existing bulk deletion is under Manage cards; no deletion was invoked.

The preview reads the retained decoded original frame, verifies its source/upload/hash/dimensions, resizes inside 768 pixels and returns a JPEG under 768 KiB. This is an uncropped display derivative, not original bytes or grading evidence. Both the list and gallery replies bind the current staff ID. SELECT snapshots refresh authorization, check intake/manual ACL and source/current-approval bindings, and never initialize missing details. Preview generation rechecks access after queue waits and before returning. Client cleanup aborts work and revokes object URLs on account/access/page changes. New routes are GET-only, private no-store and strictly bound; both retained gateway matchers already admit them, so no gateway delta is needed.

The isolated release source is `c18151157aeddc0b98ebf83f8045e4c75837a6b7`, an exact child of public report-fix source105270bc. It contains11serving and10qualification changes, excludes ownership/collection/curation proposals, and changes no migration, dependency or lockfile. This exact source is now technically deployed on native, staff and public. Real signed-in gallery acceptance remains pending a fresh staff session at the checkpoint below.

## Evidence

- Full staff suite859/859 passes. The added final online-reconnect regression subsequently passes with the other five ManualCards scope/race tests. Existing recovery73 and defect-workspace69 checks pass. Initial failures came from harness component imports and an inaccurate useCallback mock; corrected harnesses retain original assertions.
- Connected/intake suite1001 passes with2 existing native-measurement environment skips. Gallery media checks include the real native HEIF decoder; its ignored local helper build is recorded separately.
- Final staff production build and explicit boundary pass:35browser chunks,15server traces,2030traced files. Pre-existing unrelated warnings remain. The later change only adds a regression test.
- Six actual owned PostgreSQL17 groups pass: real staff/list owner scope, snapshot status/current approval, absent details without INSERT, source replacement409, ACL and revoked-session denial. Seventeen-table censuses remain unchanged around reads. Exact cluster shutdown reports stoppedVerified:true.
- Actual-component local browser checks pass at1440/1024/390/320px, with4/3/2/2columns and no horizontal overflow. Full-frame photo, retry, missing/loading, source-change clearing, foreign-account denial,30→36pagination, account replacement, keyboard navigation and actual Shell sign-out cleanup pass. After sign-out33created blob URLs are33revoked; peak reads2. The fixture repeats one existing Cubone camera photo across synthetic IDs/statuses with inert navigation/auth; it is not production inventory or physical-device acceptance. The temporary server was stopped and viewport override reset.
- Offline exact gateway-regex plus actual handler checks pass; no live gateway reload or Caddy-runtime check is claimed. Independent integration review found no remaining regression.

Private evidence: `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-gallery-20261021/qualification-01/evidence.json`, source-01, browser-01 and gateways-01. Actual PostgreSQL receipt is under `atlas-detail-release-20261021/qualification/gallery-snapshot-pg-01`. Evidence receipts and failed historical qualification attempts remain intact. Native/web release qualification is complete; signed-in real-card gallery acceptance remains required.


## Technical production release — October 21 Pacific / October 22 UTC

Source `c18151157aeddc0b98ebf83f8045e4c75837a6b7` is live on native, staff and public. This release includes the existing archive/detail/report-return behavior and excludes local ownership, collection and comp-curation proposals.

| Surface | Released identity |
|---|---|
| Native image | `sha256:2741bf9d65fe0a76744920ce40b8176bdb03533f16892150359c71153c8bce25` |
| Main | `d1db3d9b2a490328694e1a17be2bcd54faa4b169e2875fce4bff2b6f3cbd6ba2`, `atlas-gallery-main-c1815115-02` |
| Worker | `a3f7aee69213118d819048417260bd39238b0299c0ef7587f72f90c0875ef569`, `atlas-gallery-worker-c1815115-02` |
| Staff | `dpl_CnDnsjJmd8Mf47xkFGJR9YRtvcpF`, `atlas-grading-staff-of9nqp28d-ten-kings.vercel.app` |
| Public | `dpl_As3boP14tGmpmM86ZcZ5sQiou79X`, `atlas-grading-public-a4pcb3nuo-ten-kings.vercel.app` |
| Customer retained | Source `c68e9ea7`, `dpl_2aW7K6CTUftYNKaWanBouvgUaDS5` |
| Controls | Staff138 / Public100 / STAFF SMS106; Customer83 / CUSTOMER SMS35 retained |
| Schema | Existing SQL009 retained, checksum `5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b`; no migration |

Both gateway configurations, all project environments and the customer release remain unchanged. Native processes have zero restarts and sealed `unless-stopped` policies. Old ca3 processes remain stopped with exit0, restart policy `no`, and detached endpoints. They must not be restarted.

The clean native build passed434 Linux Node22 tests with no skips; collect receipt `dc73b246957947cd1a56b2b6d05cd8a6bc6b70ad6e05576b8042b0a08c479678`. Exact source/build/served qualification passed for staff (`41b1b1aa10f30195c1baf56b05b6c557bfc53e520c610c34e2a7a8d043688a59`) and public (`5bc8bceadff06dc4301f392e2239c5d3224598628debc5d259b5b53bb22a2429`). Seven real owned PostgreSQL control groups passed, including observed blocking, CAS/rollback/stale/replay and preservation; result `054b4411d305ee26cedde3cca27ebe40e0f3450105268614391b946bbf64181d`, exact cluster shutdown verified.

Activation01 staged only. Its holder observed stdin EOF immediately after acquiring and rolled back; exact absence was verified, with no cutover/control/promotion effect. A separately prepared and independently reviewed activation02 used a persistent terminal and fresh one-use plans. One post-quiesce read lost its DB connection before creating any control intent; a fresh unchanged read passed after independent same-holder verification. Exactly three controls were updated once. Staff promotion returned201 once; one alias propagated later, so GET-only reconciliation/finalization completed without a second promotion. Public promotion returned201 once. No consumed action was replayed.

Old main stopped at00:37:34.763UTC; replacement readiness was verified at00:45:42.240UTC, a native readiness gap of **8m07s**. Canonical technical verification completed at00:52:51.384UTC. These are observed checkpoint bounds, not a continuous HTTP downtime measurement. The new deployment binding invalidated the previous staff session. This was not a zero-interruption release.

Final evidence under `/Users/markthomas/.codex/atlas-handoffs/atlas-staff-gallery-20261021/`:

| Receipt | Result / SHA256 |
|---|---|
| `publication-02/staff-result.json` | PASS `2afbad3cef0ca45f7f19aebb2e6c676c9a5bee0d7a76efc11af1c14d3150480e` |
| `publication-02/public-result.json` | PASS `cae064b8d37ea5bdca14ebbd56cf50c0270386326f9234db0d7129a87ffed1e5` |
| `acceptance-02/technical-result.json` | 31 checks PASS `ac104069a6ccff2f64d9a7fab0de5a24246d9c1fcf636d033852bb505ebbfb09` |
| `acceptance-02/reports-result.json` | 4 reports / 8 original image hashes PASS `bc43ef95f3b67db5d7374f73ee516ce084946d2553b59d777b7e9d219f28077f` |
| Native postflight | PASS `59740220cfa80fbd0d3f47e514d1f03cade24a2e984f64d71a7c7a8795901ebf` |
| Final preservation | 37 business tables/schema/provider/label/customer preserved `0f4503e0c2da04cc1babb0edfe27013390b978171b1cbc033a6224c9e7a852cd` |
| `admission-02/released.json` | EXPLICIT_RELEASE at00:54:31.820UTC; byte hash `0af2d7042cb782cbd4f7c4997ed3293d32e11173aead02f17bd10331d1c6ef5b` |
| Exact holder absence | PASS `6dc6b36ee36b6b4b435f5bd50c93b7d4bc7d093cd7bfff1b849fd618266d5396` |

No business writes, paid provider searches, grading approvals, printing, tag writes, notifications or financial operations were used for acceptance. Actual Chrome returned ordinary staff sign-in; the owner has been asked to sign in again. Real gallery photo/state/navigation acceptance, owner visual acceptance and physical phone acceptance remain separate. No admission holder remains while waiting. Retain all release packets as evidence; future changes require fresh observed plans.
