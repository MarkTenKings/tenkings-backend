# Protected retention gateway candidate

This is an **inert, unqualified installation candidate**. No runtime or migration manifest applies it. Its first statement raises `R1_PROOF_RETENTION_GATEWAY_NOT_APPROVED`. The production installer must review the existing function bodies, complete helper/trigger closure, effective grants, immutable intake binding and canonical composition before installing it. The existing R1 integration review is not acceptance.

The ordinary marketplace writer currently submits a whole next document. When this candidate is installed, its existing three public function signatures remain the same, but `commit_state` refuses any change to these six maps: proof uploads, original objects, retention journal metadata, retention operations, upload index and publication index. Unrelated marketplace work and retained reads/reviews remain available. New physical intake must use its separately implemented trusted gateway; this candidate does not provide that missing path.

The existing CAS/journal/event function is renamed to an owner-only helper without changing its body. The ordinary writer, retention writer and PUBLIC cannot execute that helper. A new confined role can execute only `read_retention_state_v1()`, `lock_retention_state_v1()`, `commit_retention_state_v1(bigint,text,jsonb,text,bigint,uuid,text)` and the new bounded singleton accessor `read_retention_binding_v1()`. It has no table, binding, DDL, owner or helper grants. The ordinary role's grant auditor remains unchanged.

The retention gateway accepts one exact C1 transition. It verifies the complete operation hash and closed tuple, installed intake binding and object key, original validated upload, manifest, order/payment projection, immutable prior operations/indexes, exact retained upload/object or cancellation tombstone, and one exact event. It compares the entire proposed document with the document constructed from that transition. It cannot change another order, original, review, event, index or financial record as a side effect. Existing operation IDs and upload/publication identities cannot be replaced. A cancellation barrier must be strictly newer than the original retention fence.

The installation has one immutable intake-binding row and a finite operation limit. It starts empty, so positive writes refuse until a separately reviewed installer supplies the exact binding. A document field, GUC, caller-selected limit or role label cannot activate it. The canonical proof tuples use a bounded UTF8 canonical encoder with ASCII field names and safe integer numbers; the fixture checks its bytes and SHA256 against the existing JavaScript encoder. This encoder is not used to normalize arbitrary application state.

These constraints do **not** prove a genuine logged-in request, current C0 fence, qualified decoder result or publisher original. Those must come from the concrete source-owned handler and installed authority chain. The dedicated role is only an additional database boundary. No JSON report is rebranded as authority. A separate default-off source-owned protected connection/writer candidate now audits the full installed closure and binding; see `PROOF_RETENTION_PROTECTED_ADAPTER.md`. Its fresh actual PostgreSQL17.11 fixture passed20 groups with15 refusals, including the fourth grant; evidence and limits are recorded in that adapter document. Protected initial intake, positive C0 stage and canonical revocation integration remain separate implementation work.

The fourth read-only grant and new adapter are later source changes; the frozen actual gateway receipts below cover the earlier three-function special role. They are not replayed or silently extended to cover this candidate.

## Actual isolated PostgreSQL evidence

The root-owned local PostgreSQL 17.11 fixture used a fresh private Unix socket, TCP disabled, fsync and synchronous commit enabled, and the existing pinned pg 8.16.3 / Node 22.16.0. It used synthetic records only; no financial/provider call, shared database or credential discovery occurred.

`retention-gateway-postgres-fixture-03/receipt.json` in the R2 proposal packet has SHA256 `f0fb4c42e8327981ab902484dd89d0cbc893e7d593aaef28c73d14b6b47347bd`. Six groups passed with 30 expected refusals:

- Exact effective function grants and denial of direct tables, private helpers, common CAS and binding writes.
- All six ordinary-writer proof-map bypasses refused; an unrelated change through the unchanged audited store passed.
- Canonical proof tuple bytes/hashes matched JavaScript, including UTF8/escaping/integer boundaries; fractional values refused.
- Exact C1 commit passed; malformed outcomes, hashes, originals, metadata, events, unrelated state and stale replay refused.
- Exact permanent cancellation passed; prior history/tombstone changes and a non-increasing barrier refused.
- Actual concurrent commit/cancel produced one winner, preserving the other originals.

Final revision was 4 with four commits and three events; state SHA256 `a312cc6c7db5e7a2baa637b1390a711878cee68162b27a2383e7dff51329a864`. The owned PostgreSQL process stopped with exit 0 and its socket was absent. The fixture and all evidence remain intact.

Earlier fixture01 SQL parsing failure and fixture02 ambiguous column-reference failure are retained. The first install rolled back; the second stopped at the first intended missing-binding refusal, before a retention commit. The exact revision-zero synthetic fixture was resumed with one verified helper repair, without resetting or dropping state. Whole-target qualification, genuine producer integration, lost-COMMIT response handling and production installation are not established by these results.


The independent review identified two gaps beyond the first six groups: prior
journal map counts did not prove each original record/index mapping, and SQL
text checks differed from C1's JavaScript trim and UTF-16 length semantics.
The candidate now revalidates every original operation/record and both indexes,
including permanent cancellation barriers, before any new admission. It uses a
private text helper with the exact ECMAScript trim set and UTF-16 unit counting.
No invalid imported history is repaired, discarded or accepted on map counts.

Focused actual PostgreSQL fixture05 passed five new groups, 13 expected refusals
and 88 text comparisons, then committed the previously unused `alter` operation.
Revision5/commits5/events4, state hash
`50bd607fef5569d3e94fb05fcb6255a343b2438ba9858b2626cdf7235e27c2c2`;
receipt `5ab2f22ade4a8b77c2ac7af136eeb96b143c773a3decb891398086685fd07ed3`.
The original six groups were not replayed. Fixture04 compiled the correction but
its follow-up harness mistakenly selected a newly generated ID; it stopped
before writing application state. Fixture05 retrieved the actual stored original
ID and resumed the exact revision-four fixture without reset, DDL or reseeding.
Both owned PostgreSQL processes stopped successfully and their socket disappeared.
The synthetic malformed histories were passed only to the private checker by
the fixture administrator, never installed as database state. Production and
genuine authority/physical composition remain unqualified.
