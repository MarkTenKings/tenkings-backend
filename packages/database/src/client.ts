import { PrismaClient } from "@prisma/client";
import { URL } from "node:url";

function buildDatasourceUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return undefined;
  }
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
      const fallback = Number.parseInt(process.env.PRISMA_CONNECTION_LIMIT ?? "3", 10);
      const limit = Number.isFinite(fallback) && fallback > 0 ? fallback : 3;
      url.searchParams.set("connection_limit", String(limit));
    }
    return url.toString();
  } catch (error) {
    console.warn("[database] failed to normalise DATABASE_URL", error);
    return rawUrl;
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (!globalForPrisma.prisma) {
  const datasourceUrl = buildDatasourceUrl(process.env.DATABASE_URL);
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.PRISMA_LOG_LEVEL ? ["query", "info", "warn", "error"] : ["warn", "error"],
    datasources: datasourceUrl ? { db: { url: datasourceUrl } } : undefined,
  });
}

export const prisma = globalForPrisma.prisma;

export default prisma;
