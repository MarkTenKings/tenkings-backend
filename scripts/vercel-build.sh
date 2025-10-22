#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @tenkings/database run migrate:deploy
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
pnpm --filter @tenkings/nextjs-app run build
