# Ten Kings Vault V1 — Codex Orchestrator Build Prompt V2

## Mission

Build Ten Kings Vault V1 in the existing Ten Kings monorepo, faithfully implementing `TEN_KINGS_VAULT_V1_FINAL_MASTER_BLUEPRINT_DRAFT_3.md`.

This prompt is an execution contract, not blanket authorization for external or production actions. Vault V1 software implementation is authorized as an independent project. The orchestrator must enforce every payment, hardware, tax, migration-application, deployment, and certification gate. When a gate is not evidenced, continue all implementation that does not depend on that missing real-world fact, use the approved mock/simulator boundary, and stop only the affected external action with a decision-ready blocker report. Never invent provider behavior, hardware facts, tax rules, or owner approval.

## 1. Mandatory first actions

Before planning, editing, installing dependencies, creating a branch, running a migration, or spawning implementation agents:

1. Read the repository’s `AGENTS.md` in full.
2. Read:
   - `docs/context/MASTER_PRODUCT_CONTEXT.md`
   - `docs/runbooks/DEPLOY_RUNBOOK.md`
   - `docs/runbooks/SET_OPS_RUNBOOK.md`
   - `docs/HANDOFF_SET_OPS.md`
   - `docs/handoffs/SESSION_LOG.md`
3. Read the complete owner-approved `docs/specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md`.
4. Read the complete Vault Draft 3 blueprint, review report, change log, and open decisions list.
5. Report exactly:
   - `git status -sb`
   - current branch
   - short HEAD
   - relation to `origin/main`
   - unresolved conflicts and whether the worktree is safe to edit
6. Fetching remote state, switching branches, creating a worktree, installing dependencies, or changing files requires authorization implied by the active build request and repository rules. If the current tree is dirty or conflicted, do not disturb it. Propose or create an isolated clean worktree only when authorized.

Do not deploy, restart, migrate, activate hardware, send a live payment, or access production data unless the owner explicitly authorizes that exact action.

## 2. Non-negotiable product decisions

Preserve:

- 150 doors: columns `X K I N G S`, rows `01–25`.
- Sports and Pokémon products at $25/$50/$100/$250.
- Guest checkout.
- Mixed-product, multi-door cart and one Nayax payment flow.
- Sales tax at checkout.
- Configurable product name, photo, description, price, category, and active status.
- No door sensors, pack QR scans, customer close-door step, substitute doors, or remote unlock.
- Exactly one customer-requested transaction-level `OPEN DOORS` retry; it sends one second command to every original paid door and never to a substitute or unpaid door.
- Windows mini PC, portrait touchscreen, local-first runtime, premium black/gold UI.
- Staff/restock and certification modes.

If implementation evidence forces a product change, stop and present the conflict, impact, options, and recommendation. Do not silently rewrite these decisions.

## 3. Locked independence decision and evidence gates

Create a gate ledger before implementation. Each gate entry must contain status, exact evidence, approver, date, affected phases, and artifact links.

### Locked owner correction — Vault is independent

Mark confirmed on August 16, 2026:

- Vault V1 has zero dependency on Speedster.
- Vault is a separate product, branch, local runtime, and data domain and may be built immediately on a clean branch.
- Do not pause, defer, or ask for Speedster completion before building Vault.
- The V2 physical-vending deferral applies only to a future V2 pack/card identity bridge. Vault V1 must not infer or write V2 pack/card identity or ownership.

### G-01 — Nayax

Real payment work requires the actual kit, SDK, onboarding, installed architecture, flow configuration, multi-vend limits, price encoding, callback semantics, keepalive requirements, test environment, restart reconciliation, refund/support flow, no-sensor vend-success decision, and Nayax certification plan.

### G-02 — Controller/electrical

Real actuator work requires the actual controller/firmware/protocol/map, electrical design, power budget, duty limits, safety mechanisms, and bench acceptance.

### G-03 — Tax

