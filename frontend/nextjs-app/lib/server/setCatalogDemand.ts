import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@tenkings/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { canonicalJson, normalizeCatalogDemand, catalogDemandKey, catalogDemandResultHash, CATALOG_DEMAND_VERSION,
  filterCatalogDemandResult, validateCatalogDemandAcquisition, type CatalogDemand, type CatalogDemandResult } from '@tenkings/card-catalog-evidence';
import { acquireSetCatalogDemand } from './setCatalogDemandSources';
import { HttpError } from './adminSessionAuthority';

type Job = { demandKey: string; demandJson: CatalogDemand; state: string; attempt: number; leaseToken: string | null;
  leaseUntil: Date | null; nextAttemptAt: Date; resultHash: string | null; createdAt: Date };
type Stored = { resultJson: CatalogDemandResult; snapshotHash: string };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function unpack(row: Stored, job: Job) {
  const result = validateCatalogDemandAcquisition(row.resultJson);
  if (result.demandKey !== job.demandKey || result.snapshotHash !== row.snapshotHash || result.snapshotHash !== job.resultHash
    || canonicalJson(result.demand) !== canonicalJson(job.demandJson) || result.attempt !== job.attempt) throw new Error('Demand result binding mismatch.');
  return result;
}
function pending(job: Job, now: Date) {
  const result = { schemaVersion: CATALOG_DEMAND_VERSION, demandKey: job.demandKey, demand: job.demandJson,
    state: job.state === 'RUNNING' ? 'RUNNING' : job.attempt >= 3 ? 'UNAVAILABLE' : 'QUEUED', attempt: job.attempt,
    coverage: 'unknown', sources: [], choices: [], context: [], problems: [job.attempt >= 3 ? 'SOURCE_ATTEMPTS_EXHAUSTED' : 'SOURCE_PREPARATION_PENDING'],
    capturedAt: now.toISOString(), snapshotHash: '' };
  result.snapshotHash = catalogDemandResultHash(result); return validateCatalogDemandAcquisition(result);
}

/** Separate tables and fixed SQL only. No legacy draft import, SetCard writes,
 * canonical IDs, publication pointers or approved-set replacement are possible. */
