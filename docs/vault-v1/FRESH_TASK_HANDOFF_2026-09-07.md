# Vault V1 — fresh Astra Max ownership handoff

Prepared 2026-09-07 (America/Los_Angeles). This is a saved-work transfer, **not** a final software review, test certificate, fabrication release or production-readiness claim.

## Owner instruction and ownership

Mark explicitly approved two fresh GPT-6 Astra tasks at Max reasoning and retiring the prior task from implementation. Do not request the same approval again. Vault and ATLAS are different projects/companies: no ATLAS integration, coordination or business-logic work is authorized.

1. **Software and system integration lead:** owns the entire Vault software review, profile architecture and implementation, adapter contracts, simulated local testability, regression tests, CI, integration documentation, final exact-head independent review, commits and PR #339. It integrates the hardware task's agreed profile requirements. It must not wait for final cabinet dimensions to remove hardcoded topology safely.
2. **CAD and hardware design lead:** owns precise source-CAD verification, versioned CAD variants, assembled layout/clearance documentation, hardware parts/BOM research and the hardware-to-software interface specification. It collaborates directly with Mark on compact variants. It works in its own output folder and treats all repository/source CAD files as read-only. It does not edit software, database, CI, shared handoff or session log, commit or push the software PR. Send proposed interface updates and artifact paths to the software lead for integration.

The prior task will finish this transfer, then stop implementation. The new tasks must not both edit the same files. The software lead owns repository integration; the CAD lead owns its new CAD/BOM output directory. Both preserve original source files and unrelated work.

## Current product direction

- One supported application build for a configurable family of Vaults with different cabinet dimensions, door counts, door sizes and nonuniform layouts. Current maximum design: **125 doors**. Compact exploration: **roughly 72**, not a finalized minimum/count.
- Compact layout: touchscreen, Nayax terminal and product-display cutouts in the center, surrounded by doors, replacing the side control panel concept. Explore cabinet width/height/depth and display-case dimensions for fabrication cost/speed. Mark is considering 1–2 inches less touchscreen width to align door columns; verify actual available display dimensions and mounting, never assume an existing panel can be physically resized.
- Standardize locks, ViewSonic TV and touch displays, Nayax terminals and one SER mini PC per machine. Exact part numbers, controller protocol/capacity, firmware, OS and physical qualifications remain unresolved. Same brand does not establish interface compatibility or electrical/thermal suitability.
- Read `PRODUCT_BASELINE.md`. Stable internal door IDs, printed labels, physical/display geometry and controller addresses are separate. Support irregular center cutouts and mixed sizes. Usable compartment volume differs from the door opening. Define product-fit policy explicitly.
- Signed/versioned profiles need capability bounds, safe service-boundary activation and historical sale/command/restock/certification snapshots. Do not remap paid doors, change old records or erase retired-door history. Existing 150-door data must remain interpretable even though the latest new-cabinet target is at most 125.
- Door count is not the payment/cart limit. Preserve payment-provider constraints, inventory authority, concurrency safety, offline behavior and staff security across profiles. Geometry changes within qualified interfaces should be configuration changes; new interfaces/semantics can require code and qualification.

## Foundational sources and reading requirements

Read AGENTS.md and its mandatory documents before task actions. Current worktree AGENTS also requires the full `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`; read for isolation/context, not as a Vault dependency or authorization for non-Vault work.

- Original attached request: `/Users/markthomas/.codex/attachments/aa686732-83ce-48eb-8a21-52120942663b/pasted-text.txt`.
- Original engineering package: `/Users/markthomas/Downloads/Ten_Kings_Vault_V1_Complete_Codex_Handoff_Package/Final_Engineering_Review_2026-08-16`.
- Five original authority documents are archived unchanged under `docs/vault-v1/authority/`, with an explanatory README. They describe the historical 150-door product; newer owner decisions override conflicting dimensions and hardware.
- Mandatory context: `docs/context/MASTER_PRODUCT_CONTEXT.md`, `docs/runbooks/DEPLOY_RUNBOOK.md`, `docs/runbooks/SET_OPS_RUNBOOK.md`, `docs/HANDOFF_SET_OPS.md`, complete append-only `docs/handoffs/SESSION_LOG.md`, plus AGENTS-required V2 blueprint.
- Search all repository Vault requirements, including `docs/vault-v1/ARCHITECTURE_AND_OWNERSHIP.md`, `API_CONTRACTS.md`, `GATE_LEDGER.md`, `EXTERNAL_EVIDENCE_PACKETS.md`, `THREAT_MODEL_AND_FMEA.md`, `OPERATIONS_RUNBOOK.md`, `TEST_AND_CERTIFICATION_MATRIX.md`, all relevant ADRs and package/Windows/kiosk README files.
- `REVIEW_TRACEABILITY.md` was established before code correction. It records legacy requirements and initial findings, not current acceptance. Update intended/implemented/mock/remaining traceability before further changes.

