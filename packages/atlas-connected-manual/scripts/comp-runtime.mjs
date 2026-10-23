// Optional native host mapping; every client is separate and lazy.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { requireThat } from '@atlas/manual-service/contract';
import { createNativeCompCurationRuntime } from '../src/comp-curation-runtime.mjs';
import { createCompArtifactReader } from '../src/comp-artifact-reader.mjs';
import { bufferResponse, failure } from '../../../frontend/atlas-app/lib/server/staff-comp-curation-transport-boundary.mjs';
const valid = ok => requireThat(ok, 503, 'COMP_NOT_CONFIGURED');
const environmentNames = ['ATLAS_STAFF_COMP_CURATION', 'ATLAS_COMP_DATABASE_URL', 'ATLAS_COMP_DATABASE_ROLE', 'ATLAS_COMP_SCHEMA_OWNER',
  'ATLAS_COMP_SCHEMA_SHA256', 'ATLAS_COMP_GUARD_VERSION', 'ATLAS_COMP_EVIDENCE_SELECTION', 'ATLAS_COMP_ARCHIVE_ACCESS', 'ATLAS_COMP_STORAGE_ENDPOINT', 'ATLAS_COMP_STORAGE_REGION', 'ATLAS_COMP_STORAGE_BUCKET',
  'ATLAS_COMP_STORAGE_PREFIX', 'ATLAS_COMP_STORAGE_ACCESS_KEY', 'ATLAS_COMP_STORAGE_SECRET_KEY', 'ATLAS_MANUAL_SERVICE_KEY',
  'ATLAS_MANUAL_STORAGE_ACCESS_KEY', 'ATLAS_MANUAL_STORAGE_SECRET_KEY', 'ATLAS_CUSTOMER_STORAGE_ACCESS_KEY', 'ATLAS_CUSTOMER_STORAGE_SECRET_KEY'];
export function createServingCompCuration({ env, auth, staffConfig, Client, nonceStore, ObjectClient = S3Client, ReadCommand = GetObjectCommand }) {
  if (env?.ATLAS_STAFF_COMP_CURATION !== '1') return null;
  for (const name of ['ATLAS_COMP_EVIDENCE_SELECTION', 'ATLAS_COMP_ARCHIVE_ACCESS'])
    valid(env[name] === undefined || env[name] === '0' || env[name] === '1');
  const guardVersion = env.ATLAS_COMP_GUARD_VERSION === undefined ? 'SQL011' : env.ATLAS_COMP_GUARD_VERSION;
  const selectionPolicy = env.ATLAS_COMP_EVIDENCE_SELECTION === '1' ? Object.freeze({
    version: 'atlas-comp-evidence-selection-policy-v1', status: 'LOCAL_PROPOSAL', method: 'private-saved-sold-evidence-v1', recencyDays: null, rightsStatus: 'UNRESOLVED',
  }) : null;
  const archiveCompAccess = env.ATLAS_COMP_ARCHIVE_ACCESS === '1';
  valid(selectionPolicy === null || guardVersion === 'EVIDENCE_SELECTION_V1');
  valid(typeof Client === 'function' && typeof ObjectClient === 'function' && typeof ReadCommand === 'function');
  const values = environmentNames.map(name => env[name]);
  const check = () => valid(environmentNames.every((name, i) => env[name] === values[i]));
  valid(typeof env.ATLAS_COMP_STORAGE_ACCESS_KEY === 'string' && typeof env.ATLAS_COMP_STORAGE_SECRET_KEY === 'string');
  for (const prefix of ['ATLAS_MANUAL_STORAGE', 'ATLAS_CUSTOMER_STORAGE']) {
    valid(env.ATLAS_COMP_STORAGE_ACCESS_KEY !== env[`${prefix}_ACCESS_KEY`]
      && env.ATLAS_COMP_STORAGE_SECRET_KEY !== env[`${prefix}_SECRET_KEY`]);
  }
  const key = Buffer.from(env.ATLAS_MANUAL_SERVICE_KEY ?? '', 'base64');
  valid(key.length === 32 && key.toString('base64') === env.ATLAS_MANUAL_SERVICE_KEY);
  const artifacts = createCompArtifactReader({ settings: {
    endpoint: env.ATLAS_COMP_STORAGE_ENDPOINT, region: env.ATLAS_COMP_STORAGE_REGION, bucket: env.ATLAS_COMP_STORAGE_BUCKET,
    prefix: env.ATLAS_COMP_STORAGE_PREFIX, accessKeyId: env.ATLAS_COMP_STORAGE_ACCESS_KEY, secretAccessKey: env.ATLAS_COMP_STORAGE_SECRET_KEY,
  }, createClient(settings) { check(); return new ObjectClient(settings); }, GetObjectCommand: ReadCommand });
  const runtime = createNativeCompCurationRuntime({ enabled: true, environment: env, auth, staffConfig, nonceStore,
    settings: { databaseUrl: env.ATLAS_COMP_DATABASE_URL, role: env.ATLAS_COMP_DATABASE_ROLE, schemaOwner: env.ATLAS_COMP_SCHEMA_OWNER,
      schemaSha256: env.ATLAS_COMP_SCHEMA_SHA256, guardVersion, selectionPolicy, archiveCompAccess, get origin() { check(); return staffConfig.origin; }, transportKey: key },
    createClient({ databaseUrl }) {
      check(); const url = new URL(databaseUrl); url.searchParams.set('connection_limit', '2');
      url.searchParams.set('pool_timeout', '3'); url.searchParams.set('connect_timeout', '5');
      return new Client({ datasources: { db: { url: url.href } }, errorFormat: 'minimal' });
    }, artifactReader: Object.freeze({ async read(...args) { check(); const value = await artifacts.reader.read(...args); check(); return value; } }),
  });
  let closing, closed = false;
  return Object.freeze({
    get configuredForDisplay() { try { check(); return !closed && runtime.configuredForDisplay; } catch { return false; } },
    async handler(req, res) {
      try {
        check(); valid(!closed); const buffered = bufferResponse();
        const handled = await runtime.handler(req, buffered.capture); check();
        if (!handled) return false;
        const result = buffered.result(); res.setHeader('Cache-Control', 'private, no-store');
        res.status(result.status).json(result.value); return true;
      } catch (error) { failure(res, error); return true; }
    },
    close() {
      if (closing) return closing; closed = true;
      closing = (async () => { try { await runtime.close(); } finally { await artifacts.close(); } })(); return closing;
    },
  });
}
