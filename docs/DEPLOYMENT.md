# Deployment Guide

This document outlines the recommended process for promoting TenKings services and the operator console into a production environment.

## 1. Prerequisites

- Docker 24+ and Docker Compose v2 on the target host(s)
- Access to a container registry (workflow targets GitHub Container Registry by default)
- Domain name pointed at the Traefik host with HTTPS certificates provisioned (Traefik supports Let’s Encrypt)
- PostgreSQL instance reachable from the services (the compose bundle runs its own Postgres for staging; production should use a managed database)
- Secrets for database credentials and any third-party integrations (Stripe, Supabase, etc. once implemented)

## 2. CI/CD Overview

The GitHub Actions workflow at `.github/workflows/ci.yml` performs two stages:

1. **Install & Build** – installs dependencies with pnpm and runs `pnpm --filter @tenkings/* run --if-present build` to compile each service.
2. **Image Build Matrix** – builds Docker images for every backend service and the frontend. Images push to `ghcr.io/<owner>/<repo>/<service>` when the workflow runs on the `main` branch.

### Configure GHCR Access

Add the following repository secrets if you plan to pull from a production host:

- `GHCR_USERNAME` – GitHub username or service account
- `GHCR_TOKEN` – a PAT with `read:packages` scope (or a fine-grained token)

On the production host authenticate once:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

## 3. Environment Files

Each service ships with a template `.env.docker` holding container-friendly defaults. Before deploying:

1. Duplicate the file and commit the new name to your secret store (not git):
   ```bash
   cp backend/wallet-service/.env.docker backend/wallet-service/.env.production
   # repeat for every service and the frontend
   ```
2. Edit the production env files with real credentials:
   - `DATABASE_URL` should point at the managed PostgreSQL instance
   - set `PORT` only if you need to expose a different container port (Traefik defaults assume 8080 for services, 3000 for frontend)
   - configure Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`) for the auth service
   - supply Stripe keys (`STRIPE_SECRET_KEY`) and `HOUSE_USER_EMAIL` for the pack service to process card payments and transfer instant buybacks into TenKings' house account
   - set `OPERATOR_API_KEY` for the wallet service and mirror the value as `NEXT_PUBLIC_OPERATOR_KEY` in the frontend so operator tooling can authenticate administrative ledger adjustments
   - add any cloud secrets (Stripe, Supabase) when those integrations are enabled
3. On the host, store the env files somewhere safe (e.g., `/opt/tenkings/config/...`) and reference them when running compose:
   ```bash
   docker compose --env-file ../backend/wallet-service/.env.production up -d wallet-service
   ```
   The provided compose file already references `.env.docker`; replace the file paths or export `ENV_FILE` overrides through environment variables.

## 4. Running Prisma Migrations

Before rolling out new code ensure the database schema is up to date.

From a workstation with repository access:

```bash
pnpm --filter @tenkings/database run migrate:dev
```

For production, run migrations against the managed database using the helper script `infra/scripts/run-migrations.sh`:

```bash
./infra/scripts/run-migrations.sh backend/wallet-service/.env.production
```

The script mounts the repo into a Node 22 container, installs the Prisma workspace, and executes `prisma migrate dev`. Pass a second argument to set a custom migration name.

Alternatively, run the commands manually:

```bash
docker run --rm \
  --env-file backend/wallet-service/.env.production \
  -v $(pwd):/workspace \
  -w /workspace \
  node:22-alpine \
  sh -c "corepack enable && pnpm install --filter @tenkings/database --prod && pnpm --filter @tenkings/database run migrate:dev -- --name deploy-$(date +%Y%m%d%H%M)"
```

(Adjust the env file to one that contains the correct `DATABASE_URL` for the migration.)

## 5. Compose Deployment Flow

1. Copy the entire repository (or a release bundle) to the production host.
2. Replace the `.env.docker` files referenced in `infra/docker-compose.yml` with your production variants or symlink them.
3. Pull the latest images built by CI:
   ```bash
   cd infra
   docker compose pull
   ```
4. Start or update the stack:
   ```bash
   docker compose up -d
   ```
5. Verify health endpoints via Traefik:
   ```bash
   curl http://<your-domain>/wallet/health
   curl http://<your-domain>/marketplace/health
   curl http://<your-domain>/ingestion/health
   curl http://<your-domain>/vending/health
    curl http://<your-domain>/auth/health
   ```
6. Run the automated smoke test from a workstation or the host:
   ```bash
   BASE_URL=https://<your-domain> ./infra/scripts/smoke-test.sh
   ```
7. Load the operator console at `https://<your-domain>/` (Traefik auto-provisions TLS via Let’s Encrypt; set `TRAEFIK_ACME_EMAIL` before launch).

### Zero-Downtime Updates

For rolling updates you can pull new images and recreate services one by one:

```bash
docker compose pull marketplace-service
docker compose up -d marketplace-service
```

## 6. TLS with Traefik

Update `infra/traefik/traefik.yml` to enable Let’s Encrypt or bring your own certificates:

```yaml
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
certificatesResolvers:
  letsencrypt:
    acme:
      email: ops@example.com
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
```

Mount `acme.json` as a writable file via the compose service and add labels to redirect traffic to HTTPS.

## 7. Post-Deployment Checklist

- [ ] Confirm migrations ran successfully and Prisma models match
- [ ] Run a smoke test: create wallets, approve an ingestion, perform a marketplace sale
- [ ] Monitor Traefik and service logs for errors
- [ ] Configure backups for the managed Postgres instance
- [ ] Set up uptime monitoring against critical endpoints (`/wallet/health`, `/marketplace/health`, `/packs`) and the operator UI

Keep this guide updated as new integrations (payments, auth) land in the blueprint.
