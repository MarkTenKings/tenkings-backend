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
with `attempts: 0` and keep that value. The explicit accounted adapter below
records new operational/content history separately using the existing lifecycle;
the historical structural adapter does not acquire those admission semantics. Existing
VALIDATED reconciliation and retained-read/review authority remain separate
required implementation work.

`atlas_proof_intake_writer` originally received five fixed functions: read configuration, read
state, read bounded capacity, lookup original operation, commit intake operation.
The accounting extension adds four bounded functions described below. It has no retention,
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

`qualify-proof-intake-protected-postgres.mjs` passed its finite actual PG17.11 run.
Root must supply a fresh isolated, already-installed and seeded PG17.11 fixture,
a private protected config file, explicit Unix endpoint and both distinct role
credentials. It does not install SQL, create roles, seed rows or discover
credentials. Configuration schema is `atlas-proof-intake-protected-operator-v1`
with `intakeConfiguration`, `retentionConfiguration`, `installation`,
`retentionMaxOperations: 4`, `create: {actor, request}`, `validation`, and
`expectedInitialStateHash`. Require a paid seeded order, empty proof maps/events,
revision 0, maxOperations exactly 8, per-order quota at least 5, and original
policy/window lifetimes sufficient for the finite run. No lifetime is renewed.

Nine completed groups covered actual role/closure composition, NULL-CAS/unrelated
patch refusal, original CREATE/VALIDATE and mismatched validation, exact replay,
conflicting CREATE, actual C1 retention/private-origin lookup, and operator-only
COMMIT response loss before/after actual database commit. A near-capacity group refuses a new CREATE while allowing a reserved VALIDATE.
Expected final state is revision 7, seven events, four uploads and one retained object. External decoder,
actor-access, qualification and publication fields are explicitly synthetic;
this test makes no publisher-IO or canonical-authority claim. SQL installation and all nine actual PostgreSQL groups passed, including ten
refusals. Receipt `0f95c67aaf6e40ef35e4a49bd8379196f066a834b1df7b53c289d42958e434a8`
records final revision 7, seven commits/events, six intake operations, two reserved
VALIDATE slots and one retained object; state hash
`9373d0bef36daea7ae8030383ed38414843201fcfb66c53d627f5ebac577877f`.
The original setup stopped at a restricted settings read before intake writes.
Only that test query was corrected; the exact stopped fixture resumed after
revision-zero/empty-journal checks, without reinstalling SQL, reseeding, widening
grants or renewing policy. Original evidence and three prior fixtures remained
unchanged. Owned PostgreSQL exited 0 and its private socket was absent afterward.

Remaining live gates are concrete work: canonical request/private producer and
C0 stage/revocation transaction integration, actual qualified decoder outcome
verification, qualified accounting admission, original-only publisher dispatch and fence
serialization, old-row reconciliation, and authenticated intake/read/review
composition. No canonical policy, ownership/history, pricing, installation or
production authority is activated by this candidate.


## Decoder-origin preparation prerequisite

`prepareValidationFromDecoder({createOperation, client, outcome})` now composes
an actual private same-client broker outcome with the owned intake connection.
It is an internal, default-off `SYNTHETIC_LOCAL` path. `COMPLETE_CLEAN` transport
provenance does not establish qualified decoder or canonical actor authority.
The existing structural `prepareValidation(...)` remains for the explicit
synthetic fixture; neither method is wired to a physical/public intake endpoint.

The method claims the original outcome synchronously before the first async
boundary, allocates one operation ID, validation-attempt ID and timestamp, and
uses the shared single-active database call guard. The claim cannot be borrowed
by a second intake instance or another original CREATE. A repeated same-owner,
same-CREATE call refuses and exposes only the same bounded preparation report;
it does not requery, allocate identities, renew time or return a replacement
handle. A failed preparation retains that report and its consumed local slot.

Matching the immutable CREATE plan plus a single-use result proves same bytes
and private origin, but does not prove that the broker request was originally
dispatched for that exact upload/actor when two CREATEs name identical bytes.
A durable prepared-request association (and the genuine C0 coordinator) must bind
that original association before live admission; this outcome-only method is
not a full qualified physical join.

