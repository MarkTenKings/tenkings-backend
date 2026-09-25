# Workspace deletion and safe diagnostics release

**LIVE; software release and the authorized fixed server cleanup are verified. Actual iPhone-local cleanup remains unobserved.** Application source `b013a4f13e582f6159ec214f18230aa446d26eea` is deployed on staff, customer, public and private services. Public promotion readback passed at **08:40:46.778 UTC**, canonical read-only checks passed **61/61 at 08:42:52.073 UTC**, and final post-promotion preservation passed **08:43:18.720379 UTC** on September 25, 2026.

## Deployed identities and preservation

| Surface | Verified identity |
|---|---|
| Staff | `dpl_5CC8EzCJ7PgDvM6YF6C2KKiq8CNU` — [atlas-grading-staff-ovis4q938-ten-kings.vercel.app](https://atlas-grading-staff-ovis4q938-ten-kings.vercel.app) |
| Customer | `dpl_32TARCjDG75sFuQw3uY7VWqvL5Xe` — [atlas-grading-customer-ccr53lm0u-ten-kings.vercel.app](https://atlas-grading-customer-ccr53lm0u-ten-kings.vercel.app) |
| Public, all four aliases | `dpl_6s17NYmG1gJ3e96rAvzEQjT8x88k` — [atlas-grading-public-bxc9cnokj-ten-kings.vercel.app](https://atlas-grading-public-bxc9cnokj-ten-kings.vercel.app) |
| Private | Container `a59b818c5150f48127454cf8632c6b5144d5c89050398a8c98ddcf472b436431`, image `sha256:1d3e4cb1fccfae6eb98e98bfac54baa4b2292002e4b154fc54b03f7b8a09024a` |

The private container started at `2026-09-25T08:39:38.762578648Z`; final readback recorded zero restarts. Protected configuration is `/opt/atlas/workspace-delete-20260925/private.env`, SHA-256 `309f8d2d805f221819f0411e3889c9a5d80f04e411647e19d74733bb85bebe09`. Staff configuration hash is `66dccf9a94147ead6785ea4f0d75fc0e6efc5bbcb4e7c839762950f5943557d9`. The immediate predecessor remains stopped and disconnected as `atlas-manual-connected-20260917-retained-47dff-workspace-delete-b013a4f1`, container `92ab04be4dcc3ea9636c9725c78db6b611ca87738505edfabe3b9c4f40e09d3b`. Its [design release audit](design-iteration-release.md) remains historical evidence.

Only additive staff migration 53, `20260925080000_manual_workspace_discard`, and the reviewed narrow manual-role grants were applied. The 52 predecessor staff entries and 112 public ledger entries remain intact. The public ledger consists of 99 finished, unrolled entries and 13 historical rolled-back entries; it is not 112 clean applied migrations. Migration SQL SHA-256 is `324f839e0596ec0151fff150e7bd8fd9e1960d9b5f2936903b77fc9254a99b2e`; grants SHA-256 is `c09630e0f6ad8aafa40350e9948226a9afa1f0678a3a2b6ffb5521052e2d77b4`. The added grants permit SELECT/INSERT on two immutable discard tables, schema USAGE and SELECT on four obligation tables for the existing manual role. They grant no new staff-role rights, ownership, CREATE, UPDATE/DELETE or arbitrary execution authority. The unchanged old/new manual-auth boundary and actual authenticated-role PostgreSQL checks qualified compatibility with the added grants; the earlier hypothetical exact-audit incompatibility was not established.

The initial post-migration check encountered one active customer transaction after Prisma had already succeeded. The original successful process receipt was retained; a fresh read-only idle/catalog/history reconciliation established the result without replaying the migration. This hold is not concealed as an uninterrupted first pass.

The six release-binding rows now read Staff 33 / STAFF SMS 31 / PublicReader 11 / Customer 13 / CUSTOMER SMS 11 plus the existing enabled customer-service binding. Final preservation accounted for 30 grading-history tables and 21 customer tables, allowing only the separately verified migration/grants and binding changes. Both discard tables were still empty at that checkpoint. Caddy, unrelated containers and existing feature policy were preserved. Customer intake/identification remain enabled; commerce, dealer operations and physical station remain disabled.

## Delivered behavior

Delete and Delete all retire owner-scoped cards from the active workspace through immutable owner/create-request tombstones. The receipt freezes the selected snapshot, so retrying an ALL request cannot include later cards. Local-only create IDs are covered; old journals and stale create requests cannot recreate retired cards. Server reads and future upload/work admissions/adoptions are fenced across intake, batch, analysis, research, presentation/publication, station and dealer paths. Published/customer-linked/active-station obligations refuse this workspace deletion.

Original objects, past grades, accepted model receipts and accounting history remain retained. Deletion cannot unsend an already admitted provider request; accepted-result collection remains available. Deleted queued or expired geometry jobs become terminal without adopting a result. A live CPU lease remains until its matching worker finishes or the lease expires. This release does not purge original images or rewrite historical states to pretend grading succeeded.

The browser persists a delete intent and pauses new processing, then removes matching local journal records/bytes only after a confirmed server receipt/status. Late writes cannot resurrect retired records. Mount/online reconciliation handles deletion acknowledged on another device. These software paths passed synthetic browser/native-database checks; physical-iPhone cleanup is not established by those tests.

Unexpected API failures now receive an opaque reference and allowlisted route/phase, error class, Prisma/SQLSTATE, elapsed time and release context. Client diagnostics retain approved fields. No raw error message/stack, SQL/body/URL, cookie, credential or image enters this logging. Existing authorization rules and timeouts remain unchanged. This supplies evidence for subsequent failures; it does not identify or repair the exact historical 503 exception.

## Verification and limits

| Scope | Recorded result | Limit |
|---|---|---|
| Final web source | 748/748 frontend tests; three production builds | Software qualification, not owner-device acceptance |
| Backend | 160 focused tests; 10 actual PostgreSQL scenario groups | Synthetic records and isolated fixtures |
| Schema 52→53 and grants | 3 positive / 26 refusal checks against actual owned PostgreSQL snapshots | Production result separately reconciled and preserved |
| Frozen cleanup SQL | Initial five checks retained; corrected ledger fence passed six owned PostgreSQL checks | Synthetic exact 99+13 ledger shape; no production cleanup implied |
| Exact native image | 197-test coverage across two isolated runs | First run: 196 passes / one environment skip retained as FAILED zero-skip gate; only that test rerun with inherited engine path |
| Native custody | 906 source files / 16 native artifacts preserved | No native recompilation, new original-photo replay or repeated 585-test suite |
| Signed private TLS | 3/3 at 08:40:02.427 UTC | No owner session/card actions; 401 session denial, 404 unknown report, 200 directory |
| Canonical production | 61/61 at 08:42:52.073 UTC | Anonymous read-only HTTP/assets; no JavaScript execution or authenticated processing |
| Final preservation | PASS at 08:43:18.720379 UTC | 30 grading histories / 21 customer tables; discard tables empty before cleanup |

Two earlier canonical probe holds, `SIGN_IN_REDIRECT_REQUIRED` and `RESPONSE_CAP`, remain retained. The final probe matched the exact READY staff assets and passed 61 checks. Those probe holds are not evidence that the historical authenticated 503 defect was reproduced or fixed.

The current batch worker capacity remains two; 50 is a batch-request limit. Complete server-owned processing after both originals are verified, automatic recovery of every READY receipt into later stages, and 10–20-card one-card-latency capacity are **not implemented or measured by this release**. Required identity/geometry review and human final approval remain. See the [evidence-backed investigation and proposed capacity plan](rapid-capture-root-cause-investigation.md). No new paid grading, physical print/NFC, dealer/commerce activation or real completed-card acceptance is claimed.

## Authorized cleanup — committed and reconciled

The fixed cleanup committed at **08:53:18.980196 UTC** on September 25, 2026, with receipt time **08:53:15.975 UTC**. It inserted exactly **one immutable request and 33 tombstones**, retiring **28 server cards and five diagnosed local-only create IDs**. Psql exited 0 without stderr. The transaction's owner/scope/idle/obligation checks passed, and all **120 pre-existing ATLAS-table/ledger fingerprints** were preserved. Original photos, historical grades and accepted provider/accounting records remain retained; no source objects were purged.

Read-only reconciliation at **08:53:41.191041 UTC** recovered the exact committed receipt. A separate read-only census at **08:53:55.712473 UTC** found **zero active workspace cards**, with all 28 intake rows retained, 28 retired server cards, five retired local-only creates, 33 tombstones and one receipt. This is server workspace retirement; actual local byte removal on the owner's iPhone has not been observed.

The first cleanup attempt was refused before insertion: psql exited 3 / SQLSTATE `P0001`, and read-only reconciliation at **08:45:33.373999 UTC** returned `NOT_COMMITTED`. Root identified an incorrect maintenance-helper assertion requiring all 112 public ledger entries to be clean; the actual preserved ledger has 99 clean entries and 13 historical rollbacks. The application Delete/Delete all paths do not contain that maintenance assertion. The first helper/seal, intent, process result and reconciliation remain retained.

The narrowly corrected helper passed six owned PostgreSQL checks, including refusal when a historical checksum or log hash changes despite unchanged 99+13 counts; its fixture stopped cleanly. The successful second attempt used the **same request UUID and exact scope**, after a fresh matching impact at **08:52:29.144934 UTC** and repeated locked checks. Both executed and reconciled receipts match. No migration ledger entry was repaired or rewritten, and no new ALL sweep, queue wake or model request was used. Consumed cleanup intents must not be replayed.

## Owner-device acceptance still open

The same iPhone's local reconciliation and byte removal have not been observed. With the server receipt now established, ordinary login/mount/online reconciliation should acknowledge retired IDs without clearing all site data or recreating cards. Keep any unresolved local originals intact. A new explicitly paired Front/Back capture, its upload/preparation states and any safe failure reference need separate real-device observation; this documentation does not initiate a new capture cohort or paid grading request.

## Evidence custody

The [sanitized release summary](../../../../validation/atlas-workspace-delete-20260925/sanitized-release-summary.json) contains safe identities, counts, separate release/cleanup outcomes and receipt hashes. Private evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-workspace-delete-20260925`. The following files were read locally for this audit; raw card/create/request identifiers, original images, diagnostic exports, environment values and database/provider payloads remain outside Git.

| Private receipt path, relative to evidence root | SHA-256 |
|---|---|
| `web-release/build/qualification.json` | `1101225386a8a6bf615b773ac9c52a74f6eaa83c2452eaabbec8ef43c292d937` |
| `web-release/native-qualification-b013a4f1.json` | `33322f995d774540b9caad8a53958cb3cee1f9590b8617a966659b8804ac5566` |
| `web-release/staff-b013-ready.json` | `4573f5b3ab29aca84321b850e93d1c8460b57434efba4a3acb7d9e9f3046d2b3` |
| `web-release/customer-b013-ready.json` | `184c2b52ba8434e0517d3f4f6e35f490d6040cf1bbcc0f92fd8265592c5114c4` |
| `web-release/public-b013-ready.json` | `a4197af8e4ba11ea855d13ff1b5fd6a5e5715d3585e95ae7b957094329731489` |
| `web-release/public-promotion-b013/result.json` | `954325acc1a65f07de37e1da67755a4ad5370024053a1b5227f151635df7fc45` |
| `runtime/host-readback/derive-result.json` | `0f44cd27d5eec05a4f5aa5b3696178173d4a1a3b695a12a3107606b27ff8c97c` |
| `migration-plan/reconciliation-result.json` | `b903025e1546ce298e1a28734c2e387c893d28e2e8ee7acce9a20d4afc779330` |
| `migration-plan/owned-qualification-1/verifier-result-v2.json` | `b96d1d4b6ed39dce9b33d76a19f9b1df7c7afed68511c57c39b6ed27d9349e92` |
| `discard-postgres-reaper/result.json` | `4b8f2592fbeafd13d519ae3576b395f4d05249100ef2e5ae1635fe6b694af9cb` |
| `cleanup/owned-sql-qualification.json` | `b206b2f811466be036d4278cd408d0fe0cda56f867e14a1152f3113394e49cba` |
| `probes/signed-private-workspace-delete-1/result.json` | `e3d1bdcfd667ee62f0d2c6024f2c1fa11ccb5aeaaa5ce26ed59f373725c690d8` |
| `probes/canonical-1/failure.json` | `02cfd21c57b0e7e2a99724e471eb3bfdfe2cee60d440714cc2ad9e62c54b4eb7` |
| `probes/canonical-2/failure.json` | `9db08351db56e1626167bb4780bda8e3887b8a67299ded8ac53da80a9f88bd7e` |
| `probes/canonical-3/result.json` | `24380594dcb4b92c7e8e59d26030796249f683eac7becc06293b132d77b36168` |
| `runtime/host-readback/post-promotion-result.json` | `e3d06347fe456b8cf2e0cd1a750b43f43843eda3c49dbd9d13b344268ced713c` |
| `runtime/host-readback/post-promotion-readonly.json` | `9927666ed4ff0b2c9282f3242006d06cdf644c71c2a0091aa622b75d3abb1b5b` |
| `runtime/host-readback/migration-process.json` | `f34a1c448460e5fc4c923c730d4cb93ae57c66f601b43bf902b574e8c6ccc8a6` |
| `runtime/host-readback/migration-result.json` | `c7a00ab3a57db631f7e8cdf435951db447f5c81639582433a549fb4cd629c242` |
| `runtime/host-readback/schema53-result.json` | `4ab90bc5e14919a9cff9cdf13b4a488caa9ebffc1aa06492009c2352005ba687` |
| `runtime/host-readback/constructor-result.json` | `76fce9d4add321cffefadffcf6f26b073fc37b5596a2ec0b8bde388e93217630` |
| `runtime/host-readback/controls-result.json` | `f4a385c810249b02109eb28e502d270cebceda300c75c7519c70b23bf48b9b09` |
| `runtime/host-readback/cutover-result.json` | `571e870c66e3dc152b47a30084eda8949d029d141b111d2f2bce8e8fe454ad45` |
| `runtime/host-readback/post-cutover-result.json` | `74557ea86e1a9f42d6e8f167af4b30da7a2fc51d4a5d6e6dc162c71363a7bd7d` |
| `cleanup/execute-1.json` | `842415649f80966159657c5384e2070d0c0bee94da0a53cbfbda7a54b41404eb` |
| `cleanup/reconcile-1.json` | `1ff3a24e7148ba08316d781c390a280e256bd3f727eb2f6b2418026f063675ac` |
| `cleanup/owned-sql-v2-qualification.json` | `9765db18dc601d16fb601dfa434bdb9258dd47fd80cda4efd4035e283c939b96` |
| `cleanup/owned-sql-v2-cleanup.json` | `0c4ab959abc4036387969865a4066e4a46f4a75b1d4f433b661654b58b9cf8a8` |
| `cleanup/review-seal.json` | `ebeedfb4e9bc5660a470eb21a6829af540560e7f986a16ba47c53895b5e3a464` |
| `cleanup/final-impact-2.json` | `f8eb31545a5efe3552e94d276b4070d96c4d1f432f1681e8690095bd51a41376` |
| `cleanup/execute-2.json` | `8079466516eec0d8a34f557060aebc5af36e776f87a9be34b4907950130b4459` |
| `cleanup/reconcile-2.json` | `2fdb40d7b9843fd828380267dd8b2e6337f2c5ec3baf0036621754aeec6bfef1` |
| `cleanup/active-counts-result.json` | `1e06e4546c698ceb9a8ce9fad21a2f68d91cd9079352b1dd104925e95fd47547` |

Application source remains b013a4f1 after documentation edits. Release and cleanup intents are separate; consumed effects must not be replayed. Ten Kings and Set Ops behavior are unchanged.
