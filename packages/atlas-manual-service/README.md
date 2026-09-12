# Authenticated manual draft persistence

An isolated PostgreSQL repository and staff HTTP boundary for the manual rebuild.
It imports no operator ledger, cohort, card allowance, paid-provider adapter or
commercial writer. Existing ordinary `DurableStaffAuth` phone/session auth is
injected; this package does not establish another login system.

## Composition

```js
const boundary = createDurableStaffBoundary({ auth, manualClient });
const repository = createManualRepository({ boundary });
const service = createManualService({
  repository,
  // Current authenticated card and principal, outside every DB transaction.
  reduce: async ({ card, action, principal }) => {
    // Hydrate hash-verified state; run existing pure/CPU action; store immutable
    // results; return the compact new draft. Server owns HUMAN attribution.
    return compactDraft;
  },
  buildReport: async ({ card, principal }) => compactExactReport,
});
```

The draft envelope is `{cardId, revision, contentHash, draft}`. Geometry, defect
and full report artifacts may be referenced inside `draft`; the host owns their
domain validation and side-specific dependency/revision rules. Every committed
action advances the card revision, even when undo restores earlier values.
No native CPU, storage or model operation runs inside repository transactions.

`service.execute(staff, cardId, {actionId, expectedRevision, action})` accepts a
UUIDv4 action ID, positive revision and an action object with a named `type`.
Only the trusted reducer controls supported domain actions. The public wire
rejects actor/principal/authority fields, raw image/mask keys and oversized data.
Action payloads are at most64KiB; compact draft/report documents at most256KiB.
Large traces must first be staged through an authenticated host artifact route.
Use `service.authorizeEdit(staff, cardId)` before any such storage work; validate
the actual current source, and recheck it through the eventual action/CAS.

For every action, the repository checks current auth and card access, reads the
saved draft, and later performs a short compare-and-set commit of new draft plus
immutable action receipt. Same card/action ID, same actor and same exact request
returns the original receipt/result, including after later edits. Another payload
under that ID conflicts. Another actor cannot reuse it. Concurrent changes cannot
overwrite each other. External work may run twice before a concurrent duplicate
is resolved; this boundary is for manual CPU/storage actions, not blind retries
of paid model work. Unreferenced immutable result artifacts may remain after a
conflict; there is no deletion/garbage collector in this package.

`service.status(staff, cardId, actionId)` returns `COMMITTED` with the exact saved
result/request hash, or `NOT_FOUND`. After a lost reply, retain the same action ID
and payload and read status/retry it. `NOT_FOUND` is an observation at that read,
not proof that another in-flight request cannot subsequently commit.

## Existing staff authority and SQL

`sql/proposal.sql` is an **inactive proposal**, applied only to owned local test
databases. It creates `atlas_manual.card`, `action`, `approval` and narrow helper
functions. No existing schema/migration/role grant is modified. No production
schema, deployment or endpoint is activated here.

Use a separate least-privilege `manualClient`, with the grants returned by
`manualGrantSQL(role)`. The old staff role retains its exact privilege audit.
The manual boundary rejects superuser, ownership, inherited roles and schema or
database creation privileges. The proposed manual role has SELECT/INSERT and
only draft-column UPDATE; it cannot edit ACL/owner, delete history or train staff.
Its server process remains trusted to call the repository: this is application
authorization with restricted SQL privileges, not row-level security against a
compromised manual database credential. Deployment must independently verify the
complete role footprint and secure both clients.

`DurableStaffAuth.authenticate(cookie, csrf)` supplies an opaque handle held in
its existing WeakMap. A copied handle is rejected. A restricted SQL function
rechecks current session, browser, deployment control, approved phone, role and
access version under shared row locks in the same transaction as card access.
The write's card row is locked independently; no old cohort/operator/global gate
is imported. The ordinary initial auth lookup still uses existing staff auth's
short global gate; this package does not silently modify that serving behavior.
Logout or role revocation during CPU work fences the later commit.

The card owner may read/edit/approve, subject to current reviewer role and final
certification. Owner-provisioned reader/editor/approver arrays support additional
explicit assignments. There is no public ACL editor. `repository.provision` is
for an authenticated **server intake adapter**, which must construct the initial
draft from verified photo/preparation sources. It is deliberately absent from
the package HTTP routes; never expose a client-supplied arbitrary initial draft.

## Immutable artifacts and report snapshots

`createManualArtifactStore({transport, prefix})` writes JSON up to16MiB. Call
`write(fullState, {cardId, kind, sourceHash})` and retain the returned reference
plus the source hash in the compact draft. `read(ref, sameLineage)` verifies exact
content bytes/length/hash, media type and lineage before returning parsed JSON.
The immutable key incorporates card, kind, content and lineage hashes. Lost PUT
responses reconcile only that same key. Originals/photos use their existing
separate storage adapter; this JSON adapter never impersonates a photo derivative.

`createS3ManualArtifactTransport` takes an injected SDK client, bucket and locked
`PutObjectCommand`/`GetObjectCommand` constructors. It uses conditional create and
checksum headers, bounds complete streamed reads and closes bodies. Configure
SDK request deadlines/cancellation, private bucket policy and aggregate capacity
in the host. Actual intended-provider conditional/checksum semantics and private
storage acceptance have not been exercised. The file transport under `scripts/`
is an explicitly local fixture; atomic create-only publication and exact rereads
are tested, but it is not the production storage backend or a crash/power-loss
durability claim.

`previewReport` calls a trusted deterministic report builder. Only explicit
`{type:'APPROVE_REPORT', reportHash, reviewed:true}` with the exact preview hash
can save an approval. It rechecks current certification and card approval access
at commit, stores the exact source revision/hash and immutable report, and grants
no learning or physical-finishing authority. `readApproval` and `latestApproval`
return that authorized immutable snapshot. Comparing `sourceHash` with the
current draft hash shows whether later changes changed its content; an approval
action advances the action revision while preserving the draft content hash.
This package creates no public report URL, certificate, label, ownership record
or publication route. Those host actions still require their own integration.

## HTTP and validation

`createManualHandler({service,boundary,origin,assertRequest})` is a Node/Next-style
boundary for GET card, GET action status, GET report-preview and POST actions under
`/api/staff/manual/cards/:uuid`. The host supplies its existing host/router request
assertion and bounded JSON parser. POST requires exact origin, JSON, nonempty CSRF
and ordinary staff cookies. Responses are private/no-store; unrelated routes
return false for host dispatch. No synthetic auth is part of these routes.

`node --test test/*.test.mjs` covers artifact mutation/lineage, same-key lost reply,
concurrent file publication, bounded S3 streams, public authority rejection,
origin/CSRF enforcement and exact-report confirmation.

`scripts/validate-postgres.mjs` uses the repository's existing ownership-checked
native disposable PostgreSQL helper. It accepts only reviewed binary/module
paths plus `--ack-disposable-local-postgres`; it refuses inherited database URLs.
It applies the full existing migration chain with second-deploy no-op checks,
then this proposal only in a fresh owned database. Its existing durable SMS flow
uses an explicitly synthetic Verify provider, never live Twilio. It verifies CAS
races, unrelated-card/observer denial, paused external work with another grader,
real separate-process readback, immutable approvals, certification expiry during
an actual card lock and logout fencing. The owned native validation clusters
were stopped and verified; evidence is retained
outside the worktree. This is native software/auth/persistence proof, not real
phone-photo grading, provider storage, live SMS or production acceptance.
