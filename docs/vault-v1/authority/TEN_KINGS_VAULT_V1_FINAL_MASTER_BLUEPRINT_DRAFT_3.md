# Ten Kings Vault V1 — Final Master Blueprint, Draft 3

**Status:** FINAL — owner-approved engineering and Codex build contract  
**Date:** August 16, 2026  
**Authority:** Preserves the owner-approved product direction in Draft 2 while reconciling it with current repository evidence and the owner-approved Ten Kings V2 blueprint.  
**Implementation authority:** Vault V1 software may be built now as an independent project on a clean branch. Applying a database migration, deploying, charging a real payment method, actuating physical hardware, or launching production still requires the applicable gates and explicit operational authorization.  
**Supersedes:** `Ten_Kings_Vault_V1_Master_Blueprint_Draft_2` after owner acceptance.

## 1. Product definition

Ten Kings Vault V1 is a local-first physical mystery-pack vending system built around a 150-door cabinet, a portrait touchscreen, a Windows mini PC, a Nayax card reader, and a serial-connected door controller.

The machine sells anonymous physical packs by occupied door. It does not identify a specific pack or any cards inside it. It does not scan pack QR codes, monitor door sensors, require customer accounts, or require customers to close doors. The authoritative inventory fact is whether a particular door is available for sale.

### 1.1 Fixed physical map

The cabinet contains six columns and 25 rows:

```text
       X     K     I     N     G     S
01   X-01  K-01  I-01  N-01  G-01  S-01
02   X-02  K-02  I-02  N-02  G-02  S-02
...
25   X-25  K-25  I-25  N-25  G-25  S-25
```

Door IDs are immutable and use the regular expression `^(X|K|I|N|G|S)-(0[1-9]|1[0-9]|2[0-5])$`. The same parser, map order, and controller mapping are used by customer, restock, admin, diagnostics, and certification software.

### 1.2 Product catalog

Vault V1 supports:

- Sports mystery packs.
- Pokémon mystery packs.
- Price tiers of $25, $50, $100, and $250.

Each product has configurable name, photo, description, price in cents, category, active status, and tax class. Comics and other categories are out of scope. The system does not derive price from tier; price is an explicit versioned field.

### 1.3 Customer promise

- Guest checkout with no account or phone requirement.
- Multiple doors and different products in one cart.
- One Nayax payment flow for the full cart.
- Sales tax shown and added at checkout.
- Purchased doors become unavailable before any unlock command can be sent.
- After the initial unlock commands, one customer-triggered `OPEN DOORS` retry sends exactly one second command to every door in that paid transaction. It never opens a substitute or unpaid door.
- No automatic substitution and no remote unlock.
- No claim that a door physically opened unless future sensor evidence exists.

## 2. Goals and non-goals

### 2.1 Goals

- Survive cloud loss, UI refresh, local restart, duplicate callbacks, and serial timeout without a duplicate charge or duplicate sale.
- Keep the customer experience responsive and simple on a 13.3-inch portrait touchscreen.
- Maintain durable, auditable facts for payment, door commands, inventory, retry, restock, certification, and sync.
- Reuse the existing Ten Kings monorepo, cloud application, database, authentication, visual language, and reporting conventions where they fit.
- Separate local machine authority from cloud administration and reporting.
- Make every production dependency an explicit evidence gate.

### 2.2 Non-goals

- Identifying packs or cards inside the machine.
- Writing Ten Kings V1 `PackDefinition`, `PackInstance`, wallet, kiosk-session, Item, or ownership facts.
- Writing `CollectibleCardV2` or `CardOwnershipEventV2` from a Vault V1 sale.
- Customer accounts, loyalty, saved carts, phone collection, shipping, live rip, video, or account delivery.
- Remote unlock, remote restock completion, automatic substitution, or automatic refunds.
- Door-open or pack-retrieval proof.
- A second cloud platform, an Electron application, Docker on the machine, or browser-direct serial control.

## 3. Authority hierarchy and integration boundary

When evidence conflicts, use this order:

1. Current production/runtime/database evidence.
2. Recorded Ten Kings owner decisions.
3. This Vault blueprint.
4. The Ten Kings V2 blueprint only where a future integration boundary is involved.
5. Vendor documentation.
6. Draft assumptions and marketplace listings.

Owner correction dated August 16, 2026:

- Vault V1 has zero dependency on Speedster.
- Vault V1 is a separate product, code branch, local runtime, and data domain and may be built independently now.
- The Speedster-first sequence applies only to the Card Platform V2 work defined by the V2 blueprint. It does not sequence or block Vault V1.
- The V2 blueprint's physical-vending deferral applies only to a future identity bridge that would associate a Vault sale with identified Pack V2 or Card V2 records. It does not defer Vault software, Nayax integration, door inventory, hardware control, cloud administration, reporting, or certification.
- Vault V1 must not infer or write V2 pack/card identity or ownership. Any future bridge is a separate owner-approved Card Platform V2 project.

Current permanent V2 entry remains Speedster-driven: `createCardFromSpeedster` creates an idempotent `CollectibleCardV2` plus its creation ownership event. That fact defines an integration boundary only; it is not a Vault implementation dependency.

## 4. Mandatory gates

No gate closes through assumption. Each requires a dated record, named approver, evidence artifact, and exact decision.

### G-01 — Nayax onboarding and flow approval

**Blocks:** real payment adapter and any production charge.  
**Required evidence:** Exact Marshall kit, SDK version, Windows architecture, supported language/runtime, flow configuration, multi-vend item limit, total/price encoding, cancel behavior, timeout behavior, callback semantics, session query/reconciliation, test mode, certification steps, and written vend-success rule for a no-sensor door system.  
**Approvers:** Nayax integration contact and Ten Kings owner.

### G-02 — Controller and electrical qualification

