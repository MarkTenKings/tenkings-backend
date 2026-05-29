import type { NextApiRequest } from "next";
import type { AiGraderServicePrismaClient } from "@tenkings/database";
import { createAiGraderAdminApiHandler, type AiGraderAdminApiService } from "./aiGraderApi";

async function requireRuntimeAdminSession(req: NextApiRequest) {
  const { requireAdminSession } = await import("./admin");
  return requireAdminSession(req);
}

async function getRuntimeAiGraderService(): Promise<AiGraderAdminApiService> {
  const { createAiGraderService, prisma } = await import("@tenkings/database");
  return createAiGraderService(prisma as unknown as AiGraderServicePrismaClient);
}

export const aiGraderAdminApiHandler = createAiGraderAdminApiHandler({
  requireAdminSession: requireRuntimeAdminSession,
  getService: getRuntimeAiGraderService,
});

export default aiGraderAdminApiHandler;
