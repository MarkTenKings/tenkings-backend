# Ten Kings Vault V1 — Engineering Review Findings and Decision Report

**Review date:** August 16, 2026  
**Review type:** Documentation and architecture review only  
**Decision:** Approved for independent Vault software implementation on a clean branch. Live payments, real hardware activation, application of cloud-schema migrations, deployment, and production launch remain separately gated.  
**Companion blueprint:** `TEN_KINGS_VAULT_V1_FINAL_MASTER_BLUEPRINT_DRAFT_3.md`

## 1. Executive decision

Draft 2 is directionally strong and preserves the owner’s core product intent: a 150-door, portrait, black-and-gold, guest-checkout vending experience with mixed-product carts, one Nayax transaction, local-first door control, one customer-triggered `OPEN DOORS` group retry for all paid doors, no QR scanning, no door sensors, and no requirement that customers close doors.

Draft 2 was not implementation-safe as written. The owner has now removed one false sequencing blocker. The remaining findings gate specific live, physical, accounting, or production actions; they do not prevent unrelated Vault software work with mocks and simulators:

1. **Resolved owner correction:** Vault V1 has zero dependency on Speedster. It is a separate product, code branch, runtime, and data domain and may be built now. The V2 deferral applies only to a future bridge that could identify Vault-sold packs or cards inside Card Platform V2.
2. The draft treats Nayax “vend approved” too much like final settlement. Nayax’s Marshall flow authorizes vending before the peripheral reports vend success and settlement follows. The state machine must preserve authorization, fulfillment commitment, command acknowledgement, vend result, settlement, and reconciliation as distinct facts.
3. With no door sensors, a controller ACK proves command acceptance—not that a customer received a pack. The exact rule for reporting Nayax vend success, handling partial fulfillment, and customer support must be approved with Nayax and validated on the actual controller.
4. The current Ten Kings V1 pack, vending, kiosk, and checkout code is not a safe foundation for Vault transaction authority. It has different product semantics and lacks the required local durability, concurrency controls, machine-scoped authorization, provider-reference idempotency, and physical-door state model.
5. All owner-policy decisions are now closed. Controller protocol, Windows/SDK compatibility, touchscreen scaling, Nayax certification, production support contact values, and physical/certification evidence remain implementation or deployment gates.

The corrected architecture is therefore:

- one Windows-local Vault machine service as the immediate source of truth for the active session, reservations, payment callbacks, door commands, retries, restock progress, and an append-only outbox;
- one local browser kiosk shell served from loopback, with no cloud dependency in the hot transaction path;
- existing Ten Kings Next.js and PostgreSQL infrastructure for cloud administration, configuration publishing, fleet health, audit ingestion, and reporting;
- a separate Vault domain that does not mutate legacy V1 pack inventory and does not create V2 card or ownership records;
- explicit, versioned bridges to broader Ten Kings reporting now and to future Card Platform V2 vending identity only after owner approval.

## 2. Review method

The lead review reconciled four evidence classes:

- Draft 2 blueprint and build prompt in Markdown, Word, and PDF;
- the owner-approved V2 master blueprint and mandatory repository context;
- current code and schema evidence from a clean tree matching `origin/main` at tree-equivalent HEAD `3b42079f`;
- official Nayax and Elo technical documentation.

Three independent specialist passes covered architecture/integration, customer and operations UX, and payments/hardware/reliability. Their disagreements were resolved using the repository conflict rule: runtime and code evidence first, then approved product decisions, then vendor evidence, with unresolved physical facts converted to explicit gates.

The requested working copy was not modified for implementation. It was on `feature/ai-grader-report-polish` at `8343958f`, 964 commits behind `origin/main`, with pre-existing modifications and an unresolved `UU docs/handoffs/SESSION_LOG.md`. That checkout was treated as evidence only.

## 3. Preserve without redesign

These Draft 2 decisions remain owner-approved and are retained:

- 150 doors in six columns `X K I N G S` and rows `01–25`.
- Sports and Pokémon only; tiers at $25, $50, $100, and $250.
- Guest checkout; no account or phone required.
- Mixed-product, multi-door cart with one Nayax payment attempt.
- Sales tax added at checkout.
- Configurable product name, photo, description, price, category, and active status.
- No door sensors, no pack QR scans, and no customer close-door requirement.
- One customer-triggered `OPEN DOORS` group retry that reissues one command to every original paid door only.
- No automatic substitute door and no remote-unlock feature.
- Windows mini PC, portrait touchscreen, local-first operation, black/gold experience.
- Staff/restock mode and an evidence-producing certification mode.

## 4. Resolved scope correction and blocking findings

### F-01 — Resolved: Vault is independent from Speedster

