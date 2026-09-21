# Big Kahuna additive preparation service — review candidate

Prepared 2026-09-17; subsequently verified with offline fixtures and one explicitly authorized, owned local disposable PostgreSQL run. No production database transaction, artifact upload, import, approval, publication, provider call or grant was performed. The existing proposal, source PDFs, transcription, reconciliation and catalog history are unchanged. This note does not authorize activation.

## Bounded service contract

`frontend/nextjs-app/lib/server/setCatalogSportsPreparation.ts` exports `createSportsCatalogPreparationService({ db, readArtifact? })`, with `preview(actor)` and `stage(input, actor)`. Server composition supplies both dependencies; a request cannot supply a database, byte reader, SQL, URL, recipe or replacement roster. The fixed adjacent JSON plan carries the exact earlier eight-create proposal, pinned source metadata and real existing IDs. The implementation is a single-pilot path, without a generic taxonomy writer.

Both methods require the existing catalog feature gate and a current human SetOps reviewer. The source PDFs are read through the catalog artifact reader and verified by exact size/SHA-256 **before** any transaction or lock. Missing source artifacts fail closed; this service does not fetch or upload them. The checklist pin is `bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca` (529,104 bytes), and the odds pin is `72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5` (265,208 bytes).

Preview returns an unreviewed snapshot digest and fixed proposed counts. Stage accepts only:

```json
{
  "schemaVersion": "setops-sports-additive-preparation-request/v1",
  "idempotencyKey": "<caller-generated UUID retained for retries>",
  "expectedSnapshotSha256": "<fresh preview digest>",
  "proposalSha256": "4484129eabafbad247c8be01bde777b389ee2071cc28e64de4834e1b8796db04",
  "acknowledgement": "PREPARE PENDING SPORTS CATALOG MAPPINGS"
}
```

Stage creates **ten data rows plus one receipt audit** atomically: two isolated source jobs, two taxonomy sources, three parallels and three scopes. Sources always reference the newly created non-null job IDs; parallel/scope sources reference the new exact odds source. No card, program, draft, draft version, variation, odds, bridge, image, approval, applicability or publication write exists. Unknown applicability is retained in the receipt for all nine selected card/printing pairs; it is not inserted as inferred evidence.

## Actual lifecycle, not a new status enum

The schema has no `PENDING` ingestion status. Each new job uses `REVIEW_REQUIRED`, `draftId: null`, parser version `catalog-sports-additive-preparation/v1`, `parsedAt: null` and `reviewedAt: null`. Metadata is explicitly unreviewed, with no rights verification. The raw payload records source pins and the preparation request hash; it does not contain legacy rows/programs/odds.

`taxonomyV2Core.ts` legacy publication filters accept a null source job or an approved source job. Therefore each prepared source is bound to a real non-approved job in the same transaction. `approval.ts` only bulk-approves jobs attached to its draft; the null draft binding keeps these jobs outside that operation. This service has no approval method.

The descriptive `genericDraftBuildAllowed: false` metadata is **not** an enforced guard. Before the parent task's separate handler correction, `drafts/build.ts` ignores it: the checklist job fails the original-input check; the odds job reaches normalization, produces zero rows, and the quality-rejection branch can bind it to the existing draft and mark it `FAILED`. The service tests' zero-row/quality assertions do not prove handler immutability. Activation requires the separate actual Build Draft handler to reject the exact parser marker before draft resolution or any mutation, with its actual-handler regression test passing. The parent owns that correction and its actual-handler validation; service-only fixtures do not substitute for it.

The schema's `SetTaxonomySource.ingestionJobId` foreign key uses `ON DELETE SET NULL`. The service never deletes jobs and never creates a null source binding. Its guarantee is transactional preparation, not immunity to later unsupported direct deletion. Existing whole-set removal removes sources before jobs; direct job-only SQL/deletion remains outside this preparation lifecycle. Receipt replay detects missing/changed prepared rows and refuses to repair or promote them.

## Fresh snapshot and preserved identities

The exact set is `2023_Bowman_University_Chrome_Football`, approved draft `2e8b2265-edcb-4910-922f-40a6e926ac38`, latest version `52de475c-ee6a-4abf-b148-fffde0ec93af` and version hash `48314036838b6a481e87633c1b659541ca0a158ae91d7145e675fc5fb8292a1b`.

