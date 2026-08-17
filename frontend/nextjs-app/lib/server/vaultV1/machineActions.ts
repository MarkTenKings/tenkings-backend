import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, assertVaultEventOrder, type Prisma } from "@tenkings/database";
import { VaultEventBatchSchema, VaultStaffGrantSchema } from "@tenkings/vault-contracts";
import { z } from "zod";
import {
  methodNotAllowed,
  requireVaultGet,
  requireVaultJson,
  requireVaultMachine,
  sendVaultError,
  vaultRequestId,
  VaultApiError,
} from "./http";
import { normalizeTypedVaultEvent, projectVaultMachineEvent, vaultEventDigest } from "./events";

type Rejection = { eventId: string; code: string; message: string };

export type VaultMachineActionDependencies = {
  prismaClient: typeof prisma;
  authenticateMachine: typeof requireVaultMachine;
  projectEvent: typeof projectVaultMachineEvent;
};

const defaultDependencies: VaultMachineActionDependencies = {
  prismaClient: prisma,
  authenticateMachine: requireVaultMachine,
  projectEvent: projectVaultMachineEvent,
};

const staffGrantQuerySchema = z.object({
  afterGrantVersion: z.coerce.number().int().nonnegative().default(0),
});

export async function handleVaultEventBatch(
  req: NextApiRequest,
  res: NextApiResponse,
  dependencies: VaultMachineActionDependencies = defaultDependencies,
) {
  const requestId = vaultRequestId(req);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"], requestId);
  try {
    requireVaultJson(req, 8 * 1024 * 1024);
    const machineId = String(req.query.machineId ?? "");
    await dependencies.authenticateMachine(req, machineId);
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
        outcome = await dependencies.prismaClient.$transaction(async (tx) => {
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
          await dependencies.projectEvent(tx, typedEvent);
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
      await dependencies.prismaClient.vaultAdminAuditEvent.create({
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

export async function handleVaultStaffGrantPull(
  req: NextApiRequest,
  res: NextApiResponse,
  dependencies: VaultMachineActionDependencies = defaultDependencies,
) {
  const requestId = vaultRequestId(req);
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"], requestId);
  try {
    requireVaultGet(req);
    const machineId = String(req.query.machineId ?? "");
    await dependencies.authenticateMachine(req, machineId);
    const input = staffGrantQuerySchema.parse({ afterGrantVersion: req.query.afterGrantVersion });
    const grants = await dependencies.prismaClient.vaultStaffMachineAccess.findMany({
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

function actionSegment(req: NextApiRequest): string | null {
  const action = req.query.action;
  if (typeof action === "string") return action;
  if (Array.isArray(action) && action.length === 1) return action[0] ?? null;
  return null;
}

export async function handleVaultMachineAction(
  req: NextApiRequest,
  res: NextApiResponse,
  dependencies: VaultMachineActionDependencies = defaultDependencies,
) {
  const action = actionSegment(req);
  if (action === "events:batch") return handleVaultEventBatch(req, res, dependencies);
  if (action === "staff-grants:pull") return handleVaultStaffGrantPull(req, res, dependencies);
  const requestId = vaultRequestId(req);
  sendVaultError(res, requestId, new VaultApiError(404, "VAULT_MACHINE_ACTION_NOT_FOUND", "Vault machine action was not found"));
}