export function createSetCatalogDemandService(dependencies: { db?: PrismaClient; acquire?: typeof acquireSetCatalogDemand; now?: () => Date } = {}) {
  const db = dependencies.db ?? prisma, acquire = dependencies.acquire ?? acquireSetCatalogDemand, now = dependencies.now ?? (() => new Date());
  return async function prepareSetCatalogDemand(input: { demand: CatalogDemand; card?: { name: string; cardNumber: string } }) {
    const demand = normalizeCatalogDemand(input.demand), key = catalogDemandKey(demand), token = randomUUID();
    // Validate the filter before any persistence or network action.
    const initial = pending({ demandKey: key, demandJson: demand, state: 'QUEUED', attempt: 0 } as Job, now());
    filterCatalogDemandResult(initial, input.card ?? null);
    const claim = await db.$transaction(async tx => {
      // A global new-demand admission lock bounds growth without locking or
      // modifying any business/table roster. Existing set reads bypass the quota.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1869423110, 1)`;
      let rows = await tx.$queryRaw<Job[]>`SELECT * FROM "SetCatalogDemandJob" WHERE "demandKey"=${key} FOR UPDATE`;
      if (!rows.length) {
        const [count] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "SetCatalogDemandJob" WHERE "createdAt" > clock_timestamp() - interval '1 day'`;
        if (Number(count.count) >= 20) throw new HttpError(503, 'Catalog demand capacity reached.');
        await tx.$executeRaw`INSERT INTO "SetCatalogDemandJob" ("demandKey","demandJson",state) VALUES (${key},${canonicalJson(demand)}::jsonb,'QUEUED')`;
        rows = await tx.$queryRaw<Job[]>`SELECT * FROM "SetCatalogDemandJob" WHERE "demandKey"=${key} FOR UPDATE`;
      }
      let job = rows[0];
      if (!job || catalogDemandKey(job.demandJson) !== key) throw new Error('Demand identity binding mismatch.');
      const [clock] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
      if (job.state === 'RUNNING' && job.attempt >= 3 && job.leaseUntil && job.leaseUntil <= clock.at) {
        [job] = await tx.$queryRaw<Job[]>`UPDATE "SetCatalogDemandJob" SET state='UNAVAILABLE',"leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=clock_timestamp() WHERE "demandKey"=${key} RETURNING *`;
      }
      if (job.state === 'READY' || job.attempt >= 3 || job.state === 'RUNNING' && job.leaseUntil && job.leaseUntil > clock.at || job.nextAttemptAt > clock.at) {
        const retained = job.resultHash ? await tx.$queryRaw<Stored[]>`SELECT "resultJson","snapshotHash" FROM "SetCatalogDemandResult" WHERE "demandKey"=${key} AND "snapshotHash"=${job.resultHash}` : [];
        return { job, claimed: false, result: retained[0] ? unpack(retained[0], job) : pending(job, clock.at) };
      }
      const claimed = await tx.$queryRaw<Job[]>`UPDATE "SetCatalogDemandJob" SET state='RUNNING',attempt=attempt+1,"leaseToken"=${token},
        "leaseUntil"=clock_timestamp()+interval '30 seconds',"updatedAt"=clock_timestamp(),"resultHash"=NULL
        WHERE "demandKey"=${key} AND attempt<3 RETURNING *`;
      return { job: claimed[0], claimed: true, result: null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000 });
    if (!claim.claimed) return filterCatalogDemandResult(claim.result!, input.card ?? null);
    // Only idempotent public GETs occur outside the transaction. An abandoned
    // request can be reclaimed at most twice; no paid/model dispatch is here.
    const acquired = await acquire(claim.job.demandJson, claim.job.attempt);
    const result = validateCatalogDemandAcquisition(acquired.result);
    if (result.demandKey !== key || result.attempt !== claim.job.attempt || canonicalJson(result.demand) !== canonicalJson(claim.job.demandJson)
      || !Number.isSafeInteger(acquired.requests) || acquired.requests < 0 || acquired.requests > 5
      || acquired.artifacts.length !== result.sources.length) throw new Error('Demand acquisition binding mismatch.');
    for (const source of result.sources) {
      const artifacts = acquired.artifacts.filter(a => a.sourceId === source.sourceId);
      if (artifacts.length !== 1 || sha(artifacts[0].bytes) !== source.sha256 || artifacts[0].sha256 !== source.sha256 || artifacts[0].bytes.length !== source.byteSize) throw new Error('Demand artifact checksum mismatch.');
    }
    const saved = await db.$transaction(async tx => {
      const [job] = await tx.$queryRaw<Job[]>`SELECT * FROM "SetCatalogDemandJob" WHERE "demandKey"=${key} FOR UPDATE`;
      const [clock] = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
      if (!job || job.state !== 'RUNNING' || job.leaseToken !== token || job.attempt !== result.attempt || !job.leaseUntil || job.leaseUntil <= clock.at) throw new HttpError(409, 'Demand preparation lease expired.');
      await tx.$executeRaw`INSERT INTO "SetCatalogDemandResult" ("demandKey","snapshotHash","resultJson",requests,attempt)
        VALUES (${key},${result.snapshotHash},${canonicalJson(result)}::jsonb,${acquired.requests},${result.attempt})`;
      for (const artifact of acquired.artifacts) {
        await tx.$executeRaw`INSERT INTO "SetCatalogDemandSource" ("demandKey","snapshotHash","sourceId",sha256,"contentType",bytes)
          VALUES (${key},${result.snapshotHash},${artifact.sourceId},${artifact.sha256},${artifact.contentType},${artifact.bytes})`;
      }
      await tx.$executeRaw`UPDATE "SetCatalogDemandJob" SET state=${result.state},"resultHash"=${result.snapshotHash},"leaseToken"=NULL,"leaseUntil"=NULL,
        "nextAttemptAt"=clock_timestamp()+interval '1 minute',"updatedAt"=clock_timestamp() WHERE "demandKey"=${key} AND "leaseToken"=${token}`;
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000 });
    return filterCatalogDemandResult(saved, input.card ?? null);
  };
}
export const prepareSetCatalogDemand = createSetCatalogDemandService();
