# Vault V1 Test and Certification Matrix

| Layer | Automated now | External evidence later |
|---|---|---|
| Contracts | 150-door parser/order/map; tax parsing/rounding; config signature; roles; redaction; schemas; certification scheduler | None |
| Local repository | SQLite migration/PRAGMAs; uniqueness/FKs; atomic reservation/commit/outbox; callback idempotency/conflict; restart; build provenance; integrity; backup/restore | Windows protected-store verification |
| State model | allowed/forbidden transition exploration; decline/cancel/unknown/reconciliation; config pinning; cloud-loss readiness; durable paid countdown/restart/one retry extension/automatic presentation completion | Official Nayax mapping approval |
| Payment adapter | deterministic approve/decline/cancel/timeout/unknown; duplicate/out-of-order callbacks; reconcile | Official SDK simulator and certification |
| Controller | serialized ACK/NAK/timeout/disconnect/wrong-door faults; exact paid-group retry; max two customer commands | Eight-door electrical bench; signed 150-door bidirectional map |
| Kiosk | component/workflow tests for all customer/staff states; stable 150 positions; 720×1280–1080×1920 scaling proxies; accessibility and language checks | Installed touchscreen/scaling/glare/reach tests |
| Staff/restock | role grant/deny; PIN lockout; locked-session reauthentication; resumable command/terminal/human-observation phases; only FILLED activates; stale-close reset; safe exit; certification coverage isolated per session | Human operator acceptance |
| Cloud API | machine auth/path binding; enrollment/decommission lifecycle; bounded typed contiguous-prefix event ingest; transactional domain projections; heartbeat; exact pending config activation; signed config; owner/machine scope; fresh step-up/audit; body/version checks | Production credential ceremony |
| Reporting | immutable snapshots; authorization vs settlement; certification excluded by default | Accounting/reconciliation acceptance |
| E2E | at least 1,000 deterministic simulated customer transactions plus crash/fault exploration | 500 observed sessions; 5 purchase + 2 restock cycles per each of 150 doors |
| Appliance | service manifest, installer/update/rollback scripts and static validation | Cold boot/power cut/USB/disk/clock/update rollback on final Windows hardware |

The software build may report mock/simulator completeness only. It may not claim production readiness until G-01/G-02/G-03/G-04/G-06/G-07 deployment and physical evidence is attached to a version-bound certificate.

Frozen-head automated result: 124/124 Vault tests pass under Node 20 (7 contracts, 52 machine, 46 kiosk, 9 database, 10 cloud), including 1,000 deterministic simulated purchases and exact machine-redactor-to-cloud-schema business-session coverage.