The exact original CREATE record is read from the audited PostgreSQL gateway by
its operation ID/hash. The closed projection binds its original upload, object
key, storage/policy tuple and byte plan. The decoder request ID and validation
DTO are derived together from one private successful result; callers do not
supply either field. The original upload/policy window remains unchanged. The
existing gateway rechecks the current immutable upload and original manifest
projection while holding its real state lock, and checks its actual wall clock.

The broker adds `assertProofDecoderClientOutcomeBeforeDeadline(value, {client})`
as an explicit stricter export. It retains the same genuine native observer in
the private client record, refuses closed/quarantined clients or a closed
observer, and reads actual BOOTTIME against the original prepared deadline.
The historical outcome verifier is unchanged. The intake path checks this
private origin/deadline before and after its connection/original lookup, before
the write and COMMIT, and after COMMIT. A late, closed or uncertain commit returns
`UNKNOWN` with the same operation and consumed handle. Only exact-original
lookup remains; there is no resubmission, new validation attempt or decoder
retry. These checks are not a canonical revocation fence or a database-enforced
BOOTTIME transaction deadline: a late actual COMMIT can exist behind UNKNOWN.

Six distinct new pure/refusal cases cover original/DTO coupling, uncertain and
invalid-image outcomes, contradictory transport fields, exact original/storage/
policy tuples, time windows and closed scalars, private-brand refusal without
calling a fake clock, and default-off/injected-factory refusal. The first run
passed five cases; the sixth expected the later window error for a fractional
number already refused by the scalar parser. Only that corrected case reran.
Only the expanded tuple/policy case then reran. No fake positive client/outcome
brands, PostgreSQL replay or native runtime effects were used. The actual nine
PostgreSQL groups above predate this composition delta and remain valid for
their original source scope. Actual private decoder-to-PostgreSQL preparation,
shared-call races, deadline crossings and post-COMMIT uncertainty for this new
path are `NOT_RUN`.

A live qualified path still requires the source-owned qualification/installation
producer and canonical C0 request/stage/fence composition, including revocation
serialization. Fingerprint and genuine ownership remain required before
ownership/history/pricing can turn on. This prerequisite supplies private
transport provenance and durable original identity; it does not synthesize any
of those missing producers or grant fresh publication permission.


## Durable pre-dispatch accounting candidate

`createProofIntakeAccountedPostgres({enabled, configuration, installation,
accounting})` is an explicit default-off `SYNTHETIC_LOCAL` branch. Its matching
owned connection audits the complete expanded catalog and actual immutable
`atlas-proof-intake-accounting-installed-v1` configuration: the hash of the full
intake installation and `operationalLimit` from 1 through 16. It uses the same
intake role; retention receives no accounting functions or table access.

This factory omits both `prepareValidation(...)` and the outcome-only
`prepareValidationFromDecoder(...)`. They remain available only on the separate
historical synthetic adapter. An accounted VALIDATE must use the bound attempt:

1. The trusted composer durably calls D1 `beginDecoderDispatch` with the original
   genuine prepared handle before transferring it. D1's saved original report
   remains unchanged. The adapter itself does not authenticate a D1 registration
   or canonical stage; those composition producers remain required work.
2. `reserveDecoderAttempt({createOperation, client, prepared})` synchronously
   transfers the genuine same-client prepared record into its private closure
   before any await. The old key can no longer submit, discard or be borrowed.
   No bytes, timer, request ID, abort signal or BOOTTIME deadline are recreated.
   D1 now keys its same-process ownership map by the genuine original report
   object rather than the replaceable handle key, preventing a second publisher
   from claiming the record after transfer. No durable schema/history changes.
   The actual original CREATE is read by ID/hash. The adapter commits one RESERVE
   before returning its opaque attempt handle. Its wall-clock lease is capped
   by the original remaining BOOTTIME and upload/policy window, never renewed.
3. `submitDecoderAttempt(handle)` consumes the attempt once, durably commits
   SUBMIT_INTENT, then submits that same private record. Every original prepared
   deadline check surrounds the SQL read/write/COMMIT. A lost or late response
   never becomes later permission to send. The actual same-client result/error
   is structurally bound to the saved report and recorded as OBSERVE_OUTCOME.
