# Internal typed retention settlement

This default-off v4 candidate performs owned local storage transactions and
records concrete PostgreSQL producer outcomes. It remains UNQUALIFIED and grants
no customer, actor, reviewer, canonical fence, decoder or publication authority.
The generic PostgreSQL adapter in this tranche accepts **SYNTHETIC_LOCAL only**.
A real protected gateway adapter, complete installed SQL/helper/trigger closure
audit and genuine request/fence producers remain implementation and installation
work. The earlier generic three-function role is never production authority.

`proof-retention-postgres-connection.mjs` owns the real pg8.16.3 Client and its
141-file exact public dependency inventory. `configuration.driverDirectory`
points to the protected, complete pinned `node_modules` tree; no constructor,
pool, stream, query, clock or callback comes from the caller. The closed explicit
configuration supplies a protected local Unix socket or verified TLS DNS endpoint,
database/role/function owner, explicit password and exact public function
`pg_get_functiondef` SHA256 values. TLS uses the supplied CA, verification and
TLS1.2 minimum. Deployment must bind the actual server and full installed source;
a private JavaScript brand does not prove a malicious server truthful.

The connection owner bypasses pg's native-selection entry point, supplies a
source-owned password closure, and overwrites pg's false-valued binary/replication
fallbacks before connecting. It never changes environment/defaults or discovers
URLs, service files or pgpass. Nonempty explicit fields and fixed UTF8/options,
application name and timeouts prevent other ambient fallbacks. Secret data never
enters reports or forwarded errors; the owned password buffer is cleared on
close, without claiming complete JavaScript string erasure. One connection is
active at a time, without a queue or retry. Connect/query/client lifetimes and
request/response bytes are bounded. Every acquired connection checks exact
function-definition pins before the existing unchanged store performs its full
role/grant/owner/search-path audit. The future protected gateway needs a separate
fixed audit mode covering helpers, common CAS, schemas, immutable binding and
triggers; supplying only its three public function hashes is insufficient.

`createProofRetentionPostgresWriter({enabled,configuration,binding,maxOperations})`
creates that connection owner, the existing audited store and C1 journal itself.
It accepts no supplied pool/client/store/journal. Its finite API is:

- `prepareRetention({operation})`: copies the complete closed C1 identity into a
  private, writer-bound handle. No socket opens. Duplicate operation IDs refuse.
- `commitPrepared(handle)`: consumes the original dispatch once. Every failure
  is conservatively UNKNOWN; no commit retry is available.
- `lookupPrepared(handle)`: only after dispatch, reads the exact original ID and
  full identity, at most eight observations per private handle. ABSENT_HOLD remains held.
- `cancelPrepared(handle,{barrierId,barrierRevision})`: at most one exact-ID
  cancellation dispatch, with a barrier newer than the original RETAIN fence.
  Uncertain cancellation can only be looked up, never reissued.
- `lookupDisposition(actualOutcome)` and direct private verifiers accept only
  values actually produced by this writer after awaited concrete database work.
  Plain JSON, arbitrary errors and method-shaped objects are refused.
- `close()`: closes the owned journal/store/client lifetime; it grants no release.

Public reports contain unqualified observations. Prepared handles and produced
outcomes cannot be reconstructed from those reports. Actual database completion
is the storage-origin boundary, not the synchronous C1 callback constructing its
report. Original COMMITTED/CANCELLED records, original upload/proof/event and
exact-ID cancellation semantics remain the unchanged C1 implementation.

The concrete publisher adds `migrateProofPublicationLedgerV4` and
`openProofPublicationRetentionStore` with the same option pattern as v3. Migration
requires an exact clean closed v3 checkpoint, expected ledger/revision/head,
genuine local observer, same SQLite inode, persistent exclusive ownership and
volume seal. It adds immutable retention tables and one migration event; every
v1/v2/v3 row/event hash remains intact. No old hold, stale lock, unknown restart,
missing row, absent PID, new directory or caller JSON opens a recovery path.

The v4 owner exposes:

- `beginRetentionDispatch({operationId,expectedRevision,sessionId,stageBinding,writer,prepared})`
  verifies the actual writer/handle, current ACTIVE session, original live
  BOOTTIME deadline and unreclaimed scopes. It matches the complete C1 operation
  to this ledger/session's COMPLETED publication and reads the exact encrypted
  original. Installation/qualification/policy/intake, actor access, original
  key/manifest/hash/size, publication operation/revision/evidence, and full C1
  operation hash are bound. RETAIN fence revision equals the committed stage
  revision. A private handle has one durable dispatch identity for its lifetime.
- `settleRetentionDispatch({operationId,expectedRevision,dispatchOperationId,writer,outcome})`
  imports the real same-writer verifier directly. One UNKNOWN/ABSENT observation
  may be appended and retained; only a subsequent real exact-original LOOKUP or
  CANCEL outcome can add one terminal COMMITTED/CANCELLED observation. No later
  commit is dispatched. Exact same-operation/value replay is idempotent;
  conflicts and third observations refuse. Original publication/history is never
  rewritten. Terminal settlement releases only this new typed obligation.
- `lookupRetentionDispatch({operationId})` returns historical data, never a fresh
  producer or admission capability.

