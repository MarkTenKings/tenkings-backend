import type { NextApiRequest } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { createPhysicalInventoryCardHandler, readPhysicalInventoryCard } from "../../../../../lib/server/physicalInventoryRead";

export const config = { api: { responseLimit: "2mb" } };

export default createPhysicalInventoryCardHandler({
  requireAdmin: (req) => requireAdminSession(req as NextApiRequest),
  readTokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  // One stable snapshot prevents a concurrent source write from mixing an old
  // card projection with newly accepted history. No write or lock is required.
  readCard: (cardId) => prisma.$transaction((tx) => readPhysicalInventoryCard(tx, cardId), {
    isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000,
  }),
});