Owner policy is locked: Admin manually enters each machine's city, state, and tax percentage. Store the percentage as integer basis points, publish it in a signed versioned machine configuration, calculate half-up tax on the transaction subtotal, show subtotal/tax/total before payment, and pin the jurisdiction/rate/calculation/result to the sale. Production still requires a populated, reviewed machine rate and calculation tests.

### G-04 — Screen/Windows/enclosure

Physical UI acceptance requires final hardware and viewport/scaling/touch/enclosure evidence.

### G-05 — Offline sales

The local Windows service and serial controller must complete every active/authorized purchase and paid `OPEN DOORS` retry without Ten Kings cloud connectivity. A full internet/Nayax outage blocks new payment attempts unless Nayax later certifies an offline mode. Owner policy is locked: do not begin a new checkout while Ten Kings cloud sync is unavailable; finish active/authorized transactions locally.

### G-06 — Staff/support

Implement the blueprint's owner-approved `RESTOCKER`, `TECHNICIAN`, and `ADMIN` matrix exactly. The customer remedy is one group `OPEN DOORS` retry followed, if needed, by a Ten Kings support page offering email, text, and phone-call choices. No automatic substitute, store credit, or refund. Admin alone manages staff access and resolves financial reconciliation. Production activation requires real Admin-supplied support page URL, email, text number, phone number, and displayed support hours; those values are deployment configuration, not an open design decision.

### G-07 — Certification

A Ten Kings Technician or Admin may approve pre-field machine certification. Certification evidence is retained for the machine's complete service life plus three years. Mark, acting as Admin/owner, owns enrollment and key management. Launch still requires test/live isolation, invalidation/recertification rules, and release signing evidence.

## 4. Required orchestration model

Use one lead orchestrator and bounded specialist agents only for tasks that can proceed independently. No two agents may edit the same file set. The lead owns the plan, gate ledger, architecture decisions, cross-package contracts, integration, final verification, and handoff.

Recommended workstreams:

1. **Repository and architecture agent** — current-main discovery, package map, contracts, ADRs, CI implications, V1/V2 isolation.
2. **Local transaction agent** — SQLite schema, repositories, state machines, outbox, recovery, model/property tests.
3. **Kiosk UX agent** — customer/staff UI, door map, accessibility, responsive portrait behavior, Playwright/component tests.
4. **Cloud domain agent** — additive Prisma models, migration source, machine auth, config/event/heartbeat APIs, admin/reporting; migration execution remains separately authorized.
5. **Nayax agent** — mock contract first; official SDK bridge only after G-01.
6. **Controller agent** — simulator first; real serial adapter/firmware only after G-02.
7. **Operations/certification agent** — staff/restock, certification scheduler/evidence, Windows service/update/rollback, runbooks.
8. **Independent reviewers** — security, transaction integrity, UI/ops, payments/hardware. Reviewers do not edit the implementation they assess.

The lead must reconcile reviewer findings before merge. A specialist cannot close its own critical gate.

## 5. Branch and worktree discipline

- Start from an owner-selected clean, current base that is tree-aligned with `origin/main`.
- Default new branch prefix: `codex/`.
- Preserve all user changes and unresolved conflicts in existing worktrees.
- Do not use destructive Git commands.
- Make small, phase-scoped commits only after tests pass and the session log is updated.
- Before every migration/deploy/restart, append the planned action to the session log; after it, append observed evidence.
- Do not commit secrets, SDK packages that prohibit redistribution, machine credentials, PINs, certificates, runtime databases, rendered test card data, or production exports.

## 6. Architecture contract

Implement this shape unless repository evidence requires an owner-approved change:

- `packages/vault-contracts`: Zod/TypeScript contracts, enums, door IDs, event/config/state schemas, redaction.
- `packages/vault-machine`: one Windows local service, one SQLite writer, transaction FSM, outbox, sync, adapters, health, recovery, static UI hosting.
- `frontend/vault-kiosk`: static React touchscreen app served by the local service.
- existing `frontend/nextjs-app`: cloud Vault API/admin/fleet/reporting.
- existing `packages/database`: additive Vault cloud schema and migration source; applying a migration to any database remains separately authorized.
- optional minimal .NET Nayax bridge only when the official SDK requires it.