4. `prepareValidationFromAttempt(handle)` accepts only the already-settled exact
   successful attempt. It consumes the same private outcome and reuses the
   original attempt UUID. The accounted commit gateway rechecks that success,
   decoder request, DTO and immutable CREATE under the marketplace state lock.

`decoderAttemptReport(handle)` gives bounded unqualified metadata.
`decoderAttemptOutcome(handle)` returns only an already-produced genuine
same-client object so D1 can inspect/settle its own dispatch; it does not mint a
receipt, change accounting, or clear UNKNOWN/HELD. This includes an actual
private discard result when a transferred request was never sent. A historical
clean object cannot turn an uncertain accounting commit into a fresh attempt.
`lookupDecoderAttempt(handle)` reads exact original history without changing
its phase. One active call and one open attempt are permitted, with no queue.
Closing wipes an unsent prepared copy or cancels the active genuine client.

The immutable side journal contains at most 64 events per original. Its existing
lifecycle reducer is reused unchanged. Each reserve counts one operational
attempt; exact event replay never counts twice. Only a structurally consistent
complete submitted INVALID_IMAGE observation can count a content rejection;
the concrete adapter obtains that observation from the actual private client.
Operational failures do not consume content counts. Unknown submission/cleanup,
lease expiry and contradictory or late results hold the original permanently;
there is no renewal, hold-clear, automatic retry or implicit legacy adoption.
All original legacy counters, request/object keys, snapshots and v1 manifests
remain untouched. Accounting writes neither consume CREATE/VALIDATE quota slots
nor release the VALIDATE capacity reserved by each original CREATE.

The inert SQL adds two append-only/configuration tables, four private finite
projection/check helpers, and four public functions: read accounting config,
read bounded original history, append exact accounting event, and commit an
accounted VALIDATE. The same marketplace state lock serializes accounting with
intake commits. Stored events bind the full prepared report, CREATE/hash and
original tuple; reconstructed history must agree with the unchanged reducer.
Exact duplicate delivery returns current original history; conflicting IDs or
changed content refuse. Old event/configuration rows cannot be edited, deleted
or truncated by the writer. The source-owned closure audit includes all new
bodies, ACLs, constraints/indexes and enabled triggers. No installed schema is
upgraded by this source; a reviewed fresh synthetic fixture must install the
final inert proposal once and insert its accounting configuration explicitly.

This remains internal machinery. With no accounting binding installed, the
historical structural commit API preserves the explicitly synthetic fixture
behavior. Once the immutable accounting binding exists, every new VALIDATE
through either public commit API invokes the same private accounting guard
while holding the actual state lock. The generic API cannot skip a missing or
held attempt. Its exact already-committed operation replay intentionally returns
the original snapshot before that guard, without any write or new admission.
The accounted wrapper always requires the installed configuration and delegates
to that shared guarded path; no caller GUC or recursion is used. SQL JSON
observations still are not authenticated private outcomes. Only the accounted
source-owned adapter consumes genuine prepared/outcome objects. Production
requires the canonical producer and restricted stage protocol, not merely this
role or an installed row. In particular, if a reservation's first SQL response
is uncertain and no row is durable, the adapter's same-process held identity
cannot prove cross-process custody after restart. D1's durable original hold
and the future trusted coordinator must preserve that absence as HOLD; no
absence/PID/deadline-based recovery or fresh dispatch is authorized here.

Seven new pure/refusal cases passed, including the entire sixteen-attempt,
48-event history, exact duplicate/conflict behavior, same-byte different-original
refusal, immutable legacy counters, content/operational separation, absorbing
unknown/expiry, exact accounted validation and fake-private-origin refusal.
The affected function body/grant pin case passed; it reran alone after
qualifying one new SQL parameter reference to avoid name ambiguity, then again
for the fifteen-function closure after the shared generic-VALIDATE guard fix. No old
PostgreSQL or native cases were replayed.

