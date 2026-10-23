# Owned publication store — unqualified preparation

## V2 session lifecycle preparation

The separate default-off `migrateProofPublicationLedgerV2` and `openProofPublicationLifecycleStore` exports add reusable local publisher sessions on the **same** durable ledger, SQLite inode, ownership manifest, key and object volume. They supply no qualification or customer authority. The existing v1 writer and `openProofOriginalReader` signatures and v1 encrypted envelope/manifest/object keys are unchanged. The old writer refuses a v2 database; the independent original reader continues to read its unchanged seal wrapper without opening SQLite.

Migration requires an existing fully validated v1 REVOKED ledger and its exact `expectedLedgerId`, `expectedRevision`, `expectedHeadHash`, plus a new `migrationId`. Empty directories are refused before the old initializer is called. Every tracked legacy original is read back before migration. Migration takes a durable exclusive owner lock, adds the v2 schema and event, sets `user_version=2` in the same transaction/inode, then advances the existing volume seal. Legacy tables are hashed and frozen by triggers. Partial migration, old locks, sidecars, pending seals, replacement DBs or mismatched checkpoints remain held; there is no force-open, stale-lock removal, reinitialization or rollback-repair API.

`openProofPublicationLifecycleStore({enabled,descriptorPath,encryptionKey,linuxObserver})` requires the existing genuine Linux observer for CLOCK_BOOTTIME and reads only the fixed kernel boot-ID scalar. It opens only a migrated, durably closed chain; it never resumes an unclosed session. Its synchronous methods are:

- `beginSession({operationId,expectedRevision,previousSessionId,previousCloseHash,binding})`: generates a fresh session UUID after the exact migration anchor or previous CLOSED session. The closed binding is `{installationId,qualificationSessionId,qualificationEvidenceHash,sourceClosureHash,policyHash,intakeBindingHash}`. These are unverified provenance fields, not installation authority.
- `publishOriginal({operationId,expectedRevision,sessionId,stageBinding,objectKey,manifest,bytes})`: uses the same concrete synchronous v1 encrypted put/readback, with a durable intent and completion. The stage must match **all six** session binding fields and include `stageId`, `stageRevision`, `requestId`, `requestBindingHash`, `actorAccessBindingHash`, `operationHash`, `bootId`, `deadlineBootNs` and sorted distinct `fences`. A fence is `{fenceId,sourceKind,sourceKeyHash,sourceGenerationHash,ordinal,revision}`; duplicate source identities are refused. Stage/request IDs are unique across all publications. Actual boot/deadline and durable barriers are checked before intent and immediately before put. Exact completed replay returns the original session/revision/evidence without a new write or deadline extension.
- `beginSessionDrain({operationId,expectedRevision,sessionId,reason})`, then `closeSession({operationId,expectedRevision,sessionId})`: serialize against the entire synchronous publication critical section. Close verifies every original created in that session, no held intent, no external hold and no unsettled local barrier. A closed-record hash includes the immutable binding, predecessor, revisions and counters; it is not an authentication token. Clean successors preserve all history. `close()` performs these actual drain/close transactions using reserved capacity, or retains the owner lock on failure.
- `beginScopeBarrier({operationId,expectedRevision,sessionId,canonicalMutationId,barrierId,barrierRevision,scope})`: records a permanent exact-generation tombstone, including unseen generations, before acknowledging it. An old fence cannot be borrowed with a new ID/ordinal/hash, and a successor cannot clear tombstones. `settleScopeBarrier({operationId,expectedRevision,barrierId})` computes only local quiescence; it never accepts a `clean` boolean or external receipt JSON.
- `holdExternalDispatch({operationId,expectedRevision,sessionId,kind,identityHash})` records an absorbing DECODE/RETAIN hold before any future integrated external effect. It blocks new publication and clean closure. There is no generic release method. Typed settlement with the actual decoder/C1 producers is still implementation work, not merely an approval or deployment gate.
- `status`, `lookupSession({sessionId})`, `lookupOperation({operationId})`, `lookupOriginal({objectKey,manifestHash})`, `readOriginal({objectKey,manifestHash})`, and `close` return only bounded internal observations. Legacy objects report `LEGACY_UNQUALIFIED` with no invented modern session identity. Retained reads remain available through the independent reader even while writer recovery is held.

Every completed v2 publication supplies immutable `ledgerId`, `publicationSessionId`, `publicationOperationId`, `publicationRevision`, `publicationEvidenceHash`, and `request` for the future C1 join. The completion hash covers the original request, full stage/fence binding, immutable session binding and revisions. No C1/authority endpoint or factory has been wired to this report.