Do not use Electron, Docker on the machine, browser-direct serial, a local microservice fleet, a second cloud platform, or a cloud unlock endpoint.

## 7. Domain isolation contract

Vault V1 must not:

- mutate `PackDefinition.inventoryCount`;
- create/update `PackInstance`, `Item`, wallet, V1 kiosk-session, or V1 ownership records;
- create/update `CollectibleCardV2` or `CardOwnershipEventV2`;
- infer a physical pack/card identity;
- retrofit the legacy `backend/vault-service`, `backend/vending-gw`, `/packs`, live-rip purchase, or kiosk-agent as transaction authority.

Vault production reporting reads Vault sale facts. A future Card Platform V2 bridge is a separate owner-approved project.

## 8. Phase plan and stop conditions

### Phase 0 — Discovery, ADRs, and evidence

Deliver:

- clean-base evidence and repository map;
- gate ledger;
- ADRs for local service/browser shell, SQLite, adapter boundaries, sources of truth, config signing, machine auth, tax snapshot, V1/V2 isolation, and certification;
- precise state/event/adapter/API contracts;
- threat model and failure-mode analysis;
- test and certification matrix;
- hardware/Nayax/tax question packets.

Acceptance:

- no unresolved architecture ambiguity hidden as TODO;
- every unknown is a named gate with owner/provider/bench evidence;
- no production mutation.

### Phase 1 — Contract and simulator foundation

Proceed on the authorized independent Vault branch. No Speedster or Card Platform V2 gate applies.

Deliver:

- canonical 150-door parser/map and tests;
- transaction/payment/door/sync/restock state contracts;
- local SQLite migrations and repositories;
- mock Nayax and deterministic controller simulator with fault injection;
- transactional outbox and idempotent replay;
- restart/crash harness at every external-effect boundary;
- loopback-only local API with strict origin, auth, size, validation, and redaction;
- customer/staff UI skeleton using only mock adapters.

Acceptance:

- state-machine invariants pass model/property tests;
- process-kill recovery never duplicates payment intent or door command entitlement;
- no command exists without a durably authorized/committed sale item;
- one transaction-level `OPEN DOORS` group retry survives restart and gives every original paid door at most one second command;
- certification mode uses the same paths and cannot report production revenue.

### Phase 2 — Complete simulated product

Deliver:

- full customer state inventory and stable door map;
- mixed cart, checkout revalidation, provider-limit behavior, tax snapshot display;
- payment unknown/recovery/support UI;
- staff PIN/service lock with test verifiers and the approved role matrix enforced exactly;
- resumable per-door restock workflow;
- certification coverage scheduler and evidence manifest;
- local sync client against a deterministic mock cloud;
- touchscreen accessibility and scaling test suite.

Acceptance:

- all 150 positions remain stable in supported viewports;
- payment/recovery states do not idle-timeout;
- restock never creates false inventory;
- exact conflicting doors are removed while valid cart items remain;
- no success copy claims physical opening.

### Phase 3 — Cloud Vault domain

Cloud schema, API, admin, reporting, and migration-source implementation may proceed. Applying the migration to any database requires explicit migration authorization.

Before migration:

- inspect current schema on the clean base;
- produce migration SQL and Prisma diff;
- run disposable-Postgres migration-chain tests;
- perform a non-destructive impact report;
- append planned migration to session log;
- ask for explicit authorization before applying the migration to any database if not already given.

Deliver:

- additive Vault models and migration;
- per-machine revocable authentication;
- signed immutable config snapshots;
- idempotent event ingestion and projection;
- heartbeat/readiness, products/config, staff access, fleet, sales, restock, certification, and support APIs/pages;
- reporting union that excludes certification by default.

Acceptance:

- no V1 or V2 domain writes from Vault;
- unique event/provider/local transaction constraints are database-enforced;
- config cannot mutate an active session;
- cloud never becomes door-command authority;
- disposable migration and rollback procedure verified.

### Phase 4 — Official Nayax adapter

Requires G-01 for the official/live adapter. Mock adapter and interface work may proceed earlier.

