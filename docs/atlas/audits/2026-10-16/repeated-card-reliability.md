# Repeated-card reliability — October 16, 2026

Status: combined source `50b59900fd9527bd177dab4f694d99d5aa3033ca` is live. Native/data/web cutover, 52 canonical route/asset checks and postflight passed. The temporary admission holder was explicitly released at 20:57:11.211 UTC.

## Physical cards and shared references

Separate submissions of the same card design keep separate photographs, geometry, findings, grades, approvals and certificates. Public catalog/listing photograph readings can be reused. Reusing those readings does not reuse a physical card's grade or authorize a second provider dispatch.

The reviewed failures concerned shared reference state and queue progress, rather than a prohibition on grading duplicate card identities:

- An unanswered shared photograph request could hold up other clean photographs. The worker now isolates only overlapping photograph hashes; clean siblings and later eight-photo packets continue. A retained exact response can be projected without another provider call.
- A definitive credit rejection could remain attached to a deleted original owner. A current live submission can explicitly retry that retained request through the updated procedure. The original request hash and old evidence remain intact, and deleted cards stay deleted. An authorized retry abandoned before reservation can be consumed once. A request whose paid outcome is unknown is not automatically replayed.
- Reference work could be starved by grading activity. Cache-only work now proceeds under load. Necessary new acquisition has one global allowance per minute under sustained load, preserving the existing single worker. This is bounded progress, not unrestricted throughput. Historical unresolved analysis can keep the system in this bounded mode.
- Waiting for shared market-photo labels could exhaust the six-failure budget. A proven shared wait now retains its logical attempt. Narrow legacy wait-only failures can recover from their saved SoldComps response. Genuine failures still consume the ordinary retry budget. A 300-second model fetch/body deadline releases a stuck worker; late results cannot alter the settled outcome, and unknown paid requests are not replayed.

Fresh physical source, identity, revision and approval bindings still determine whether saved evidence can be used. Deleted owners cannot prolong a shared wait. No catalog coverage requirement, identity-field blocker, model replacement or grade reuse was introduced.

## Scope and qualification

Reliability implementation: `dc948a5d3111cd1e46677a3a68f4689d7d804007`. The separate human-review performance implementation `3949e104b07d664675f246a39a04abffa6937ad4` is integrated into the frozen combined source. Its scope, controlled timings and limitations are in [the performance audit](human-review-performance.md).

Focused reference/migration tests: 166 passed, plus eight owned PostgreSQL groups and an additional request-age/live-lease case. Focused market tests: 75 passed and 17 owned PostgreSQL groups. Combined root suites: 1,911 passed, zero failed, 11 native/demo skips. Actual Linux image qualification: 329 passed, zero skipped or failed, including the native approval/report cases. These overlapping suites are not a count of unique scenarios. Production staff build and both Vercel candidate builds passed. Candidate source verification covers 2,602 current tree identities/modes, 22 current changed-source reads and 2,580 retained unchanged-byte proofs. Served assets include the performance, identity, variant-unconfirmed, progressive-comps and NFC features.

Additive standalone migration 006 replaces only the exact shared-label retry procedure and inserts one migration ledger row. The coordinated transaction rebinds three existing release controls and verifies preservation of 105 other data tables, previous ledger rows, all other objects and privileges, and migration 005. Astra configuration, scoring, physical image processing, human approval, report selection, labels and NFC remain on their existing paths.

Qualification used synthetic providers and disposable PostgreSQL. No paid diagnostic calls, real human approval, printing or deleted-card restoration was performed. Production click latency and fresh authenticated operator acceptance are not established by these tests.

## Release evidence

The private packet is `~/.codex/atlas-handoffs/atlas-repeat-card-reliability-20261016/release-01`. Every effect uses an exact one-use plan. Older and consumed intents are evidence only; uncertain effects require read-only reconciliation. Root owns the single coordinated native-first release. Final identities, observed transaction preservation and postflight results are recorded in the current Deploy Runbook and SESSION_LOG.

Observed postflight at 20:57:26 UTC confirms all seven current cards, discarded rows, prior READY market results and retained label requests are preserved, with the release holder absent. Native health at 20:57:27 UTC confirms zero restarts, exact image/settings and preserved predecessors/proxy. Evidence hashes: canonical `c38ed097…`, release `5cf6dc8f…`, postflight `2dc84c88…`, native health `ca255cf7…`. Fresh authenticated operator acceptance and production latency remain unmeasured.