**Severity:** Resolved; not a Vault blocker  
**Decision:** Remove the Speedster sequencing gate from every Vault artifact and correct the V2 blueprint language that caused the confusion.

The earlier review incorrectly applied a Card Platform V2 sequencing decision to Vault V1. The owner clarified on August 16, 2026 that:

- Vault has zero dependency on Speedster;
- Vault may be built now on its own clean branch, with its own runtime and Vault-specific data domain;
- “Speedster first” applies only within Card Platform V2; and
- the deferred physical-vending work is only a future identity bridge into V2, not the independent Vault product.

Vault V1 intentionally sells anonymous physical pack slots rather than identified cards or packs. It must not write `CollectibleCardV2`, `CardOwnershipEventV2`, legacy `PackDefinition`, or `PackInstance`. That data boundary is an integration-safety rule, not a build-sequencing dependency. A future physical identity bridge is a separate owner-approved change.

### F-02 — Wrong payment finality model

**Severity:** Critical  
**Decision:** Replace “approved means charged” with an evidence-based payment and fulfillment state machine.

Nayax documents `onVendApproved` before the peripheral reports vend success or failure; charge/settlement follows the vend result. Multi-vend also has item-count limits that vary by SDK generation. Draft 3 distinguishes:

- payment requested;
- payment authorized for vending;
- fulfillment committed durably;
- command attempted and acknowledged or unknown;
- vend result reported or withheld pending support;
- settlement confirmed or reconciliation required.

No UI, inventory, cloud report, or retry path may collapse these facts into a generic `COMPLETED` flag.