Deliver:

- recorded SDK/version/license/source provenance;
- minimal supervised bridge if needed;
- callback persistence before action;
- keepalive/timing behavior isolated from heavy work;
- flow mapping for authorization, vend result, settlement, cancel, timeout, unknown, and reconciliation;
- exact item/amount limit enforcement;
- official simulator and certified test evidence;
- strict payload whitelist with no cardholder-data logging.

Stop immediately if public documentation and installed SDK disagree. Record the evidence and obtain Nayax guidance.

### Phase 5 — Controller and electrical adapter

Requires G-02 for real hardware. Simulator, protocol interface, and fault-harness work may proceed earlier.

Deliver:

- framed/versioned protocol and deterministic command IDs;
- fixed firmware-owned pulse profiles;
- serialized commands and per-door terminal receipts;
- startup safe-state, controller boot identity, firmware/map checks;
- watchdog, default-off, maximum-on-time, brownout/reset/disconnect behavior;
- eight-door electrical/thermal/EMI/power/fault evidence;
- signed 150-door bidirectional mapping report.

No host-supplied arbitrary pulse duration, public batch unlock, or unbounded concurrency.

### Phase 6 — Windows appliance integration

Requires G-04 and the relevant G-01/G-02 evidence for installed appliance acceptance.

Deliver:

- reproducible signed installer;
- Windows service account and least privilege;
- assigned-access Edge shell on loopback;
- stable USB device identity binding;
- power-loss recovery, update, rollback, backup/restore, logs, and support collection;
- installation and rollback runbooks.

Acceptance includes cold boot, hard power cut at every durable boundary, adapter disconnect/reconnect, disk pressure, clock drift, browser restart, service restart, and failed update rollback.

### Phase 7 — Full certification

Requires G-03, G-05, G-06, and G-07.

Deliver:

- automated, official SDK, bench, full-machine, and field evidence;
- five purchase cycles per door;
- two restock cycles per door;
- at least 500 human-observed purchase sessions;
- at least 1,000 automated end-to-end transactions plus property/model exploration;
- wrong-door, unpaid-door, duplicate-charge, false-inventory, and test-to-production leakage results;
- version-bound certificate.

Any wrong-door or unpaid-door actuation is critical: stop physical automation, preserve evidence, and require independent root-cause review plus affected recertification.

### Phase 8 — Pilot and launch

Requires a separate explicit owner deployment/migration/production-activation instruction.

Deliver:

- planned action logged before each deploy/restart/migration;
- one-machine bounded pilot;
- rollback and incident-stop criteria;
- live payment/reconciliation monitoring;
- daily door/inventory/payment settlement reconciliation;
- observed results logged after each action.

Do not infer launch approval from successful certification.

## 9. State and idempotency requirements

The implementation must preserve separate durable facts for:

```text
Payment: NOT_REQUESTED -> REQUESTED -> AUTHORIZED
         AUTHORIZED -> VEND_RESULT_PENDING -> SETTLEMENT_PENDING -> SETTLED
         REQUESTED -> DECLINED | CANCELLED
         uncertainty -> UNKNOWN | RECONCILIATION_REQUIRED

Door work: NOT_COMMITTED -> COMMAND_INTENT_RECORDED
           -> ACCEPTED | SENT_UNKNOWN | REJECTED | TIMEOUT
           -> OUTPUT_RELEASED where the qualified protocol supports it

Sync: OUTBOX_PENDING -> ACKED
```

Rules:

1. Persist intent and idempotency key before every external effect.
2. Repeated key plus identical payload returns the original result.
3. Repeated key plus different payload is a hard conflict and audit event.
4. Authorization, command ACK, physical opening, vend result, and settlement are not synonyms.
5. On restart, reconcile provider-unknown state; never automatically charge again.
6. For command `SENT_UNKNOWN`, never automatically repulse. Preserve the one explicit transaction-level `OPEN DOORS` group retry for exactly the original paid doors.
7. Cloud event ingestion is idempotent by machine/event ID and sequence-aware.
8. Inventory is door state, not a product counter.