Every preview and initial stage reads count-accounted, ID-ordered card, program, version, source, parallel, scope and ingestion-job metadata. Each list has a 1,001-row sentinel cap; reaching it, a count mismatch or duplicate IDs aborts. Sorted identity digests must retain exactly **379 card IDs, ten program IDs and six version IDs**. The exact existing Big Kahuna program and three selected card IDs/numbers/names must agree. A changed latest version, archived/unapproved draft, existing catalog publication, active seed or replacement blocks preparation.

An occupied exact source URL, parallel key/normalized label, or scope key/tuple aborts; no existing source is reclassified, silently reused or upserted. The stage digest must equal the preview digest. After creates, the service verifies every created field and rereads metadata; removing only its new IDs must reproduce the original metadata digest. Existing raw version payloads and private source payloads are not read or copied. The no-write guarantee follows the narrow delegate calls; metadata digests do not pretend to hash unread history bytes.

## Locking, time bounds and cross-writer limits

Preview uses a read-only Repeatable Read transaction, Prisma `maxWait: 1000`, `timeout: 8000`, and a 3-second statement timeout. Stage uses Read Committed so its first snapshot sees writes committed while lock acquisition was pending. Inside that transaction it issues, in order:

```sql
SET LOCAL lock_timeout = '750ms';
SET LOCAL statement_timeout = '3s';
LOCK TABLE "SetTaxonomySource", "SetParallel", "SetParallelScope"
  IN SHARE ROW EXCLUSIVE MODE;
SELECT id FROM "SetDraft" WHERE id = <exact existing draft ID> FOR UPDATE;
```

The stage also uses Prisma `maxWait: 1000`, `timeout: 8000`. No source storage/network work runs under these locks. There is no automatic retry of a timeout, deadlock, serialization failure or unknown outcome.

The three table locks serialize competing source/parallel/scope mutations even when their writers do not honor an application advisory lock. This closes the exact-source-URL race despite the absence of a source-URL uniqueness constraint. Locks cover those tables across sets, not only this set; ordinary reads remain compatible. They do not lock inventory, research, queue or worker tables. The exact draft row lock protects normal draft changes and conflicting version foreign-key acquisition while held.

Ordering is not universal. Ordinary taxonomy ingestion starts with its source and then parallel/scope writes, but legacy operations may acquire a draft before taxonomy writes, and whole-set removal deletes scopes before sources. Our table-then-draft order can conflict with those paths. The service fails fast and rolls back; it does not promise contention-free operation. The authorized isolated PostgreSQL run below verified actual ordinary-write lock conflicts on all three target tables, rollback and foreign-key bindings. It did not exercise every legacy inverse-order writer or establish contention-free production behavior.

Direct maintenance such as `scripts/populate-set-cards.ts` can write card/program rows without first touching a locked table. The before/after metadata check detects changes visible during its reads, but cannot exclude a direct write that commits just after the final check. A documented operator window excluding that maintenance and any replacement/import is required for this one-off preparation; these three locks must not be represented as universal serialization of every historical writer. Expanding table locks would need separate impact review. The actual API remains unavailable for use until the parent task reviews composition, the Build Draft guard, this limitation and runtime qualification.

## Retry receipt

The request digest includes the exact request and human actor ID. The audit primary key is deterministic: `sports-catalog-preparation:<idempotencyKey>`. Action `set_ops.catalog.sports_preparation` is covered by the existing append-only catalog audit trigger. The receipt records the input baseline, fixed proposal, ten distinct created IDs, exact created-field digest and nine unknown relations.

These private preparation digests use a local sorted-key JSON encoding with finite JSON numbers. Source metadata contains literal fractional PDF coordinates, so the shared catalog manifest canonicalizer (which deliberately permits only integer numbers) is unsuitable for this metadata. Coordinates stay unchanged. This receipt encoding does not replace or alter catalog manifest hashes, verification hashes or legacy version hashes.

With the same request/actor, a retry after an uncertain commit verifies the stored receipt and every owned created field, then returns `outcome: replay`. A new key cannot duplicate an occupied cohort. Changed evidence, actor, baseline, receipt bindings or job/source/printing fields yields a conflict without repair. Receipt replay is not renewed publication, source approval or a fresh assertion about the unrelated catalog. Database trigger enforcement is a prerequisite; an in-memory fixture does not establish it.

