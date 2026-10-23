# Owned publication store — unqualified preparation

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