**Blocks:** real door commands.  
**Required evidence:** Controller make/model, firmware hash/version, COM settings, framing, checksum, channel map, command ACK semantics, error codes, concurrency, reboot behavior, duplicate-command behavior, command timeout, retry safety, power supply margins, flyback protection, solenoid duty cycle, wire gauge, fusing, thermal behavior, and a signed 150-door mapping report.

### G-03 — Tax authority

**Blocks:** production checkout until the machine-specific jurisdiction and rate are configured and tested.  
**Owner decision:** Ten Kings Admin manually configures each machine's city, state, and tax percentage. Tax is added to the transaction subtotal and paid by the customer. The published configuration is versioned, signed, audited, and pinned to the sale.  
**Required implementation:** Store the percentage as integer basis points (`8.25% = 825`), calculate `tax_cents = round_half_up(subtotal_cents × rate_basis_points / 10,000)`, display subtotal/tax/total before payment, and use the original pinned tax snapshot for void/refund reporting. Admin remains responsible for entering the legally correct rate.

### G-04 — Screen, Windows, and enclosure qualification

**Blocks:** physical UI acceptance.  
**Required evidence:** Final screen and touch model, 1080×1920 portrait behavior, effective CSS viewport at Windows 100/125/150 percent scale, browser zoom lock, touch calibration, VESA/enclosure fit, glare, reach, cable routing, thermal behavior, power recovery, and assigned-access behavior.

The Elo 1304L is a candidate, not an approved component. Its official datasheet supports the paper fit; the installed system must still be tested.

### G-05 — Offline sales policy

**Blocks:** sales during cloud outage.  
**Locked architecture:** The serial door controller, local SQLite authority, active transaction, and paid `OPEN DOORS` retry run on the Windows machine and do not require the Ten Kings cloud. Cloud loss never interrupts an already-authorized fulfillment or retry. A full internet/Nayax outage blocks new payment attempts unless Nayax later provides a separately certified offline-payment mode.  
**Owner decision:** Do not begin a new checkout while the Ten Kings cloud is unavailable. Continue every active or already-authorized transaction locally, including initial door commands and the paid `OPEN DOORS` retry. A future nonzero cloud-outage sales window is a separate owner-approved policy change with explicit maximum outage/config/tax age, clock, storage, and outbox limits.

### G-06 — Staff and support policy

**Blocks:** production service mode.  
**Owner decisions:** The detailed `RESTOCKER`, `TECHNICIAN`, and `ADMIN` matrix in section 13.2 is approved. After the initial unlock attempt, the customer receives one `OPEN DOORS` retry for all paid doors; unresolved problems route to Ten Kings support without an automatic substitute, store credit, or automatic refund. The support QR/page offers email, text, and phone-call choices. Admin alone resolves payment/reconciliation cases and manages staff access.  
**Deployment configuration:** Admin must populate the production support page URL, email, text number, phone number, and displayed support hours before production activation. These values are operational configuration, not an open blueprint decision.

### G-07 — Certification governance

**Blocks:** production launch.  
**Owner decision:** A Ten Kings `TECHNICIAN` or `ADMIN` may approve the pre-field certification of each machine. Certification evidence is retained for the machine's complete service life plus three years. Mark, acting as Ten Kings Admin/owner, owns machine enrollment and security-key management.  
**Remaining external evidence:** Allowed Nayax test mode, critical-failure stop rules, recertification matrix, and release-signing procedure must be evidenced before launch; they are implementation/certification deliverables, not open owner-policy questions.

## 5. Target system architecture

### 5.1 System shape

```text
Customer / Staff Touchscreen
          |
          | HTTP + WebSocket, loopback only
          v
Vault Machine Service (Windows service, one writer)
  |        |         |          |
  |        |         |          +--> durable outbox / cloud sync
  |        |         +-------------> controller adapter -> serial controller
  |        +-----------------------> Nayax adapter -> approved SDK bridge
  +-------------------------------> local SQLite authority
                                        |
                                        | authenticated idempotent HTTPS
                                        v
Existing Ten Kings Next.js API + PostgreSQL
  | products/config | machine fleet | sales/reporting | staff/access | audit
```

### 5.2 Existing platform reuse

Reuse the current monorepo and cloud stack:

- Next.js 14 and React 18 for cloud admin and API routes.
- Prisma and PostgreSQL for cloud records.
- Existing black/gold Tailwind design tokens and admin layout primitives.
- Existing server-side admin identity as a starting point.
- Existing CI, package structure, logging, object-storage/media conventions, and deployment path.

Reuse does not mean copying unsafe transaction flows. The current V1 pack, live-rip checkout, kiosk, `vending-gw`, and legacy `backend/vault-service` remain isolated.

### 5.3 New packages

Final package names may follow current monorepo conventions, but responsibilities are fixed:

- `frontend/vault-kiosk`: static local customer/staff UI, built with React and shared design tokens; no secret or hardware access.
- `packages/vault-machine`: loopback HTTP/WebSocket API, SQLite repositories, state machine, adapters, sync client, health, structured logs, Windows service packaging, recovery.
- `packages/vault-contracts`: shared door IDs, schemas, enums, config contracts, event envelopes, redaction rules, and versioning.
- existing `frontend/nextjs-app`: Vault cloud API routes and admin/fleet/reporting pages.
- existing `packages/database`: new additive cloud models and migration source may be built with Vault; applying that migration to any database requires explicit authorization.

If native Nayax integration requires .NET, place a minimal bridge under the machine package or a clearly named companion package. It exposes only the approved adapter contract over authenticated loopback or supervised stdio. It does not own business state.

### 5.4 Browser shell

Microsoft Edge runs fullscreen/assigned access against a loopback URL. Browser chrome, navigation, downloads, autofill, external links, devtools access, context menus, and ordinary session restoration are disabled. The machine service serves only the pinned UI build and strict security headers.

The UI can restart independently. On load it queries the service’s current durable public state and renders recovery instead of starting a new transaction.

