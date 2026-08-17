# Vault V1 Architecture and Ownership

Status: frozen for implementation on `codex/vault-v1-build` from `origin/main` at `1dcb39a1`.

## Canonical architecture

One Windows service (`packages/vault-machine`) is the sole local writer and immediate authority. It serves one static React kiosk (`frontend/vault-kiosk`) over authenticated loopback HTTP/WebSocket, owns SQLite, persists every external-effect intent, drives normalized payment/controller adapters, and synchronizes an append-only outbox to the existing Next.js/PostgreSQL cloud. The cloud owns immutable configuration publication, machine/staff credentials, fleet administration, audit projection, and reporting; it never sends a door command.

`packages/vault-contracts` is the single shared vocabulary. It fixes the 150-door parser/order, integer-money/tax rules, roles, states, config signing, API envelopes, adapter contracts, redaction, and certification thresholds.

## File ownership during the build

| Owner | Exclusive paths |
|---|---|
| Lead orchestrator | `packages/vault-contracts/**`, `.github/workflows/ci.yml`, root lockfile/config, `docs/vault-v1/**`, handoff/session docs, cross-package integration |
| Local-machine specialist | `packages/vault-machine/**` |
| Kiosk specialist | `frontend/vault-kiosk/**` |
| Cloud/admin specialist | Vault additions inside `packages/database/**` and Vault-only files inside `frontend/nextjs-app/**` |

No specialist edits another owner's file set. The lead resolves cross-package changes.

## Resolved architecture decisions

- Product prices are restricted to the four owner-approved V1 prices: 2500, 5000, 10000, and 25000 cents. Price remains explicit and versioned; tier never derives it.
- Tax percentage input accepts at most two decimal places and converts exactly to integer basis points. Tax uses integer half-up rounding on the transaction subtotal.
- Config payloads use canonical JSON, SHA-256 digests, and detached Ed25519 signatures. Machines trust pinned public-key IDs and reject downgrade, invalid signature, wrong machine, expired snapshot, or unsupported schema.
- Machine HTTPS authentication uses a unique random credential stored only as a server-side hash, bound to machine ID and credential version. Enrollment tokens are one-time, expiring, hash-stored, and Admin-approved. Technician recovery means application/service recovery; credential recovery remains Admin-only.
- The loopback browser gets a short-lived HttpOnly SameSite=Strict session cookie after a same-origin bootstrap. Origin validation, loopback binding, assigned access, and OS ACLs are the boundary; JavaScript-visible static tokens are not treated as secrets.
- Cloud reachability must be recently proven before checkout. The signed config carries a deterministic freshness limit (default 120 seconds). Once checkout begins, cloud loss cannot stop payment recovery, fulfillment, or the single group retry.
- Financial settlement and customer retrieval are orthogonal facts. Durable sale/payment/item states remain distinct; public UI state is derived.
- Decline or confirmed pre-authorization cancellation releases reserved doors atomically. Unknown payment retains reservations and prevents a second payment until reconciliation.
- Config activation waits for a safe boundary: no active customer/payment/reconciliation, staff, or restock session. Historical snapshots never mutate.
- Simulator logical channel order is row-major. A real controller mapping remains blocked on G-02 and must replace it only through a signed 150-door config plus certification evidence.
- Customer retry extension is a signed bounded config value, default 30 seconds. Customer door commands are capped at attempts 1 and 2. Restock/certification commands never auto-repeat; an operator must record an outcome and create a new explicit evidence step where allowed.
- Local outbox pressure is an alert at 100,000 pending events or 512 MiB. Acknowledged envelopes may be archived after verified backup; underlying sale, command, audit, support, and certification facts are never deleted by sync.

## Domain isolation

Vault V1 contains no Speedster dependency and no relation/write to `PackDefinition`, `PackInstance`, `Item`, wallet, legacy kiosk/live-rip/vending facts, `CollectibleCardV2`, or `CardOwnershipEventV2`. It sells anonymous occupied doors. A future identity bridge is outside this branch and requires separate owner approval.
