import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { SignedVaultConfigSchema } from "@tenkings/vault-contracts";
import { methodNotAllowed, requireVaultGet, requireVaultMachine, sendVaultError, vaultRequestId, VaultApiError } from "../../../../../../lib/server/vaultV1/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"], requestId);
  try {
    requireVaultGet(req);
    const machineId = String(req.query.machineId ?? "");
    await requireVaultMachine(req, machineId);
    const machine = await prisma.vaultMachine.findUnique({
      where: { id: machineId },
      include: { pendingConfig: true, activeConfig: true },
    });
    const config = machine?.pendingConfig ?? machine?.activeConfig;
    if (!config || config.status !== "PUBLISHED" || !config.signingKeyId || !config.signingAlgorithm || !config.detachedSignature) {
      throw new VaultApiError(404, "NO_PUBLISHED_CONFIG", "No published config is available for this machine");
    }
    const signed = SignedVaultConfigSchema.parse({
      payload: config.canonicalPayload,
      digest: config.digest,
      keyId: config.signingKeyId,
      algorithm: config.signingAlgorithm,
      signature: config.detachedSignature,
    });
    const ifNoneMatch = String(req.headers["if-none-match"] ?? "").replace(/^W\//, "").replaceAll('"', "");
    const knownDigest = String(req.query.digest ?? "");
    res.setHeader("ETag", `\"${config.digest}\"`);
    res.setHeader("Cache-Control", "private, no-cache");
    // Version alone is not cache identity: a repaired/re-signed payload may retain
    // its monotonic version. Only the exact digest (query or ETag) may produce 304.
    if (ifNoneMatch === config.digest || knownDigest === config.digest) return res.status(304).end();
    res.status(200).json({ requestId, config: signed });
  } catch (error) {
    sendVaultError(res, requestId, error);
  }
}