## 6. Sources of truth

| Fact | Immediate authority | Cloud role |
|---|---|---|
| Active customer/staff session | Local SQLite | Eventual audit copy |
| Door availability and reservation | Local SQLite | Reporting/config comparison |
| Payment callback and reconciliation | Local SQLite + Nayax SDK evidence | Durable financial copy |
| Door command attempt/ACK | Local append-only command event | Audit copy |
| Retry entitlement/use | Local SQLite | Support/audit copy |
| Restock progress | Local SQLite | Synced record and reporting |
| Published products/config | Cloud immutable version | Local validates and activates safe snapshot |
| Staff identity/authorization | Cloud-issued versioned grants | Local verifier snapshot for offline use |
| Production reporting | Cloud Vault sale facts | Excludes certification by default |
| V2 card ownership | Card Platform V2 only | Vault V1 never writes it |

### 6.1 Local versus cloud conflict rule

- The active transaction’s pinned snapshot never changes because the cloud published a new configuration.
- The cloud does not overwrite local transaction, command, retry, or restock facts.
- Duplicate cloud events are idempotent by immutable event ID.
- Conflicting events are quarantined for support; they are not silently last-write-wins.
- A local door cannot become available from cloud inventory math. Only a completed local restock confirmation can restore it.

## 7. Local data model

The exact SQL may vary, but these invariants and concepts are required.

### 7.1 `machine_meta`

- machine ID, enrollment ID, credential version, app version, local schema version;
- controller identity/map version, payment adapter/SDK version;
- active and pending config versions and digests;
- last successful cloud sync and trusted clock observations;
- current public/service lock state.

### 7.2 `config_snapshot`

Immutable signed payload containing machine, timezone, products, prices, machine jurisdiction (`city`, `state`), tax rate in integer basis points, tax calculation version, support page/contact configuration, door map, planned assignments, feature flags, minimum app version, creation/expiry times, and digest.

Only a validated snapshot can become active. Activation occurs only when no customer, payment, reconciliation, staff, or restock session pins the old version.

### 7.3 `door`

- stable door ID and controller channel;
- state: `EMPTY`, `AVAILABLE`, `RESERVED`, `COMMITTED_SOLD`, `SERVICE_HOLD`, `DISABLED`, or `EXCEPTION`;
- active product snapshot reference;
- planned product reference for next restock;
- owning transaction/restock ID where applicable;
- optimistic version and last event ID.

`COMMITTED_SOLD` is not physical-open proof. It prevents resale after durable payment authorization and fulfillment commitment.

### 7.4 `sale`

- local transaction UUID and short support reference;
- immutable `PRODUCTION` or `CERTIFICATION` mode;
- state and state version;
- pinned config/tax versions and machine timezone;
- subtotal, tax, total, currency, item count;
- provider session/transaction IDs and observed callback sequence;
- authorization, vend-result, settlement, cancel, and reconciliation facts;
- created, updated, and recovery timestamps.

Provider IDs are unique when present. Monetary values are integer minor units.

### 7.5 `sale_item`

- sale ID, line ID, door ID;
- product ID plus immutable name/photo/category/description/price/tax snapshots;
- allocation state and fulfillment state;
- command ID and ACK state;
- group-retry entitlement, per-door retry command ID, and retry used timestamp;
- support reason.

One sale has at most one item for a door. A line can never substitute a different door.

### 7.6 `machine_event`

Append-only record for every state transition, provider callback, command intent, command write, ACK, timeout, retry, config activation, staff access, restock action, health transition, and support action. Each event has a UUID, type/schema version, correlation/causation IDs, timestamps, actor, redacted payload, and sync state.

### 7.7 `restock_session` and `restock_item`

Durable wizard state, actor/grant version, pinned config, expected doors, command facts, and one of `UNREVIEWED`, `FILLED`, `LEFT_EMPTY`, or `EXCEPTION` for every door. Only `FILLED` activates planned inventory.

### 7.8 `outbox`

Append-only delivery queue with event ID, payload digest, attempt count, next attempt time, last response, and acknowledgement time. Cloud acceptance is idempotent and does not delete the local business record.

### 7.9 SQLite requirements

- WAL mode, foreign keys enabled, `synchronous=FULL`, busy timeout, and one writer process.
- Every state transition and outbox event committed atomically.
- Integrity check at controlled startup/maintenance intervals.
- Bounded encrypted backups and tested restore procedure.
- No cardholder data, PIN plaintext, SDK secret, or raw machine credential in ordinary tables/logs.
- Windows-protected secret storage for machine keys and provider secrets.

## 8. Cloud data model

The cloud schema is Vault-specific and additive.

### 8.1 Required models

| Model | Purpose and critical constraints |
|---|---|
| `VaultMachine` | Stable machine identity, location, timezone, enrollment/credential version, active/pending config, status, versions, last heartbeat; unique machine slug/serial. |
| `VaultProduct` | Configurable name, media, description, price cents, category, tax class, active state; immutable historical sale snapshots. |
| `VaultDoor` | Stable machine + door ID, controller channel, active/planned product, reporting state/version; unique `(machineId, doorId)` and `(machineId, channel)`. |
| `VaultConfigVersion` | Immutable versioned/signed machine configuration, digest, creator, publish status, minimum app version, created/published timestamps. |
| `VaultSale` | Idempotent local transaction, mode, machine/timezone/config/tax snapshots, amounts, provider IDs, payment/fulfillment/settlement state, timestamps. |
| `VaultSaleItem` | Door/product/price/tax snapshots, fulfillment/command/retry/support facts; unique `(saleId, doorId)`. |
| `VaultMachineEvent` | Idempotently ingested append-only audit and health envelope; unique `(machineId, eventId)`. |
| `VaultRestockSession` | Actor, machine, config, start/final state, counts and exception summary. |
| `VaultRestockItem` | Door-level plan, command evidence, manual result; unique `(restockSessionId, doorId)`. |
| `VaultStaffMachineAccess` | User, machine, role, status, verifier/grant version, validity/revocation metadata; never PIN plaintext. |

