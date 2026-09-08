# ATLAS local acceptance — September 8, 2026

This record applies to the M9–M13 completion commit containing this file on `codex/atlas-completion-20260908`, following M7 `0c170947` and M8 `d8d74bb3`. The [approved blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md) remains unchanged. [COMPLETION.md](COMPLETION.md) describes the implemented workflow; this record states what was actually verified and what remains.

## Verified locally

| Area | Observed result | Retained evidence filename |
| --- | --- | --- |
| PostgreSQL and restricted roles | **128/128** scenarios; all 93 original public and 13 additive staff migrations applied; both second deployments were no-ops | `IDENTITY_CORRECTION_DB_SQL_READY.log` |
| Staff unit and component tests | **199/199**, including exact recovery through changed permissions, fresh sign-in, failed replies and changed approval props | `ATLAS_LOCAL_COMPLETE_STAFF_UNIT_FINAL.tap` |
| Private initialization, identity and learning tests | **57/57** | `ATLAS_LOCAL_COMPLETE_PRIVATE_UNIT.tap` |
| Original learning behavior and candidate extraction | **49/49**, preserving original numerical behavior | `ATLAS_LOCAL_COMPLETE_ORIGINAL_LEARNING_UNIT.tap` |
| Operator, service bridge, finishing and Windows source fixtures | **186/186** | `ATLAS_LOCAL_COMPLETE_PACKAGES_UNIT.tap` |
| Public application unit tests | **4/4** | `ATLAS_LOCAL_COMPLETE_PUBLIC_UNIT.tap` |
| Paired staff/public HTTP behavior | **55 checks**, including both actual local application process restarts | `ATLAS_LOCAL_COMPLETE_PAIRED_WEB.log` |
| Staff, public and private builds | All three passed; staff/public route and trace boundaries passed; private database migrations disabled during build | `ATLAS_LOCAL_COMPLETE_STAFF_BUILD_FINAL.log`, `ATLAS_LOCAL_COMPLETE_PUBLIC_BUILD.log`, `ATLAS_LOCAL_COMPLETE_PRIVATE_BUILD.log` |
| Inactive built-production routes | **70 denials**: 27 staff, 11 public, 32 across eight private bridge routes; no session cookies or provider requests | `ATLAS_LOCAL_COMPLETE_STAFF_DENIAL_FINAL.log`, `ATLAS_LOCAL_COMPLETE_PUBLIC_DENIAL.log`, `ATLAS_LOCAL_COMPLETE_PRIVATE_DENIAL.log` |
| Original Sharp runtime | Passed locked runtime, shared imports and build-trace checks | `ATLAS_LOCAL_COMPLETE_SHARP.log` |
| Historical migration bytes | All 93 original public and eight previously committed staff migrations byte-identical to M8 HEAD; five new staff migrations are additive | `ATLAS_LOCAL_COMPLETE_HISTORICAL_HASH_CHECK.json` |
| Windows NFC helper source | Full .NET 8.0.424 compile: zero errors/warnings; **18 test groups passed, eight Windows-only groups skipped** | `ATLAS_NFC_DOTNET_VALIDATION.md`, `NFC_DOTNET_BUILD_FINAL.log`, `NFC_DOTNET_TEST_FINAL.log` |

The five JavaScript/TypeScript suites total **495 passing tests**, without counting repeated focused runs. Existing image/CSS and hook-dependency build warnings remain; builds are not warning-free.

Browser verification on desktop and at 390 × 844 covered report, label, correction and operations layout. A deliberately paused, owned local staff server proved the 15-second draft timeout releases controls while retaining the exact operation. Editing newer notes, attempting navigation and reloading saved state preserved that operation. Exact recovery saved the original draft while preserving newer local notes; a separate explicit save persisted those notes. Navigation and Back then returned to the correct saved card. Earlier label lost-reply recovery passed after sign-in in another tab, with Back/Forward history preserved. Console errors were empty. The correction browser fixture verified layout and unavailable-state behavior; successful identity mutation and receipt recovery were established by actual PostgreSQL service tests and component tests.

Both owned PostgreSQL clusters report `stoppedVerified: true`; the paired applications and temporary denial servers exited, and browser tabs/viewport were cleaned up. Tests used synthetic captures, fake readers and isolated loopback services. No deployed service or database was restarted or migrated. The evidence directory retains earlier failed runs and their cleanup records as history.

## Reproducible operator package

Two closed Darwin arm64 packages using actual official Node 22.23.2 reproduced exactly, with the current M13 schema, locked generated client, Prisma engine and original source closure: **25 files, 135,069,444 bytes**.

- Build hash: `60c5e931b3ff560b9d8aa78536f0b873c49dcd5e10239788f391cbf8327d20b1`.
- Manifest SHA-256: `5b2644d3b7e0b9b69ad1fd5227bb1829fff42781a7e44b319943331928d2b3af`.
- Evidence: `RELEASE_ARTIFACT_INITIALIZATION_V2_M13.package.json`, its `_REPEAT.package.json`, manifest receipts and `RELEASE_ARTIFACT_INITIALIZATION_V2_M13.verify.json`.

These packages have explicitly **synthetic, inactive release bindings**. They are reproducibility evidence, not an activation artifact. The actual selected host needs a package bound to the accepted source and real reviewed policies. Linux additionally needs its selected native/ELF closure and matching engine. See [operator runtime instructions](../../packages/atlas-operator/README.runtime.md).

## Remaining operational acceptance

The preparation release remains **null**. Live staff/provider/worker/NFC controls remain inactive. No real-card processing, SMS, paid model/worker request, physical print, native print-dialog acceptance, real NFC encoding/lock, assembly or sonic weld occurred. Learning approvals record an exact reviewed subset as `APPROVED_PENDING_APPLICATION`; no global learning-bank writer was added.

The next release needs selected staff/public/private and operator hosts, protected distinct credentials, current source/storage/preparation/worker evidence, assigned trained humans and explicit caps. Its publication, migration, deployment and activation actions require their exact operational scope. Validate the eight skipped Windows groups and all three PowerShell configuration/maintenance/update suites on the actual workstation, then real label scale/QR, reader, signer, encoding, permanent lock, hosted receipt and physical finishing. [Windows configuration](../../scripts/ai-grader-nfc/ATLAS_CONFIGURATION.md) and [finishing instructions](../../packages/atlas-finishing/README.md) describe those boundaries.

Final supervised acceptance is **exactly ten real cards**, with the approved cohort, time window, reviewers and per-card/batch limits. Record measured quality, failures, elapsed time, reconciled invoices and every physical result before owner acceptance or expansion.

Private evidence is retained in the task's `atlas-handoffs/2026-09-07` directory. `FINAL_LOCAL_ACCEPTANCE.json` binds the final source commit to evidence hashes; `RELEASE_PLAN.md` lists the concrete remaining inputs and execution sequence. These records contain no authorization to activate live work. The repository handoff history is [SESSION_LOG.md](../handoffs/SESSION_LOG.md).