Official evidence: [Marshall SDK](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-sdk), [Create Payments](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-create-payments), [Multi-Vend with Pre-Selection](https://devzone.nayax.com/docs/integrate-pos-device/marshall/payment-flows/marshall-multi-vend-with-pre-sel), and [Marshall Flow Configuration FAQ](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-faqs/faq-marshall-flowconfigurations).

### F-03 — No-sensor vending ambiguity

**Severity:** Critical  
**Decision:** Treat controller ACK as command evidence only.

Without a door sensor, the software cannot prove physical opening or customer retrieval. The kiosk may say “unlock command sent” or “doors are unlocking”; it may not assert “opened” or “dispensed.” A transaction’s purchased door becomes unavailable once authorization and the local fulfillment commit are durable, because avoiding a double-sale is safer than optimistic rollback.

Before production certification, Nayax and the owner must approve which observed fact is sufficient to return vend success and how partial multi-vend is handled without sensors. The owner has now locked the customer remedy: after the initial commands, one `OPEN DOORS` action sends exactly one second command to every original paid door. Any unresolved problem then routes to Ten Kings support; there is no automatic substitute, store credit, or refund.

### F-04 — Legacy pack/vending code conflicts with the owner’s V2 boundary

**Severity:** Critical  
**Decision:** Build a separate Vault domain; reuse infrastructure and UI primitives only.

Current schema evidence shows mutable legacy inventory and identified pack concepts:

- [`PackDefinition` has `inventoryCount`](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:1100).
- [`PackInstance` represents individually tracked packs](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:1116).
- [`KioskSession` is a countdown/live/reveal workflow](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:1144).
- [`CollectibleCardV2` is a permanent identified-card record](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:3680), while [`CardOwnershipEventV2` enforces one reference event](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:3723).
- [`createCardFromSpeedster` is the current idempotent V2 card entry point](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/src/cardPlatformV2.ts:669).

Vault V1’s stock fact is simply whether a physical door is available. It therefore needs its own products, machine doors, immutable configuration versions, transactions, sale items, restock records, and append-only machine events.

### F-05 — Current checkout patterns are not safe transaction authority

**Severity:** Critical  
**Decision:** Do not reuse the current Stripe/live-rip purchase or `vending-gw` transaction flow.

The current paths were designed for different products. Review found client-supplied identity, mutable inventory counters, race-prone “find then update” behavior, and no durable provider-reference idempotency at the physical command boundary. Only generic techniques—schema validation, logging conventions, admin session handling, and vendor-client configuration—may be reused after independent verification.

### F-06 — Resolved policy: manual per-machine tax

**Severity:** Critical  
**Decision:** Admin manually configures each machine's city, state, and tax percentage; make it a versioned signed local input.

The current repository has location addresses but no validated Vault tax engine or machine tax configuration. The owner chose a manual machine-specific process rather than an external provider: Admin enters city, state, and percentage. The implementation stores integer basis points, calculates half-up tax on the transaction subtotal, displays subtotal/tax/total before payment, and pins the signed/versioned tax snapshot and result to the sale. Production remains gated until each machine has a reviewed rate and passing calculation tests. Certification transactions retain tax calculations while remaining excluded from production revenue.

### F-07 — Hardware and SDK details remain unverified

**Severity:** Critical  
**Decision:** Require acquisition, bench evidence, and a signed hardware compatibility record.

Nayax requires onboarding, a sales kit, Nayax Core setup, the SDK sample application, and certification. Official integration material describes C, C#, and Java SDK options, not a native TypeScript SDK. Draft 3 therefore puts Nayax behind a local adapter/bridge and prohibits a guessed raw Marshall implementation.

Official evidence: [Nayax sales kit](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/sales-kit), [installation steps](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps), [getting started and certification](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-get-started), and [C# simulator](https://devzone.nayax.com/docs/integrate-pos-device/marshall/simulators-sample-codes/csharp-sdk-simulator).

The proposed Elo 1304L is a credible candidate on paper: its current official datasheet lists 13.3-inch 1920×1080 PCAP touch, HDMI/DisplayPort/USB-C, 75 mm VESA, and dimensions that fit under eight inches when rotated. Mounting, Windows portrait touch mapping, browser scaling, glare, cable routing, and enclosure clearances still require physical verification. Evidence: [Elo 1304L datasheet](https://docs.elotouch.com/Elo_1304L_DS.pdf).

Marketplace claims for the QWORK solenoid and the actual controller’s electrical limits are provisional until bench-measured.

## 5. High findings

### F-08 — Local authority was under-specified

**Severity:** High  
**Decision:** Use one loopback-only Windows service with SQLite WAL and a durable outbox.

The browser is presentation, not authority. The local service owns the state machine, serialized door commands, provider callbacks, retries, restock progress, and recovery. SQLite runs in WAL mode with foreign keys, `synchronous=FULL`, a busy timeout, integrity checks, bounded backups, and one writer process. Every external effect uses a persisted intent and idempotency key before execution.

The existing loopback helper is a more relevant pattern than the cloud/OBS kiosk agent: [`transport.ts`](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/ai-grader-capture-helper/src/transport.ts:14).

### F-09 — Staff authorization is not machine- or role-scoped

**Severity:** High  
**Decision:** Add Vault-specific staff access records and local verifier snapshots.

The current `User.role` is a free-form string ([schema](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma:596)), and admin access accepts environment allowlists or an operator key ([admin session](/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/frontend/nextjs-app/lib/server/admin.ts:94)). That does not meet the offline PIN, machine scope, individual audit, or least-privilege requirements.

Draft 3 includes the owner-approved permission/prohibition matrix for `RESTOCKER`, `TECHNICIAN`, and `ADMIN`, plus individual six-digit PIN verifiers, rate limiting, backoff, revocation versions, service lock, and explicit safe exit.

### F-10 — Customer state inventory was incomplete

**Severity:** High  
**Decision:** Specify visible recovery and dependency states.

Required additions include no cached config, controller unavailable, provider limit exceeded, payment unknown, approval durable, command unknown, group retry available/committed/used, support required, and service locked. Payment and recovery states never idle-timeout. The machine must say “Checking payment—do not pay again” while reconciling and label the single paid-door group retry `OPEN DOORS`.

### F-11 — The 150-door layout cannot be assumed to fit without scaling tests

**Severity:** High  
**Decision:** Keep physical order invariant and allow an internal scroll region.

Twenty-five 44-pixel rows consume 1,100 CSS pixels before headers, products, and cart. Windows 125–150% scaling can reduce the effective viewport further. Draft 3 keeps the product rail and cart fixed, uses sticky headers and a vertically scrolling physical map, and requires tests from 720×1280 through 1080×1920 CSS at 100%, 125%, and 150% Windows scaling.

### F-12 — Restock completion could create false inventory

**Severity:** High  
**Decision:** Require per-door `FILLED`, `LEFT_EMPTY`, or `EXCEPTION` confirmation.

Planned assignments do not become active inventory until staff manually confirms the physical door. The restock wizard must resume after crash or lock and must require explicit confirmation that all serviced doors are closed before customer mode resumes. Customer checkout never requires door closure.

### F-13 — Certification targets needed a deterministic scheduler

**Severity:** High  
**Decision:** Keep the coverage targets but measure them independently.

Five purchase cycles per door means at least 750 observed purchase openings; two restock cycles per door means at least 300 observed restock openings. The separate 500 human-observed purchase-session target can overlap those door cycles through multi-door carts. A coverage scheduler must prioritize under-tested doors; random selection alone cannot prove coverage. The 1,000-transaction automated target is a floor, not a substitute for model/property tests, crash-injection tests, or physical evidence.

### F-14 — Certification and production data could be mixed

**Severity:** High  
**Decision:** Bind immutable mode to every transaction and event.

Production and certification use the same code paths but different provider adapters and reporting predicates. Every test screen displays persistent `TEST MODE`. Production dashboards exclude certification by default. A certificate binds app, local schema, configuration, controller firmware/map, payment adapter, hardware identity, and evidence manifest versions.

## 6. Medium findings

- Use a cryptographically secure authoritative selection for “Pick for me”; animation is decorative and follows the persisted selection.
- Pin product, price, tax, door assignment, and configuration snapshots once checkout revalidation succeeds.
- Reserve only unpaid doors. Once payment begins, the transaction—not a TTL—owns them until a terminal or support state.
- Enforce Nayax’s SDK-specific item and amount ceilings at checkout. Never split one cart into multiple charges without a future owner-approved design.
- Keep at-rest local secrets in Windows-protected storage; never put machine credentials or operator keys into public build-time variables.
- Treat online and sales-ready as different fleet states.
- Do not let a cloud config publish mutate an active customer or staff session; activate only at a safe boundary.
- Do not add a remote unlock endpoint in V1.
- Use one canonical door-map component and door-ID parser across customer, restock, admin, and certification tools.

## 7. Repository-fit decisions

### Reuse

- Existing monorepo, CI structure, Next.js application, Prisma/PostgreSQL, admin page primitives, media patterns, and black/gold Tailwind tokens.
- Existing authenticated admin sessions as an identity starting point, with Vault-specific authorization added.
- Existing local helper packaging patterns as reference, after a fresh Windows compatibility review.
- Existing V2 reporting conventions only through explicit Vault read models; do not fabricate card ownership.

### Extend

- Add Vault-specific cloud models and `/api/vault/v1` routes.
- Add a static/local kiosk UI package and one Windows local service package.
- Add machine enrollment, revocable credentials, signed config snapshots, idempotent event ingestion, health, and audit.
- Add Vault-specific admin product, map, machine, fleet, sales, restock, and certification views.

### Isolate

- Nayax SDK, controller serial protocol, local database, Windows service, and recovery logic stay behind machine-local adapters.
- Certification adapters remain swappable without branching business logic.

### Reject as foundations

- Legacy `backend/vault-service` despite its name; it is an item-ownership service, not this vending machine.
- Legacy `backend/vending-gw`, `/packs`, `PackDefinition`, `PackInstance`, `KioskSession`, and live-rip purchasing as transaction authority.
- Electron, Docker-on-machine, a second cloud platform, direct browser serial access, remote unlock, and pack/card identity inference.

## 8. Decision matrix

| Area | Decision | Status |
|---|---|---|
| Product geometry and catalog | Preserve Draft 2 | Approved |
| Guest mixed cart | Preserve, with provider limits | Approved with evidence gate |
| Local-first architecture | Local service + SQLite + loopback UI | Approved for implementation |
| Cloud integration | Existing Next/Postgres, separate Vault domain | Approved for code/schema source; migration application is separately authorized |
| V2 card/pack linkage | No write or inferred identity in Vault V1 | Approved boundary |
| Nayax | Official SDK adapter; no guessed protocol | Provider-gated |
| Door controller | Serialized adapter + simulator + ACK-only semantics | Bench-gated |
| Tax | Admin-entered city/state/rate; signed versioned local snapshot | Owner-approved; machine rate/test gated |
| Touchscreen | Elo 1304L candidate, not final selection | Physical evidence-gated |
| Staff PIN | Individual, scoped, hashed, rate-limited; detailed role matrix | Owner-approved |
| Reporting | Vault production sales union; tests excluded | Approved for implementation; production activation gated |
| Certification | Same paths, immutable mode, versioned evidence | Approved architecture |

## 9. Remaining production inputs and evidence

No owner-policy questions remain open. Before production activation:

1. Admin supplies the production support page URL, email, text number, phone number, and displayed support hours.
2. Complete Nayax no-sensor vend-success, settlement/reconciliation, test-mode, and certification evidence.
3. Complete controller, electrical, touchscreen, Windows, enclosure, and 150-door mapping qualification.
4. Implement and verify the approved cloud-outage sales-ready rule, role matrix, manual tax calculation, and service-life-plus-three-years certification retention.

These decisions are listed in the companion Open Decisions file with evidence and acceptance criteria.

## 10. Final recommendation

Adopt Draft 3 as the final owner-approved engineering and Codex build contract and begin independent Vault software implementation on a clean branch from current `origin/main`. Use mock adapters and simulators wherever provider or physical evidence is still pending. No owner-policy blockers remain; affected live checkout, real payment, cabinet actuation, migration application, deployment, and production-launch actions remain behind their evidence and operational gates.