Trust code, runtime, database and test evidence for what exists; correct conflicting current documentation while preserving historical session entries. Do not trust prior review/test claims as fresh evidence.

## Exact saved software state — preserve before continuing

Read-only source of the complete saved changes:

`/Users/markthomas/tenkings/ten-kings-vault-v1-build`

Branch: `codex/vault-v1-build`.

Reconfirmed local HEAD: `abf45a0270334fe383ef7b0110bf94ee15a30f12` (merge of then-current main `7bde06f65959e376e12725186d605cc91c67852b`). Both complete main/candidate session-log sequences were retained during that merge. Many tracked modifications and new untracked files remain saved and **uncommitted**. They are valuable in-progress work, not disposable scratch.

Last prior live PR #339 observation was OPEN at remote head `92ad20c7f1391b23c55d9c43318eced95072ded9`, with historical green checks. Reverify live remote/main/PR state; no new exact-head green claim exists. Do not merge.

The fresh software task is to start an isolated worktree from the existing `codex/vault-v1-build` branch, then safely import **all** saved tracked modifications and untracked non-ignored files from the source above before implementation. A branch checkout alone does not contain them. Preserve paths and binary contents; verify complete tracked diff equivalence and per-file hashes for untracked content before declaring transfer complete. Do not copy ignored dependencies, caches, credentials or environment files. Do not mutate/remove/reset the source worktree. If the new task was provisioned from an unexpected base, correct the transfer safely rather than overwriting unrelated files.

The unrelated original checkout `/Users/markthomas/tenkings/ten-kings-mystery-packs-clean` is dirty and is **not** the source for these uncommitted Vault changes. Do not import its changes or work in it. Never force-push; the new worktree may have its own local branch, but final reviewed commits must update remote `codex/vault-v1-build` normally after reconciling its actual remote state.

No final validation, exact final-head independent review, correction commit or push has occurred. All previous internal implementation agents finished. No production service was started/restarted and no CAD source was modified.

## Saved corrections requiring independent verification

### Machine, contracts and runtime

- Atomic/concurrent checkout and final readiness checks; persisted cancellation across pending starts/restarts; vend-result and settlement progression; no second checkout while a provider session is unfinished.
- Distinguish genuinely finished controller operations from in-flight SENT_UNKNOWN state. No Done, staff operation or observation while an external effect remains in flight. Preserve sold-before-command, serialized commands, original paid-door retry and maximum command attempts.
- Revalidate scoped staff grant expiry/revocation/version and PIN hash on use; takeover/reauthentication audit; certification-linked session behavior; safe close and restock semantics.
- Configuration signatures/cache, pending safe activation, pinned sale/cart state and expiry; rollback/storage health gates, integrity and process-lock cleanup.
- Atomic event/outbox writes, payload validation, redaction, UTF-8 byte-bounded batches, contiguous acknowledgments, coalesced flushing and backoff without overtaking. Cloud callback references hashed rather than copied raw.
- New `cloud-client.ts` and `runtime.ts`: authenticated/versioned bounded HTTPS transport, config/grants/heartbeat/outbox synchronization, local timer/payment advancement, fresh cloud check before new checkout, paid local work continues during cloud loss. Explicit loopback test exception only.
- New `durable-mock.ts`: independently locked SQLite simulated-provider state survives machine restart. CLI now wires the runtime and durable mock with explicit config/provenance, Node20 and failure cleanup.
- Backup/restore hardening includes a 256 MiB bound; reconcile docs and final-release requirements with actual behavior.

### Cloud and database

- Scoped human/admin authority, step-up and lifecycle boundaries; BigInt-safe DTOs, fleet freshness, draft-only config/publish rules, filtered complete reports and timezone handling; explicit destructive-preview confirmation logic (no real destructive operation authorized).
- Fixed redaction falsely matching `pin` inside `mappingVersion`; event projection and refined certification-contract validation regressions.
- Bounded existing-storage-key/hash/build-bound evidence; no caller-provided fake counts or arbitrary evidence URL fetch. Simulator proof cannot qualify physical certification. Certificate invalidation on observed release/config/schema identity changes, consistent locks and immutable scoped links.
- New source-only migration `packages/database/prisma/migrations/20260907010000_vault_v1_review_integrity/migration.sql`, Vault-only schema changes and invariant triggers. Do not apply outside disposable harness.
- New real SQL invariant assertions `packages/database/scripts/validateVaultV1Migration.sql` and root cross-stack `scripts/validate-vault-postgres.mjs` are **not yet run**.

