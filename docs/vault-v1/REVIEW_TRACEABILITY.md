# Vault V1 requirements and review traceability

**Current owner override (2026-09-07):** maximum design 125 doors; compact concept roughly 72 doors with a central touchscreen/Nayax/product-display area surrounded by doors. Both are part of a configurable machine family, not new hardcoded capacities. The 100/150-door statements below record earlier review stages. See `PRODUCT_BASELINE.md` and `FRESH_TASK_HANDOFF_2026-09-07.md` for current authority, source-CAD uncertainty and fresh-task ownership. The precise 125-door DXF is not yet verified.

Review started 2026-09-07 against PR #339 at `92ad20c7f1391b23c55d9c43318eced95072ded9`.

## Current integrated implementation — fresh software task

Focused profile-contract, kiosk and machine commits now preserve the imported corrections and implement schema2 profiles across the product. Root Node20 build and 251 tests pass (11 contracts, 105 machine, 81 kiosk, 9 database, 45 cloud); the safe full Next production rebuild,13 real public-route transport cases and72/125 disposable local HTTP demos also pass. Kiosk browser evidence covers17 scenarios. Three independent reviewers found seven actionable issues on candidate `0c5d9745`; all are corrected with regression evidence below. Review of the new committed candidate and exact-head PR checks remain required.

| Requirement / discrepancy | Implemented correction and evidence | Remaining boundary |
| --- | --- | --- |
| Configurable topology and history | Signed schema2 profiles; separate opaque identity/label/geometry/address; mixed-size/cutout fixtures across1/7/32/72/125/150/256; explicit schema1 compatibility; retained retired history; pinned work snapshots | Complete physical source, actual mapping and applicable interface qualification;256 is a parser bound |
| Service reconfiguration and fit | Exact pending version/digest, empty-machine Technician/Admin confirmation, active financial/command/restock/certification barriers, retained lock and reauthentication; FILLED requires per-door fit attestation | Installed service procedure and actual packaged-product/mechanical acceptance |
| Runtime and external-effect recovery | CLI cloud/config/grant/heartbeat/outbox wiring; fresh pre-checkout proof; durable mock provider; serialization, cancellation, terminality and settlement progression; same original paid-group retry; immutable mode | Official Nayax/controller adapters and vendor-qualified behavior |
| Staff, kiosk and support | Scoped grant revalidation; durable recovery after browser/service interruption; individual PIN, explicit workflow resume and lock; truthful certification FAIL/CRITICAL observations; stable touch/focus/labels and bounded public support | Real contacts, installed Windows/ViewSonic touch/TV/assigned-access acceptance |
| Cloud/admin and transport | Human fresh step-up and machine scope rechecks; credential lifecycle; published-config/evidence integrity; settlement-aware complete reports and BigInt/date handling; bounded raw UTF-8 JSON; typed redacted legacy event parity | Production credentials, config values and authorized deployment |
| Database lifecycle | Additive Vault integrity/profile migrations and receipt-derived legacy finality; full95-migration historical chain, active legacy upgrade/resume, Vault SQL invariants, public Next HTTP legacy150/72/125/256 projections, 151/256 heartbeat counts, profile reconciliation/publication races and concurrent replay passed; second deploy was an unchanged-ledger no-op; container/storage cleanup verified | Separately authorized deployment and installed acceptance |
| Windows, backup and release | Functional manifest/path/hash/link tests, staging-only scripts, bounded SQLite integrity/foreign-key checks and redacted support export | Final pinned runtime/nativeSQLite/service/protected storage and state-aware encrypted update/restore implementation |
| Independent acceptance | Combined tests/builds and simulator/browser evidence; focused commits with append-only session history | Review exact final committed head, resolve findings, normal push to PR339, every exact-head check green, keep open |

### Independent review corrections after candidate `0c5d9745`

