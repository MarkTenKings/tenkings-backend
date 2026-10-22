# Saved comparable-sales curation — local proposal

This increment is unregistered and has no HTTP, runtime, migration or production grant. It adds private append-only decisions over already-saved market evidence. It cannot call a provider, create a search job, modify an approved report or set a listing price.

A reviewer can select one to five individually reviewed eligible sales, Skip, or record No suitable comps. The server derives the actor, approval/report binding, saved artifact hashes, policy and time. The latest publication attempt must itself be published: a newer pending attempt refuses old reads, new decisions and idempotent retries. Card locking, exact request hashes, revision checks and final authorization protect concurrent decisions and retries.

Exact sold amounts are integer minor units. Undisclosed accepted offers, stale/future dates, ambiguous identity, lots/reproductions and duplicate listing IDs do not contribute. Raw cards, grading companies, grades, special designations and currencies remain separate. Proposed arithmetic-mean guidance includes sample count/range, dates, method and half-up rounding; shipping/tax/fees are excluded. Asking price and listing price stay null. Rights, recency and methodology remain operational decisions; the only supported policy is PRIVATE_INTERNAL / LOCAL_PROPOSAL / UNRESOLVED rights.

The actual current v2 slab projector supplies no confirmed grade designation. The integration regression therefore refuses graded guidance instead of inventing STANDARD. Raw references remain separate. This limitation must be resolved with sourced designation evidence before describing graded curation as operational.

## Verification

Thirteen unit checks passed, including the actual saved v2 projector contract. Owned PostgreSQL17 PG02 passed ten groups with actual staff authentication, finishing packet and saved artifact verification, concurrent revision selection, immutable history, exact retry, restricted grants, latest-pending/current approval gates, ACL/session revocation and intake tombstones. Nine protected tables were preserved, with the single controlled ACL fixture mutation explicitly accounted for.

The exact card-lock waiter PID57031 was observed blocked by57024 before the approver ACL was revoked; the replay refused after unlock. Actual persistent staff sessions do not permit changing issued expiry. Clock-expiry remains unit evidence, not a claimed PostgreSQL time-expiry test. PG01 honestly failed its attempted immutable session-expiry update; its result and verified cleanup remain preserved. PG02 used actual ACL revocation and separately tested actual session revocation.

PG02 result: `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/comp-curation-pg-02/postgres-result.json`, SHA256 `abb5745882375b386d76309149e563041ee9e92eb2eea9319fcfe4cde4e32196`. Exact owned cluster `atlas-staff-db-64foPT` stopped with verification. Zero production queries, provider calls, notifications or financial effects.

Final source SHA256: SQL `3eb42a3f93e4caf7b9e1a53cecd5290ad6b0aaf22cbe35bd039951f8e6cbf0d2`; contract `3a27a8b0344ed8607da1d521ff71ab42d9567b08e274ceb7d5fd140b05eb491b`; service `954de40f0f4cd0a9e4ed4795cb8b52fedff295e6396808b7186342277299a422`; units `2c8aca330286de57120b1526182b7830eb7d3bdf466366652417c50191c80e69`; fixture `179b3c4be44032df5434eb3a4195f537bc16dd9dc38bb4d7da76685b03ca2bef`.

Authenticated transport, persistent UI, methodology/rights approval, migration activation and the complete R1 collection-to-curation journey remain unfinished. This proposal changes no production card or customer price.