### Kiosk, routes, Windows and CI

- Recovery/blocked staff entry, session renewal without blindly replaying mutations, touch/idle lock, accessible layout/focus, contact QR/support projection, same-path certification UI and paid-flow layout corrections.
- Browser geometry/click tests exist for portrait widths 720/768/864/1080 using historical 150-door fixtures; these are not installed hardware or new-profile acceptance.
- Windows release verifier checks manifest/hashes/path safety. Install/update/rollback scripts are **verified staging only**, not completed service installation or safe production activation. Final Windows release work remains substantial.
- Isolation validator inspects Git index plus new paths, Windows-invalid/reserved/trailing/protected names, collisions and length bounds. Portable Node test discovery replaces shell wildcards. Original colon-bearing API URLs remain behind Windows-safe `[...action].ts`.
- New `scripts/test-vault-next-routes.mjs` exercises a real production-built Next server on ephemeral loopback with an explicitly unusable local database address; it is **not yet run**. CI wiring includes browser tests, public-route harness and isolation self-tests.
- Root lockfile adds only the kiosk Playwright 1.57.0 importer entry for the saved browser tests, before any later edits; recheck actual diff.

## Historical lane-level validation — NOT final-head certification

Previously observed under Node20: machine build and 81/81 machine tests; cloud 29/29; database Vault 9/9; kiosk 63/63 plus kiosk build; public-support projection 1/1 (may overlap cloud total); browser layout/click runs at the four widths above; isolation self-test 57 assertions. Contracts/database builds passed in lanes. Machine simulation includes 1,000 transaction sessions and over 16,000 generated state operations across 1,000 varied payment/controller sequences.

These runs preceded the latest combined changes and profile refactor. Do not sum overlapping suites or claim this as a final total. A prior Next TypeScript check had zero Vault-source errors but 12 unrelated existing AI Grader/Speedster test type errors; this is not a successful full Next production build. Root loopback/runtime regressions passed 8/8 before later lane completion. New production-route and PostgreSQL harnesses are unrun. Confirm everything independently.

## Required software completion and safety

1. Verify transfer and live repository/PR/main state; preserve all unrelated mainline work and both complete append-only session histories when safely integrating current `origin/main`.
2. Establish full updated product traceability before code changes; audit all code/contracts/schema/state/payment/controller/recovery/kiosk/admin/security/offline/Windows/CI/docs and fix every actionable software-owned finding with meaningful regressions. Implement supported versioned profiles without guessing actual physical wiring.
3. Use Node20; known local executable `/opt/homebrew/opt/node@20/bin/node` was v20.20.1, pnpm9.12.0. Put that directory first in PATH and recheck versions/native SQLite compatibility.
4. Run `pnpm vault:test`, `pnpm vault:build`, `pnpm vault:validate-isolation` and `pnpm vault:validate-isolation --self-test`, Prisma validation, full Next production build with migrations disabled and safe local/nonproduction config, `pnpm vault:test-next-routes`, browser/profile/Windows route regressions, and `git diff --check`.
5. Log the planned disposable migration action, then run `pnpm --filter @tenkings/database validate:nfc:migration:disposable -- --ack-disposable-local-postgres` with Node20 and working local Docker. The existing guarded loopback/tmpfs harness now includes full migration history, all existing non-Vault checks, new Vault invariant SQL and cross-stack machine-to-real-Prisma event assertions, followed by second-deploy no-op/unchanged migration ledger and cleanup. Inspect guards; never redirect it to a real database. Docker binary exists but daemon availability was not established. Log observed result and cleanup. Fix the unrun new tests rather than weakening them.
6. Update `docs/HANDOFF_SET_OPS.md` and append `docs/handoffs/SESSION_LOG.md` after commit-worthy changes. Create focused commits. Have an independent reviewer inspect the **exact final committed head**, resolve all findings and repeat review/validation after any changes. Push normally to `codex/vault-v1-build`, update PR #339, and require every check on that exact head green. Keep PR open.
7. Final report: findings/corrections first, exact commit SHA, local checks, exact-head PR checks and precise remaining implementation/evidence gates.

No merge, Production access/mutation, migration outside the disposable harness, deployment or service restart, credential changes, Nayax activation, payment charge, real controller commands, hardware actuation, physical pilot or fabrication release. Local disposable test subprocesses are permitted; this does not authorize restarting serving systems.

