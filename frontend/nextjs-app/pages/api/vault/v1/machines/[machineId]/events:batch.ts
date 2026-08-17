import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, assertVaultEventOrder, type Prisma } from "@tenkings/database";
import { VaultEventBatchSchema } from "@tenkings/vault-contracts";
import { methodNotAllowed, requireVaultJson, requireVaultMachine, sendVaultError, vaultRequestId, VaultApiError } from "../../../../../../lib/server/vaultV1/http";
import { normalizeTypedVaultEvent, projectVaultMachineEvent, vaultEventDigest } from "../../../../../../lib/server/vaultV1/events";

type Rejection = { eventId: string; code: string; message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  try {
    requireVaultJson(req, 8 * 1024 * 1024);
    const machineId = String(req.query.machineId ?? "");
    await requireVaultMachine(req, machineId);
    const batch = VaultEventBatchSchema.parse(req.body);
    if (batch.events.some((event) => event.machineId !== machineId)) {
      throw new VaultApiError(403, "EVENT_MACHINE_MISMATCH", "Every event must match the authenticated path machine");
    }
    assertVaultEventOrder(batch.events);
    const acknowledgedEventIds: string[] = [];
    const rejected: Rejection[] = [];

    for (let index = 0; index < batch.events.length; index += 1) {
      const event = batch.events[index]!;
      const digest = vaultEventDigest(event);
      let outcome: "ACCEPTED" | "DUPLICATE" | "ID_CONFLICT" | "SEQUENCE_CONFLICT" | "SEQUENCE_GAP" | "MACHINE_NOT_FOUND" | "POISON_EVENT";
      let poisonCode: string | null = null;
      try {
        const typedEvent = normalizeTypedVaultEvent(event);
        outcome = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "VaultMachine" WHERE "id" = ${machineId} FOR UPDATE`;
          const existingById = await tx.vaultMachineEvent.findUnique({
            where: { machineId_eventId: { machineId, eventId: event.eventId } },
            select: { payloadDigest: true },
          });
          if (existingById) return existingById.payloadDigest === digest ? "DUPLICATE" as const : "ID_CONFLICT" as const;
          const existingSequence = await tx.vaultMachineEvent.findUnique({
            where: { machineId_sequence: { machineId, sequence: BigInt(event.sequence) } },
            select: { eventId: true },
          });
          if (existingSequence) return "SEQUENCE_CONFLICT" as const;
          const machine = await tx.vaultMachine.findUnique({ where: { id: machineId }, select: { lastEventSequence: true } });
          if (!machine) return "MACHINE_NOT_FOUND" as const;
          const expected = machine.lastEventSequence + 1n;
          if (BigInt(event.sequence) !== expected) return "SEQUENCE_GAP" as const;
          await tx.vaultMachineEvent.create({
            data: {
              machineId,
              eventId: event.eventId,
              sequence: BigInt(event.sequence),
              schemaVersion: event.schemaVersion,
              type: event.type,
              mode: event.mode,
              correlationId: event.correlationId ?? null,
              causationId: event.causationId ?? null,
              occurredAt: new Date(event.occurredAt),
              payload: typedEvent.payload as Prisma.InputJsonValue,
              payloadDigest: digest,
            },
          });
          await projectVaultMachineEvent(tx, typedEvent);
          await tx.vaultMachine.update({ where: { id: machineId }, data: { lastEventSequence: BigInt(event.sequence) } });
          return "ACCEPTED" as const;
        });
      } catch (error) {
        if (!(error instanceof VaultApiError) && !(error && typeof error === "object" && "issues" in error)) throw error;
        outcome = "POISON_EVENT";
        poisonCode = error instanceof VaultApiError ? error.code : "EVENT_PROJECTION_SCHEMA_INVALID";
      }
      if (outcome === "ACCEPTED" || outcome === "DUPLICATE") {
        acknowledgedEventIds.push(event.eventId);
        continue;
      }
      const code = outcome === "ID_CONFLICT" ? "EVENT_ID_PAYLOAD_CONFLICT" : outcome === "POISON_EVENT" ? poisonCode ?? "POISON_EVENT" : outcome;
      rejected.push({ eventId: event.eventId, code, message: `Event rejected: ${code}` });
      await prisma.vaultAdminAuditEvent.create({
        data: {
          machineId,
          action: "vault.machine_event.quarantined",
          outcome: outcome === "SEQUENCE_GAP" ? "DENIED" : "FAILURE",
          targetType: "VaultMachineEvent",
          targetId: event.eventId,
          requestId,
          payloadDigest: digest,
          metadata: { code, sequence: event.sequence } as Prisma.InputJsonValue,
        },
      });
      for (const blocked of batch.events.slice(index + 1)) {
        rejected.push({ eventId: blocked.eventId, code: "CONTIGUOUS_PREFIX_BLOCKED", message: "Event was not evaluated after an earlier rejection" });
      }
      break;
    }

    res.status(rejected.length ? 207 : 200).json({
      requestId,
      acknowledgedEventIds,
      rejected,
      partial: rejected.length > 0 && acknowledgedEventIds.length > 0,
    });
  } catch (error) {
    sendVaultError(res, requestId, error);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