Each dispatch reserves two settlement operations in addition to close/barrier
maintenance. Settlement may finish while DRAINING and after the original deadline;
it never renews that deadline, reactivates a session, removes revocation tombstones,
adjusts historical attempts, republishes, decodes again or changes an object key.
Old hash-only holds and decoder UNKNOWN holds remain absorbing. New retention
UNKNOWN can reconcile only through its still-owned original private writer; a
process crash leaves the persistent lock, without automatic reconstruction.

## Evidence and operators

New local parser/refusal/data tests pass: six connection/writer cases and seven v4
cases. A focused SQL constraint correction additionally passed its one affected
case; the affected existing v3 entrypoint refusal case passed. These do not mock
positive database/observer brands and do not establish actual v4 IO or database
producer qualification. The unchanged C1 and D1 evidence is retained separately.

`qualify-proof-retention-postgres-writer.mjs CONFIG` consumes an explicit protected
operator configuration and four newly seeded synthetic C1 operations. It performs
real private commit/lookup/cancel, two external operator-only COMMIT interruption
cases and actual function-definition mismatch refusal. Interruption either
suppresses sending COMMIT after CAS or rejects the actual COMMIT response; it
never fabricates a positive database result and is not network/power-loss evidence.
The source module has no fault hooks. The operator performs no setup or migration.

The frozen D2 closure at `8e35ccb4` passed all five PostgreSQL operator groups in
the fresh owned `retention-writer-postgres-fixture-01` cluster: real private
commit/lookup, exact-ID cancellation, response loss after actual COMMIT,
interruption before COMMIT followed by absence and cancellation, and actual
function-definition mismatch refusal. PostgreSQL17.11/pg8.16.3 used the explicit
private Unix socket on port55494. The unchanged C1 inputs finished at revision4,
four commits and four events, with two COMMITTED and two CANCELLED_BEFORE_COMMIT
records; state hash
`f8501b0b83304ff82b2d03f6d69be38f67a0a1cc5f1ba663bd3e6c0545c929d5`.
The owned server stopped with exit0 and its socket was absent. The existing
gateway fixture's checked metadata remained unchanged.

Actual receipt `retention-writer-postgres-fixture-01/receipt.json` has SHA256
`687cf95da4b1f6a9f33936d6b28062d840f6feb511d5447adb58c46358631ff8`.
The executed wrapper03 SHA256 is
`af473b0592f4952c43ba72863671ee982af7957bf0a855f949c1047b59758b47`;
its exact source, binary identity, driver and fixture inputs remain preserved in
`publisher-dispatch-lane/d2-postgres-wrapper-snapshot-03` and the actual receipt.
The earlier wrapper02 link-count refusal occurred before fixture/socket creation
and is preserved separately. These results cover the synthetic generic adapter
and source-owned private storage outcomes. They do not establish real network or
power-loss behavior, verified TLS, the protected gateway, canonical authority or
the PostgreSQL-to-publisher settlement join.

`qualify-proof-publication-retention.mjs prepare BASE UID GID APP WORKER`, then
`run FIXTURES ADDON SHA256`, prepares fresh public-key0x51 storage fixtures and
uses a genuine Linux observer. Four finite cases cover same-inode v3→v4 and old
original/history, clean successors, initial migrations before the first session,
old-hold refusal, and an owned SIGKILL after v4 COMMIT before sealing. It performs
no PostgreSQL, Engine, service, cgroup or canonical authority action.

The frozen v4 Linux operator also passed all four actual native/storage groups on
the isolated target, using native addon `e7eed62c5b791660dec2a595dec74a626a3fa8e04c66bcdb6fb535f8ab03ea03`.
All three owned wrapper commands exited0. The 14 decoder ledger sets, runtime,
control files and four older publisher fixture trees remained unchanged; the
guard remained stopped and the parent empty/frozen. Wrapper02 SHA256
`ddac539a946aeec4f8e8080a05338c6a8314d2e07b5dd089bc115e5136e434fa`
and its source/header/baseline are preserved in
`publisher-dispatch-lane/d2-linux-wrapper-snapshot-02`. Actual stdout
`ops/publication-retention-metadata-01/stdout.txt` SHA256 is
`fbbd10e27a716a28d22d2a848aa2670bed3f1d6ff1a627e628fe4ed3a0da62b4`;
the target's pretty receipt SHA256 is
`a2b10c48449a7e979c75f9013f93e9bae8be026fc7e3286152ec77f77157d2e4`.
This covers migration/storage behavior and an operator-owned SIGKILL boundary,
not power loss or any PostgreSQL settlement inside the publisher.

The combined real PostgreSQL→v4 settlement join remains NOT_RUN at this source
checkpoint. Linux/DB deployment identity, full qualified physical composition,
canonical request/fence producers
and all participating revocation writers remain required. A new separate default-off
SYNTHETIC_LOCAL protected adapter candidate is described in
`PROOF_RETENTION_PROTECTED_ADAPTER.md`; its fresh PostgreSQL17.11 harness passed20 groups/15 refusals. That result does not establish this physical join. Existing D1 metadata passed on its frozen
8b37c773 closure; D2 does not alter that immutable target evidence.