Persisted ceilings are 1024 sessions, 128 publications per session, 32768 total tracked originals, 65536 lifecycle operations, 262144 global revisions, 256 MiB SQLite, 16 GiB cumulative tracked original bytes, 32 KiB records and 12 fences per stage. Admission reserves 64 events and two operation slots, plus maintenance for pending barriers. Historical rows/events are never deleted. These finite bounds allow multiple clean sessions beyond v1's 128-operation lifetime; reaching a bound refuses new work rather than resetting custody. Bounded streaming history/projection validation runs on open; each live transaction checks exact file/inode/stamp/volume-head ownership and CAS state. The owner UID remains a trusted boundary; these hashes do not authenticate an adversarial same-UID writer.

Local evidence currently covers closed data/reducer rules, in-memory SQLite schema constraints and affected v1 refusal behavior. `scripts/qualify-proof-publication-lifecycle.mjs` supplies explicit `prepare`, `run`, `check-app` and operator-only `crash-child` modes. `prepare BASE PUBLISHER_UID PUBLISHER_GID APP_UID WORKER_UID` creates only a new synthetic fixture directory; `run CONFIG ADDON_PATH ADDON_SHA256` requires the real publisher role and pinned native observer. Its cases exercise same-inode migration, 130 new originals over three sessions, exact historical replay, stale/unseen tombstones, original-reader compatibility, held effects, missing originals, and six crash boundaries. No runtime fault hook exists. **Actual-role v2 migration/lifecycle/crash qualification passed on the isolated target in `publication-lifecycle-01` (2026-10-23).** The exact nine-file closure ran as publisher UID/GID65530 and app UID/GID65534: migration,130 publications over sessions, replay/tombstone/hold/missing-original cases, six operator SIGKILL boundaries and app access denials all completed with exit0. Outer receipt SHA256 `81fa5280f8a485e8edde23db0ee1c5a7ef4b9033492f7e5082982a6e38322af7`; all ten decoder/cache ledger sets and existing fixture metadata were unchanged. This is synthetic-key storage/process-crash evidence, not power-loss or customer publication authority. Existing v1 target evidence below remains separately scoped. Canonical C0 policy/request/fence producers, typed external settlement, authenticated publisher ports, qualification installation and full physical admission remain unimplemented/unqualified integration work.

`proof-publication-store.mjs` performs real owner-only SQLite and encrypted-file operations. It is default off, Linux/Node22.16.0 only, and supplies **no customer publication authority or decoder qualification**. It has no endpoint, actor authorizer, injected store, signing key, fault hook, async port or accepted runtime brand. Current intake/factory/storage code is unchanged.

## Concrete installation boundary

A root-owned, bounded, protected descriptor pins the publisher UID/GID, distinct app/worker UIDs, ledger directory and original v1 storage configuration. Real/effective process IDs must match. Ancestors must be root/publisher-owned and not group/other-writable; descriptor ancestors are root-owned. Ledger and objects directories must already exist with publisher ownership and mode0700. No chmod/chown, directory discovery or privilege transition occurs in the module. Root must install the actual services/permissions and protect the key; an API does not prove app filesystem exclusion.

Descriptor shape:

```json
{
  "schema": "atlas-proof-publication-descriptor-v1",
  "publisher": {"uid": 65530, "gid": 65530},
  "app": {"uid": 65531},
  "worker": {"uid": 65532},
  "ledgerDirectory": "/opt/example-publisher/ledger",
  "storage": {
    "directory": "/opt/example-publisher/objects",
    "keyId": "existing-key-id",
    "storageId": "existing-storage-id",
    "environment": "SYNTHETIC_LOCAL",
    "retentionRef": "existing-retention-reference",
    "maxObjectBytes": 10485760
  }
}
```

These IDs/paths are examples, not observed production identities. The encryption key is supplied explicitly as a32-byte Buffer, copied privately by unchanged v1 storage and wiped on close. It is never a qualification/signing key or written to the ledger/descriptor.

## Store API and ordering

`openProofPublicationStore({enabled,descriptorPath,encryptionKey})` returns null while disabled. Enabled instances expose synchronous `status`, `publishOriginal`, `lookupOperation`, `lookupOriginal`, `readOriginal`, `revoke`, and `close`. All metadata reports retain `classification:UNQUALIFIED`, `runtimeQualified:false`, `customerPublicationAuthority:false`.

`publishOriginal({operationId,expectedRevision,objectKey,manifest,bytes})` validates the exact closed v1 manifest and original digest; structural image metadata is **not a verified decoder result**. It commits an intent before calling the privately held synchronous legacy `storage.put`, then verifies exact decrypted readback and durably records completion. No original is overwritten. A completed exact replay returns the same record; changed IDs/tuples conflict. An existing object with no matching publication operation remains `UNTRACKED_ORIGINAL`, never adopted as newly admitted provenance.

