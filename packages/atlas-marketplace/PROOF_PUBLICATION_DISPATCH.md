# Typed decoder dispatch settlement

This is default-off, **UNQUALIFIED internal storage and transport machinery**.
It adds no physical runtime wiring, admission capability, canonical authority,
customer endpoint, C1 retention producer, or new decoder wire message. A clean
transport completion is not customer publication permission. Claims, history
and pricing remain off.

The exact publisher UID continues to own the concrete synchronous SQLite writer,
volume seal, encryption key and original-only filesystem writes. Existing v1
objects, envelopes, manifests, keys, retained reads and v2 APIs are preserved.
No injected store, clock, authorizer, receipt callback or fault hook is accepted.

## Source-owned producer checks

`proof-decoder-target-broker.mjs` keeps its existing private per-client handles
and outcomes. New direct exports look up those maps without calling supplied
object methods:

- `assertProofDecoderTargetBrokerClient(client)`
- `assertProofDecoderPreparedSubmission(handle,{client})`
- `assertProofDecoderClientOutcome(actualValue,{client})`

The prepared verifier accepts only that client's unclaimed PREPARED handle. The
outcome verifier accepts only an actual result/error created by that client;
it returns the stored disposition and original prepared report, plus the frozen
actual terminal completion for COMPLETE_CLEAN. Errors are never classified by
code/text, caller booleans or serialized fields. Existing `lookupDisposition`
behavior and transport framing remain unchanged. These checks establish origin
within the process, not decoder qualification or execution authority.

## Explicit v3 ownership

`migrateProofPublicationLedgerV3({enabled,descriptorPath,encryptionKey,
linuxObserver,expectedLedgerId,expectedRevision,expectedHeadHash,migrationId})`
requires the genuine Linux observer and a clean, exactly closed v2 checkpoint
(or the clean initial v2 migration with no session). It opens the same database
inode, refuses sidecars and existing owner locks, validates history/seal, and
acquires durable exclusive ownership before changing anything. One SQLite
transaction creates the v3 tables, records the exact prior checkpoint and state
hash, appends DISPATCH_MIGRATE, and sets `user_version=3`. The existing seal format
advances to the new head only after COMMIT. Existing event bytes and v1 rows are
never rewritten. Any partial/unknown migration retains the writer lock; neither
v2 nor v3 opening removes it. There is no new-directory, PID-absence, stale-lock
or generic reset path.

`openProofPublicationDispatchStore({enabled,descriptorPath,encryptionKey,
linuxObserver})` opens only v3. It shares the concrete owner implementation and
existing publication/session/barrier/read methods. The existing v2 entry point
continues to require v2. Both return null by default. Runtime source closure now
includes the genuine broker producer/verifier modules; installed older closures
and their evidence are not overwritten by these source changes.

The v3 tables are `decoder_dispatches`, `decoder_settlements` and
`decoder_dispatch_migration`. All are append-only, with UPDATE/DELETE refusal.
Decoder request and canonical stage IDs are unique in dispatches; each dispatch
has at most one outcome row, including UNKNOWN. New versioned event variants
coexist with unchanged old event shapes. Every old hash-only `external_holds`
row remains permanently absorbing; it cannot be adopted by a new private token.
Reopen recomputes the hold count as old holds plus typed dispatches lacking a
clean terminal outcome. Historical settled rows are durable facts, never freshly
minted live producer objects.

## Concrete finite methods

`beginDecoderDispatch({operationId,expectedRevision,sessionId,stageBinding,
client,prepared})` obtains the actual prepared report directly from the private
producer. It requires ACTIVE session, exact CAS, no existing hold, live original
boot/deadline and locally unrevoked scopes. The stage must use the same original
boot and deadline as the prepared handle. It stores the complete ledger/session,
six-field session binding, stage/fence identity, and prepared request (original
hash/size/type, request ID, deadline, boot, epoch, broker/profile/limits hashes).
Canonical stage request ID and decoder request ID remain distinct fields.

Before the durable intent, the actual handle is privately bound to this owner,
operation and complete identity. A second registration cannot borrow it across
sessions, owners or ledgers. Exact registration replay while still PREPARED is
idempotent. A failed write poisons the owner and does not unbind the handle. No
proof bytes enter the publication ledger. The caller subsequently submits this
same client handle once; registration is not permission to do so. The future
host still needs the real canonical DECODE fence and request producer.

`settleDecoderDispatch({operationId,expectedRevision,dispatchOperationId,client,
outcome})` requires the original same-process client association and its actual
produced outcome. It compares the entire prepared identity. COMPLETE_CLEAN with
SUCCESS or INVALID_IMAGE, or exact KNOWN_NO_START_SENT, appends one settlement
and reduces the held count. A preparation failure with `request:null` cannot
match. UNKNOWN appends a permanent uncertainty outcome and keeps the hold.
A later empty observation, deadline expiry, 404, fabricated result, new client,
new operation ID or process restart cannot change UNKNOWN to clean.

Settlement can complete an obligation in DRAINING; it does not reactivate a
session, erase a scope tombstone, renew a deadline, alter attempt counters or
permit fresh publication. Exact settlement replay with the same real outcome
returns the original record; conflicting IDs/outcomes refuse. No RETAIN or
hash-only hold can use this method. `lookupDecoderDispatch({operationId})`
returns bounded unqualified historical data only.

One active dispatch is admitted. Capacity reserves its settlement in addition
to existing close and per-barrier maintenance reserves. All existing finite
session/object/operation/event/database/byte limits remain. A clean session can
close and a successor can open on the same ledger; process loss with an active
or unknown dispatch retains the lock. Decoder/broker lifetime capacity and
canonical generation installation remain separate concerns; this module resets
neither.

## Verification scope

Eight new local tests cover closed data, direct fake-producer refusal, complete
identity/boot/deadline binding, null/unknown outcomes, retained old holds, terminal
matching, maintenance reserves, and exact SQLite constraints. Two affected v2
checks cover default-off/refusal behavior and existing capacity reserves. These
are data/refusal tests, not genuine producer or Linux IO qualifications.

`scripts/qualify-proof-publication-dispatch.mjs` is an explicit operator harness.
Root first calls `prepare BASE UID GID APP WORKER` for fresh synthetic fixtures
(public key byte 0x51), then supplies a protected closed operator configuration.
Metadata mode requires the real observer and publisher UID; it exercises the
same-inode v2→v3 migration, preserved old original/history, genuine prepared
handle discard settlement, cross-owner reuse refusal, DRAINING barriers, clean
successor/reopen, old-hold refusal and three owned child SIGKILL boundaries.
Crash instrumentation exists only in that operator child, never runtime source.
These are process crashes, not power-loss qualification.

Separate `complete` and `unknown` modes accept one root-supplied public original,
emit the exact durable REGISTERED identity, and wait for bounded `SUBMIT\n`
before calling the actual client. Root owns the real broker/fault setup. No fake
peer, observer, outcome, receipt or synthetic positive capability is available.
Unknown outcomes retain the fixture lock. No target execution is claimed until
root records the actual run; passing older worker/C1 cases is not evidence for
this new join. D2 retention settlement and the genuine C0/qualified physical
composition remain unimplemented in this tranche.
