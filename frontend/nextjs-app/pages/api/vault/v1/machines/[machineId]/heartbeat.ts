import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { VaultConfigPayloadSchema, VaultHeartbeatSchema } from "@tenkings/vault-contracts";
import { methodNotAllowed, requireVaultJson, requireVaultMachine, sendVaultError, vaultRequestId, VaultApiError } from "../../../../../../lib/server/vaultV1/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  try {
    requireVaultJson(req, 32 * 1024);
    const machineId = String(req.query.machineId ?? "");
    await requireVaultMachine(req, machineId);
    const heartbeat = VaultHeartbeatSchema.parse(req.body);
    const observedAt = new Date(heartbeat.observedAt);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
      const machine = await tx.vaultMachine.findUnique({
        where: { id: machineId },
        select: { activeConfigId: true, pendingConfigId: true },
      });
      if (!machine) throw new VaultApiError(404, "MACHINE_NOT_FOUND", "Vault machine was not found");

      let activation: {
        configId: string;
        priorActiveConfigId: string | null;
        clearPending: boolean;
        payload: ReturnType<typeof VaultConfigPayloadSchema.parse>;
      } | null = null;
      if (heartbeat.configVersion !== null && heartbeat.configDigest !== null) {
        const reportedConfig = await tx.vaultConfigVersion.findUnique({
          where: { machineId_version: { machineId, version: heartbeat.configVersion } },
        });
        if (!reportedConfig || reportedConfig.digest !== heartbeat.configDigest) {
          throw new VaultApiError(409, "CONFIG_ACTIVATION_MISMATCH", "Heartbeat config version and digest do not match a machine config");
        }
        const alreadyActive = reportedConfig.id === machine.activeConfigId;
        if (!alreadyActive && (reportedConfig.status !== "PUBLISHED" || reportedConfig.id !== machine.pendingConfigId)) {
          throw new VaultApiError(409, "CONFIG_NOT_PENDING", "Only the exact pending published config can become active");
        }
        activation = {
          configId: reportedConfig.id,
          priorActiveConfigId: alreadyActive ? null : machine.activeConfigId,
          clearPending: !alreadyActive,
          payload: VaultConfigPayloadSchema.parse(reportedConfig.canonicalPayload),
        };
      } else if (machine.activeConfigId) {
        throw new VaultApiError(409, "ACTIVE_CONFIG_REPORT_MISSING", "Heartbeat must report the exact active config version and digest");
      }

      if (activation?.priorActiveConfigId) {
        await tx.vaultConfigVersion.updateMany({
          where: { id: activation.priorActiveConfigId, status: "PUBLISHED" },
          data: { status: "SUPERSEDED" },
        });
      }

      return tx.vaultMachine.update({
        where: { id: machineId },
        data: {
          lastHeartbeatAt: observedAt,
          lastCloudObservedAt: new Date(),
          health: heartbeat.health,
          readinessReasons: heartbeat.readinessReasons as Prisma.InputJsonValue,
          appVersion: heartbeat.appVersion,
          localSchemaVersion: heartbeat.localSchemaVersion,
          activeConfigVersion: heartbeat.configVersion,
          activeConfigDigest: heartbeat.configDigest,
          availableDoorCount: heartbeat.availableDoorCount,
          outboxPendingCount: heartbeat.outboxPendingCount,
          serviceLocked: heartbeat.serviceLocked,
          ...(activation ? {
            city: activation.payload.city,
            state: activation.payload.state,
            taxRateBasisPoints: activation.payload.taxRateBasisPoints,
            supportPageUrl: activation.payload.support.pageUrl,
            supportEmail: activation.payload.support.email,
            supportTextNumber: activation.payload.support.textNumber,
            supportPhoneNumber: activation.payload.support.phoneNumber,
            supportHours: activation.payload.support.hours,
            activeConfig: { connect: { id: activation.configId } },
            ...(activation.clearPending ? { pendingConfig: { disconnect: true } } : {}),
          } : {}),
        },
        select: { id: true, status: true, health: true, lastHeartbeatAt: true, activeConfigVersion: true },
      });
    });
    res.status(200).json({ requestId, accepted: true, machine: updated, serverObservedAt: new Date().toISOString() });
  } catch (error) {
    sendVaultError(res, requestId, error);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };
