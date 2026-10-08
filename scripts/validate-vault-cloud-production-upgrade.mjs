import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Own a new local container; never accept an existing DATABASE_URL or cluster.
assert.ok(process.argv.includes('--ack-disposable-local-postgres'));
assert.equal(process.versions.node.split('.')[0], '20');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const base = '20643deae9b9b341fc7dfcd7fb703c53d0b73d0b';
const prior = '20260908010000_speedster_prepared_evidence_authority';
const priorHash = '2295497829bef571b4687f11ed493781e0a22e4151b7ae74a247a0f9793f891f';
// Official Docker Hub OCI index verified through Registry API; matches live PostgreSQL 17.11.
const postgresImage = 'postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const prefix = 'packages/database/prisma/migrations';
const directory = mkdtempSync(resolve(tmpdir(), 'vault-cloud-upgrade-'));
const name = `vault-cloud-upgrade-${process.pid}-${randomBytes(6).toString('hex')}`;
const user = 'vault_cloud_disposable', database = 'vault_cloud_disposable';
const password = randomBytes(32).toString('hex');
const environment = { PATH: process.env.PATH, HOME: process.env.HOME,
  ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
  ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}) };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300_000, ...options });
  if (result.status !== 0 || result.error) {
    throw new Error(`${command} failed: ${String(result.error?.message ?? result.stderr ?? '').replaceAll(password, '[REDACTED]').slice(-3000)}`);
  }
  return options.encoding === null ? result.stdout : result.stdout.trim();
}
const sqlArgs = ['exec', '-i', name, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database];
const sql = input => run('docker', sqlArgs, { input });
let started = false;
let report;
try {
  const endpoint = process.env.DOCKER_HOST ?? run('docker', ['context', 'inspect', '--format', '{{ (index .Endpoints "docker").Host }}']);
  assert.ok(endpoint.startsWith('unix://') || endpoint.startsWith('npipe://'), 'Local Docker endpoint required');
  const baselineFiles = run('git', ['ls-tree', '-r', '--name-only', base, prefix]).split('\n').filter(p => p.endsWith('/migration.sql'));
  assert.equal(baselineFiles.length, 98);
  const baseline = new Map();
  // Compare raw bytes separately: never normalize a Prisma migration checksum.
  for (const file of baselineFiles) {
    const raw = run('git', ['show', `${base}:${file}`], { encoding: null });
    baseline.set(file.split('/').at(-2), raw);
    assert.deepEqual(readFileSync(resolve(root, file)), raw, `Existing SQL changed: ${file}`);
  }
  const priorBytes = readFileSync(resolve(root, prefix, prior, 'migration.sql'));
  assert.equal(hash(priorBytes), priorHash);
  baseline.set(prior, priorBytes);
  // Prisma retains legacy directory names such as 20260422_golden_ticket_and_browser_ingest.
  const names = readdirSync(resolve(root, prefix), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const added = names.filter(n => !baseline.has(n));
  assert.equal(names.length, 107);
  assert.equal(added.length, 8);
  assert.ok(added.every(n => /^\d{14}_vault_/.test(n)), 'Only Vault migrations may be added');
  const migrations = resolve(directory, 'migrations');
  mkdirSync(migrations);
  cpSync(resolve(root, prefix, 'migration_lock.toml'), resolve(migrations, 'migration_lock.toml'));
  const schema = resolve(directory, 'schema.prisma');
  cpSync(resolve(root, 'packages/database/prisma/schema.prisma'), schema);
  for (const [migration, bytes] of baseline) {
    mkdirSync(resolve(migrations, migration));
    writeFileSync(resolve(migrations, migration, 'migration.sql'), bytes);
  }
  run('docker', ['run', '--detach', '--name', name, '--label', 'com.tenkings.disposable=vault-cloud-upgrade',
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=536870912',
    '--env', `POSTGRES_USER=${user}`, '--env', `POSTGRES_PASSWORD=${password}`, '--env', `POSTGRES_DB=${database}`, postgresImage]);
  started = true;
  const port = Number(run('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', name]));
  assert.ok(port > 1024 && port <= 65535);
  let ready = false;
  const readinessDeadline = Date.now() + 30_000;
  while (Date.now() < readinessDeadline) {
    // The image's temporary initialization server accepts Unix-socket probes
    // before POSTGRES_DB exists. Require a real query on the final TCP server.
    const result = spawnSync('docker', ['exec', '--env', `PGPASSWORD=${password}`, name,
      'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', user, '-d', database, '-c', 'SELECT 1;'],
    { env: environment, encoding: 'utf8', timeout: 2_000 });
    if (!result.error && result.status === 0 && result.stdout.trim() === '1') { ready = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready, 'Owned PostgreSQL must serve its initialized database over TCP');
  const serverVersion = sql('SHOW server_version;');
  const serverVersionNumber = sql('SHOW server_version_num;');
  assert.equal(serverVersion, '17.11', 'Disposable PostgreSQL must match live server version');
  assert.equal(serverVersionNumber, '170011');
  const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
  const prisma = require.resolve('../packages/database/node_modules/prisma/build/index.js');
  const migrate = () => run(process.execPath, [prisma, 'migrate', 'deploy', '--schema', schema], {
    env: { ...environment, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' } });
  migrate();
  assert.equal(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'), '99');
  const recorded = '2026-01-01T00:00:00.000Z';
  const event = JSON.stringify({ command: { request_id: 'synthetic-vault-upgrade', event_kind: 'description', data: {}, effective_at: recorded, evidence_ref: 'synthetic' },
    event: { schema_version: 2, source_sequence: 1, source_event_id: 'synthetic-event', recorded_at: recorded, effective_at: recorded, recorded_by: 'synthetic', event_kind: 'description', data: {}, currency: 'USD', evidence_ref: 'synthetic' } });
  const input = JSON.stringify({ schema_version: 1, unit_id: 'synthetic-unit', description_event_id: 'synthetic-event', description_hash: hash(event) });
  const recovery = JSON.stringify({ schema_version: 1, status: 'waiting_new_evidence', photo_attempts: [{ evidence: 'synthetic-retained' }], source_attempts: [], scope_attempts: [], refreshes: [] });
  const literal = value => `'${String(value).replaceAll("'", "''")}'`;
  sql(`INSERT INTO "InventoryWorkflowEventV2" ("sequence","id","recordedAt","content","contentHash","requestHash") VALUES (1,'synthetic-event',${literal(recorded)},${literal(event)},'${hash(event)}','${hash('request')}');
    INSERT INTO "StaffInventoryResearchJobV2" ("id","unitId","descriptionEventId","descriptionHash","inputHash","input","nextAttemptAt","createdAt","updatedAt","recoveryState","recoveryStateHash") VALUES ('synthetic-job','synthetic-unit','synthetic-event','${hash(event)}','${hash(input)}',${literal(input)},${literal(recorded)},${literal(recorded)},${literal(recorded)},${literal(recovery)},'${hash(recovery)}');
    INSERT INTO "SetCatalogObservationProposal" ("id","producer","observationId","inputRevision","physicalCardRef","proposalJson","proposalSha256","actorKind","actorRef","bindingJson","bindingSha256") VALUES ('synthetic-proposal','inventory','synthetic-observation','1','synthetic-unit','{}','${hash('{}')}','service','synthetic','{}','${hash('{}')}');`);
  const preservedTables = ['InventoryWorkflowEventV2', 'StaffInventoryResearchJobV2', 'SetCatalogObservationProposal'];
  const snapshot = () => preservedTables.map(table => sql(`SELECT row_to_json(t)::text FROM "${table}" t ORDER BY "id";`));
  const before = snapshot();
  const priorLedger = sql('SELECT migration_name||\'|\'||checksum FROM "_prisma_migrations" ORDER BY migration_name;');
  for (const migration of added) cpSync(resolve(root, prefix, migration), resolve(migrations, migration), { recursive: true });
  migrate();
  assert.deepEqual(snapshot(), before, 'Inventory, recovery and catalog evidence must remain byte-identical');
  const ledger = sql('SELECT migration_name||\'|\'||checksum FROM "_prisma_migrations" ORDER BY migration_name;');
  for (const line of priorLedger.split('\n')) assert.ok(ledger.split('\n').includes(line), 'Existing checksum ledger preserved');
  assert.equal(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'), '107');
  assert.equal(sql('SELECT count(*) FROM "VaultMachine";'), '0');
  assert.equal(sql('SELECT count(*) FROM "VaultSparkObservation";'), '0');
  for (const statement of [
    'UPDATE "InventoryWorkflowEventV2" SET "requestHash"=repeat(\'0\',64);',
    'UPDATE "SetCatalogObservationProposal" SET "inputRevision"=\'2\';',
    'UPDATE "StaffInventoryResearchJobV2" SET "recoveryState"=NULL,"recoveryStateHash"=NULL;'
  ]) assert.throws(() => sql(statement), /append-only|immutable|cannot be removed/);
  assert.deepEqual(snapshot(), before);
  assert.match(migrate(), /No pending migrations to apply/);
  assert.equal(sql('SELECT migration_name||\'|\'||checksum FROM "_prisma_migrations" ORDER BY migration_name;'), ledger);
  report = { classification: 'DISPOSABLE_PRODUCTION_LINEAGE_UPGRADE', productionSource: base, postgresImage, serverVersion, serverVersionNumber, baselineMigrations: 99, finalMigrations: 107,
    addedMigrations: added.map(migration => ({ migration, sha256: hash(readFileSync(resolve(root, prefix, migration, 'migration.sql'))) })),
    inventoryAndCatalogEvidencePreserved: true, existingMigrationChecksumsPreserved: true, immutableGuardRejections: 3, secondDeploy: 'NO_OP',
    productionDatabaseTouched: false, loopbackOnly: true, disposableContainer: name };
} finally {
  if (started) run('docker', ['rm', '-f', name]);
  rmSync(directory, { recursive: true, force: true });
}
report.ownedResourcesRemoved = true;
mkdirSync(resolve(root, 'outputs'), { recursive: true });
writeFileSync(resolve(root, 'outputs/vault-cloud-production-upgrade.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