Enums must be explicit in Prisma where stable. Payload JSON is reserved for versioned snapshots and vendor evidence, not core queryable state.

### 8.2 V1 and V2 isolation

- No relation from a Vault V1 sale item to `PackDefinition`, `PackInstance`, `Item`, `CollectibleCardV2`, or `CardOwnershipEventV2` is required.
- Do not decrement `PackDefinition.inventoryCount`.
- Do not create a customer `User` for guest checkout.
- A future link field or bridge event requires a separate owner-approved migration and an identified physical-pack protocol.

### 8.3 Reporting integration

Ten Kings reporting adds a Vault production-sales source through a read model or explicit union. It preserves channel, machine, local timezone, product, price, tax, transaction, and settlement snapshots. Certification is excluded by default and must be intentionally selected.

Inventory reporting counts local/cloud-reconciled `AVAILABLE` doors. Low stock is at or below 20 percent of enabled assigned doors for a product; sold out is zero.

## 9. Cloud APIs

All routes live under `/api/vault/v1`. Every request uses schema validation, size limits, request IDs, structured redacted logs, and version negotiation.

### 9.1 Machine APIs

- `POST /machines/enroll/complete` — one-time, expiring enrollment exchange created by a Ten Kings Admin and audited; a Technician may perform the physical machine-side step using that one-time token.
- `GET /machines/{machineId}/config` — conditional fetch by version/digest; returns signed immutable snapshot.
- `POST /machines/{machineId}/events:batch` — ordered idempotent event ingestion with per-event acknowledgement.
- `POST /machines/{machineId}/heartbeat` — health, versions, counts, last sync, readiness reasons; no sensitive secrets.
- `POST /machines/{machineId}/staff-grants:pull` — versioned machine-scoped verifier/grant snapshot.

Machine authentication uses a unique revocable machine credential with rotation. The server binds the credential to the path machine ID. No public operator key, shared fleet secret, or user bearer token is accepted.

Mark, acting as Ten Kings Admin/owner, owns enrollment and key-management authority. Only `ADMIN` may create enrollment tokens, approve enrollment, rotate or revoke credentials, recover a machine, or decommission it. A `TECHNICIAN` may install a machine and complete a specifically authorized one-time enrollment, but does not receive fleet-wide signing or recovery keys.

### 9.2 Admin APIs

- products: list/create/update/deactivate with validation and media references;
- machine/config: draft, validate, impact preview, publish, activate-status view;
- doors: bulk planning tools that never mutate an active session;
- fleet/health: online versus sales-ready, dependency reasons, versions, last heartbeat;
- sales/restock/certification/support: filterable read APIs with immutable audit;
- staff access: grant/revoke machine and role scope with step-up authentication.
- tax/support: set machine city/state, decimal tax percentage, effective version, and support page/email/text/phone destinations; preview calculation/impact before signed publication.

There is no remote unlock route in V1.

### 9.3 Sync behavior

- Local sends events in stable order with unique IDs; server may accept duplicates as success.
- Partial batch acceptance returns exact acknowledged and rejected event IDs.
- Retry uses exponential backoff with jitter and bounded local storage alerts.
- Schema/version incompatibility pauses sync and, when policy requires, sales.
- Cloud 4xx rejection never discards local evidence.
- Machine health distinguishes cloud unreachable, auth rejected, config stale, outbox pressure, controller unready, Nayax unavailable, storage degraded, clock unsafe, and service lock.

## 10. Payment and fulfillment state machine

### 10.1 Required states

```text
CART_ACTIVE
  -> CHECKOUT_REVALIDATING
  -> RESERVED
  -> PAYMENT_REQUESTED
  -> PAYMENT_AUTHORIZED
  -> FULFILLMENT_COMMITTED
  -> OPEN_COMMAND_PENDING
  -> OPEN_COMMAND_ACKED | OPEN_ACK_UNKNOWN | OPEN_COMMAND_FAILED
  -> VEND_RESULT_PENDING
  -> SETTLEMENT_PENDING
  -> SETTLED
  -> COMPLETED
```

Terminal/support branches include:

```text
PAYMENT_DECLINED
PAYMENT_CANCELLED
PAYMENT_UNKNOWN
RECONCILIATION_REQUIRED
SUPPORT_REQUIRED
```

The exact Nayax adapter mapping may add evidence states but may not remove the distinctions above.

### 10.2 Checkout revalidation

In one local transaction:

1. Verify machine is sales-ready.
2. Verify active config and tax snapshot are usable under policy.
3. Verify every cart door remains available, enabled, and assigned to the selected product.
4. Remove only conflicted lines and return exact door IDs; preserve other cart lines.
5. Enforce provider-specific item-count, per-item, and total limits.
6. Pin product, price, tax, door, controller map, config, and mode snapshots.
7. Reserve the valid doors and create the durable sale.

Cart mutation stops after payment initiation.

Tax is machine-specific and manually administered. The Admin UI requires city, state, and a percentage; converts the percentage to integer basis points; previews sample subtotal/tax/total calculations; and publishes a signed immutable version. Checkout calculates tax once on the transaction subtotal with half-up cent rounding, displays it before payment, and pins the city/state/rate/calculation version and resulting cents to the sale. A later rate change never alters an active or historical transaction.

### 10.3 Nayax adapter contract

The adapter exposes only approved SDK operations and normalized callbacks:

- initialize and report capabilities/version;
- open/preselect approved session and items;
- cancel before authorization when permitted;
- record authorization, decline, cancel, timeout, and error callbacks;
- report vend result only under the G-01 approved rule;
- query/reconcile session/transaction state after restart or ambiguity;
- close session only when allowed by the approved flow;
- expose official simulator/test mode without permitting accidental live settlement.

