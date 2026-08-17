# Vault V1 Threat Model and Failure-Mode Analysis

## Trust boundaries

1. Public touchscreen to loopback service: untrusted input; loopback-only binding, strict Origin, body/content limits, schema validation, SameSite session, CSP, no hardware-shaped endpoint.
2. Machine service to SQLite: sole writer; WAL, foreign keys, `synchronous=FULL`, atomic event/outbox commits, integrity checks, bounded verified backups.
3. Machine service to payment/controller adapters: external effects require durable deterministic intent first. Adapter payloads are allowlisted and redacted.
4. Machine to cloud: unique revocable machine credential bound to path machine ID; ordered idempotent events; 4xx never erases evidence.
5. Human staff/admin: individual machine-scoped grants, memory-hard PIN verifier, rate limit/backoff/revocation; sensitive cloud actions require a fresh human session, reason, and audit.

## High-risk failures and controls

| Failure/threat | Required control | Safe outcome |
|---|---|---|
| Duplicate/out-of-order payment callback | Unique callback/provider keys, sequence checks, payload digest conflict quarantine | No duplicate authorization, sale, or command entitlement |
| Crash after external-effect intent | Recover persisted intent and reconcile; never blind repeat | Same sale shown; no second charge/automatic repulse |
| Crash after authorization before commit | Atomic fulfillment commit creates sold doors + command intents | Either no command or fully durable command authority |
| Controller timeout/disconnect/wrong ACK | Serialized writer; record unknown/timeout; observed door mismatch is critical | No auto-repeat; retry remains exactly the paid group; certification automation stops on wrong door |
| Repeated OPEN DOORS taps/restart | Transaction-level unique retry consumption and deterministic per-door attempt-2 IDs | Every paid door gets at most one second command; no other door |
| Cloud outage | Freshness readiness gate only before checkout; local active transaction authority | New checkout blocked; active/authorized work continues |
| Config downgrade/tamper | Ed25519 signature, digest, version monotonicity, machine binding, expiry, safe-boundary activation | Rejected snapshot; current pinned transaction unchanged |
| Local database corruption/disk pressure | Startup integrity check, fail-closed recovery, backup/restore, pressure thresholds | No new sale; support/service evidence preserved |
| Clock rollback | trusted sync observations + monotonic duration accounting | New sale/config activation blocked when unsafe; active fulfillment continues |
| PIN guessing/role escalation | six digits, memory-hard verifier, machine/version scope, exponential backoff, generic errors | Locked service entry and audit; no permission widening |
| Browser escape/CSRF | assigned access, CSP, no navigation, loopback, Origin and content-type validation, SameSite cookie | No remote or cross-origin local-service command |
| Secret/cardholder leakage | allowlisted normalized adapter facts, recursive redaction, Windows secret store | No PAN/CVV/track/PIN/token/private key in logs or ordinary tables |
| Test/live crossover | immutable mode on sale/event/evidence; adapter-mode validation; report predicate excludes certification | Certification never enters production revenue/inventory |
| V1/V2 domain contamination | separate packages/schema/API; explicit isolation tests and code review | No pack/card/ownership identity write |

Any real wrong-door or unpaid-door observation is critical: stop physical automation, preserve evidence, require independent root-cause review, and recertify affected scope.
