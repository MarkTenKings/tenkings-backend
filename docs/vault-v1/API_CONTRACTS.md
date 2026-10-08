# Vault V1 API Contracts

**Current payment direction (2026-10-07):** Nayax Spark is the immediate integration target; Stripe Terminal remains available as a separate per-machine route. This supersedes the September 28 provider selection, without removing its test implementation or historical evidence. See [Spark implementation and remaining acceptance](NAYAX_SPARK_V3_REVIEW_2026-10-07.md).

All JSON endpoints require contract header `X-Vault-Contract-Version: 1`, reject unsupported content types, enforce route-specific body limits, and return `{ requestId, error: { code, message } }` on failure. Request IDs and idempotency keys are never reused for a different payload.

## Loopback machine API

The service listens only on `127.0.0.1` and `::1`. Mutations require a valid same-origin HttpOnly kiosk session, `Origin` equal to the configured loopback origin, JSON content type, and `If-Match` where an optimistic state version is supplied. There is no generic door-open endpoint.

| Method and path | Authority and behavior |
|---|---|
| `POST /api/v1/session/bootstrap` | Same-origin assigned-access bootstrap; rotates a short-lived HttpOnly SameSite=Strict session and returns no secret. |
| `POST /api/v1/session/activity` | Persists genuine public activity and advances the optimistic state version. Rejected during an active sale or service lock. |
| `GET /api/v1/state` | Current durable public state, products, all active profile doors, explicit `configSchemaVersion` and `machineProfile`, cart/sale summary, readiness, support config, and state version. Schema 1 alone uses the historical 150-door layout. |
| `GET /api/v1/events` (WebSocket upgrade) | Authenticated state/event notifications only; never accepts hardware commands. |
| `POST /api/v1/cart/select` | Add/remove an available door before payment; persists authoritative cart selection. |
| `POST /api/v1/cart/pick` | Securely selects and persists one available door for a requested product before animation. |
| `POST /api/v1/checkout` | Revalidates readiness/config/tax/provider limits and selected doors; returns exact conflicts while preserving valid lines; creates/reserves durable sale. |
| `POST /api/v1/sales/{saleId}/payment` | Persists payment intent before calling the configured payment adapter. Repeated identical idempotency key returns the original result; different payload conflicts. |
| `POST /api/v1/internal/provider-callback` | Authenticated supervised-adapter callback only; persistence and sequence/idempotency precede effects. Not available to the kiosk UI. |
| `POST /api/v1/sales/{saleId}/open-doors` | Atomically consumes the one transaction retry and creates attempt-2 intents for exactly every original paid door. |
| `POST /api/v1/sales/{saleId}/done` | Clears only public presentation after payment and door-command recovery are safe; never erases payment, commands, retry, settlement, or support facts. |
| `POST /api/v1/staff/authenticate` | Verifies individual six-digit machine grant with rate limit/backoff and returns scoped service session. |
| `POST /api/v1/staff/lock` | Locks service mode; blocks new public sessions. |
| `POST /api/v1/staff/safe-exit` | Requires authorized actor and explicit serviced-doors-closed confirmation before public mode. |
| `POST /api/v1/staff/profile-activation` | Technician/Admin confirms the exact pending version/digest, empty compartments and serviced doors closed. Requires no pinned customer, financial, restock, certification or command work and cloud acknowledgment of earlier state-bearing facts; activates atomically into service lock and requires reauthentication/safe exit. |
| `POST /api/v1/restocks` | Starts/resumes an authorized pinned-config restock session; exact expected doors only. Schedules at most one unobserved command and returns its intent/terminal/observation phase. |
| `POST /api/v1/restocks/{id}/items/{doorId}` | After a terminal command receipt, records one per-door human observation: `FILLED`, `LEFT_EMPTY`, or `EXCEPTION`; only `FILLED` makes the planned assignment available. Schema 2 additionally requires `productFitConfirmed: true` for FILLED. |
| `POST /api/v1/restocks/{id}/finalize` | Requires every door reviewed and physical-close confirmation; persists audit/outbox. |
| `POST /api/v1/certification/sessions` | Starts/resumes immutable `CERTIFICATION` mode using the same command/state paths and selected test adapters. Requires trusted service-supplied source commit/app identity and schedules at most one unobserved command. |
| `POST /api/v1/certification/sessions/{id}/evidence` | After a terminal command receipt, records PASS/FAIL/CRITICAL evidence bound to that exact command and door; unexpected door makes physical automation fail closed. |
| `POST /api/v1/certification/sessions/{id}/submit` | Requires all scheduled commands to have human evidence plus physical-close confirmation, then closes local collection as `REVIEW_REQUIRED`. It is not certificate approval. |
| `GET /api/v1/health` | Readiness reasons, trusted source/app identity, schema/config versions, integrity, clock/storage/cloud/outbox, mock adapter identity, and service lock; redacted. |