Every callback is persisted before triggering the next effect. Duplicate or out-of-order callbacks are deterministic no-ops or quarantined evidence. The local UUID and provider transaction ID are both idempotency keys.

Nayax’s documented price encoding and installed SDK limits are hard checkout constraints. Do not silently split the cart.

### 10.4 Fulfillment commit

After payment authorization and before any door command, a single local database transaction:

- moves the sale to `FULFILLMENT_COMMITTED`;
- moves every purchased door from `RESERVED` to `COMMITTED_SOLD`;
- creates one command intent per door with a deterministic command ID;
- creates outbox audit events.

If that transaction does not commit, no door command is sent. After it commits, the doors never return to available through customer cancellation or automatic timeout.

### 10.5 Command execution

- One controller writer serializes commands.
- Each command includes its persisted command ID, door/channel mapping version, attempt number, and timeout.
- ACK means the controller accepted the command under the qualified protocol; it is not proof of physical opening.
- Timeout/unknown never triggers an automatic repeated command.
- After all initial commands have reached ACK, failed, or unknown outcomes, the UI offers one prominent customer action labeled `OPEN DOORS`.
- Pressing `OPEN DOORS` durably consumes the transaction's single group-retry entitlement, creates one second command intent for every paid door, and then sends those commands through the same serialized controller path.
- The retry set is exactly the original paid door set. It cannot add, remove, substitute, or remotely select a door.
- Each paid door therefore receives at most two commands total: its initial command and the one group retry. No third command is allowed, even after restart or repeated button taps.
- If the customer still reports a problem after the group retry, show the support page/QR and short transaction reference. Do not automatically substitute a door, issue store credit, or trigger a refund.
- Unexpected-door evidence in certification immediately disables physical automation and requires technician/admin intervention.

### 10.6 Vend result and settlement

The production adapter must follow the Nayax-approved no-sensor policy:

- never report success based only on UI state;
- never invent a partial-vend list;
- preserve command ACK/unknown/failure per item;
- reconcile before accepting a second payment when provider state is unknown;
- route ambiguity to support with a short transaction reference;
- preserve authorization and settlement as separate report fields.

### 10.7 Crash recovery

On start, the machine service loads every nonterminal sale and:

1. starts no new transaction until local integrity and adapter readiness are known;
2. queries Nayax for provider state when supported;
3. reconstructs command attempts from durable events;
4. never reauthorizes or resends a command blindly;
5. renders a public recovery or support screen for the existing sale;
6. resumes sync independently;
7. records every recovery decision.

## 11. Controller adapter

### 11.1 Contract

- enumerate/version controller and firmware;
- validate the exact 150-door mapping;
- health check without actuating doors;
- send one door-open command;
- return normalized ACK, explicit error, timeout, or transport loss;
- prohibit parallel writes;
- support a deterministic simulator and fault injection.

### 11.2 Safety

- Browser and cloud cannot call serial hardware directly.
- Only a locally authorized sale/retry/restock/certification command can reach the adapter.
- Customer commands must reference a `COMMITTED_SOLD` sale item.
- Restock commands require an active authorized restock session.
- Certification commands require immutable test mode and an active evidence session.
- No generic “open any door” public or remote API exists.
- Service diagnostics that actuate a door require `TECHNICIAN` or `ADMIN`, explicit confirmation, and audit.

## 12. Customer kiosk experience

### 12.1 Visual system

- Premium black background, warm gold accents, high-contrast white text.
- Large touch targets: 56–64 CSS pixels for primary actions and at least 44–48 CSS pixels for door cells.
- Color, animation, and sound never carry state alone.
- Visible focus, semantic dialogs, focus trapping, `aria-live` status, disabled semantics, and reduced-motion behavior.
- Media failure falls back to a cached placeholder without blocking sales.

### 12.2 Stable shopping workspace

The customer remains in one shell:

- fixed product rail;
- invariant physical door map in a vertical scroll region;
- sticky column and row headers;
- matching available doors highlighted and unavailable doors visible but dimmed;
- sticky cart with exact door IDs, products, unit prices, subtotal, tax, total status, and item count;
- short checkout/payment/retrieval overlays that do not navigate away from the durable state.

Do not reorder, filter away, or compact the physical map after a selection. Selecting a cart line focuses its product and pulses the exact door.

### 12.3 “Pick for me”

The local service chooses one currently available, unreserved door for the active product using an unbiased secure random selection. The authoritative selection is persisted before animation. The button is disabled while animating and when no matching doors exist.

### 12.4 Public states

The UI explicitly handles:

- `BOOTING`, `UPDATING`, `NO_VALID_CACHED_CONFIG`, `CLOSED`, `MAINTENANCE`;
- `ATTRACT`, `SHOPPING_EMPTY`, `SHOPPING_WITH_CART`, `PRODUCT_SOLD_OUT`, `ALL_PRODUCTS_SOLD_OUT`;
- `RESERVATION_CONFLICT`, `CHECKOUT_REVALIDATING`, `PROVIDER_LIMIT_EXCEEDED`;
- `CONTROLLER_NOT_READY`, `NAYAX_UNAVAILABLE`;
- `PAYMENT_STARTING`, `PAYMENT_PENDING`, `PAYMENT_DECLINED`, `PAYMENT_CANCELLED`, `PAYMENT_UNKNOWN`, `PAYMENT_APPROVED_DURABLE`;
- `UNLOCK_QUEUED`, `RETRIEVAL`, `GROUP_RETRY_AVAILABLE`, `GROUP_RETRY_COMMITTED`, `GROUP_RETRY_USED`, `SUPPORT_REQUIRED`;
- `PAID_RESET_COUNTDOWN`, `IDLE_WARNING`, `RESETTING`, `SERVICE_ENTRY`, `SERVICE_LOCKED`.