One rejection is explicitly distinguished for safe UI recovery: `StaleSportsPreparationSnapshotError` is thrown only after the locked transaction found no prior audit receipt, found every target free, completed eligibility checks, and compared a changed metadata snapshot, before any create. It carries the exact rejected idempotency key and expected snapshot hash. The API may echo that typed authoritative rejection so the matching browser request can be discarded and previewed again. Occupied keys, replay conflicts, SQL failures and all other errors are not classified as safe to re-preview; an uncertain response must retain its original bytes/key.

## Verification status

Nine focused fixture tests are prepared in `tests/setCatalogSportsPreparation.test.ts`. They use the original locally retained PDF bytes and a synthetic in-memory transactional delegate with the actual reconciled identity roster. No provider/database is contacted. Planned coverage includes exact proposal preservation, detached preview outputs, ten creates/identity preservation, same-key concurrency, distinct-key collision, lost-response replay, rollback at every create/audit family, stale/count/identity guards, occupied keys, source-byte/auth/version rejection, unknown applicability and changed-row replay rejection.

The simulator serializes fixture transactions and rolls back its working copy; it is intentionally **not PostgreSQL concurrency proof**. The source-fixture file records its dated canonical IDs and synthetic fields. Local fixture execution requires the retained source PDFs referenced by the existing pilot packet; they are not duplicated into Git or downloaded by tests.

The parent released the performance quiet window before any verification. All nine in-memory tests passed on their first run (TAP duration 547.694708 ms). Scoped ESLint passed for the service and both TypeScript tests; the new PostgreSQL supervisor passed Node syntax checking and scoped JavaScript lint. A no-emit TypeScript API check reported zero syntax/semantic diagnostics across the service and the two new TypeScript tests. No source fixes were needed after the quiet-window release. These are fixture/source checks, not live database qualification.

Raw logs are retained outside Git under `/private/tmp/tk-sports-reconciliation-20260917.PGawem/`: `sports-service-tests-first.log`, `sports-service-lint-first.log`, `sports-service-types-first.log`, `sports-service-runner-syntax.log`, and `sports-service-runner-lint-first.log`. Tests ran with the qualified Node 22 binary and a credential-free environment. No build or installation was performed.

### Prepared disposable PostgreSQL qualification

The parent's follow-up also requested a real database fixture. Two additional new files were prepared, then executed once under the specific launch authorization recorded below:

- `frontend/nextjs-app/tests/setCatalogSportsPreparationPostgres.test.ts`: an ownership-guarded service fixture with six subtests (seven TAP tests including its parent). It reproduces the real canonical ID rosters with explicitly synthetic historical payloads/session in the owned database. It checks real ordinary-write lock conflicts on each target table, stale/occupied rejection, transaction rollback at all eleven insert positions, same-key concurrent replay, exact full-row preservation of cards/programs/versions/draft, real source-job foreign keys, legacy-reader exclusion, nine unknown relations, append-only receipt update/delete rejection, and changed-job replay denial. It never approves or publishes anything.
- `packages/database/scripts/testSetCatalogSportsPreparationDisposable.mjs`: a separate supervisor using the existing cron runner's ownership, clean environment, deadlines, source/dependency seals, bounded logs and owned-process cleanup pattern. It does not modify or widen the cron gate. Its exact database is `tenkings_sports_preparation_disposable`, scratch prefix `tk-sports-preparation-`, and environment receipt prefix `TEN_KINGS_SPORTS_PREPARATION_`. Before loading application code the test requires the loopback database, live owned PostgreSQL PID, owner UID, random nonce and URL-hash ownership receipt. No configured production URL or provider credential is carried into the child.

When explicitly executed, the runner uses the already installed isolated PostgreSQL tools, applies the complete canonical migration chain twice in an owned copied schema directory, and compares the finished migration ledger for an exact second-deploy no-op. It never generates a client or modifies application migrations. Seals include the exact fixture, new service/plan, canonical dependency source, generated client, migration tree and both locally retained source PDFs. It requires a reviewed `--prepare-only` launch-seal receipt for `--run-approved --ack-disposable-local-postgres`. The parent first authorized only preparation after executable source freeze, then separately reviewed and authorized the exact sealed launch described below. A prepare-only receipt is not a successful database test.

The supervisor retains a ten-minute total bound with thirty seconds reserved for cleanup, a two-GiB disk floor plus launch reserve, a 150-second fixture-process bound and a 120-second Node test bound. It rejects skipped or incomplete TAP results. Reports remain outside Git; failures preserve logs and report incomplete status. Cleanup signals only child process groups it created and removes only its owned scratch directory after confirming those groups stopped. Functional success, if later observed, will still report `release_pass: false` and `performance_pass: false`.

