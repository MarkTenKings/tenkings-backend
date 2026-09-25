// Native owned-fixture lifecycle ONLY. Unlike disposablePostgres.stop(), these
// functions never delete PGDATA. All database roles, grants, accepted requests,
// immutable receipts and unresolved obligations remain on disk for collection.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createServer } from 'node:net';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const env = () => ({ HOME: process.env.HOME, PATH: process.env.PATH, LANG: 'C' });
export async function retainNativeFixture({ fixture, postgresBin, pgModule, output, context = {} }) {
  const directory = await realpath(fixture.cluster.directory), data = await realpath(join(directory, 'data'));
  const ownership = JSON.parse(await readFile(join(directory, 'ownership.json'), 'utf8'));
  assert.equal(ownership.createdByHarness, true); assert.equal(ownership.uid, process.getuid());
  assert.equal(ownership.ownerPid, process.pid); assert.equal(ownership.data, data);
  const admin = new URL(fixture.database.adminUrl); assert.equal(admin.hostname, '127.0.0.1');
  const [{ system_identifier: systemIdentifier }] = await fixture.admin.$queryRawUnsafe('SELECT system_identifier::text FROM pg_control_system()');
  const record = { version: 1, directory, data, ownership, postgresBin: await realpath(postgresBin), pgModule: await realpath(pgModule),
    port: Number(admin.port), adminUrl: fixture.database.adminUrl, staffUrl: fixture.database.staffUrl,
    databaseName: fixture.database.name, systemIdentifier, context };
  record.pgCtlSha256 = hash(await readFile(join(record.postgresBin, 'pg_ctl')));
  const path = join(output, 'retained-context.private.json');
  await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  return { path, record };
}
async function validate(record) {
  assert.equal(record.version, 1); assert.equal(await realpath(record.directory), record.directory);
  assert.equal(await realpath(record.data), record.data); assert.equal(dirname(record.data), record.directory);
  assert.equal(record.data, join(record.directory, 'data'));
  assert.equal((await stat(record.directory)).uid, process.getuid()); assert.equal((await stat(record.data)).uid, process.getuid());
  assert.equal(record.ownership.uid, process.getuid()); assert.equal(record.ownership.createdByHarness, true);
  assert.match(record.ownership.nonce, /^[a-f0-9]{32}$/);
  assert.deepEqual(JSON.parse(await readFile(join(record.directory, 'ownership.json'), 'utf8')), record.ownership);
  assert.equal(hash(await readFile(join(record.postgresBin, 'pg_ctl'))), record.pgCtlSha256);
  const admin = new URL(record.adminUrl); assert.equal(admin.hostname, '127.0.0.1'); assert.equal(Number(admin.port), record.port);
  assert.equal(admin.username, 'atlas_fixture_owner'); assert.equal(admin.pathname, `/${record.databaseName}`);
  assert.match(record.databaseName, /^atlas_fixture_case_[0-9]+$/); assert(record.port > 0 && record.port < 65536);
}
const run = (record, args) => spawnSync(join(record.postgresBin, 'pg_ctl'), ['-D', record.data, ...args],
  { env: env(), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
export async function stopRetainedFixture(record) {
  await validate(record);
  const status = run(record, ['status']); assert([0, 3].includes(status.status), 'Unknown owned PostgreSQL status');
  if (status.status === 0) assert.equal(run(record, ['-m', 'fast', '-w', 'stop']).status, 0, 'Owned PostgreSQL failed to stop');
  assert.equal(run(record, ['status']).status, 3);
  assert.equal(await realpath(record.data), record.data);
  await writeFile(join(record.directory, 'retained-shutdown.json'), JSON.stringify({ stopped: true, dataRetained: true,
    nonce: record.ownership.nonce, systemIdentifier: record.systemIdentifier, at: new Date().toISOString() }), { mode: 0o600 });
}
export async function startRetainedFixture(record) {
  await validate(record); assert.equal(run(record, ['status']).status, 3, 'Resume only an explicitly stopped owned cluster');
  await new Promise((done, reject) => { const socket = createServer().once('error', reject);
    socket.listen(record.port, '127.0.0.1', () => socket.close(error => error ? reject(error) : done())); });
  assert.equal(run(record, ['-l', join(record.directory, 'postgres.log'), '-o',
    `-h 127.0.0.1 -p ${record.port} -c unix_socket_directories=''`, '-w', 'start']).status, 0, 'Owned PostgreSQL failed to restart');
  assert.equal(run(record, ['status']).status, 0);
}
export async function readRetainedFixture(path) {
  assert.equal(resolve(path), path); const info = await stat(path);
  assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o077, 0, 'Retained credentials must be private');
  const record = JSON.parse(await readFile(path, 'utf8')); await validate(record); return record;
}
export async function assertRetainedDatabase(client, record) {
  const [observed] = await client.$queryRawUnsafe("SELECT system_identifier::text AS system,current_setting('data_directory') AS data,current_setting('listen_addresses') AS host,current_database() AS database FROM pg_control_system()");
  assert.deepEqual(observed, { system: record.systemIdentifier, data: record.data, host: '127.0.0.1', database: record.databaseName });
}
