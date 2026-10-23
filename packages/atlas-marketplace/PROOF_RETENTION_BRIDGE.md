# Internal retention journal

`proof-retention-journal.mjs` is default-off, **UNQUALIFIED internal storage
machinery**. It does not authenticate actors, reviewer policy, original files,
decoder evidence, publication evidence or canonical fence revisions. Every input
identity is unverified structural data. Its real state mutation is therefore
accessible only to trusted future handler composition; there is no customer
endpoint or production factory wiring. Setting `enabled` is not authorization.

The concrete handler must require R1's private live request producer, actual
publisher evidence and the canonical durable stage/revocation fence before
calling this primitive. ALS absence, a STAFF label, a serialized observation,
policy reference or caller boolean cannot satisfy those gates. No callback or
fake actor/publisher brand is accepted or produced here.

`createProofRetentionJournal({enabled,store,binding,maxOperations})` accepts the
existing trusted marketplace document store (`read` and `transaction`), the exact
v1 intake binding and an explicit integer capacity from 1 through 4096. Disabled
construction returns null. The store methods are pinned and the capacity/binding
are persisted on first mutation; changing either refuses. The module does not
open a database, discover credentials, migrate schemas or own/close that store.
`close()` refuses new local calls; it is not a revocation barrier and cannot
cancel a database COMMIT already in flight.

The finite methods are:

- `commitRetention({operation})`
- `lookupRetention({operation})`
- `cancelBeforeCommit({operation,barrierId,barrierRevision})`
- `close()`

`operation` has the closed `atlas-proof-retention-operation-v1` shape:
operationId, uploadId, proofId, orderId, orderHash, actorId, actorRole,
actorAccessBindingHash, originalRequestHash, policyHash, intakeBindingHash,
objectKey, manifestHash, originalSha256, originalByteCount, validationAttemptId,
decoderRequestId, publicationLedgerId, publicationSessionId,
publicationOperationId, publicationRevision, publicationEvidenceHash,
qualificationSessionId, retentionFenceRevision and expectedUploadHash, plus
schema. Effect/session IDs are UUIDv4; hashes are lowercase SHA256 strings;
counts/revisions are bounded safe integers. Record data is bounded at 32768
bytes; getters, exotic values, unknown keys and caller approval fields refuse.

`originalRequestHash` is the existing upload's `requestHash`. The future genuine
actorAccessBindingHash must bind the canonical request/config/session/access
identity in addition to that upload request. `expectedUploadHash` hashes the
complete original VALIDATED row, including its historical attempt/lease fields.
The expected v1 object key is recomputed from `{binding,uploadId}`. These checks
establish internal consistency, never the truth or authority of evidence hashes.

The persisted document maps are `marketplaceProofRetentionJournal`,
`marketplaceProofRetentionOperations`, `marketplaceProofRetentionUploadIndex`
and `marketplaceProofRetentionPublicationIndex`. The operation record and its
canonical hash are immutable. Upload and publication indexes prevent a different
operation ID from bypassing a prior commit or cancellation. No record eviction,
capacity reset or hold-clearing API exists.

On a first commit, one synchronous transaction callback checks the exact
VALIDATED upload snapshot, paid order, original order binding, actor/purpose,
plan, manifest and validation DTO. It inserts the unchanged legacy proof object,
sets RETAINED/completedAt, emits the unchanged MARKETPLACE_PROOF_RETAINED event,
and records COMMITTED plus the original projection and hashes of the resulting
row/object in that same CAS. No asynchronous callback, canonical refresh, socket,
decoder, object read or filesystem write occurs inside the callback. No attempt
counter, old manifest, object key, review, original byte or envelope is changed.

The small order/projection invariants are reproduced from `proof-intake.mjs`
without editing that module. The exact projection keys are uploadId, proofId,
orderId, purpose, status, declaredType, byteCount, sha256, expiresAt, createdAt and
reviewStatus. The exact object keys are proofId, uploadId, objectKey, manifest,
manifestHash and retainedAt. The retained event payload remains proofId, orderId,
purpose and actorId. Tests compare these complete shapes. Current authority and
publication-window checks belong to the future genuine handler; the utility
does not reinterpret a later retention lookup as a new publication.