The one authorized prepare-only invocation completed successfully. Receipt: `/private/tmp/tenkings-sports-preparation-prepared-20260917-01/launch-seal.json`, SHA-256 `3697f8189ea45a526fa6aaba098285e58c593659b5866c14494359150eadf9f6`. Its `preparation.json` states `database_started: false`, `database_writes: 0`, `functional_integration_pass: false` and `release_pass: false`. `cleanup.json` records zero owned process groups, no PostgreSQL PID, no retained temporary root and no errors. Raw output is `sports-service-prepare-only-first.log` alongside the verification logs above. The separate run-approved invocation followed only after parent review and exact-seal authorization.

Frozen executable/fixture hashes:

| File | SHA-256 |
| --- | --- |
| `lib/server/setCatalogSportsPreparation.ts` | `1dbef7813581f6d81d27813804a438d011b40f8c30816f95988f9a7777974c0e` |
| `lib/server/setCatalogSportsPreparationPlan.json` | `a55049f53594d67b25bf3752db4664b7741e72aec8392d03cb6cda619d88699d` |
| `tests/setCatalogSportsPreparation.test.ts` | `58a83ebdad11904f107b1d428236f72f2e86ef8071e6e041b81ac08218d1eeae` |
| `tests/setCatalogSportsPreparationFixture.json` | `e8f0de808a68a8beed1a911255f132e828ce1ec3b744d404041e239b997eca34` |
| `tests/setCatalogSportsPreparationPostgres.test.ts` | `bff902177d7298bca8db1ff6bf4fb4eafc781ea0384a521c114297072556acbd` |
| `packages/database/scripts/testSetCatalogSportsPreparationDisposable.mjs` | `92baaff104eae1145fcba5d39e4716b819f67e98d61e5cc6775030e025635ebf` |

The first five paths are relative to `frontend/nextjs-app`; the supervisor path is relative to the repository. Any sealed source or dependency change requires a fresh preparation receipt and review before launch.

### Observed owned-PostgreSQL run

The parent reviewed the complete runner/fixture, 415-source seal, twelve active generated-client model comparisons and both pinned PDF hashes, logged the planned action, and authorized exactly one launch. A fresh disk check observed 3,273,224 KiB available, above the supervisor's floor/reserve. The exact reviewed seal above was passed to the runner, using the qualified Node 22 binary and the existing isolated tool cache. No rerun or source correction was needed.

Evidence directory: `/private/tmp/tenkings-sports-preparation-run-20260917-01`.

- `sports-preparation-functional.log`: **seven TAP tests passed**, zero failures/cancellations/skips; total TAP duration 3,282.155625 ms. All six named subtests completed, including all eleven create-failure positions, concurrent same-key replay and the three real ordinary-write lock conflicts.
- `database-and-migrations.json`: PostgreSQL 17.9, loopback-only database `tenkings_sports_preparation_disposable`, UTF8; **96 canonical migrations completed** with no rollback, and the second deploy left the full migration ledger unchanged. Receipt SHA-256: `9b9ec1ab8823e093a4088006629ee172237bf566bcd388384adb3be8bd56cbeb`.
- `launch-seal.json`: SHA-256 `3697f8189ea45a526fa6aaba098285e58c593659b5866c14494359150eadf9f6`, identical to the reviewed preparation. The supervisor also verified the complete final source/dependency seal before completion.
- `summary.json`: `complete: true`, `functional_integration_pass: true`, `release_pass: false`, `performance_pass: false`; 379 cards, ten programs and six versions preserved in the fixture; zero real provider calls. Total supervised elapsed time was 5,213 ms.
- `cleanup.json`: all five owned process groups stopped, owned PostgreSQL PID 42720 stopped, temporary database root removed, no retained root and no cleanup errors. `post-run-inspection.json` independently checked all recorded owned PIDs after completion and found none live; it also records the 96 finished migrations and exact second-deploy no-op.

This qualifies the bounded service transaction in an owned database with real pinned local PDF bytes and explicitly synthetic historical payloads/session. It does not claim an actual authenticated hosted API/UI invocation, production schema application, human source review, grant, publication, performance guarantee or safety against uncoordinated direct card-only maintenance. The separate parent-owned API/UI and generic Build Draft guard retain their own validation evidence.