`qualify-proof-intake-accounting-postgres.mjs` is a source-only finite new PG17.11
operator. Its protected config schema is `atlas-proof-intake-accounting-operator-v1`
with `configuration`, `installation`, `accounting`, `create: {actor, request}` and
`expectedInitialStateHash`. Root supplies fresh installed/seeded state revision 0,
empty proof maps/events, maxOperations 10, per-order quota at least five and
operationalLimit 16. Six groups cover the actual audit/closed method surface,
five reserved originals, 16 operational attempts, terminal idempotency and
conflicts, invalid/unknown/expired distinctions, exact accounted VALIDATE, direct generic VALIDATE refusal for missing/held
accounting, read-only original replay, and private table/helper ACL refusal. Expected final state: revision/events 6,
61 accounting events, six intake operations and four reserved VALIDATE slots.
All observation JSON is deliberately synthetic and never accepted as a private
broker object. This harness has passed syntax only: actual PostgreSQL is NOT_RUN.

The existing genuine prepared-submission operator has a new isolated `transfer`
mode: two source-only cases for old-key invalidation/same-report discard and
abort-after-transfer. It needs the real native observer/client and performs no
socket submission. Old operator modes are unchanged and were not replayed. A separate new
`qualify-proof-publication-dispatch.mjs` transfer mode registers D1 before
transfer, refuses another publisher/new identity afterward, and settles only
the original registration with its actual private discard outcome. It uses a
fresh fixture; previous metadata, complete and unknown cases are not rerun.
Genuine transfer cases, accounted private decoder-to-PG/D1 composition, concurrent
calls and lost-response/deadline boundaries remain NOT_RUN. Canonical C0,
qualification/installation, revocation serialization, authenticated ports and
legacy reconciliation still require concrete producers and implementation.
Fingerprint and genuine ownership remain mandatory for ownership/history/pricing.

Accounting source04 correction: the first fresh actual accounting PostgreSQL
fixture stopped after the expected missing-accounting VALIDATE refusal because
its growing whole-history CAS hash exceeded the shared retention canonicalizer's
32 KiB output bound. That partial fixture and receipt are retained; it is not
reset or replayed. The shared helper is unchanged. Accounting now hashes the
closed `atlas-proof-intake-accounting-head-v1` tuple containing the exact CREATE
ID/hash and at most 64 ordered per-entry SHA256 digests. Each entry retains its
independent validation/hash and 16 KiB SQL input bound; the head is below 8 KiB.
JS and the new private SQL helper use the same canonical tuple. Existing event
bytes/hashes, idempotent replay and original deadlines are unchanged. The new
helper is in the exact sixteen-function audited closure with no writer grant.
The affected 16-attempt regression covers a full read above 32 KiB, the bounded
head, order/count/original/domain binding and empty history. Actual source04
PostgreSQL completion remains NOT_RUN until the fresh fixture02 run.

### Actual bounded accounting PostgreSQL evidence — 2026-10-23

Frozen source04 was executed against fresh local PostgreSQL17.11 fixture02 using the audited restricted role: six groups and11 expected refusals passed. Five original CREATEs reserved five VALIDATE slots; sixteen operational attempts reached the budget exactly; duplicate deliveries were idempotent; invalid content counted once; unknown/expired holds remained absorbing; both generic and accounted VALIDATE paths enforced the same accounting guard; exact successful validation and read-only original replay passed; private table/helper ACLs refused. Owner verification observed revision6, six commits/events,61 accounting events, five CREATE/one VALIDATE and four reserved validations, with unrelated state and legacy attempt counts unchanged.

Evidence: external packet `atlas-r2-target-proposal-20261023/intake-accounting-postgres-fixture-02/receipt.json`, SHA256 `abe1b3520db0aa887d96690a67a95104ae76a255d63ee4d2fd5f25680c4efc0b`; state `96ce4605f1ba145354dc253a8fa03073743b47e6b9f40b74147a09aaa64986b4`. Owned PostgreSQL96397 exited0, socket absent; five earlier stopped fixtures remained unchanged. Prior partial fixture01 remains preserved: its whole-history hash exceeded the shared canonicalizer bound. The correction hashes a bounded domain-separated tuple of ordered exact entry hashes; shared retention limits and event bytes are unchanged.

This is actual SQL/role/accounting evidence with explicitly synthetic decoder observations. Genuine prepared transfer, private decoder→accounted PostgreSQL→publisher composition, C0 authority and production installation remain unqualified/not run. No production readiness follows from this receipt.
