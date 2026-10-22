# Lifecycle-aware ownership reader — local foundation

This reader is **disabled and unregistered**. No deployment migration, role provisioning, route, runtime client or operational policy was activated. It has no Fingerprint dependency. Existing ownership writer, evidence and lifecycle sources remain unchanged.

The separate restricted customer reader exposes live access, explicitly configured UI settings, current published certificate targets, the customer's own claims and bounded transition history. Every read authenticates against current customer control/session/browser/account state; card reads lock and recheck authority before and after projection. Its service permits only the new definer read routine and rejects table, sequence, helper, writer and private-guard capabilities.

Current state comes from the v2 lifecycle projection, including withdrawal and replacement evidence. History preserves actual transition revisions and earlier bundle identities. Legacy submissions retain their original timestamp without a fabricated v2 revision1 transition. A newer PENDING publication does not replace the latest PUBLISHED approval/report binding. Target eligibility reflects current title and the authenticated customer's current pending claims without disclosing competing claimants or owners.

UI configuration defaults unavailable. Deliberate management settings require explicit notice and labels; disabled proof policy leaves own status/history and the existing withdrawal path available. Proof preparation additionally requires an explicitly configured storage boundary and an exact live policy hash. No acceptance, retention or deletion policy is invented; no proof bytes, object keys, signed proof URLs or reviewer identities are returned.

## Source and qualification

Five new files under `packages/atlas-connected-manual`:

| File | SHA256 |
|---|---|
| `sql/card-ownership-lifecycle-reader-proposal.sql` | `8d88b2e50c993a2eca7658ffc959b40062a041b73c7705f3408a02eb58030e9c` |
| `src/card-ownership-lifecycle-read-contract.mjs` | `49c37feb3037bfefc033a13ed4b0e139159ad23e6205521e5dcb93259c9d15bb` |
| `src/card-ownership-lifecycle-read-service.mjs` | `f925c0d7cfbdc79b88a1dba98371feb40d3115a1b57e1ee43a823afdaa2ad578` |
| `test/card-ownership-lifecycle-read.test.mjs` | `ebf333cf7d44e10edda1d7d3a7f2f9140e7b59c3013a0e11dd5b7b6d82c67a18` |
| `test/fixtures/card-ownership-lifecycle-reader-postgres.mjs` | `bcc04038d43bef6a8c5c5794d8a784ed6aed8d5d4a077c6b742ff38ae37e8a06` |

Node22 focused qualification: **16 tests passed, zero skips**. The tests cover closed inputs, existing submission-client wire compatibility, withdrawn/replaced/legacy history, cursor and source binding, private-field refusal, unavailable/management configuration, real CustomerAuth cookie digests and restricted-role checks. These mocks are separate from actual database evidence.

Fresh owned PostgreSQL17.11/Node22.16.0 PG03 passed **seven actual groups**: default/config/current-published behavior; own versus foreign reads and pagination; replacement/withdrawal/legacy history; known-title eligibility; disabled-policy and discarded-source management; SQL capability and forged-binding refusal; session expiry after an observed wait and revoked-account refusal. Ten read phases preserved full JSON contents of all **36 explicitly listed fixture tables**, including authentication, grading, ownership, private evidence and proof lifecycle data.

Waiter **87742** was observed blocked by **87716** on the exact card identity at **2026-10-22 03:14:44.408 UTC**, while its session was valid, before expiry **03:14:46.400 UTC**. After real expiry and unlock, the restricted SQL reader returned `SIGN_IN_REQUIRED`. This qualifies the SQL function's after-wait check, not a fabricated session or production request.

Evidence is retained at `/Users/markthomas/.codex/atlas-handoffs/atlas-detail-release-20261021/qualification/ownership-lifecycle-reader-pg-03/`. `postgres-result.json` SHA256 `13fd16fe4fa0aec8f868809e066ae58be2894d92253a90c8f9eb77d1e381b035`; `cleanup.json` SHA256 `02a8aa070313546d40726de50d42b2b170591cc83624a3386185df1bf84b665c`. Cleanup reports `stoppedVerified:true` for exact owned cluster `/private/tmp/atlas-staff-db-Wnn7O1`; shutdown logs and absent owned postmaster PID corroborate it. Independent review checked all retained/current source pins, the waiter proof, preservation and cleanup without rerunning effects.

PG01 and PG02 failures remain in their separate immutable evidence directories, both with verified shutdown. PG01's fixture census used a grading-document serializer that forbids the proof observation's `pixels` key. PG02's synthetic reviewer authority and grant used different reference/expiry values and were correctly refused. Only the fixture changed: full ordered JSON serialization, then one shared exact reviewer reference/expiry. Product source was unchanged through all three runs.

## Remaining integration limits

Access, configuration, target and `read_claim` outputs match the existing submission browser validators. New `atlas-ownership-claims-page-v2` and `atlas-ownership-claim-history-v2` outputs require an explicit adapter/UI change. **The old v1 history UI/projector is not a fallback**: it cannot represent current withdrawal/replacement semantics. Original mutation request receipts remain original outcomes, separate from current claim state.

Qualification used only synthetic local accounts/cards and trusted synthetic retained-object observations. It does not qualify real storage, decoder isolation, proof authenticity, operational acceptance/retention/deletion policy, public usability or production migration. Those gates and reviewed runtime/UI integration remain outstanding. No production/provider/storage/notification effects occurred.
