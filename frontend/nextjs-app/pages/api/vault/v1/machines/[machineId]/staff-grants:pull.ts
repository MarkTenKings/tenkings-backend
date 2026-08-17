import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { VaultStaffGrantSchema } from "@tenkings/vault-contracts";
import { z } from "zod";
import { methodNotAllowed, requireVaultJson, requireVaultMachine, sendVaultError, vaultRequestId } from "../../../../../../lib/server/vaultV1/http";

const requestSchema = z.object({ contractVersion: z.literal(1), afterGrantVersion: z.number().int().nonnegative().default(0) });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  try {
    requireVaultJson(req, 16 * 1024);
    const machineId = String(req.query.machineId ?? "");
    await requireVaultMachine(req, machineId);
    const input = requestSchema.parse(req.body);
    const grants = await prisma.vaultStaffMachineAccess.findMany({
      where: { machineId, grantVersion: { gt: input.afterGrantVersion } },
      orderBy: { grantVersion: "asc" },
      take: 500,
    });
    const payload = grants.map((grant) => VaultStaffGrantSchema.parse({
      grantId: grant.grantId,
      userId: grant.userId,
      machineId: grant.machineId,
      role: grant.role,
      verifierVersion: grant.verifierVersion,
      verifier: grant.verifierHash,
      hashAlgorithm: grant.verifierAlgorithm,
      hashParameters: grant.verifierParameters,
      validFrom: grant.validFrom.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() ?? null,
    }));
    res.status(200).json({
      requestId,
      grants: payload,
      latestGrantVersion: grants.at(-1)?.grantVersion ?? input.afterGrantVersion,
      hasMore: grants.length === 500,
    });
  } catch (error) {
    sendVaultError(res, requestId, error);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };
