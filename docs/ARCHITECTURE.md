# TenKings Architecture Overview

TenKings delivers a closed-loop collectible marketplace where TKD balances never leave the platform. Services are decoupled but share a single Postgres database accessed through `@tenkings/database` (Prisma).

## Service Responsibilities
- **wallet-service** — creates users, exposes wallet ledger APIs (`/users`, `/wallets/:id`, credit/debit endpoints).
- **vault-service** — maintains physical inventory metadata and ownership history.
- **marketplace-service** — lists items, settles TKD sales atomically, and updates ownership records.
- **pricing-service** — stores manual valuations and exposes buyback math.
- **pack-service** — defines pack SKUs, seeds inventory, debits wallets on purchase, and records openings.
- **ingestion-service** — accepts scanner payloads, queues review, and mints items on approval.
- **vending-gw** — vending machines verify balances and vend packs via this API.
- **frontend/nextjs-app** — operator console for onboarding, pack/market flows, and ingestion approvals.

## Data Model Highlights
- `User` has one `Wallet` and many `IngestionTask`, `Item`, and `Listing` relations.
- `WalletTransaction` stores immutable ledger entries tagged with `TransactionSource` for audit.
- `Item` tracks vault status (`STORED`, `LISTED`, `SOLD`, etc.) and links to `Listing`, `PackSlot`, `IngestionTask`.
- `PackDefinition` + `PackInstance` + `PackSlot` model both digital and physical packs for vending + web flows.

## Cross-Service Conventions
- All services expose `/health` and `/version`.
- CORS enabled by default so the Next.js console can access services during dev.
- Shared DTOs live in `@tenkings/shared`.
- Database access always goes through the shared Prisma client to maintain pooling.

## Local Development Flow
1. `npm install && npm run db:migrate`
2. `npm run dev --workspace @tenkings/<service>`
3. `npm run dev --workspace @tenkings/nextjs-app`
4. `docker compose up --build` from `infra/` for full-stack verification.

Use `docs/TENKINGS_BLUEPRINT.md` for the full product context and roadmap.