`PAYMENT_UNKNOWN` says “Checking payment—do not pay again” and prevents a new charge.

### 12.5 Timeout behavior

- The 60-second idle timer runs only in unpaid browse/cart states.
- At 60 seconds, a 10-second modal absorbs background touches and offers one prominent `CONTINUE SHOPPING` action.
- Payment, authorization, reconciliation, unlock, retry, support, and service states never use the unpaid idle timer.
- After payment, a visible 30-second reset countdown runs alongside `I GOT MY PACKS — DONE`.
- The paid retrieval screen offers one `OPEN DOORS` button until the group retry is consumed. A retry extends retrieval once by a bounded policy value.
- Reset clears public presentation state, not durable payment, command, retry, reconciliation, or support facts.

### 12.6 Customer language

Permitted: “Payment approved,” only after durable authorization; “Unlock command sent”; “Doors are unlocking”; “Take your packs from X-01 and K-09”; “Need us to open your paid doors again? Tap OPEN DOORS.”  
Not permitted: “Door opened,” “Pack dispensed,” “Delivery confirmed,” or “Transaction settled” without the corresponding evidence.

Customers are never instructed to close doors.

## 13. Staff access and service mode

### 13.1 Entry

- Ten taps in one fixed invisible corner within a configured 5–8 second window.
- Any outside tap or expiration resets the sequence.
- Success opens only the PIN pad.
- Individual six-digit PIN, locally verified against a versioned salted password-verifier record; never stored or logged in plaintext.
- Machine scope, role scope, expiry/revocation, rate limit, exponential backoff, generic failures, and audit.

### 13.2 Approved role matrix

| Role | May do | May not do |
|---|---|---|
| `RESTOCKER` | Enter restock mode on assigned machines; view the assigned restock plan and door states; open only doors in the active restock batch; record `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`; report shortages; review and complete the safe-exit checklist. | Change products, prices, tax, support contacts, or the door/controller map; use customer payment/retry controls; run unrestricted diagnostics; resolve payments/refunds; manage PINs/roles/keys; certify or launch a machine. |
| `TECHNICIAN` | All Restocker actions; enter service lock; view health, versions, controller map, logs, and redacted diagnostics; run approved individual-door/controller tests only in service or certification mode; install/repair approved hardware/software; perform recovery; collect certification evidence; approve a machine’s pre-field certificate. | Change products/prices/tax/support policy; manage staff roles or fleet keys; resolve financial reconciliation/refunds; issue a customer-sale unlock; bypass safety gates; remotely unlock any door. |
| `ADMIN` | All Technician actions; manage products, prices, media, machine city/state/tax rate, support destinations, planned door assignments, and signed configuration publication; issue/revoke individual PIN grants and roles; resolve payment/reconciliation/support cases; create/approve/rotate/revoke machine enrollment credentials; approve certification; recommend pilot/launch. | Bypass immutable audit, open an unpaid or arbitrary customer door, alter a pinned/closed sale, silently change filled-door inventory, or treat certification as launch authorization. |

This matrix is owner-approved. Admin-only sensitive actions require authenticated cloud admin identity, fresh step-up authentication, reason capture, and immutable audit. Mark is the owner Admin for enrollment and key management. Actual deployment, migration application, live-payment activation, and production launch still require their separate explicit authorization.

### 13.3 Service lock

Entering service mode inhibits new customer and payment sessions. After two minutes of staff inactivity, the machine returns to a locked service screen, never directly to public mode. Restart during service/restock returns to locked recovery. Public mode resumes only after explicit safe exit and manual confirmation that serviced doors are closed.

## 14. Restock workflow

1. Preflight: no active customer/payment, correct machine/config, controller ready, authorized actor.
2. Show planned groups, exact expected doors, available/empty counts, and exceptions.
3. Process one product/tier group at a time.
4. Show exact door list and invariant physical map.
5. Persist command intents, then send the approved group commands.
6. Require `FILLED`, `LEFT EMPTY`, or `EXCEPTION` per door.
7. Activate planned assignment only for a door confirmed `FILLED`.
8. Leave failed/unreviewed doors unavailable and support-flagged.
9. Review totals, shortages, mismatches, and exceptions.
10. Require manual confirmation that all serviced doors are physically closed.
11. Finalize, sync, and explicitly exit to public mode.

The wizard resumes from durable state after inactivity lock, crash, or restart. There is no blind “mark all filled.” A batch helper may preselect rows only if staff still reviews every door before finalization.

## 15. Cloud admin and fleet

### 15.1 Products

- Required name, photo, description, integer price cents, Sports/Pokémon category, tax class, active state.
- Preview, validation, audit, safe deactivation, and historical snapshot preservation.
- Deactivation never changes a pinned customer transaction or historical sale.

### 15.2 Machine configuration

- Stable 150-door map with active and planned assignments.
- Row, column, range, and product bulk tools with dry-run impact and typed confirmation for destructive changes.
- Filled-door assignment cannot be silently changed.
- Immutable published versions and signed digests.
- Safe-boundary local activation and visible “update pending” status.
- Product copy, price, tax, and mapping cannot change mid-cart.

### 15.3 Machine detail

- Sales-ready versus merely online.
- Exact heartbeat and sync times.
- Nayax, controller, active config, cloud, local storage, clock, outbox, and service-lock health.
- App, local schema, config, payment SDK/adapter, controller firmware/map, and hardware identity versions.
- Available doors by product, low-stock/sold-out state, today/week/month/custom sales, settlement/reconciliation state, restock history, certification status, and open support cases.

### 15.4 Fleet and reporting

- Production sales exclude certification by default.
- Financial views distinguish authorized, settled, cancelled/voided, unknown, and support/reconciliation states.
- Inventory derives from available doors.
- All day boundaries use the machine’s snapshotted IANA timezone.
- Online does not imply sales-ready.

