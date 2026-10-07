import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import type { SpeedsterPreparationInput, SpeedsterPreparationManifestBody } from "../ai-grader-v2/preparation";
import {
  type PreparationAttempt, type PreparationManifest, type PreparationOwner, type PreparationSnapshot,
  type PreparationStore, type PreparationTransaction,
} from "./speedsterPreparationAuthority";
import { preparationCanonicalJson, preparationRequire } from "./speedsterPreparationIntegrity";
import { insertSpeedsterInstrumentationEventWithConflictDetection } from "./aiGraderV2Instrumentation";

export type PrismaPreparationTransaction = PreparationTransaction & Readonly<{ database: Prisma.TransactionClient }>;
type Database = Pick<Prisma.TransactionClient, "aiGraderV2Session" | "aiGraderV2PreparationHead" | "aiGraderV2PreparationAttempt" | "aiGraderV2PreparationManifest">;
type AttemptRow = Prisma.AiGraderV2PreparationAttemptGetPayload<Record<string, never>>;
type ManifestRow = Prisma.AiGraderV2PreparationManifestGetPayload<Record<string, never>>;

function attemptRecord(row: AttemptRow | null): PreparationAttempt | null {
  if (!row) return null;
  preparationRequire(row.side === "FRONT" || row.side === "BACK", "Stored preparation side is invalid.");
  preparationRequire(row.terminalOutcome === null || row.terminalOutcome === "FAILED" || row.terminalOutcome === "ADOPTED", "Stored preparation terminal outcome is invalid.");
  const { inputCanonical, ...record } = row;
  const input = JSON.parse(inputCanonical) as SpeedsterPreparationInput;
  preparationRequire(preparationCanonicalJson(input) === inputCanonical, "Stored preparation input is not canonical.");
  return { ...record, side: row.side, terminalOutcome: row.terminalOutcome, input };
}

function manifestRecord(row: ManifestRow | null): PreparationManifest | null {
  if (!row) return null;
  preparationRequire(row.side === "FRONT" || row.side === "BACK", "Stored preparation manifest side is invalid.");
  const { bodyCanonical, ...record } = row;
  const body = JSON.parse(bodyCanonical) as SpeedsterPreparationManifestBody;
  preparationRequire(preparationCanonicalJson(body) === bodyCanonical, "Stored preparation body is not canonical.");
  return { ...record, side: row.side, body };
}

const sessionSelect = { id: true, createdByUserId: true, workflowState: true, cardProfile: true, identity: true, capture: true,
  mapRevisionId: true, mapRegistration: true, mapFilterPolicyVersion: true, updatedAt: true } as const;

async function readSnapshot(database: Database, owner: PreparationOwner): Promise<PreparationSnapshot> {
  const session = await database.aiGraderV2Session.findFirst({ where: { id: owner.sessionId, createdByUserId: owner.createdByUserId }, select: sessionSelect });
  preparationRequire(session, "Owned preparation session was not found.");
  const rows = await database.aiGraderV2PreparationHead.findMany({ where: { sessionId: owner.sessionId }, include: { activeAttempt: true, adoptedManifest: true } });
  const snapshot: PreparationSnapshot = { session, heads: {}, attempts: {}, manifests: {} };
  for (const row of rows) {
    preparationRequire(row.side === "FRONT" || row.side === "BACK", "Stored preparation head side is invalid.");
    const { activeAttempt, adoptedManifest, ...head } = row;
    snapshot.heads[row.side] = { ...head, side: row.side };
    const attempt = attemptRecord(activeAttempt);
    const manifest = manifestRecord(adoptedManifest);
    if (attempt) snapshot.attempts[row.side] = attempt;
    if (manifest) snapshot.manifests[row.side] = manifest;
  }
  return snapshot;
}

