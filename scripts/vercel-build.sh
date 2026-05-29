#!/usr/bin/env bash
set -euo pipefail

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  echo "RUN_DB_MIGRATIONS=true; running Prisma migrations before build."
  pnpm --filter @tenkings/database run migrate:deploy
elif [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "VERCEL_ENV=production and RUN_DB_MIGRATIONS is not true; skipping Prisma migrations."
fi
pnpm --filter @tenkings/database run generate

PRISMA_SRC=$(find node_modules -path "*/.pnpm/@prisma+client@*/node_modules/.prisma" -print -quit)
if [ -z "$PRISMA_SRC" ]; then
  echo "Prisma engines directory not found" >&2
  exit 1
fi

mkdir -p frontend/nextjs-app/node_modules
rm -rf frontend/nextjs-app/node_modules/.prisma
cp -R "$PRISMA_SRC" frontend/nextjs-app/node_modules/.prisma

pnpm --filter @tenkings/database run build
pnpm --filter @tenkings/shared run build
pnpm --filter @tenkings/browser-rip-client run build
pnpm --filter @tenkings/nextjs-app run build
