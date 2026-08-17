import { randomBytes } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, hashVaultSecret } from "@tenkings/database";
import { z } from "zod";
import { methodNotAllowed, requireVaultJson, sendVaultError, vaultRequestId, VaultApiError, writeVaultAdminAudit } from "../../../../../../lib/server/vaultV1/http";

const requestSchema = z.object({
  contractVersion: z.literal(1),
  machineId: z.string().uuid(),
  enrollmentToken: z.string().min(32).max(512),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  try {
    requireVaultJson(req, 16 * 1024);
    const input = requestSchema.parse(req.body);
    const tokenHash = hashVaultSecret(input.enrollmentToken);
    const now = new Date();
    const rawCredential = `vault_${randomBytes(32).toString("base64url")}`;
    const credentialHash = hashVaultSecret(rawCredential);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${input.machineId} FOR UPDATE`;
      const token = await tx.vaultEnrollmentToken.findUnique({ where: { tokenHash }, include: { machine: true } });
      if (!token || token.machineId !== input.machineId) throw new VaultApiError(403, "ENROLLMENT_TOKEN_INVALID", "Enrollment token is invalid");
      if (token.machine.status === "DISABLED" || token.machine.status === "DECOMMISSIONED") throw new VaultApiError(403, "MACHINE_ENROLLMENT_DISABLED", "Disabled or decommissioned machines cannot enroll");
      if (token.status !== "APPROVED" || !token.approvedAt) throw new VaultApiError(403, "ENROLLMENT_NOT_APPROVED", "Enrollment token is not approved");
      if (token.expiresAt <= now) throw new VaultApiError(410, "ENROLLMENT_TOKEN_EXPIRED", "Enrollment token has expired");
      const version = token.machine.currentCredentialVersion + 1;
      await tx.vaultMachineCredential.updateMany({
        where: { machineId: input.machineId, status: "ACTIVE" },
        data: { status: "ROTATED", rotatedAt: now },
      });
      const credential = await tx.vaultMachineCredential.create({
        data: { machineId: input.machineId, version, credentialHash, status: "ACTIVE", activatedAt: now },
      });
      await tx.vaultEnrollmentToken.update({ where: { id: token.id }, data: { status: "CONSUMED", consumedAt: now } });
      await tx.vaultMachine.update({
        where: { id: input.machineId },
        data: { status: token.machine.status === "PROVISIONING" ? "ENROLLED" : token.machine.status, currentCredentialVersion: version },
      });
      await writeVaultAdminAudit({ req, tx, machineId: input.machineId, action: "vault.enrollment.exchange", outcome: "SUCCESS", targetType: "VaultMachineCredential", targetId: credential.id, metadata: { credentialVersion: version, enrollmentTokenId: token.id } });
      return { credentialId: credential.id, version, machineId: input.machineId };
    });
    res.status(200).json({ requestId, ...result, credential: rawCredential, credentialReturnedOnce: true });
  } catch (error) {
    sendVaultError(res, requestId, error);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };
