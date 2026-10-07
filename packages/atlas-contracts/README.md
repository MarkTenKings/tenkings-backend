# ATLAS offline contracts

This package is a local executable reference for the approved ATLAS preparation boundary. It has no provider transport, API key, live route, Prisma dependency, certificate issuer, learning writer, or legacy-admin import. **Do not mount it as a production service.** Its `OFFLINE_REFERENCE` manifest and synthetic adapter receipts are deliberately incompatible with a claim of production authority.

From the repository root, use Node 20 with an empty inherited environment:

```sh
env -i PATH=/opt/homebrew/opt/node@20/bin:/usr/bin:/bin node --test packages/atlas-contracts/test/*.test.mjs
env -i PATH=/opt/homebrew/opt/node@20/bin:/usr/bin:/bin node packages/atlas-contracts/evaluation/run.mjs
env -i PATH=/opt/homebrew/opt/node@20/bin:/usr/bin:/bin node packages/atlas-contracts/evaluation/validate-boundary.mjs
```

On another machine substitute its verified Node 20 path. There is nothing to install. Tests reject provider/DB credentials and block HTTP, sockets and fetch. All source images are two generated tiny PNG fixtures; no customer image is read. Root packages, lockfiles and migration chains are unchanged.

| File | Executable boundary |
|---|---|
| `src/contracts.mjs` | Fourteen closed strict function schemas; machine/staff context, evidence, frozen run, approval, audit and attempt schemas |
| `src/strict.mjs` | Bounded parsing, supported-schema validation, canonical SHA-256 and immutable returned snapshots |
| `src/states.mjs` | Proposed state/authority matrix; certification is absent from machine transitions |
| `src/workflow.mjs` | Source/revision/capability checks, append-only proposals and human overrides, draft checklist, crop-delivery coverage, exact assigned-human approval and audit chain |
| `src/jobs.mjs` | Lease fences, logical-operation binding, reserved spend, unknown outcomes, retry/deadline limits, atomic output/accounting/outbox and dead letters |
| `src/store.mjs` | Small local locked file transaction adapter with checksum, fsync, atomic rename and reopen tests |
| `src/responses.mjs` | Exact Astra Responses request/continuation builder, refusal/incomplete/drift handling and conservative token accounting; no send method |
| `evaluation/plan.json` | Proposed frozen quality/cohort/pilot plan; operational approval/caps are null |
| `evaluation/run.mjs` | 1,000 deterministic fault simulations; visual quality remains inconclusive |
| `evaluation/validate-boundary.mjs` | Validate the design inventory's existing paths, route uniqueness and exact proposed tool roster; no runtime route enforcement |

The detailed [contract](../../docs/atlas/CONTRACTS.md), [evaluation plan](../../docs/atlas/EVALUATION.md) and [app extraction plan](../../docs/atlas/APP_EXTRACTION.md) distinguish implemented checks from adapter work still required. A schema-valid function call, mock approval, source hash, file-store test or successful simulation does not prove image accuracy, authentication, trusted GPU execution, production durability, actual API cost, or unattended readiness.
