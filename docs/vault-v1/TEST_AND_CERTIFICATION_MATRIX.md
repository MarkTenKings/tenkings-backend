# Vault V1 Test and Certification Matrix

The current target is a configurable family: maximum design 125, compact concept near 72. All new geometry/mappings are synthetic, and schema 1 preserves the historical 150-door baseline. This matrix describes implemented test coverage; the session log and review traceability record actual combined-run and committed-head results.

| Layer | Automated now | External evidence later |
|---|---|---|
| Contracts | Schema-1 compatibility; opaque IDs, unique labels, mixed geometry/cutouts, independent endpoint/channel mappings; signed profiles at 1/7/32/72/125/150/256 doors; incomplete drafts rejected as configs; tax, roles, redaction and certification policy | Complete measured profile and hardware evidence |
| Local repository | SQLite migration/PRAGMAs; uniqueness/FKs; atomic reservation/commit/outbox; callback idempotency/conflict; restart; build provenance; integrity; backup/restore | Windows protected-store verification |
| State model | allowed/forbidden transition exploration; decline/cancel/unknown/reconciliation; config pinning; cloud-loss readiness; durable paid countdown/restart/one retry extension/automatic presentation completion | Official Nayax mapping approval |
| Payment adapter | deterministic approve/decline/cancel/timeout/unknown; duplicate/out-of-order callbacks; reconcile | Official SDK simulator and certification |
| Controller | serialized ACK/NAK/timeout/disconnect/wrong-door faults; exact paid-group retry; max two customer commands; profile adapter/address consistency | Eight-door electrical bench; independently verified map for every applicable profile door; firmware pulse/fault limits |
| Kiosk | customer/staff/recovery workflows; explicit legacy/profile discriminator; stable mixed-size/cutout geometry and opaque IDs; 720×1280–1080×1920 scaling proxies; 44px hit targets, long labels, focus and language checks | Installed touchscreen/TV binding, scaling, glare and reach tests |
| Staff/restock | role grant/deny; PIN lockout; locked-session reauthentication; resumable command/terminal/human-observation phases; only FILLED activates with schema-2 fit confirmation; stale-close reset; safe exit; exact-digest empty-machine profile activation; certification coverage isolated per session/profile | Human operator acceptance and actual packaged-product fit |
| Cloud API | machine auth/path binding; enrollment/decommission lifecycle; bounded typed contiguous-prefix event ingest; transactional domain projections; heartbeat; exact published monotonic intermediate activation preserving newer pending configuration; signed config; owner/machine scope; fresh step-up/audit; body/version checks | Production credential ceremony |
| Reporting | immutable snapshots; authorization vs settlement; certification excluded by default | Accounting/reconciliation acceptance |
| E2E | at least 1,000 deterministic simulated customer transactions plus crash/fault exploration; 72/125 local HTTP demo flows; actual production Next HTTP auth/events into disposable PostgreSQL for legacy150/72/125/256 with profile publication/reconciliation races and count boundaries | 500 observed real sessions; 5 purchase + 2 restock cycles for every door in the applicable approved profile |
| Database | Full historical Prisma chain on guarded loopback/tmpfs PostgreSQL, existing non-Vault invariants, Vault snapshot/scope/immutability checks, concurrent event idempotency, second-deploy no-op and cleanup | Separately authorized deployment and production acceptance |
| Appliance | Functional release-manifest/path/hash tests and staging-only Windows scripts; local backup integrity and schema compatibility | Final pinned Node20/native SQLite/protected-storage/service implementation; cold boot/power cut/USB/disk/clock/update rollback on final Windows hardware |

The software build may report mock/simulator completeness only. It may not claim production readiness until G-01/G-02/G-03/G-04/G-06/G-07 deployment and physical evidence is attached to a version-bound certificate.

The old 124-test result belongs to a historical implementation and is not current acceptance. Current combined counts and exact commit references are maintained in [review traceability](REVIEW_TRACEABILITY.md) and the append-only session log; no physical certification follows from simulated test counts.
