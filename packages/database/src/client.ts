import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.PRISMA_LOG_LEVEL ? ["query", "info", "warn", "error"] : ["warn", "error"],
  });
}

export const prisma = globalForPrisma.prisma;

export default prisma;
