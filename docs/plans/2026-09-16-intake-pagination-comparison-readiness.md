# Internal pagination comparison — prepared only

Prepare **one comparison of changed source**, with history reuse present in both arms:

- A: `12e13992cd341eeea96dbe0955cc4dbfba67bc1d` — internal history pages of 1,000 rows.
- B: `80e75b1e26753117b5a0bd1feefa0ee181695454` — internal history pages of 250 rows.
- The only exported runtime difference is `packages/database/src/inventoryWorkflowV2Read.ts`. Static byte comparison confirms exactly the internal `limit: 1000` → `limit: 250` argument changes. Public export maximum/shape, all validation, byte limits, writer, locks and replay code remain identical.

The [history-reuse comparison failure](2026-09-16-intake-history-reuse-comparison-results.md) and all three preceding failed studies remain unchanged. This experiment measures whether smaller internal batches reduce callback stalls, including any throughput/lock-duration cost from extra queries. It does not assume the single-event or replay cost is bounded, predict a pass, or qualify production identify latency.

## New artifacts and preserved protocol

- [Runner](../../packages/database/scripts/benchmarkStaffIntakePaginationDisposable.mjs).
- [Preregistration](2026-09-16-intake-pagination-comparison-protocol.json).
- This readiness record.

The qualified history-reuse runner is copied with only its description, protocol path, frozen refs, expected changed-source diagnostic and reader-hash assertion updated. Its setup/execution/analysis/cleanup suffix is byte-identical. Driver, role and IPC hashes are unchanged. There is no new preflight, instrumentation, profile or scenario.

Keep **1,200 measured saves + 120 warmups**: three sessions, idle/thumbnail, ABBA; five warmups and 50 measured saves per session/block. The 2,000-unit/256-pending/16-terminal fixture, 4/3/1 pools, two workers, photo bytes, provider tapes, delays, overlap barrier and admission/integrity checks are unchanged. All five original metrics and direct photo wall remain gates. Every pooled comparison and individual repetition, plus candidate loaded-minus-idle, must satisfy the original `max(50 ms, 10% of baseline p95)` margin. No exclusions or pooling with earlier runs; release pass is always false.

Seed RPC remains 180 seconds and ordinary RPC 60 seconds. Owned process-group supervision, shared SIGINT/SIGTERM abort, admin/readiness cancellation and **29m30s work + 30s cleanup within the 30-minute cap** are unchanged. Data removal still requires confirmed owned-group/PostgreSQL stop. The preceding normal run cleaned up successfully; forced-signal/failure cleanup remains statically reviewed, not experimentally proved.

## Source and client checks

Preparation checks a conservative **79-module import closure per arm**. All four application workspace aliases resolve into the pinned exported trees; catalog source is explicitly exported and aliased. Dirty canonical pilot/SetOps files cannot substitute for these pinned application sources. Installed external libraries and the exact prior frozen Prisma client remain reused; no install, generation or build occurs.

Both schemas retain SHA-256 `0233ffa118ff9927621043bfe5e077aa15ee320db8087be9fc6a270884b9dd09` and 96 migrations. The frozen client ledger remains `e1a91c8dee8d08a561083f4976312f6d3b0faedaf3842489cda739b769db6345`; compatibility assertions still cover only the four exercised models. Catalog/V4/contribution flags remain absent; injected worker dependencies retain the V3 path and synthetic transports, with larger images false. No production credentials or arbitrary environment are forwarded; HOME is preserved only unchanged if supplied.

Before commit B, the database TypeScript build and one disposable PostgreSQL 17.9 UTF8 suite passed **62/62 test entries**, including five focused new pagination cases. Those use actual reader SQL on transaction-local `ON COMMIT DROP` fixture tables; they do not replace existing production-journal trigger/writer tests. No qualification suite was repeated during this preparation.

## Preparation receipt and seals

Receipt: `/private/tmp/tenkings-intake-pagination-preparation-20260916-01`.

Observed: **no database started, no source trees exported, zero measured saves**. Node syntax and source/schema/import/client/harness assertions pass. Historical preparation and run receipts are untouched.

| Artifact | SHA-256 |
| --- | --- |
| Runner | `438d1600fc8dbcfd7e1f46bfd000ee39b11a6cda1963638fa301ba8f53be35a2` |
| Preregistration | `15bc558dfde9aeb5cc94eceb3fa5c102371aa105e9b9cdb4e8a181a8d832884c` |
| Effective protocol | `311c257e4cb5834adf4bb246592256c21ef58e28fc36e0bb7883243648847d0f` |
| Source compatibility receipt | `27c6cdb02440a89c52a24e37ad210188de631f689f86702865865ab66f7e2206` |
| Reader A | `532a1b4e14cf8bcc3e433dc4149283c4b1fc7990f42554e910f3ebd60a3f8b1f` |
| Reader B | `7666f14237521d51e5d7aee7fec26d9d5cf6429911dec16bef78986d66d0db5c` |
| Writer, both arms | `20305bc3152618c3817ef6b06b8a7a32c69c4f12a9497bd0f809640744da05fb` |
| Driver | `064a9018d15ffd3c97bced10001a9c0541ee6d44a2313a83f3fac2f0108e5fb5` |
| Role | `a708f12e817845806d62bceca4875b85178955c5a072e9bfc7447b8baaffc749` |
| IPC | `a44b60247437c6b333ba36469e3248452ebfb0b60249650cee819fbb628a1a7f` |

## Launch held for coordinating review and disk reserve

Root must review these exact seals, verify **at least 2 GiB + 300 MiB = 2,462,056,448 free bytes immediately before launch**, and release one quiet window under Mark's existing authorization. No new permission request to Mark is needed. The latest supplied approximately 2.34 GB free does **not** meet this reserve. Preparation does not authorize launch below it. The runner retains its 2 GiB checks before setup and each block; the coordinating launch check supplies the additional reserve. Do not relax either requirement or delete evidence.

Only after that review, use a fresh output path:

```sh
cd /Users/markthomas/tenkings/codex-staff-inventory-release-20260910
INVENTORY_TEST_TOOLS_DIR=/private/tmp/tenkings-catalog-test-tools-20260916 \
/Users/markthomas/Library/Caches/tk-node22-20260909/node-v22.23.2-darwin-arm64/bin/node \
  packages/database/scripts/benchmarkStaffIntakePaginationDisposable.mjs \
  --run-approved-split-diagnostic --ack-disposable-local-postgres \
  --prisma-client-root /private/tmp/tenkings-benchmark-prisma-frozen-20260916 \
  --out /private/tmp/tenkings-intake-pagination-comparison-20260916-01
```

**Deployment limitation remains:** synthetic identify leases and workspace saves share the intake process, while the production receipt gives identify a different function identity. This local source/DB subset does not establish actual instance placement, physical camera/upload/recognition behavior, real-provider variance, the full scenario matrix or independent all-card accuracy.
