import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderDesignReferenceService, prisma } from "@tenkings/database";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { createAiGraderDesignReferenceApiHandler } from "../../../../../lib/server/aiGraderDesignReferenceApi";
import { readStorageBuffer } from "../../../../../lib/server/storage";

export const config = {
  maxDuration: 20,
  api: { bodyParser: { sizeLimit: "64kb" } },
};

const runtime = createAiGraderDesignReferenceApiHandler({
  requireAdminSession,
  readArtifactBytes: async (storageKey) => readStorageBuffer(storageKey),
  service: createAiGraderDesignReferenceService(prisma as any, {
    readArtifactBytes: async (storageKey) => readStorageBuffer(storageKey),
  }),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