| Finding | Correction and regression evidence |
| --- | --- |
| P1: old stocked cloud projection blocks heartbeat before emptying events can sync | Physical reconfiguration waits for prior state-bearing events to be acknowledged; actual runtime/PostgreSQL test delivers old restock facts before activation and creates new membership before new-door events; an in-flight heartbeat race test defers delivery until the new digest is reported. |
| P1: version 3 publication strands locally active version 2 | Exact signed/published intermediate versions advance monotonically while preserving newer pending configuration; actual HTTP rejects downgrade, draft and digest mismatch, then clears only exact latest pending activation. |
| P2: late payment-start failure regresses provider evidence | Emit uncertainty only for an actual REQUESTED-to-UNKNOWN transition; cloud retains stronger observed states and avoids false support cases. Concurrent decline/cancel/authorization/settlement regressions pass. |
| P2: heartbeat database limit remains 150 | Additive profile migration aligns the defensive 256-door envelope; real PostgreSQL accepts 151/256 and rejects oversized/profile-inconsistent counts. |
| P2: mock certification accepts physical classes | Local and cloud reject every non-AUTOMATED class for mocked adapters; all four physical/provider enum values are exercised. |
| P2: reboot revives expired offline staff authority after clock rollback | Shared clock guard persists safe observed wall progress, including offline expiry, and never lowers the retained floor; restart blocks staff/config authority while preserving the one original paid retry. |
| P2: valid large carts overflow support QR capacity | Reference-only QR fallback preserves full pinned labels onscreen; real encoder checks cover 256 long IDs and Unicode labels; failed generation has a terminal contact-instruction state. |

Implementation detail and the separately hashed CAD R01 proposals are in [MACHINE_PROFILES.md](MACHINE_PROFILES.md). Installed physical qualification,5purchase+2restock cycles per applicable door,500real observed sessions, certification and pilot remain open. Simulator results never replace them.

## Historical review baselines and pre-change checklist

**Owner baseline changed during review:** the intended machine now has **100 doors**, one SER mini PC and an OS-free ViewSonic touchscreen. See [current product baseline](PRODUCT_BASELINE.md). The checklist below records the reviewed legacy 150-door implementation; it is not acceptance evidence for the new capacity. Exact physical arrangement/door labels and hardware models are pending before capacity-specific changes.

**Later owner requirement supersedes a fixed-capacity implementation:** support a family of cabinet sizes, door quantities and mixed door sizes through approved, versioned machine profiles using standardized hardware interfaces. The first planned cabinet is 100 doors; neither 100 nor the legacy 150 may remain a global topology assumption. Profile architecture/refactoring can proceed before final CAD dimensions. Actual wiring, hardware limits and installed acceptance still need evidence. See `PRODUCT_BASELINE.md` for the required identity/mapping/history/activation boundaries and the unimplemented status.

## Authority and method

## Fresh software ownership checklist — 2026-09-07 (before implementation)

The frozen source was imported mechanically into `codex/vault-v1-software-20260907` at `abf45a0270334fe383ef7b0110bf94ee15a30f12`: 71 tracked modifications and 32 untracked non-ignored files. Tracked binary diff and all transferred file hashes/modes matched; source remained unchanged. Current fetched `origin/main` is already an ancestor (HEAD has 9 additional commits, main has 0 missing commits). PR #339 is OPEN at the old `92ad20c7f1391b23c55d9c43318eced95072ded9`; historical checks do not certify imported changes.

The intended product is the latest configurable family in `PRODUCT_BASELINE.md`: current design maximum 125, compact exploration around 72 with central controls and display, one SER PC, standardized but unqualified ViewSonic/Nayax/lock interfaces. Original 150-door identities and historical snapshots remain readable. No physical layout or wiring is inferred. The existing checklist below remains historical; this checklist governs the new implementation and fresh validation.

