# Vault V1 API Contracts

All JSON endpoints require contract header `X-Vault-Contract-Version: 1`, reject unsupported content types, enforce route-specific body limits, and return `{ requestId, error: { code, message } }` on failure. Request IDs and idempotency keys are never reused for a different payload.

## Loopback machine API

The service listens only on `127.0.0.1` and `::1`. Mutations require a valid same-origin HttpOnly kiosk session, `Origin` equal to the configured loopback origin, JSON content type, and `If-Match` where an optimistic state version is supplied. There is no generic door-open endpoint.

| Method and path | Authority and behavior |
|---|---|
| `POST /api/v1/session/bootstrap` | Same-origin assigned-access bootstrap; rotates a short-lived HttpOnly SameSite=Strict session and returns no secret. |
| `GET /api/v1/state` | Current durable public state, products, all 150 doors, cart/sale summary, readiness, support config, and state version. |
| `GET /api/v1/events` (WebSocket upgrade) | Authenticated state/event notifications only; never accepts hardware commands. |
| `POST /api/v1/cart/select` | Add/remove an available door before payment; persists authoritative cart selection. |
| `POST /api/v1/cart/pick` | Securely selects and persists one available door for a requested product before animation. |
| `POST /api/v1/checkout` | Revalidates readiness/config/tax/provider limits and selected doors; returns exact conflicts while preserving valid lines; creates/reserves durable sale. |
| `POST /api/v1/sales/{saleId}/payment` | Persists payment intent before calling the configured Nayax adapter. Repeated identical idempotency key returns the original result; different payload conflicts. |
| `POST /api/v1/internal/provider-callback` | Authenticated supervised-adapter callback only; persistence and sequence/idempotency precede effects. Not available to the kiosk UI. |
| `POST /api/v1/sales/{saleId}/open-doors` | Atomically consumes the one transaction retry and creates attempt-2 intents for exactly every original paid door. |
| `POST /api/v1/sales/{saleId}/done` | Clears only public presentation after the paid countdown; never changes payment, commands, retry, settlement, or support facts. |
| `POST /api/v1/staff/authenticate` | Verifies individual six-digit machine grant with rate limit/backoff and returns scoped service session. |
| `POST /api/v1/staff/lock` | Locks service mode; blocks new public sessions. |
| `POST /api/v1/staff/safe-exit` | Requires authorized actor and explicit serviced-doors-closed confirmation before public mode. |
| `POST /api/v1/restocks` | Starts/resumes an authorized pinned-config restock session; exact expected doors only. |
| `POST /api/v1/restocks/{id}/items/{doorId}` | Records one per-door `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`; only `FILLED` makes the planned assignment available. |
| `POST /api/v1/restocks/{id}/finalize` | Requires every door reviewed and physical-close confirmation; persists audit/outbox. |
| `POST /api/v1/certification/sessions` | Starts immutable `CERTIFICATION` mode using the same command/state paths and selected test adapters. |
| `POST /api/v1/certification/sessions/{id}/evidence` | Records PASS/FAIL/CRITICAL evidence; unexpected door makes physical automation fail closed. |
| `GET /api/v1/health` | Readiness reasons, versions, integrity, clock/storage/cloud/outbox, mock adapter identity, and service lock; redacted. |

## Cloud machine API

All enrolled-machine routes require the unique machine credential. The server hashes it, verifies credential version/status, and binds it to the `{machineId}` path. A machine/user/operator credential cannot substitute for another authority type.

- `POST /api/vault/v1/machines/enroll/complete`
- `GET /api/vault/v1/machines/{machineId}/config`
- `POST /api/vault/v1/machines/{machineId}/events:batch`
- `POST /api/vault/v1/machines/{machineId}/heartbeat`
- `POST /api/vault/v1/machines/{machineId}/staff-grants:pull`

Event batches are monotonic per machine and acknowledge/reject exact event IDs. A duplicate event with the same digest is success; the same ID with a different digest is quarantined and rejected. Partial acceptance does not advance or delete rejected local evidence.

## Cloud Admin API

Admin routes use server-side human sessions plus Vault permission. Credential lifecycle, staff grants, signed config publication, financial resolution, and certification approval require a fresh human step-up, reason text, and immutable audit.

- `/api/vault/v1/admin/products`
- `/api/vault/v1/admin/machines`
- `/api/vault/v1/admin/machines/{machineId}/config/{draft|validate|impact|publish}`
- `/api/vault/v1/admin/machines/{machineId}/doors/plan`
- `/api/vault/v1/admin/machines/{machineId}/staff-access`
- `/api/vault/v1/admin/machines/{machineId}/enrollment`
- `/api/vault/v1/admin/fleet`
- `/api/vault/v1/admin/sales`
- `/api/vault/v1/admin/restocks`
- `/api/vault/v1/admin/certification`
- `/api/vault/v1/admin/support-cases`

No route may unlock a door remotely, mutate local inventory authority, mutate a pinned/closed sale, or write any V1/V2 pack/card/ownership record.