The public active-certification DTO supplies `observationEvidenceClass` from the session's immutable controller and payment identities. Either MOCK identity restricts kiosk observations to `AUTOMATED`; the same classification enforces the local evidence guard. `adapterMode` retains the payment-mode meaning used to permit simulated purchase/restock cycles and does not establish physical evidence eligibility. A kiosk talking to an older DTO may infer only AUTOMATED from MOCK payment; official payment without the explicit classification blocks observations until provenance is available.

## Cloud machine API

All enrolled-machine routes require the unique machine credential. The server hashes it, verifies credential version/status, and binds it to the `{machineId}` path. A machine/user/operator credential cannot substitute for another authority type.

- `POST /api/vault/v1/machines/enroll/complete`
- `GET /api/vault/v1/machines/{machineId}/config`
- `POST /api/vault/v1/machines/{machineId}/events:batch`
- `POST /api/vault/v1/machines/{machineId}/heartbeat`
- `GET /api/vault/v1/machines/{machineId}/staff-grants:pull?afterGrantVersion={version}`

Event batches are bounded and strictly typed by event name. Ingest owns a machine-scoped lock, accepts only the next contiguous sequence prefix, and stops at the first gap or conflict. A duplicate event with the same digest is success; the same ID with a different digest is quarantined and rejected. Partial acceptance does not advance or delete rejected local evidence. Accepted facts project transactionally into cloud sales/items, commands, restocks, certification evidence, support cases, and fleet health without becoming physical authority.

### Stripe Terminal test observations

- `POST /api/vault/v1/stripe/webhook` receives a raw signed Stripe **test** event. It is disabled unless `VAULT_STRIPE_WEBHOOK_ENABLED=true` and needs a dedicated test signing secret, test API key, and explicit `VAULT_STRIPE_TEST_BINDINGS_JSON` machine/reader/location allowlist. It retrieves and binds the exact Stripe PaymentIntent and reader before an insert-only durable observation. This route does not accept machine events or authorize doors.
- `GET /api/vault/v1/stripe/observations?machineId={machineId}&saleId={saleId}` requires that machine's credential and returns at most 100 diagnostic `RECONCILE_ONLY` hints after the sale projects. The machine uses direct Stripe retrieval for payment authority; this endpoint is not in its local payment loop.

The local event boundary redacts authentication/provider sessions while preserving the typed business UUIDs `restockSessionId` and `certificationSessionId` required for durable cloud projection. The paid presentation deadline is persisted in SQLite, starts only after the initial paid-door command group is terminal, survives restart, extends exactly once when the group retry is committed, and clears only presentation state at expiry or customer Done.

## Cloud Admin API

Admin routes use server-side human sessions plus the explicit Vault owner permission. Global listings are owner-only; machine-scoped roles remain bound to one machine. Credential lifecycle, staff grants, signed config publication, financial resolution, and certification approval require a fresh human step-up, reason text, and an atomic immutable audit. Certification approval uses one server-owned completeness predicate and fails closed on missing thresholds, failures, unresolved deviations, untrusted build identity, or a concurrent state change.

- `/api/vault/v1/admin/products`
- `/api/vault/v1/admin/machines`
- `/api/vault/v1/admin/machines/{machineId}/config/{draft|validate|impact|verify-profile|publish}`
- `/api/vault/v1/admin/machines/{machineId}/doors/plan`
- `/api/vault/v1/admin/machines/{machineId}/staff-access`
- `/api/vault/v1/admin/machines/{machineId}/enrollment`
- `/api/vault/v1/admin/fleet`
- `/api/vault/v1/admin/sales`
- `/api/vault/v1/admin/restocks`
- `/api/vault/v1/admin/certification`
- `/api/vault/v1/admin/support-cases`

No route may unlock a door remotely, mutate local inventory authority, mutate a pinned/closed sale, or write any V1/V2 pack/card/ownership record.

Cloud POST routes parse bounded raw UTF-8 JSON themselves, including streamed bytes and whitespace, and return the same error envelope for malformed JSON, oversized bodies and lookalike media types. The Windows-safe catch-all route preserves the exact `events:batch` and `staff-grants:pull` public URLs. Production-built Next HTTP tests cover the transport; the guarded PostgreSQL harness additionally exercises authenticated database effects.


### Spark Remote Start candidate (October 7, 2026)

