# Source-owned protected PostgreSQL adapter

This is a default-off, UNQUALIFIED internal storage candidate. It accepts only
SYNTHETIC_LOCAL and the exact dedicated candidate database/roles. It does not
install SQL, authenticate a request, qualify a decoder, authorize publication,
refresh a canonical fence, or enable production. Initial physical intake and
canonical C0/request/revocation composition remain actual implementation work.

`createProofRetentionProtectedPostgresWriter({enabled,configuration,binding,maxOperations})`
owns the pinned pg8.16.3 Client, protected connection audit, protected store and
unchanged C1 journal. The existing generic writer factory/configuration remains
separate. Both use the same private writer/prepared/outcome implementation, so a
real protected result can be verified by the existing D2 publisher verifier.
Caller JSON, a supplied pool/client/store/query callback, or a function hash does
not create a producer. The pure catalog validator returns no receipt or token.

The closed configuration schema is
`atlas-proof-retention-protected-connection-v1`: explicit driverDirectory,
LOCAL_UNIX or VERIFIED_TLS endpoint, database `atlas_marketplace_review_candidate`,
role `atlas_proof_retention_writer`, functionOwner `atlas_marketplace_owner`, and
explicit password. It accepts no functionDefinitionHashes. Existing pinned-driver,
protected-file/socket, no ambient credential fallback, one-connection/no-queue,
time/response bounds and no automatic retry behavior are reused. The candidate
requires PostgreSQL17.x and UTF8; the first actual harness requires 17.11 exactly.
PostgreSQL16 is refused. TLS source support is not actual TLS qualification.

Before exposing each real connection, fixed source queries inspect the actual
catalog. Source-owned hashes cover all fifteen installed function bodies,
including the renamed original common CAS, generic proof-map barrier, every
private helper, history/text validators and four protected surfaces. Exact
function arguments, return types, language, owner, definer/config/volatility and
other execution metadata are checked. Seven tables, columns/defaults, all
constraints and eleven unique indexes, five enabled immutable triggers, schema
ownership/ACL, role flags and memberships are checked. Effective privileges
include PUBLIC, column grants, PostgreSQL17 MAINTAIN, unrelated schemas/functions,
sequences, database CREATE/TEMP and owner access. No role memberships or SET ROLE
route into these roles is accepted. Role/database settings are refused; current
search_path, origin trigger execution, write mode, fsync, synchronous commit and
full-page writes must match the fixed contract. Catalog rows and total bytes are
bounded. Administrative superuser/database integrity remains an installation
trust boundary; the audit is not protection against a malicious server owner.

The inert SQL adds one narrow fourth grant:
`read_retention_binding_v1() RETURNS jsonb`. It exposes only the bounded installed
singleton binding and maxOperations; no table grant, caller selector or mutation.
The actual returned tuple must exactly match the writer binding and capacity.
Its body, owner and ACL are part of the same audit. The source installer must
supply the original immutable binding; absence, replacement or mismatch refuses.
The SQL's explicit NOT_APPROVED blocker remains intact. Nothing applies it on
startup, and no migration manifest registers it.

The protected store calls only the protected read/lock/commit gateway. It derives
operationId and operationHash from the sole new C1 operation; it does not accept
these as caller-selected CAS arguments. SQL independently reconstructs and checks
the exact full transition. The existing synchronous C1 callback performs no
network or authorization work. No-op exact-original calls preserve the original
record; changed state uses the seven-argument protected CAS. An ambiguous COMMIT
is UNKNOWN, never a retry permission. Same-writer lookup/cancellation uses the
original identity, with the existing private outcome and bounded attempt rules.
No new key, publication rewrite, decoding or old-hold release is provided.

The initial-intake gap is deliberate and operationally significant: installing
the generic proof-map barrier prevents the ordinary writer from creating new
VALIDATED uploads. This adapter can retain previously present exact originals;
it does not supply the missing trusted intake gateway. Deploying it alone cannot
complete a physical proof flow or establish current staff/customer policy.

The new local tests check closed configuration/default-off/refusal behavior,
exact source body pins, version/trigger/durability refusal and sole-new-operation
CAS extraction. They do not simulate a genuine positive database producer.
`qualify-proof-retention-protected-postgres.mjs CONFIG` is a separate operator
harness for an explicitly provisioned fresh PostgreSQL17.11/Unix fixture. It
expects four seeded synthetic C1 originals plus the immutable binding, audits
real metadata, temporarily changes and restores only finite fixture DDL/ACL
cases, then checks real commit/cancel and operator-instrumented before/after
COMMIT uncertainty. The original fixture state must remain unchanged during each
audit refusal. No production SQL, real network/power loss, initial intake,
canonical authority or PG→publisher-v4 join is claimed. Actual PostgreSQL17.11 execution passed after root review in the fresh isolated
fixture below.

## Actual protected adapter evidence

The exact ready01 runtime closure passed20 groups, including15 refusals of altered
bodies, grants, columns, memberships, triggers, constraints, defaults and installed
binding. Four genuine protected writer outcomes reached revision4: two committed,
two cancelled; four commits/events. Instrumented before/after-COMMIT response loss
became private UNKNOWN followed only by exact-original lookup/cancellation. This
is operator-instrumented uncertainty, not a network or power failure claim.

Receipt: `retention-protected-postgres-fixture-02/receipt.json`, SHA256
`21b76af62290fd8651d0fc63c80b247b93efbcac024443c2f262b703c5d0bc79` in the
external target-proposal packet. Final state hash
`1f88640a4fde05bcb9f3347419612366b7707d99b0034ede30339c008dbb58f5`.
The owned server stopped with exit0 and its Unix socket disappeared. Earlier
stopped generic-writer and gateway fixture metadata remained unchanged.

Fixture01 installed the schema but its operator suffix exceeded the synthetic
24-character limit before any binding/state seed or adapter test. Its failure
receipt `738c1fc4dd903e684009d48610cbbc782176aba61ffb09b69147f537c7899c5f`
is preserved. Fixture02 corrected that operator-only suffix and resumed the
exact stopped, unseeded cluster after actual zero-count checks. No reinstall,
reset, runtime source change or previously passing group replay occurred.

Initial intake, canonical authority and the protected PG→publisher-v4 physical
join remain untested and unqualified. This finite success enables none of them.