export function createPrismaSpeedsterPreparationStore(client = prisma): PreparationStore<PrismaPreparationTransaction> {
  return {
    // A single read transaction gives a coherent preflight snapshot. External byte
    // verification runs only after this transaction has ended.
    read: (owner) => client.$transaction((tx) => readSnapshot(tx, owner), { isolationLevel: "RepeatableRead" }),
    transaction: (owner, work) => client.$transaction(async (database) => {
      const owned = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "AiGraderV2Session"
        WHERE "id" = ${owner.sessionId} AND "createdByUserId" = ${owner.createdByUserId}
        FOR UPDATE
      `);
      preparationRequire(owned.length === 1, "Owned preparation session was not found.");
      await database.$queryRaw(Prisma.sql`
        SELECT "sessionId", "side" FROM "AiGraderV2PreparationHead"
        WHERE "sessionId" = ${owner.sessionId}
        ORDER BY CASE "side" WHEN 'FRONT' THEN 0 WHEN 'BACK' THEN 1 ELSE 2 END
        FOR UPDATE
      `);
      const scopedAttempt = (id: string) => ({ id, sessionId: owner.sessionId, createdByUserId: owner.createdByUserId });
      const transaction: PrismaPreparationTransaction = {
        database,
        snapshot: await readSnapshot(database, owner),
        findAttempt: async (id) => attemptRecord(await database.aiGraderV2PreparationAttempt.findFirst({ where: scopedAttempt(id) })),
        findIdempotentAttempt: async (side, idempotencyKey) => attemptRecord(await database.aiGraderV2PreparationAttempt.findFirst({ where: { sessionId: owner.sessionId, createdByUserId: owner.createdByUserId, side, idempotencyKey } })),
        findManifest: async (attemptId) => manifestRecord(await database.aiGraderV2PreparationManifest.findFirst({ where: { attemptId, sessionId: owner.sessionId, createdByUserId: owner.createdByUserId } })),
        insertAttempt: async (attempt) => {
          preparationRequire(attempt.sessionId === owner.sessionId && attempt.createdByUserId === owner.createdByUserId, "Preparation insert owner differs.");
          const canonical = preparationCanonicalJson(attempt.input);
          // JSON crosses Prisma's engine as text, preserving exact JS numbers.
          // PostgreSQL checks the JSONB projection against these canonical bytes.
          await database.$executeRaw(Prisma.sql`
            INSERT INTO "AiGraderV2PreparationAttempt" (
              "id", "sessionId", "createdByUserId", "side", "sideRevision", "idempotencyKey", "requestSha256",
              "expectedSideRevision", "expectedAttemptId", "input", "inputCanonical", "createdAt"
            ) VALUES (${attempt.id}, ${attempt.sessionId}, ${attempt.createdByUserId}, ${attempt.side}, ${attempt.sideRevision},
              ${attempt.idempotencyKey}, ${attempt.requestSha256}, ${attempt.expectedSideRevision}, ${attempt.expectedAttemptId},
              ${canonical}::jsonb, ${canonical}, ${attempt.createdAt})
          `);
        },
        setHead: async (head) => {
          preparationRequire(head.sessionId === owner.sessionId, "Preparation head owner differs.");
          const where = { sessionId_side: { sessionId: owner.sessionId, side: head.side } };
          if (await database.aiGraderV2PreparationHead.findUnique({ where })) {
            await database.aiGraderV2PreparationHead.update({ where, data: head });
          } else {
            await database.aiGraderV2PreparationHead.create({ data: head });
          }
        },
        claimDispatch: async (id, claimId, at) => {
          const result = await database.aiGraderV2PreparationAttempt.updateMany({
            where: { ...scopedAttempt(id), dispatchClaimId: null, terminalOutcome: null }, data: { dispatchClaimId: claimId, dispatchClaimedAt: at },
          });
          preparationRequire(result.count === 1, "Preparation dispatch was already claimed.");
        },
        finishAttempt: async (id, outcome, details, at) => {
          const result = await database.aiGraderV2PreparationAttempt.updateMany({
            where: { ...scopedAttempt(id), terminalOutcome: null, dispatchClaimId: { not: null } },
            data: { terminalOutcome: outcome, terminalDetails: details as Prisma.InputJsonValue, terminalAt: at },
          });
          preparationRequire(result.count === 1, "Preparation result was already finalized.");
        },
        insertManifest: async (manifest) => {
          preparationRequire(manifest.sessionId === owner.sessionId && manifest.createdByUserId === owner.createdByUserId, "Preparation manifest owner differs.");
          const canonical = preparationCanonicalJson(manifest.body);
          await database.$executeRaw(Prisma.sql`
            INSERT INTO "AiGraderV2PreparationManifest" (
              "id", "sessionId", "createdByUserId", "side", "sideRevision", "attemptId", "manifestSha256", "body", "bodyCanonical", "createdAt"
            ) VALUES (${manifest.id}, ${manifest.sessionId}, ${manifest.createdByUserId}, ${manifest.side}, ${manifest.sideRevision},
              ${manifest.attemptId}, ${manifest.manifestSha256}, ${canonical}::jsonb, ${canonical}, ${manifest.createdAt})
          `);
        },
        audit: async (event) => {
          preparationRequire(event.sessionId === owner.sessionId && event.createdByUserId === owner.createdByUserId, "Preparation audit owner differs.");
          await insertSpeedsterInstrumentationEventWithConflictDetection(database, { ...event, category: "PREPARATION_AUTHORITY", details: event.details as Prisma.InputJsonValue });
        },
      };
      const result = await work(transaction);
      // Prisma 5.22 can resolve an interactive transaction after a deferred
      // COMMIT-trigger error even though PostgreSQL rolls it back. Force these
      // checks while the callback is active so no uncommitted success escapes.
      await database.$executeRaw(Prisma.sql`SET CONSTRAINTS "PreparationManifest_atomic_adoption", "PreparationAttempt_atomic_adoption" IMMEDIATE`);
      return result;
    }, { maxWait: 5_000, timeout: 10_000 }),
  };
}

export const speedsterPreparationStore = createPrismaSpeedsterPreparationStore();