| Requirement | Imported implementation / mock status | Remaining implementation and acceptance |
| --- | --- | --- |
| Versioned, signed machine profiles | Not implemented; v1 config and runtime assume the historical grid | Separate stable ID, printed label, geometry, usable compartment, explicit endpoint/channel mapping, hardware identity and capability envelope. Test varied counts and irregular mixed-size synthetic profiles; incomplete physical drafts cannot actuate. |
| History and safe profile activation | Config/sale pinning exists; topology still fixed | Preserve v1 bytes and mappings; pin profiles with sales, commands, restocks and certification. No activation while a cart/payment/staff/restock pins state; no remapping stocked or paid doors, no deleted retired history. |
| Product fit and controller limits | No usable-compartment policy; flat simulator channels | Explicit fit policy and qualified capacity validation independent of payment limits. No geometry-to-hardware address derivation. |
| Local machine, payment, retry, cancellation and recovery | Saved corrections add runtime/cloud synchronization and durable mock provider | Independently audit all external-effect boundaries, concurrency, idempotency, terminality, reconciliation, storage/clock, offline behavior and staff authority. Same business workflow for mocks and later adapters. |
| Cloud, admin, routes, events and database | Saved authorization/reporting/certification corrections and unrun integrity migration harness | Audit full Vault domain, immutable snapshots, mode isolation, contiguous-prefix projection, public routes, staff scope, bounded evidence, actual PostgreSQL invariants and cross-stack replay. Preserve both exact colon-bearing public URLs. |
| Kiosk customer/staff flows | Saved recovery/accessibility fixes; historical grid and browser fixtures | Render profile geometry/labels without changing identity or filtering positions; maintain touch targets, focus, viewport behavior, paid recovery, support, restock and per-profile certificate coverage. |
| Windows and release | Verified staging scripts only; production package remains incomplete | Audit path/hash safety and run meaningful regressions. State truthfully that pinned Windows runtime/native SQLite, service/protected storage and state-safe activation remain production implementation work. |
| Independent evidence and integration | Imported lane checks are historical, not acceptance | Node20 full tests/builds, Prisma, migration-disabled Next build, public production-route harness, browser/profile/Windows tests, isolation normal/self-test, disposable full PostgreSQL chain/invariants/cross-stack/second no-op/cleanup, final committed-head independent review, normal push and every PR check green. |
| Production and physical qualification | Official adapters and installed hardware unimplemented/unqualified | Official vendor and controller evidence plus adapter implementation, installed Windows/SER/ViewSonic validation, reviewed tax/support, authorized migration/deployment, physical 5 purchase + 2 restock cycles per door, 500 observed sessions, certification and pilot. Simulator proof never replaces these. |

Repository ownership: lead owns shared contracts, root scripts/CI, integration and all shared docs; bounded specialists own only machine, kiosk, or Vault cloud/database paths. The separate CAD task owns only its output copies. No ATLAS work or integration is authorized.

The foundational request is the attached `pasted-text.txt`. The owner-approved product authority is the August 16 Final Engineering Review package, particularly `TEN_KINGS_VAULT_V1_FINAL_MASTER_BLUEPRINT_DRAFT_3.md`, its orchestrator prompt, review decisions, change log, and decision register. Repository context/runbooks govern integration and operational safety. The large shared handoff/session history supplies historical execution claims; those claims require fresh code and test evidence. Card Platform V2 describes only a future identity boundary and cannot gate Vault.

The baseline has contracts and substantial individual implementations, but prior passing tests do not prove an integrated runnable product. Review begins from the requirements below before implementation changes. Evidence and corrected limitations will be appended as each review lane closes.

## Checklist established before correction

