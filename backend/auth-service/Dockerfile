  FROM node:20-bullseye-slim
  WORKDIR /app
  RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
  RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
  COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
  COPY tsconfig.base.json ./
  COPY backend ./backend
  COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tenkings/database run generate
RUN pnpm --filter @tenkings/database run build
RUN pnpm --filter @tenkings/shared run build
  RUN pnpm --filter @tenkings/auth-service run build
  WORKDIR /app/backend/auth-service
  ENV NODE_ENV=production
  EXPOSE 8080
  CMD ["node","dist/index.js"]
