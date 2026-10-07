import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { vaultPaymentActionHints } from "../../../../lib/server/vaultV1/paymentActions";
import { requireVaultMachine, assertVaultMachineAuthorityCurrent, sendVaultError, VaultApiError, vaultRequestId } from "../../../../lib/server/vaultV1/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); }
  try {
    const { machineId } = req.query;
    if (typeof machineId !== "string") throw new VaultApiError(400, "MACHINE_ID_REQUIRED", "An exact machine is required.");
    const authority = await requireVaultMachine(req, machineId);
    const data = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
      await assertVaultMachineAuthorityCurrent(tx, authority, machineId);
      return vaultPaymentActionHints(tx, machineId);
    });
    return res.status(200).json({ requestId, ...data });
  } catch (error) { sendVaultError(res, requestId, error); }
}