The SAME sole writer owns both its durable local revocation state and the entire synchronous put/readback/commit interval. No await, external callback, reentrancy, different publisher or separate revocation writer is accepted. Revocation therefore cannot commit or acknowledge between the pre-effect state check and final link. This is a local serialized operation barrier, not a remote check-then-put. If future composition delegates a write or adds another authoritative revocation store, this argument no longer applies and that integration must be redesigned/qualified. Request arrival alone is not revocation acknowledgment.

`revoke({operationId,expectedRevision,reason})` durably transitions ACTIVE→DRAINING→REVOKED. Reasons are OPERATOR_REVOKED, SERVICE_STOP, ADMISSION_REVOKED or STORAGE_UNCERTAIN; none is proof of external authority. There is no reactivate/reset/renew API. Clean close revokes and removes only the exact own writer lock. A clean REVOKED reopen is read-only. Any uncertainty poisons the instance and retains the durable intent and lock; expiry/absence never clears them.

## Ledger and volume seal

SQLite uses DELETE journaling, synchronousEXTRA and a100ms busy timeout. Limits:128 operation records (one reserved for close/revocation),512 events,16MiB database,32KiB records,4096 original-directory entries. History is hash-linked and append-only; new admissions fail on exhaustion, and no original/evidence is pruned.

A persistent O_EXCL writer lock forbids a second owner and refuses automatic stale-lock recovery. Foreign files or any SQLite sidecar refuse reopen before SQLite recovery. The separate volume seal binds descriptor/storage hashes, publisher identity, ledger/object-directory inodes, database inode and a random ledger ID. It also checkpoints the current revision and event hash after each SQL commit. Thus alternate paths, replacement DB inodes, reinitialized files and same-inode rollback to an earlier valid state refuse. Crash between SQL commit and checkpoint remains held by the writer lock; a checkpoint is not repaired automatically. Own temporary seal files are retained on uncertainty.

The seal/journal do not change any v1 object key, binding, AES-GCM envelope/AAD, retained manifest or review hash. They authenticate neither historical customer authorization nor old decoder provenance. Backups, key custody, privileged same-UID integrity and real storage power-loss behavior remain deployment qualification requirements.

## Retained reads

`readOriginal({objectKey,manifestHash})` reads exact existing bytes. `openProofOriginalReader` supplies a separate get/close facade under the same trusted publisher principal, even when the writer is restart-quarantined. It never opens/writes SQLite and exposes no put. It still validates descriptor/role/path/volume binding and exact object integrity. It is not a caller/actor authorizer; the future authenticated read/review service must enforce current actor/policy checks. Neither facade is accepted as legacy proof storage/intake authority.

## Evidence and operator harness

Local tests exercise only default-off, closed/getter-free options and platform/path refusal. They do not fake Linux roles or successful storage authority.

Root may run `scripts/qualify-proof-publication-store.mjs` explicitly on the dedicated host:

1. As root, `prepare NEW_ABSOLUTE_BASE PUBLISHER_UID PUBLISHER_GID APP_UID WORKER_UID` creates fresh synthetic fixtures and root-owned descriptors. IDs must already be chosen as distinct actual roles. No existing directory is accepted.
2. As that publisher UID/GID, `run CONFIG_PATH` exercises real encrypted compatibility, idempotency/revoke/read-only reopen, old-object non-adoption, inode replacement and rollback refusal, stale-lock/sidecar holds, and process crashes at three durable boundaries.
3. As the app UID, `check-app CONFIG_PATH` observes actual directory-write and publisher-role refusal. Root separately verifies worker isolation/key exclusion; this script does not start workers.

The crash harness temporarily instruments built-in filesystem calls only inside disposable operator children, then SIGKILLs those children. Production source has no fault hook. Fixtures, old DB snapshots, encrypted pending files and unresolved operations remain on disk. The key/image/manifest are public synthetic fixtures. Process-crash evidence is not power-loss, production-admission or cross-process revocation qualification. No scripts run automatically and no network/provider/decoder action occurs.

Future genuine admission must privately own this concrete store, order revocation through it and authenticate request/target/result/publication boundaries. These earlier UNQUALIFIED records cannot be relabeled as admitted provenance. Physical runtime, ownership claims/history/pricing and canonical R1 integration remain untouched.

## Observed isolated qualification

On the dedicated R2 Ubuntu target, `publication-store-02` passed all six actual-role storage tests under publisher UID/GID65530. The unchanged role/path checks reuse the preceding run's observed app UID65534 denial across13 fixtures; worker UID65532 is distinct. The first storage run failed on a UUID-pattern bug and is retained unchanged. The corrected run used fresh fixtures and covered missing/corrupt originals in addition to the cases above. Source pins and receipts are preserved in `atlas-r2-target-proposal-20261023/target-publication-store-02` and `ops/publication-store-02`. No decoder, customer proof, real key, shared database, power-loss test or customer publication authority was involved.
