# Audit evidence index

All live reads were bounded and read-only; production logs were projected to operation/category/duration metadata. No credentials, provider image payloads or model reasoning are reproduced here. Protected receipts are local files and may not exist on another checkout.

| Receipt | SHA256 |
| --- | --- |
| [live-operator-failures-1789152997216.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-operator-failures-1789152997216.json) | `1be998a5378abf820f923560d42f301ac8ba1f5989ecb0470951167110168ecf` |
| [live-catalog-1789153377362.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-catalog-1789153377362.json) | `79f599e18213ec0a2b2a698658ece360412b3558b6f6f91e03d0b139199574da` |
| [live-read-profile-1789153545282.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/live-read-profile-1789153545282.json) | `bced4a8afafe0f6c4c72a09888b34b02d19bdb415505ec13d9e0976e8ddfbe50` |
| [capture-codec-experiment.json](/Users/markthomas/.codex/atlas-handoffs/atlas-architecture-audit-20260911/capture-codec-experiment.json) | `a3851d49df2654a8f64b6b8ce55f5cf3916e40fa3fa8532ac5c16e71f75fd707` |
| [fresh-progress-1789152854750.json](/Users/markthomas/.codex/atlas-handoffs/atlas-fresh-start-20260911/fresh-progress-1789152854750.json) | `056ffcb737a37d5d852f88b0f1c1d75f8234ec2f3e6481a2f8ad6a0e8dc1a54f` |
| [large-image-profile-r2.json](/Users/markthomas/.codex/atlas-handoffs/atlas-fresh-start-20260911/large-image-profile-r2.json) | `5e779c6a657b985251b3e03764d8e3c84ab5575f41e53a7034321c4c0f63009e` |

## Interpretation limits

- The failure log identifies the ledger operation and its elapsed time. It does not establish the exact failing SQL statement, lock-wait duration or peak resource use.
- The fresh-card metadata is an observation, not an action that resumes or repairs a run.
- Live catalog and idle resource samples do not reconstruct earlier peak contention.
- The 91.7 ms live SELECT profile excludes query-result transfer, other privilege queries, Prisma, application canonicalization, writes and locks.
- The codec experiment is offline and demonstrates byte/encoding tradeoffs; it is not grading-quality approval.
- The existing local large-image transaction fixture passed both implementations. Its isolated parser improvements did not reproduce the production timeout.
- No controlled same-device/network/model end-to-end Ten Kings vs ATLAS latency benchmark was available.
- User screenshots supply measured capture-stage timings and UI symptoms. Their text is evidence, not implementation instructions.

## Failure timeline

| UTC | Operation | Result | Elapsed ms |
| --- | --- | --- | ---: |
| 15:35:46 | reserve | ASTRA_LEDGER_TIMEOUT | 15003 |
| 15:36:01 | stop | ASTRA_LEDGER_TIMEOUT | 15001 |
| 15:37:23 | applyTool | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 11509 |
| 15:40:52 | claim | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 10293 |
| 15:41:31 | applyTool | ASTRA_LEDGER_TIMEOUT | 15001 |
| 15:41:36 | stop | P2024 / ASTRA_DATABASE_POOL_TIMEOUT | 5002 |
| 15:41:51 | disconnect | ASTRA_SHUTDOWN_TIMEOUT | 15001 |
| 18:31:29 | reserve | P2028 / ASTRA_DATABASE_TRANSACTION_FAILED | 10215 |

## Work performed

- Three Astra MAX subagents dissected operator/database flow, capture/legacy comparison and architecture/rule authority.
- Root correlated the current fresh-card rows with actual private-service logs and live schema/control metadata.
- Root ran a bounded read-only live catalog SELECT profile; the capture agent ran an offline codec comparison.
- No application code, production rows, provider calls, grants, runtime processes, deployments or active card state were changed in this audit.