## 16. Certification mode

### 16.1 Principle

Certification wraps the production state machine, repositories, UI components, door mapping, retry rules, restock wizard, and sync contracts. It swaps approved provider/controller adapters and binds immutable `CERTIFICATION` mode. It is not a second business implementation.

### 16.2 Safeguards

- Persistent red `TEST MODE` on every screen.
- Clear display of mock, official Nayax test, or live-settlement status.
- Live settlement disabled unless an owner-approved certification step explicitly requires it.
- Wrong-door evidence immediately stops physical automation.
- Every physical command requires `PASS`, `FAIL` with missed doors, or `CRITICAL` with unexpected doors and notes.
- Certification survives restart and shift changes.
- Test data is excluded from production revenue and ordinary inventory.

### 16.3 Evidence classes

- Unit and model/property tests.
- Deterministic UI/component tests.
- Full local simulator and fault-injection tests.
- Nayax official SDK simulator tests.
- Controller bench tests.
- Full-machine human-observed tests.
- Field soak tests.

### 16.4 Minimum coverage

- Every door: five observed purchase-open cycles, at least 750 door openings total.
- Every door: two observed restock-open cycles, at least 300 door openings total.
- At least 500 human-observed purchase sessions; multi-door sessions may contribute to multiple door cycles.
- At least 1,000 automated end-to-end transactions, plus model/property tests that explore substantially more state sequences.
- Decline, cancel, payment unknown, duplicate callback, out-of-order callback, crash at every external-effect boundary, serial timeout, wrong ACK, controller restart, cloud loss, config update, local disk pressure, clock drift, PIN lockout, restock crash, and recovery cases.

A deterministic coverage scheduler prioritizes under-tested doors. Pure random selection cannot certify the map.

### 16.5 Certificate

The signed certificate records:

- app build and source commit;
- local schema and contract versions;
- active config version/digest;
- Nayax SDK/adapter and flow configuration;
- controller model/firmware/map digest;
- touchscreen/PC/Windows/browser/enclosure identities;
- automated and human evidence manifests;
- unresolved deviations;
- approver identities and date.

Relevant changes invalidate or scope-reduce the certificate under the G-07 matrix.

## 17. Security and privacy

- Loopback service binds only to `127.0.0.1`/`::1` and validates origin plus a per-install UI token where applicable.
- Cloud machine credentials are unique, revocable, rotated, and protected by Windows credential facilities.
- Staff PINs use a memory-hard password hash with unique salt and versioned verifier; logs record actor ID after success, never PIN input.
- No PAN, track data, CVV, or unnecessary provider payload is stored or logged.
- Logs redact bearer tokens, credentials, PINs, transaction secrets, and personal data.
- Guest sales create no customer account and collect no phone/email.
- Admin routes require server-side identity plus Vault permission; sensitive publication/access actions require fresh human step-up.
- Build artifacts are signed or digest-verified, dependencies locked, and update/rollback procedures tested.
- Browser CSP and local API validation prevent arbitrary navigation or hardware access.

## 18. Observability and support

### 18.1 Structured context

Every log/event includes available machine ID, local transaction ID, provider transaction ID, command ID, sale item, door ID, mode, config version, app version, event type, monotonic sequence, and redacted error classification.

### 18.2 Health states

- `READY`
- `DEGRADED_CLOUD`
- `DEGRADED_SYNC`
- `BLOCKED_CONFIG`
- `BLOCKED_TAX`
- `BLOCKED_NAYAX`
- `BLOCKED_CONTROLLER`
- `BLOCKED_STORAGE`
- `BLOCKED_CLOCK`
- `SERVICE_LOCKED`
- `RECOVERY_REQUIRED`

Public sales are allowed only when policy evaluates the current combination as sales-ready.

### 18.3 Support screen

Shows a short reference, the exact paid doors, whether payment is still being checked, the remaining `OPEN DOORS` retry state, and safe customer instructions. After the group retry is consumed, it prominently offers a QR code and on-screen link to a Ten Kings customer-support page. That page provides three customer choices: email, text message, or phone call with a Ten Kings support agent.

The support page URL and the email/text/phone destinations are machine configuration values controlled by Admin and included in the signed snapshot. The QR/link may carry only the short opaque transaction reference and affected door IDs; it never carries a raw provider ID, secret, PIN, stack trace, or customer personal data. Vault does not automatically substitute a door, issue store credit, or initiate a refund.

## 19. Delivery phases

### Phase 0 — Evidence and contracts

- Preserve the recorded owner correction that Vault is independent of Speedster and Card Platform V2 sequencing.
- Acquire official Nayax/controller/hardware evidence.
- Freeze door ID, state, event, adapter, config, tax, and reporting contracts.
- Produce threat model, failure-mode analysis, and certification matrix.
- No migration, deploy, real charge, or physical command.

### Phase 1 — Simulators and local skeleton

- Local service, SQLite schema, repositories, state model, mock Nayax/controller, durable outbox, recovery harness.
- Static kiosk UI and all public/staff states.
- Unit, property, contract, crash, and deterministic simulation tests.
- This software phase may begin on the authorized independent Vault branch.

### Phase 2 — Cloud domain and admin

- Cloud schema, API, admin, and migration-source implementation may begin on the independent Vault branch. Applying the migration to any database requires explicit migration authorization.
- Vault cloud models/migration, machine auth, config/event/heartbeat APIs, admin and reporting read models.
- No live payment or controller activation.

### Phase 3 — Hardware adapters

- Only after G-01/G-02/G-04 evidence for real payment, controller, and installed-screen activation. Mock/simulator adapter development may proceed earlier.
- Official Nayax bridge and simulator evidence.
- Controller bench adapter, electrical/map evidence.
- Windows service/assigned access installation and rollback.

### Phase 4 — Full integration and certification