## 10. Security requirements

- Bind local service to loopback only and validate origin, content type, body size, schemas, and UI/session token.
- Unique revocable machine credential; no shared public kiosk secret.
- Mark/Ten Kings Admin owns enrollment and key authority. Admin alone creates one-time enrollment tokens, approves enrollment, rotates/revokes credentials, performs recovery, and decommissions machines; a Technician may complete only an explicitly authorized one-time physical enrollment.
- Store secrets in Windows-protected storage.
- Individual machine-scoped staff PIN verifiers using Argon2id or scrypt, versioned parameters, rate limits, backoff, revocation, and generic errors.
- Cloud admin actions require server-side session and Vault permission; sensitive actions require fresh human step-up.
- No PAN, CVV, track data, PIN input, bearer token, provider secret, raw Transfer Data, or machine private key in logs.
- Dependency/SBOM/license review, signed artifacts, controlled updates, and rollback.
- Threat-model local browser escape, USB/COM swapping, replay, callback spoofing, database tampering, clock rollback, config downgrade, support-data leakage, and test/live crossover.

## 11. Test requirements

At minimum implement:

- unit tests for door IDs, manual machine tax basis-point parsing and half-up rounding, config validation, state transitions, role grants/denials, redaction;
- model/property tests for transaction and command state machines;
- SQLite transaction, uniqueness, migration, crash/replay, integrity, backup/restore tests;
- API schema, auth, idempotency, sequence, replay, conflict, and size-limit tests;
- Playwright/component tests for every customer/staff state and supported viewport/scaling proxy;
- mock Nayax/controller fault injection and out-of-order callbacks;
- Windows packaging/service/update/rollback tests;
- official Nayax simulator/certification tests;
- eight-door and full 150-door bench evidence;
- report predicates proving certification cannot enter production revenue.

CI must actually run the new suites. A package script that prints a placeholder is a failure.

## 12. Review checkpoints

At the end of each phase, the lead reports:

- files changed and ownership;
- decisions made versus gates still open;
- tests run with exact commands and outcomes;
- schema/API/event contract changes;
- security and failure-mode findings;
- screenshots/evidence where UI or hardware is involved;
- git status, branch, and short HEAD;
- session-log update;
- whether the next phase requires new explicit authority.

Independent review is mandatory before cloud migration, official Nayax merge, controller activation, Windows installer release, certification sign-off, and pilot.

## 13. Definition of done

Vault V1 is done only when:

- every product and architecture invariant in Draft 3 is implemented;
- every gate is closed with evidence;
- local transaction recovery is proven across power loss and duplicate/out-of-order inputs;
- the exact Nayax flow is certified;
- the controller/electrical design is proven safe and the 150-door map has zero errors;
- tax and offline policies are approved and tested;
- the approved role matrix is enforced, real support page/contact values are published before production, and certification evidence retention is implemented for service life plus three years;
- public, staff, restock, admin, fleet, and certification acceptance criteria pass;
- certification evidence and the version-bound certificate are approved;
- runbooks, install/update/rollback, support, and reconciliation procedures are tested;
- production pilot and launch are separately authorized;
- handoff/session logs contain planned and observed evidence for every migration, deploy, restart, and activation.

Until then, report the exact remaining gap. Never call a simulator pass, compile success, command ACK, or provider authorization “production complete.”

## 14. Initial expected response when this prompt is run now

Because the known workspace is dirty/conflicted, the first response should:

1. confirm the mandatory files were read;
2. report status/branch/HEAD/base relation;
3. state that the current worktree will not be edited;
4. inventory the gate evidence actually present;
5. create or propose the isolated clean current base authorized by the build request;
6. state explicitly that Speedster and Card Platform V2 sequencing do not block Vault;
7. begin the smallest safe implementation phase without waiting for real Nayax or controller hardware, using the defined mock adapters;
8. ask only for a remaining decision when it materially changes the implementation or an external action;
9. perform no deploy, restart, migration application, live payment, hardware command, or production DB action without exact authorization.