Production still needs official Nayax information **and adapter implementation**, real controller information **and adapter implementation**, qualified wiring/electrical/thermal/mechanical design, final Windows release package with pinned Node20/native SQLite, service registration, Windows-protected credentials and state-aware update/rollback, installed SER/touchscreen/TV validation, approved real tax/support configuration, separately authorized migration/deployment, physical certification and pilot. Collecting documents alone does not make a machine production-ready. Preserve original per-door certification policy (5 purchase plus 2 restock cycles per applicable door), 500 real observed sessions and other original gates unless Mark explicitly changes them; simulations do not replace physical proof.

## CAD/hardware source and precision notes

The directly inspected source is `/Users/markthomas/Downloads/Ten_Kings_Vault_Rev27_FINAL_QA/04_DIMENSIONED_4x10_SHEET_LAYOUTS/Final_Ten_Kings_Vault_Rev27_All_5_Sheets_DIMENSIONED.dxf` (ASCII AutoCAD 2018 AC1032). Its 100 cut rectangles are 5.000 by 2.250 inches, five columns by twenty rows. Five 48 by 120 inch stock-sheet layouts are not an assembled machine drawing. `4x10` refers to stock sheet feet, not a door grid.

Notes include TD1655 portrait cutout 7.7 by 13.6 inches, a product-display cutout 8 by 30 inches, Nayax mounting notes, TV front opening 27.55 by 15.55 inches, and field-drilled hinge notes. These are prior read-only observations, to recheck in source. They establish no controller mapping, assembled clearances or electrical design. ViewSonic's published TD1655 external body is about 13.99 by 8.8 by 0.58 inches; behind-panel cutout versus body dimensions require a mounting/overlap/cable/touch-access check, not an assumption that the cutout must equal the body. Verify official specifications and exact selected models afresh.

Mark says his latest supplied drawings have 125 doors. A targeted read-only inventory found `/Users/markthomas/Downloads/Ten_Kings_Vaults_Master_Blueprint_40x24x80_125Door_Rev_6(1).pdf` as a candidate (filename only, contents not verified); no matching newer 125-door DXF has been verified yet. Locate and reconcile source revisions before editing, or ask Mark for the exact authoritative file. Do not silently change owner intent to fit Rev27 or present provisional geometry as measured truth.

Additional located references (historical or unverified, not automatically authoritative):

- `/Users/markthomas/Downloads/Ten_Kings_Vault_Rev27_FINAL_QA_and_Dimensioned_Sheets(1).zip`: DXF/STEP part files, sheet layouts, `PART_INDEX.csv`, `ALIGNMENT_MATRIX.csv` and QA reports; archive entries include `Customer_Door_QTY100`.
- `/Users/markthomas/Downloads/Ten_Kings_Vault_V3_All_Fabricated_Parts_Package_Rev_P1/output/cad/P1_all_parts/`: historical individual fabricated-part DXFs/SVGs.
- `/Users/markthomas/Downloads/Ten_Kings_Vault_Blueprint_Final/Ten_Kings_Vault_V3_FINAL_Work_Handoff_Package/`: historical START_HERE specifies 150 doors; includes `Ten_Kings_Vault_V3_Final_Master_Blueprint.xlsx` and `Ten_Kings_Vault_V3_Manufacturing_Handoff.pdf`, located but not inspected during transfer.
- `/Users/markthomas/Downloads/Ten_Kings_Vault_Component_Research_8in_vs_10in_Front_Panel.xlsx`: located component research, contents not inspected during transfer.

The CAD lead should inventory only Vault sources, preserve original bytes, record source hashes/units/revision and coordinate systems, and create separately named editable DXF variants and viewable drawings. AutoCAD is available per Mark and may be used; verify local tooling before promising app control. Work from real CAD entities and dimensions, not traced screenshots or generated illustrations. Validate entity geometry, closed cut contours, duplicate/overlapping cuts, hole/slot quantities, units/layers, stock nesting, bend/material allowances, assembled fit, service access and all changed measurements. Round-trip/open final DXFs and visually inspect them. Record unresolved tolerances, lock/hinge/controller/power parts and mechanical/electrical approvals explicitly. No parts purchases or fabrication commands are authorized.

The hardware/software interface delivery should identify model/profile revision, door inventory and stable labels, physical/display positions and usable dimensions, control/display openings, exact proposed part numbers, qualified controller capacities and **separately verified** wiring address map. Mark/fabricator/qualified electrical review retain approval of physical manufacturing and safety. The software task may build synthetic profiles for tests while physical profiles remain provisional and non-deployable.
