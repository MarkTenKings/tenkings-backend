# Vault V1 API Contracts

All JSON endpoints require contract header `X-Vault-Contract-Version: 1`, reject unsupported content types, enforce route-specific body limits, and return `{ requestId, error: { code, message } }` on failure. Request IDs and idempotency keys are never reused for a different payload.

## Loopback machine API

The service listens only on `127.0.0.1` and `::1`. Mutations require a valid same-origin HttpOnly kiosk session, `Origin` equal to the configured loopback origin, JSON content type, and `If-Match` where an optimistic state version is supplied. There is no generic door-open endpoint.

| Method and path | Authority and behavior |
|---|---|
| `POST /api/v1/session/bootstrap` | Same-origin assigned-access bootstrap; rotates a short-lived HttpOnly SameSite=Strict session and returns no secret. |
| `POST /api/v1/session/activity` | Persists genuine public activity and advances the optimistic state version. Rejected during an active sale or service lock. |
| `GET /api/v1/state` | Current durable public state, products, all 150 doors, cart/sale summary, readiness, support config, and state version. |
| `GET /api/v1/events` (WebSocket upgrade) | Authenticated state/event notifications only; never accepts hardware commands. |
| `POST /api/v1/cart/select` | Add/remove an available door before payment; persists authoritative cart selection. |
| `POST /api/v1/cart/pick` | Securely selects and persists one available door for a requested product before animation. |
| `POST /api/v1/checkout` | Revalidates readiness/config/tax/provider limits and selected doors; returns exact conflicts while preserving valid lines; creates/reserves durable sale. |
| `POST /api/v1/sales/{saleId}/payment` | Persists payment intent before calling the configured Nayax adapter. Repeated identical idempotency key returns the original result; different payload conflicts. |
| `POST /api/v1/internal/provider-callback` | Authenticated supervised-adapter callback only; persistence and sequence/idempotency precede effects. Not available to the kiosk UI. |
| `POST /api/v1/sales/{saleId}/open-doors` | Atomically consumes the one transaction retry and creates attempt-2 intents for exactly every original paid door. |
| `POST /api/v1/sales/{saleId}/done` | Clears only public presentation after payment and door-command recovery are safe; never erases payment, commands, retry, settlement, or support facts. |
| `POST /api/v1/staff/authenticate` | Verifies individual six-digit machine grant with rate limit/backoff and returns scoped service session. |
| `POST /api/v1/staff/lock` | Locks service mode; blocks new public sessions. |
| `POST /api/v1/staff/safe-exit` | Requires authorized actor and explicit serviced-doors-closed confirmation before public mode. |
| `POST /api/v1/restocks` | Starts/resumes an authorized pinned-config restock session; exact expected doors only. Schedules at most one unobserved command and returns its intent/terminal/observation phase. |
| `POST /api/v1/restocks/{id}/items/{doorId}` | After a terminal command receipt, records one per-door human observation: `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`; only `FILLED` makes the planned assignment available. |
| `POST /api/v1/restocks/{id}/finalize` | Requires every door reviewed and physical-close confirmation; persists audit/outbox. |
| `POST /api/v1/certification/sessions` | Starts/resumes immutable `CERTIFICATION` mode using the same command/state paths and selected test adapters. Requires trusted service-supplied source commit/app identity and schedules at most one unobserved command. |
| `POST /api/v1/certification/sessions/{id}/evidence` | After a terminal command receipt, records PASS/FAIL/CRITICAL evidence bound to that exact command and door; unexpected door makes physical automation fail closed. |
| `POST /api/v1/certification/sessions/{id}/submit` | Requires all scheduled commands to have human evidence plus physical-close confirmation, then closes local collection as `REVIEW_REQUIRED`. It is not certificate approval. |
| `GET /api/v1/health` | Readiness reasons, trusted source/app identity, schema/config versions, integrity, clock/storage/cloud/outbox, mock adapter identity, and service lock; redacted. |

## Cloud machine API

All enrolled-machine routes require the unique machine credential. The server hashes it, verifies credential version/status, and binds it to the `{machineId}` path. A machine/user/operator credential cannot substitute for another authority type.

- `POST /api/vault/v1/machines/enroll/complete`
- `GET /api/vault/v1/machines/{machineId}/config`
- `POST /api/vault/v1/machines/{machineId}/events:batch`
- `POST /api/vault/v1/machines/{machineId}/heartbeat`
- `GET /api/vault/v1/machines/{machineId}/staff-grants:pull?afterGrantVersion={version}`

Event batches are bounded and strictly typed by event name. Ingest owns a machine-scoped lock, accepts only the next contiguous sequence prefix, and stops at the first gap or conflict. A duplicate event with the same digest is success; the same ID with a different digest is quarantined and rejected. Partial acceptance does not advance or delete rejected local evidence. Accepted facts project transactionally into cloud sales/items, commands, restocks, certification evidence, support cases, and fleet health without becoming physical authority.

The local event boundary redacts authentication/provider sessions while preserving the typed business UUIDs `restockSessionId` and `certificationSessionId` required for durable cloud projection. The paid presentation deadline is persisted in SQLite, starts only after the initial paid-door command group is terminal, survives restart, extends exactly once when the group retry is committed, and clears only presentation state at expiry or customer Done.

## Cloud Admin API

Admin routes use server-side human sessions plus the explicit Vault owner permission. Global listings are owner-only; machine-scoped roles remain bound to one machine. Credential lifecycle, staff grants, signed config publication, financial resolution, and certification approval require a fresh human step-up, reason text, and an atomic immutable audit. Certification approval uses one server-owned completeness predicate and fails closed on missing thresholds, failures, unresolved deviations, untrusted build identity, or a concurrent state change.

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
