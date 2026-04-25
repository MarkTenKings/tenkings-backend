# Stage 1: install dependencies and build
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend ./backend
COPY packages ./packages
COPY frontend ./frontend
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tenkings/database generate
RUN pnpm --filter @tenkings/shared build \
  && pnpm --filter @tenkings/browser-rip-client build \
  && pnpm --filter @tenkings/database build

# Stage 2: run production server with Next.js
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace manifest and installed dependencies from the build stage
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Bring over the built frontend application (including the compiled .next output)
COPY --from=builder /app/frontend ./frontend

WORKDIR /app/frontend/nextjs-app

RUN pnpm run build

# Drop privileges for runtime
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
USER nextjs

ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "run", "start"]