- `POST /api/vault/v1/spark/{TransactionCallback|DeclineCallback|TimeoutCallback}` authenticates the Nayax-configured static callback header, parses bounded lossless JSON and stores minimized evidence only. Timeout is recorded for discrepancy review, never preselection success or proof of no payment.
- `GET /api/vault/v1/spark/observations?machineId={uuid}&sparkTransactionId={uuid}` and `GET /api/vault/v1/spark/receipts?machineId={uuid}&after={decimalInt64}` require the exact machine credential and return `RECONCILE_ONLY` evidence. The feed uses exclusive commit-safe cursors, up to 100 receipts and `hasMore`; it includes terminal/orphan sessions.
- `POST /api/vault/v1/admin/payment-actions` requires fresh FINANCIAL_RESOLVE authority, a reason and explicit full-sale confirmation. It records one bounded exact-sale approval and performs no external payment call.
- `GET /api/vault/v1/payment-actions?machineId={uuid}` returns `APPROVED_PAYMENT_ACTIONS_ONLY`; approved actions (including expired unstarted approvals for proof-based retirement) and existing executing/unknown actions retain their original immutable identity. The machine records an intent before any separate CancelTransaction type 2 call. No kiosk route authorizes a paid void.
- Ordered events `PAYMENT_EVIDENCE_ANOMALY`, `PAYMENT_VOID_INTENT_RECORDED` and `PAYMENT_VOID_OUTCOME_RECORDED` project financial evidence only. Neither a void nor an anomaly rewrites capture, fulfillment or stock. `PAYMENT_CALLBACK_QUARANTINED` accepts the same safe captured-provider evidence as applied callbacks.

See the current [Spark build and profile contract](NAYAX_SPARK_V3_REVIEW_2026-10-07.md). Local schema 6 and additive cloud migrations are source candidates; deployed environments require separately reviewed rollout and evidence.

### Supervised financial recovery (2026-10-07 source candidate)

Local schema 6 separates financial holds from the retained technical `automation_halted` / `recovery_required` flags. An immutable machine snapshot contains its generation, provider binding/evidence digest, exact unresolved notice/action IDs and blocking reasons. Financial review cannot clear restore, hardware, clock, lost-journal, active-command or unfinished-sale recovery, rewrite capture, or release stock.

| Endpoint | Authority and behavior |
| --- | --- |
| `POST /api/v1/staff/financial-recovery` | Local kiosk cookie plus `staffSessionId` with `FINANCIAL_RESOLVE`; returns cached safe snapshot, hold state and review/retirement counts. No approval or clearing authority. |
| `GET /api/vault/v1/admin/financial-recovery?machineId=...` | Scoped financial admin; latest snapshot, action/notice/review history, machine-wide unresolved orphan count, callback receipt time/age/count/cursor and oldest pending approval age. Receipt age alone is not a missing-callback or payment-state determination. `download=true` downloads the same bounded safe JSON evidence. |
| `POST /api/vault/v1/admin/financial-recovery` | Fresh exact Admin approval bound to `decisionId`, machine/snapshot/generation/state digest, complete `noticeIds` and `unknownActionIds`, human evidence reference/digest, reason and `confirmReviewed:true`. Expires within five minutes; machine must be recently observed. |
| `GET /api/vault/v1/financial-recovery?machineId=...` | Exact authenticated machine identity; returns only its unexpired approved decisions with instruction `FINANCIAL_RECOVERY_ONLY`. |
| `GET /api/vault/v1/payment-actions?machineId=...` | Exact machine authority; retains expired APPROVED actions for proof-based retirement and existing EXECUTING/UNKNOWN identities for recovery; externally reviewed actions stop replay. |

Machine events `FINANCIAL_RECOVERY_SNAPSHOT_RECORDED`, `FINANCIAL_RECOVERY_APPLIED`, `FINANCIAL_RECOVERY_SUPERSEDED` and `PAYMENT_VOID_RETIRED_UNSTARTED` use strict shared schemas and the existing contiguous authenticated outbox. Local review intent is durable before provider replay barriers. If new evidence invalidates that intent, supersession retires only its approval, preserves all unresolved facts and barriers, and permits a fresh exact review. Delivery of the obsolete decision is a no-op.

An expired payment approval can release active cloud sale ownership only after its bound machine proves no main intent, provider intent or provider transport began and durably tombstones that exact action. Technical recovery or an incomplete provider feed blocks that proof. The original sale/action approval is retained. A later replacement needs new fresh human approval. A started UNKNOWN void always retains its action ID and UNKNOWN monetary state; external human review is a separate record with `verifiedFinancialAdjustmentCents:0`, never provider-confirmed compensation.
