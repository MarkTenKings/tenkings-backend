# Wallet Service Service

> Bootstrapped from `docs/TENKINGS_BLUEPRINT.md`; replace stub logic with production logic.

## Development

```bash
npm install
npm run dev
```

## Docker

```bash
docker build -t tenkings/wallet-service:dev .
docker run --env-file .env.example -p 8080:8080 tenkings/wallet-service:dev
```
