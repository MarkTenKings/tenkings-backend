# Protected initial-intake storage candidate

This is default-off, internal `SYNTHETIC_LOCAL` storage machinery and inert SQL.
It is `UNQUALIFIED`. An actor label, validation DTO, installed policy hash or
successful storage transaction supplies no request, decoder, publication or
canonical stage authority. No physical-runtime factory or endpoint imports it.

## Concrete storage path

`createProofIntakeProtectedPostgres({enabled, configuration, installation})`
owns the pinned pg8.16.3 driver and its clients. There is no supplied pool, query,
store, clock, authorization callback or positive receipt factory. PostgreSQL17
and Node22.16.0 are explicit runtime bounds; the operator targets PG17.11.

- `prepareCreate({actor, request})` creates an opaque single-use handle with an
  original operation UUID and wall-clock timestamp, without socket effects.
- `prepareValidation({createOperationId, createOperationHash,
  expectedUploadHash, validationAttemptId, decoderRequestId, validation})`
  creates the corresponding handle for the exact original CREATE. These fields
  are unverified structural inputs, not an authenticated decoder result.
- `preparedReport(handle)` returns the frozen original operation.
- `commitPrepared(handle)` consumes it once. It reads actual state, projects the
  bounded change, and calls the fixed gateway in one real transaction. A failed
  dispatch returns `UNKNOWN`; it never renews the timestamp or retries.
- `lookupPrepared(handle)` and `lookupOriginal(operation)` only read the exact
  original durable record. A missing record is `ABSENT_HOLD`; no resubmission or
  reset is exposed. A record is metadata, not customer permission.
- `close()` terminates the owned connection. One active call is allowed, with no
  queue; local preparations and the durable operation table have finite bounds. Each outstanding CREATE
  reserves its future VALIDATE slot; expiry or uncertainty never releases it.

`r1-proof-intake-gateway-proposal.sql` raises before DDL by default and is not
registered in a migration. A separately reviewed synthetic fixture installer
must install it after the exact existing base and retention gateway, then insert
one immutable intake configuration matching the actual retention binding.
No application role can install, update, delete or truncate either configuration
or the operation journal.

The gateway locks the existing marketplace state row, checks the exact CAS
revision/hash and installed configuration, recomputes CREATE/VALIDATE, and
atomically commits the original upload/event through the unchanged common CAS
plus the new immutable operation record. A duplicate exact operation returns its
original snapshot without another CAS. A different operation cannot reuse the
same CREATE/VALIDATE upload dispatch key. NULL/stale CAS values and unrelated
whole-document changes are refused. The original operation must be no older than
15 seconds at commit; the original upload and policy expiry remain unchanged.

## Compatibility and separate roles

The legacy `proof-intake.mjs` projection is preserved: the upload ID hashes
`{actorId, role, requestId}`; the proof ID hashes that upload ID; the object key
hashes `{binding, uploadId}`. The PREPARED row, six-field paid-order binding,
original request hash, expiry/retention times and
`atlas-marketplace-retained-proof-v1` manifest keep their existing meanings.
The existing encrypted storage envelope and namespace are untouched. CREATE
counts existing rows toward per-order and total quotas. VALIDATE requires the
exact immutable CREATE snapshot, paid order, original bytes/type/hash, and buyer
return window. Unrelated rows, retained objects, reviews and events are preserved.

This candidate handles only new rows. It never adopts old PREPARED, VALIDATING,
VALIDATED or RETAINED rows or rewrites historical counters. Its new rows start
with `attempts: 0` and keep that value; operational/content attempt accounting
must still be joined to the existing lifecycle before any live use. Existing
VALIDATED reconciliation and retained-read/review authority remain separate
required implementation work.

`atlas_proof_intake_writer` gets five fixed functions: read configuration, read
state, read bounded capacity, lookup original operation, commit intake operation. It has no retention,
helper, common-CAS, table, owner membership or schema-CREATE rights.

`createProofRetentionIntakePostgresWriter({enabled, configuration,
installation, maxOperations})` is an explicit composition for the existing real
C1 writer/private outcomes. Its configuration uses
`atlas-proof-retention-intake-connection-v1` and the separate
`atlas_proof_retention_writer` role. That role receives only one new readonly
function, `read_intake_configuration_v1()`; it receives no intake write or lookup
rights. Its public binding includes both source-owned catalog closure hashes,
the complete installed intake configuration and retention maxOperations. The v4
publication parser accepts this exact closed branch. The actual producer still
verifies private writer/outcome origin; serialized bindings cannot mint it.

Every connection audits the full original catalog plus the exact extension:
public/private function bodies, common CAS, generic writer barrier, roles,
PUBLIC/effective privileges, memberships/settings, tables, constraints/indexes,
enabled immutable triggers, owner/schema grants, and both actual installed
bindings. The original generic and retention-only factories and catalog remain
unchanged; retention-only correctly refuses the extended schema unless the new
factory is explicitly selected. No caller supplies audit expectations.

## Source evidence and finite operator

The six restored pure/refusal tests passed once. Three new composition tests
plus the affected SQL-body-pin test passed. After reserved-capacity hardening,
four affected cases passed; one missing-original test needed its synthetic
reservation count corrected and then passed alone. The failed test setup is
preserved in the packet. Ten distinct tests are covered, including capacity. This is parser/projection
and refusal evidence, not PostgreSQL execution or authority evidence.

`qualify-proof-intake-protected-postgres.mjs` is prepared and syntax checked only.
Root must supply a fresh isolated, already-installed and seeded PG17.11 fixture,
a private protected config file, explicit Unix endpoint and both distinct role
credentials. It does not install SQL, create roles, seed rows or discover
credentials. Configuration schema is `atlas-proof-intake-protected-operator-v1`
with `intakeConfiguration`, `retentionConfiguration`, `installation`,
`retentionMaxOperations: 4`, `create: {actor, request}`, `validation`, and
`expectedInitialStateHash`. Require a paid seeded order, empty proof maps/events,
revision 0, maxOperations exactly 8, per-order quota at least 5, and original
policy/window lifetimes sufficient for the finite run. No lifetime is renewed.

Nine planned groups cover actual role/closure composition, NULL-CAS/unrelated
patch refusal, original CREATE/VALIDATE and mismatched validation, exact replay,
conflicting CREATE, actual C1 retention/private-origin lookup, and operator-only
COMMIT response loss before/after actual database commit. A near-capacity group refuses a new CREATE while allowing a reserved VALIDATE.
Expected final state is revision 7, seven events, four uploads and one retained object. External decoder,
actor-access, qualification and publication fields are explicitly synthetic;
this test makes no publisher-IO or canonical-authority claim. SQL compilation
and all nine actual PostgreSQL groups are **NOT_RUN** for this new candidate.

Remaining live gates are concrete work: canonical request/private producer and
C0 stage/revocation transaction integration, actual qualified decoder outcome
verification, lifecycle accounting, original-only publisher dispatch and fence
serialization, old-row reconciliation, and authenticated intake/read/review
composition. No canonical policy, ownership/history, pricing, installation or
production authority is activated by this candidate.