Exact duplicate commit/lookup returns the saved original result, even after a
later staff review; it emits no new event. The retained row and object must still
match their recorded hashes. Lookup of a past commit does not re-run current
payment eligibility: it reports an original durable fact, while the calling
handler separately authenticates access. A pre-existing RETAINED legacy row
without this operation cannot be adopted or given invented provenance.

Cancellation writes CANCELLED_BEFORE_COMMIT under the same document lock, with
an exact UUID barrierId and barrierRevision strictly greater than the original
retentionFenceRevision. It leaves the original VALIDATED row unchanged and emits
one MARKETPLACE_PROOF_RETENTION_CANCELLED event. Late commit under that ID or a
replacement ID for that upload/publication refuses permanently. Exact repeated
barriers are idempotent; different barrier identities conflict. If the original
commit won first, the barrier returns that exact COMMITTED fact without a new
event. These supplied revisions remain unverified data; C0 must establish their
real canonical meaning before the handler invokes cancellation.

Absent lookup returns ABSENT_HOLD and writes nothing. It cannot attest that an
old request will never arrive. STORE_COMMIT_UNKNOWN is propagated unchanged,
with no retry. The current instance then rejects another commit for that ID;
an unknown barrier rejects further mutation for that ID. Lookup stays available.
It also refuses a duplicate dispatch while the original same-kind action is
still in flight; the named commit/barrier race remains serialized by the store.
An explicitly invoked cancellation barrier may still follow an unknown commit.
These local uncertainty sets do not survive process recreation: the publisher
must durably preserve its dispatch intent and uncertainty and use exact lookup
after restart. Constructing another instance is not a recovery authorization.
Only the durable exact-ID tombstone blocks a late original dispatch across
instances. Unknown, absent or mismatched outcomes never authorize republishing,
redecoding, a new key or a replacement operation ID.

The new tests exercise only synthetic state-CAS behavior using the existing
owned local SQLite store, including externally simulated lost replies. Their
operation/evidence fields are explicitly synthetic observations, not fake private
capabilities. They establish neither canonical authority nor actual PostgreSQL
semantics.

The operator module `scripts/qualify-proof-retention-journal.mjs` exports
`qualifyProofRetentionJournalPostgres({pool,expectedRole,expectedDatabase,
expectedFunctionOwner})`. Root must supply an already configured pool for a
fresh, isolated, initialized SYNTHETIC_LOCAL database. It uses the existing
`createPostgresStore` per-connection role/grant checks, requires the complete
empty state before writing, and preserves its synthetic records afterward.
It contains no credential/environment discovery, DDL, destructive reset or
runtime fault hook. Direct CLI execution refuses. Its four cases cover actual
transaction idempotency, late cancellation refusal, concurrent commit/barrier
serialization and absent HOLD. **These four storage cases passed on actual
PostgreSQL 17.11** in the fresh local `retention-postgres-fixture-01` under the
R2 target-evidence packet. The actual restricted writer passed its role/grant
audit; the race committed once, and the final state had four commits and three
immutable events. The owned server exited0 and its private socket disappeared;
the synthetic database and evidence remain retained. Receipt SHA256:
`c87db76ef336fdde9b21aca411ede81f6b4791c0781bcbb5cc42f375b214da7e`.
No shared database or credential was used. Lost-COMMIT transport faults, actual
C0 revocation and publisher/decoder joins remain separate, uncompleted tests.

The existing publisher's 128-operation lifetime, permanent REVOKED read-only
reopen and storage limits remain unchanged. This journal's separate capacity is
not increased publisher capacity or a clean-successor/restart solution. Customer
activation still requires the canonical request/fence producer, genuine reviewer
and retention policy, qualified target decoder, concrete publisher integration
and actual role/failure evidence. Claims/history/pricing remain off independently.
