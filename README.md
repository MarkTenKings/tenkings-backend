# TenKings Monorepo Scaffold

> Generated from `docs/TENKINGS_BLUEPRINT.md`. All services and the operator console live in this workspace.

## Prerequisites
- Node.js 22.x (via nvm recommended)
- Docker Desktop or compatible runtime

## Getting Started
1. Install dependencies
   ```bash
   npm install
   npm run db:generate
   ```
2. Apply migrations
   ```bash
   npm run db:migrate
   ```
3. Start an individual service (example: wallet)
   ```bash
   npm run dev --workspace @tenkings/wallet-service
   ```
4. Launch the frontend console
   ```bash
   npm run dev --workspace @tenkings/nextjs-app
   ```

For wallet adjustments through the operator console, set a shared key:
1. Add `OPERATOR_API_KEY=your-operator-secret` to `backend/wallet-service/.env.local` (and `.env.docker` for compose).
2. Mirror the same value as `NEXT_PUBLIC_OPERATOR_KEY` in `frontend/nextjs-app/.env.local`.
3. Restart the services so both ends pick up the configuration.

### Service Ports (direct dev runs)

When running services locally outside Docker, the default ports are:
- Wallet – 8080
- Marketplace – 8082
- Vault – 8181
- Pricing – 8182
- Pack – 8183
- Ingestion – 8184
- Vending Gateway – 8185
- Frontend (Next.js) – 3000
- Auth – 8088

## Docker Compose
Bring up the full stack (Postgres, Traefik, services):
```bash
cd infra
docker compose up --build
```
Sample health checks once containers settle:
```bash
curl http://localhost/wallet/health
curl http://localhost/marketplace/health
curl http://localhost/auth/health
```
Then open `http://localhost` in a browser to access the operator console served via Traefik.

Compose reads deployment-focused `.env.docker` files for every service. Duplicate them with real values (`cp backend/wallet-service/.env.docker backend/wallet-service/.env.local`, etc.) when preparing staging/production secrets.

### HTTPS

Traefik terminates TLS via Let’s Encrypt. Set `TRAEFIK_ACME_EMAIL` before starting compose and ensure ports 80/443 are open. Certificates are stored in the `traefik-certificates` volume.

## Directory Map
- `backend/*` – Express microservices (wallet, vault, marketplace, pricing, pack, ingestion, vending gateway)
- `frontend/nextjs-app` – Operator console (Next.js)
- `packages/shared` – Shared TypeScript types & DTOs
- `packages/database` – Prisma schema and client
- `docs/` – Blueprint and architecture summaries
- `infra/` – Compose stack + Traefik config

Consult `docs/TENKINGS_BLUEPRINT.md` for detailed requirements and future phases.