| Requirement / blueprint section | Existing implementation to verify | Mock or external boundary | Required verification |
| --- | --- | --- | --- |
| Anonymous 150-door product, X K I N G S / 01–25; four explicit prices; Sports/Pokémon only (§1–3) | vault-contracts, kiosk map, machine/config, cloud domain | Physical signed door/channel map is unavailable | Full canonical order, valid prices, no pack/card/account/ownership writes |
| One local service, one SQLite writer, static loopback browser (§5–7) | store, migrations, CLI, HTTP, kiosk build | Final Windows service/runtime package unqualified | Fresh startup reaches configuration, staff/restock, checkout and synchronization through public interfaces |
| Signed immutable config/tax/support, safe activation (§6,9,15) | config-manager, cloud config routes | Real rates/support values are Admin deployment inputs | No downgrade, mutated published version, mid-cart/staff activation or false inventory |
| Guest mixed cart, exact tax and provider limits (§10.2,12) | machine checkout, money contracts, cart UI | Provider ceilings are deterministic mock capabilities pending Nayax | Atomic concurrent checkout, conflict preservation, pinned snapshots, half-up integer tax |
| Persisted payment intent, authorization, vend result, settlement, cancellation/reconciliation (§10) | machine engine, mock Nayax, event projection | Official Nayax adapter and no-sensor vend policy require G-01 | Real adapter-contract calls reached by runtime; duplicate/out-of-order/crash behavior never creates a second charge |
| Commit sold inventory before serialized commands; one all-original-paid-door retry (§10–11) | engine, controller simulator, SQLite intents | No real controller protocol implemented; G-02 | No unpaid/wrong/third command; pending asynchronous effect cannot count as terminal; retry survives restart |
| Cloud loss blocks new checkout; active transactions/retry continue (§4,9,20) | readiness, event outbox, runtime synchronization | Deterministic local mock cloud for tests | Startup and periodic sync, exact contiguous acknowledgments, backoff, authentication rejection, schema mismatch, reconnect |
| Durable UI/restart/power-loss recovery (§10.7,12) | machine recovery, public-state projection, client intents | Hard power cuts on installed appliance remain physical | Browser reload and process restart use same sale, no blind replay, no stale intent or overlapping sessions |
| Black/gold portrait stable workspace and truthful accessible copy (§12) | all kiosk components/styles | Installed scaling, touch, glare, reach remain G-04 | 150 stable positions; touch/focus/modal behavior; no physical-open claim or customer-close requirement |
| Browse-only idle warning and paid reset/retry timing (§12.5) | public-state timers, kiosk workflow | None for deterministic software tests | Timers run without incidental API calls and do not abandon unresolved external effects |
| Individual scoped PINs, approved roles, lock/safe exit (§13) | auth, operations, kiosk staff, cloud access | Windows protected credential store remains release work | Revocation/expiry/downgrade rechecked, lock after two minutes, blocked-state service entry, restart locked, close confirmation |
| Durable per-door restock, only FILLED restores inventory (§14) | operations/store/restock UI/cloud projection | Human observation required | Planned product snapshot retained; no blind fill; per-command observation, resume, completion and safe exit |
| Human cloud admin, step-up, enrollment/key lifecycle (§9,15,17) | cloud auth/admin routes and UI | No real credentials will be created/changed | Reject static operator/service identities; exact machine roles; Admin-only key/config/financial authority |
| Accurate fleet, inventory, timezone/date and settlement reporting (§8,15) | cloud read models, admin UI | Deployment remains unauthorized | Stale online state cannot remain sales-ready; totals not truncated; explicit date/product/mode filters |
| Same-path certification, immutable TEST mode, deterministic coverage (§16) | operations/certification contracts/UI/cloud approver | Official SDK, bench, 500 human sessions, 5 purchase + 2 restock cycles per door remain external | No self-authorized evidence or test revenue; version-bound completeness, critical stop, retention life + 3 years |
| Storage/clock health, redaction, backup/update/rollback (§7,17–18) | readiness, logger/support, Windows scripts | Final signed package, pinned Node20/native SQLite, service registration, protected storage and installed validation remain implementation | Fail closed on clock/storage/integrity hazards; no traversal/unverified copied artifacts or unsafe state loss |
| API URLs/version/method/body/auth and Windows checkout safety (§9,17) | Next catch-all, API handlers, isolation tool | None | Both colon-bearing public URLs preserved; Windows-invalid paths/collisions rejected; meaningful transport tests |
| Release evidence and safety (§19–20) | CI, test suites, migration source, handoff | No merge/deploy/Production/provider/hardware/pilot authority | Node20 full test/build/Prisma/Next; disposable-only migration chain and no-op; independent final-commit review and green PR checks |

## Initial discrepancies (historical starting point; corrected above)

- Machine CLI has no configuration/staff-grant/cloud heartbeat/outbox runtime wiring; tests seed these internals directly.
- Payment continuation, concurrent checkout, in-flight command finality and staff-grant revalidation require adversarial verification.
- Cloud published-config lifecycle, human role resolution and reporting freshness/completeness require correction.
- Kiosk blocked-state staff entry and existing Windows artifact validation need review.

Production readiness is not established by simulator results or document collection. Real adapters, final Windows release implementation, installed-machine validation, migration/deployment, certification and pilot remain separately required.