- Only after G-03/G-05/G-06/G-07 decisions.
- Full-machine tests, human coverage, soak, support drills, certificate.
- Production remains disabled until owner launch acceptance.

### Phase 5 — Production pilot

- Separately authorized deployment/migration/activation.
- One-machine bounded pilot, rollback plan, live monitoring, daily reconciliation, incident stop criteria.

## 20. Acceptance criteria

### 20.1 Transaction integrity

- No command before durable payment authorization and fulfillment commit.
- No sold door appears available after commit.
- Duplicate requests/callbacks/events produce no duplicate charge, sale, command entitlement, or reporting row.
- Payment unknown prevents a new charge until reconciled.
- One transaction-level `OPEN DOORS` group retry maximum; each original paid door receives at most one second command, durable across restart.
- Every monetary and inventory transition is reconstructable from persisted facts.

### 20.2 Offline and recovery

- Cloud loss never loses or pauses an active/authorized transaction, initial door commands, or the paid group retry; all are local-machine operations.
- Starting a new checkout is blocked whenever the Ten Kings cloud is unavailable. Active and already-authorized transactions continue locally.
- Loss of Nayax/internet payment connectivity blocks new payment attempts unless a future Nayax-certified offline-payment mode is separately approved.
- UI, service, and PC restart recover the same transaction without blind payment or command repeat.
- Invalid/corrupt local state fails closed with support/recovery evidence.
- Outbox reconnect is idempotent and preserves event order.

### 20.3 Customer UI

- Stable physical map and correct door IDs across all screens and supported scaling.
- Mixed cart works within provider limits.
- Exact subtotal, tax, and total shown before payment.
- Recovery/error states are explicit and cannot be mistaken for decline or success.
- UI never claims sensor-confirmed opening or asks customers to close doors.
- Touch, keyboard service use, contrast, focus, reduced motion, glare, and standing reach tests pass.

### 20.4 Staff/restock

- Individual scoped PIN access with lockout/backoff and audit.
- Service mode blocks new sales.
- Restock resumes after interruption.
- Every serviced door ends `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`.
- Only `FILLED` restores availability.
- Public mode requires explicit safe exit and physical-close confirmation.

### 20.5 Admin/reporting

- Product/config changes are versioned, audited, and safe-boundary activated.
- Filled doors cannot be silently reassigned.
- Fleet distinguishes online from sales-ready.
- Inventory derives from available doors.
- Production revenue excludes certification by default and distinguishes settlement/reconciliation.

### 20.6 Certification

- Production and certification exercise the same business paths.
- Coverage thresholds and failure matrix pass.
- Any wrong-door event stops physical automation.
- Certificate binds the complete version/evidence tuple.
- Required recertification is enforced after relevant changes.

## 21. Authoritative engineering rules

1. Persist before external effect.
2. Treat every external callback and request as repeatable.
3. Serialize controller writes.
4. Distinguish authorization, fulfillment commitment, ACK, vend result, and settlement.
5. ACK is not proof of physical opening.
6. Never invent pack/card identity.
7. Never use cloud inventory as local command authority.
8. Never reuse legacy mutable inventory counters for Vault.
9. Never mutate an active session’s pinned configuration.
10. Never report certification as production.
11. Never add remote unlock in V1.
12. Never close an evidence gate through assumption.

## 22. Evidence references

### Ten Kings repository

- PostgreSQL/Prisma datasource: `/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/prisma/schema.prisma`, lines 1–8.
- Legacy pack models: same file, lines 1100–1142.
- Current V2 card/ownership models: same file, lines 3680–3743.
- Current V2 creation hook: `/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/database/src/cardPlatformV2.ts`, lines 669–748.
- Current admin authority: `/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/frontend/nextjs-app/lib/server/admin.ts`, lines 94–182.
- Local loopback precedent: `/Users/markthomas/tenkings/.codex-worktrees/phase2-production-observed-20260816/packages/ai-grader-capture-helper/src/transport.ts`, beginning line 14.

### Vendor evidence

- [Nayax Marshall sales kit](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/sales-kit)
- [Nayax Marshall installation steps](https://devzone.nayax.com/docs/integrate-pos-device/marshall/hw-integration-kit-and-setup/installation-steps)
- [Nayax Marshall SDK](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-sdk)
- [Nayax Marshall payment flows](https://devzone.nayax.com/docs/integrate-pos-device/marshall/payment-flows/marshall-payment-flows)
- [Nayax Multi-Vend with Pre-Selection](https://devzone.nayax.com/docs/integrate-pos-device/marshall/payment-flows/marshall-multi-vend-with-pre-sel)
- [Nayax Create Payments](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-create-payments)
- [Nayax Getting Started and Certification](https://devzone.nayax.com/docs/integrate-pos-device/marshall/get-started/marshall-get-started)
- [Nayax C# SDK Simulator](https://devzone.nayax.com/docs/integrate-pos-device/marshall/simulators-sample-codes/csharp-sdk-simulator)
- [Nayax flow configuration FAQ](https://devzone.nayax.com/docs/integrate-pos-device/marshall/marshall-faqs/faq-marshall-flowconfigurations)
- [Elo 1304L official datasheet](https://docs.elotouch.com/Elo_1304L_DS.pdf)

## 23. Blueprint status

This is the final owner-approved engineering and Codex build contract for independent Vault V1 implementation on a clean branch. Speedster and Card Platform V2 sequencing are not blockers. No owner-policy questions remain open. The paid-door group retry, manual per-machine tax configuration, fail-closed new checkout during Ten Kings cloud loss, approved staff-role matrix, three-option customer support design, Technician/Admin certification authority, service-life-plus-three-years evidence retention, and Mark/Admin enrollment-key ownership are locked. Actual support contact values are Admin-supplied deployment configuration. This blueprint is not, by itself, permission to apply a database migration, deploy, charge a real payment method, actuate physical hardware, or launch production.
