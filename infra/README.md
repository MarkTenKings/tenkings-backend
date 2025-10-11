# TenKings Infrastructure

Bring the full stack up with Postgres + Traefik + services:

```bash
cd infra
docker compose up --build
```

Health checks:
```bash
curl http://localhost/wallet/health
curl http://localhost/marketplace/health
```

Stop with `docker compose down`. Add TLS, secrets, and production monitoring before going live.
