import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../lib/server/policy.mjs';
import { staffGrantSQL } from '../lib/server/access/privileges.mjs';
import { publicGrantSQL } from '../../atlas-public/lib/server/privileges.mjs';
import { operatorGrantSQL } from '../../../packages/atlas-operator/src/privileges.mjs';
import { operationsGrantSQL } from '../lib/server/access/operations-authority.mjs';
import { customerGrantSQL } from '../../atlas-customer/lib/server/database.mjs';
import { createRemotePostgresTransport, REMOTE_POSTGRES_IMAGE } from './remote-disposable-postgres.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(appRoot, '../..');
const cleanEnv = { HOME: process.env.HOME ?? tmpdir(), PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C',
    PRISMA_HIDE_UPDATE_MESSAGE: '1', NEXT_TELEMETRY_DISABLED: '1' };

// An already-present image ID, never a mutable tag or a network pull.
export const DISPOSABLE_POSTGRES_IMAGE = 'sha256:9b1d34adbce1dd07ee6e94b4a2cf698884b89bd44a6c9c12f5da8f3acbfe4957';
const dockerLabel = 'com.atlas.disposable-postgres.nonce';
const dockerData = '/var/lib/postgresql/data/pgdata';
const dockerTmpfs = { '/var/lib/postgresql/data': 'rw,nosuid,nodev,size=1200m', '/tmp': 'rw,nosuid,nodev,size=64m', '/run': 'rw,nosuid,nodev,size=16m' };
const dockerLogConfig = { Type: 'local', Config: { 'max-size': '1m', 'max-file': '1', compress: 'false' } };

export function disposableDockerArgs({ image, nonce, port, envFile, remote = false }) {
    assert.equal(image, remote ? REMOTE_POSTGRES_IMAGE : DISPOSABLE_POSTGRES_IMAGE, 'Only the explicitly selected reviewed PostgreSQL image ID is accepted');
    assert.match(nonce, /^[a-f0-9]{32}$/); assert(Number.isInteger(port) && port > 0 && port <= 65535);
    assert(typeof envFile === 'string' && envFile.startsWith('/'));
    return ['create', '--pull=never', '--name', `atlas-fixture-${nonce}`, '--label', `${dockerLabel}=${nonce}`,
        '--read-only', '--memory=2g', '--memory-swap=2g', '--pids-limit=256', '--cpus=2', '--shm-size=64m',
        '--log-driver=local', '--log-opt=max-size=1m', '--log-opt=max-file=1', '--log-opt=compress=false', '--restart=no', '--network=bridge', '--publish', `127.0.0.1:${port}:5432`, '--env-file', envFile,
        ...Object.entries(dockerTmpfs).flatMap(([path, options]) => ['--tmpfs', `${path}:${options}`]),
        image, 'postgres', '-c', 'listen_addresses=*', '-c', 'max_connections=40', '-c', 'shared_buffers=64MB'];
}

/** Inspect by the captured immutable ID before either starting or removing it. */
export function verifyDisposableDocker(container, { id, nonce, port, remote = false }) {
    assert.match(id, /^[a-f0-9]{64}$/); assert.equal(container.Id, id);
    assert.equal(container.Image, remote ? REMOTE_POSTGRES_IMAGE : DISPOSABLE_POSTGRES_IMAGE);
    assert.equal(container.Name, `/atlas-fixture-${nonce}`);
    assert.equal(container.Config?.Labels?.[dockerLabel], nonce);
    const host = container.HostConfig;
    assert.equal(host.ReadonlyRootfs, true); assert.equal(host.Memory, 2 * 1024 ** 3); assert.equal(host.MemorySwap, host.Memory);
    assert.equal(host.Privileged, false); assert.equal(host.NetworkMode, 'bridge');
    assert.equal(host.PidsLimit, 256); assert.equal(host.NanoCpus, 2 * 10 ** 9); assert.equal(host.ShmSize, 64 * 1024 ** 2);
    assert.equal(host.RestartPolicy?.Name, 'no'); assert(!host.Devices?.length && !host.CapAdd?.length);
    assert.deepEqual(host.LogConfig, dockerLogConfig, 'Only bounded owned-container diagnostic logs are allowed');
    assert.deepEqual(host.PortBindings, { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] });
    assert.deepEqual(host.Tmpfs, dockerTmpfs);
    assert(!host.Binds?.length && !host.VolumesFrom?.length, 'No existing filesystem or volume may be mounted');
    assert((container.Mounts ?? []).every(m => m.Type === 'tmpfs' && Object.hasOwn(dockerTmpfs, m.Destination)), 'Only owned tmpfs mounts are allowed');
    return true;
}

/** Accepts binaries or a pinned owned container, never an existing database/data directory. */
export async function disposablePostgres(args, { beforeUpgradeFrom48 } = {}) {
    assert(beforeUpgradeFrom48 === undefined || typeof beforeUpgradeFrom48 === 'function', 'Upgrade rehearsal requires an explicit fixture callback');
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        assert(!seen.has(args[i]), 'Duplicate disposable fixture argument'); seen.add(args[i]);
        if (['--postgres-bin', '--docker-image', '--pg-module'].includes(args[i])) { assert(args[++i] && !args[i].startsWith('--')); continue; }
        assert(['--ack-disposable-local-postgres', '--ack-disposable-remote-pg17', '--serve'].includes(args[i]), 'Unknown disposable fixture argument');
    }
    assert(args.includes('--ack-disposable-local-postgres'), 'Explicit disposable fixture acknowledgement required');
    assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)), 'Refusing inherited database configuration');
    const option = flag => { const index = args.indexOf(flag); assert(index >= 0 && args[index + 1]); return realpathSync(args[index + 1]); };
    assert(seen.has('--postgres-bin') !== seen.has('--docker-image'), 'Choose exactly one disposable PostgreSQL mode');
    const dockerImage = seen.has('--docker-image') ? args[args.indexOf('--docker-image') + 1] : null;
    const remote = seen.has('--ack-disposable-remote-pg17');
    if (remote) assert(dockerImage && !seen.has('--serve'), 'Remote PostgreSQL requires a finite owned Docker fixture');
    if (dockerImage) assert.equal(dockerImage, remote ? REMOTE_POSTGRES_IMAGE : DISPOSABLE_POSTGRES_IMAGE, 'Only the explicitly selected reviewed PostgreSQL image ID is accepted');
    const transport = remote ? createRemotePostgresTransport() : null;
    const docker = (commandArgs, options) => transport ? transport.execute(commandArgs, options) : spawnSync('docker', commandArgs, options);
    const bin = dockerImage ? null : option('--postgres-bin'), pgModule = option('--pg-module');
    const { Client } = createRequire(import.meta.url)(pgModule);
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-staff-db-')));
    const data = dockerImage ? dockerData : join(directory, 'data'), owner = 'atlas_fixture_owner', role = 'atlas_fixture_staff';
    const ownerPassword = randomBytes(24).toString('hex'), staffPassword = randomBytes(24).toString('hex'), publicPassword = randomBytes(24).toString('hex');
    const publicRole = 'atlas_fixture_public';
    const operatorRole = 'atlas_fixture_operator', operatorPassword = randomBytes(24).toString('hex');
    const operationsRole = 'atlas_fixture_operations', operationsPassword = randomBytes(24).toString('hex');
    const customerRole = 'atlas_fixture_customer', customerPassword = randomBytes(24).toString('hex');
    const passwordFile = join(directory, 'owner-password');
    writeFileSync(passwordFile, ownerPassword, { mode: 0o600 });
    const sentinel = { nonce: randomBytes(16).toString('hex'), data, ownerPid: process.pid, uid: process.getuid(), createdByHarness: true };
    writeFileSync(join(directory, 'ownership.json'), JSON.stringify(sentinel), { mode: 0o600 });
    let log = '', started = false, containerId = null, ownedContainer = null;
    const safe = value => String(value).replaceAll(ownerPassword, '[fixture-password]').replaceAll(staffPassword, '[fixture-password]')
        .replaceAll(publicPassword, '[fixture-password]').replaceAll(operatorPassword, '[fixture-password]').replaceAll(operationsPassword, '[fixture-password]')
        .replaceAll(customerPassword, '[fixture-password]');
    function run(command, commandArgs, env = cleanEnv) {
        const options = { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120_000 };
        const result = command === 'docker' ? docker(commandArgs, options) : spawnSync(command, commandArgs, options);
        log += safe(`${result.stdout ?? ''}${result.stderr ?? ''}`);
        writeFileSync(join(directory, 'validation.log'), log, { mode: 0o600 });
        if (result.error || result.status !== 0) throw new Error(safe(result.error?.message ?? result.stderr ?? 'Fixture child failed'));
        return result.stdout;
    }
    let port;
    for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = await new Promise((done, reject) => {
            const socket = createServer().once('error', reject);
            socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(error => error ? reject(error) : done(value)); });
        });
        if (!transport || transport.portAvailable(candidate, cleanEnv)) { port = candidate; break; }
    }
    assert(port, 'No fresh loopback fixture port was available');
    function url(database, staff = false, schema = 'atlas_staff') {
        assert(/^[a-z][a-z0-9_]+$/.test(database));
        if (staff === 'operator') return `postgresql://${operatorRole}:${operatorPassword}@127.0.0.1:${port}/${database}?schema=${schema}&connection_limit=4`;
        if (staff === 'operations') return `postgresql://${operationsRole}:${operationsPassword}@127.0.0.1:${port}/${database}?schema=${schema}&connection_limit=4`;
        if (staff === 'customer') return `postgresql://${customerRole}:${customerPassword}@127.0.0.1:${port}/${database}?schema=${schema}&connection_limit=4`;
        return `postgresql://${staff === 'public' ? publicRole : staff ? role : owner}:${staff === 'public' ? publicPassword : staff ? staffPassword : ownerPassword}@127.0.0.1:${port}/${database}?schema=${schema}&connection_limit=4`;
    }
    async function sql(query, values = [], database = 'postgres') {
        const client = new Client({ connectionString: url(database, false, 'public'), connectionTimeoutMillis: 5000 });
        await client.connect();
        try { return await client.query(query, values); } finally { await client.end(); }
    }
    async function stop() {
        assert.deepEqual(JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8')), sentinel);
        assert.equal(statSync(directory).uid, process.getuid());
        if (dockerImage && containerId) {
            // Keep the captured ID in memory as well as evidence: a full host
            // disk must not prevent removing this already verified own fixture.
            const recorded = ownedContainer;
            assert.deepEqual(recorded, { id: containerId, nonce: sentinel.nonce, port, remote, image: dockerImage });
            const initial = docker(['inspect', containerId], { env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
            assert.equal(initial.status, 0); verifyDisposableDocker(JSON.parse(initial.stdout)[0], recorded);
            // PostgreSQL logs expose the initiating SQL error that Prisma may
            // replace with "current transaction is aborted". Capture bounded
            // owned-container logs in memory; no evidence write may block stop.
            const postgresLogs = docker(['logs', '--tail=2000', '--timestamps', containerId],
                { env: cleanEnv, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
            const postgresLog = safe(`${postgresLogs.stdout ?? ''}${postgresLogs.stderr ?? ''}`);
            // Do not write logs between stop/remove: cleanup must also work on a full host disk.
            const stopped = docker(['stop', '--time=10', containerId], { env: cleanEnv, encoding: 'utf8', timeout: 30_000 });
            assert.equal(stopped.status, 0, 'Owned fixture container did not stop');
            const inspected = docker(['inspect', containerId], { env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
            assert.equal(inspected.status, 0); const container = JSON.parse(inspected.stdout)[0];
            verifyDisposableDocker(container, recorded); assert.equal(container.State.Running, false);
            const removed = docker(['rm', containerId], { env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
            assert.equal(removed.status, 0, 'Owned fixture container was not removed');
            const absent = docker(['inspect', containerId], { env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
            assert.equal(absent.status, 1); assert.match(absent.stderr, /No such (object|container)/i);
            containerId = null; started = false;
            await transport?.stopTunnel();
            writeFileSync(join(directory, 'postgres.log'), postgresLog, { mode: 0o600 });
            writeFileSync(join(directory, 'cleanup.json'), JSON.stringify({ stoppedVerified: true, removed: 'owned tmpfs container', evidenceRetained: true }));
        } else if (started) {
            const status = spawnSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: cleanEnv, encoding: 'utf8' });
            if (status.status === 0) {
                // Shutdown must not depend on space being available to flush a
                // log. Verify stop, free owned data, then retain the log below.
                const stopped = spawnSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { env: cleanEnv, encoding: 'utf8' });
                log += safe(`${stopped.stdout ?? ''}${stopped.stderr ?? ''}`);
                assert.equal(stopped.status, 0, 'Owned fixture did not stop');
            }
            else assert.equal(status.status, 3, 'Unknown fixture cluster status');
            assert.equal(spawnSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: cleanEnv }).status, 3);
            assert.equal(realpathSync(data), data);
            rmSync(data, { recursive: true });
            writeFileSync(join(directory, 'validation.log'), log, { mode: 0o600 });
            writeFileSync(join(directory, 'cleanup.json'), JSON.stringify({ stoppedVerified: true, removed: 'owned regenerable database files', evidenceRetained: true }));
            started = false;
        }
    }
    const inventory = path => readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(({ name }) => {
        const bytes = readFileSync(join(path, name, 'migration.sql'));
        return { name, sha256: hash(bytes), byteCount: bytes.length };
    }).sort((a, b) => a.name < b.name ? -1 : 1);
    const source = { commit: run('git', ['rev-parse', 'HEAD']).trim(), status: run('git', ['status', '--porcelain']).trim(),
        publicMigrations: inventory(join(root, 'packages/database/prisma/migrations')),
        staffMigrations: inventory(join(appRoot, 'prisma/migrations')) };
    writeFileSync(join(directory, 'source.json'), JSON.stringify(source, null, 2));
    try {
        if (dockerImage) {
            const endpoint = JSON.parse(run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']).trim());
            assert.match(endpoint, /^unix:\/\//, 'Docker fixture requires a local Unix-socket daemon');
            const image = JSON.parse(run('docker', ['image', 'inspect', dockerImage]))[0];
            assert.equal(image.Id, dockerImage); assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, transport?.architecture ?? 'arm64');
            const envFile = join(directory, 'container.env');
            // The official entrypoint initializes through its container-local socket.
            // SCRAM permits that generated-password setup; no socket is mounted on the host.
            writeFileSync(envFile, `POSTGRES_USER=${owner}\nPOSTGRES_PASSWORD=${ownerPassword}\nPGDATA=${dockerData}\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C\n`, { mode: 0o600, flag: 'wx' });
            const created = docker(disposableDockerArgs({ image: dockerImage, nonce: sentinel.nonce, port, envFile, remote }), { env: cleanEnv, encoding: 'utf8', timeout: 30_000 });
            let id = created.stdout?.trim();
            if (!/^[a-f0-9]{64}$/.test(id ?? '')) {
                // A failed create response may still have created the object.
                // Resolve only this nonce-derived name, then verify every guard.
                const possible = docker(['inspect', `atlas-fixture-${sentinel.nonce}`], { env: cleanEnv, encoding: 'utf8', timeout: 15_000 });
                if (possible.status === 0) {
                    const container = JSON.parse(possible.stdout)[0];
                    verifyDisposableDocker(container, { id: container.Id, nonce: sentinel.nonce, port, remote }); id = container.Id;
                }
            }
            if (/^[a-f0-9]{64}$/.test(id ?? '')) {
                containerId = id; ownedContainer = { id, nonce: sentinel.nonce, port, remote, image: dockerImage };
                writeFileSync(join(directory, 'container.json'), JSON.stringify(ownedContainer), { mode: 0o600, flag: 'wx' });
            }
            unlinkSync(envFile); unlinkSync(passwordFile);
            assert.equal(created.status, 0, safe(created.stderr)); assert(containerId, 'Docker create did not return an owned container ID');
            verifyDisposableDocker(JSON.parse(run('docker', ['inspect', containerId]))[0], { id: containerId, nonce: sentinel.nonce, port, remote });
            run('docker', ['start', containerId]); started = true;
            transport?.startTunnel(port, cleanEnv);
            writeFileSync(join(directory, 'transport.json'), JSON.stringify({ host: transport?.host ?? 'local', image: dockerImage,
                architecture: image.Architecture, encryptedSshLoopbackTunnel: remote, port, containerId, nonce: sentinel.nonce }), { mode: 0o600 });
            const deadline = Date.now() + 60_000; let ready = false;
            while (Date.now() < deadline) {
                try { await sql('SELECT 1'); ready = true; break; } catch { await new Promise(done => setTimeout(done, 200)); }
            }
            assert(ready, 'Owned disposable PostgreSQL did not become ready');
        } else {
            run(join(bin, 'initdb'), ['-D', data, '--username', owner, '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C']);
            started = true;
            run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start']);
        }
        const settings = (await sql("SELECT current_setting('data_directory') AS data, current_setting('listen_addresses') AS host")).rows[0];
        assert.deepEqual(settings, { data, host: dockerImage ? '*' : '127.0.0.1' });
        await sql('CREATE DATABASE atlas_fixture_template');
        const cli = join(appRoot, 'node_modules/prisma/build/index.js');
        const deploy = (scope, database = 'atlas_fixture_template', stagedSchema) => {
            const schema = stagedSchema ?? (scope === 'public' ? join(root, 'packages/database/prisma/schema.prisma') : join(appRoot, 'prisma/schema.prisma'));
            return run(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], { ...cleanEnv,
                [scope === 'public' ? 'DATABASE_URL' : 'ATLAS_DATABASE_URL']: url(database, false, scope) });
        };
        const ledger = async scope => (await sql(`SELECT * FROM ${scope}."_prisma_migrations" ORDER BY migration_name,id`, [], 'atlas_fixture_template')).rows;
        deploy('public');
        const publicLedger = await ledger('public');
        const createServingRoles = async () => {
            await sql(`CREATE ROLE ${role} LOGIN PASSWORD '${staffPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await sql(staffGrantSQL(role), [], 'atlas_fixture_template');
            await sql(`CREATE ROLE ${publicRole} LOGIN PASSWORD '${publicPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await sql(publicGrantSQL(publicRole), [], 'atlas_fixture_template');
            await sql(`CREATE ROLE ${operatorRole} LOGIN PASSWORD '${operatorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await sql(operatorGrantSQL(operatorRole), [], 'atlas_fixture_template');
            await sql(`CREATE ROLE ${operationsRole} LOGIN PASSWORD '${operationsPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await sql(operationsGrantSQL(operationsRole), [], 'atlas_fixture_template');
            await sql(`CREATE ROLE ${customerRole} LOGIN PASSWORD '${customerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
            await sql(customerGrantSQL(customerRole), [], 'atlas_fixture_template');
        };
        let upgradeLedger;
        if (beforeUpgradeFrom48) {
            assert.equal(source.staffMigrations[47]?.name, '20260924030000_manual_research_effects');
            assert.equal(source.staffMigrations[48]?.name, '20260924060000_customer_photo_intake');
            assert.equal(source.staffMigrations.length, 53, 'Review the upgrade boundary before adding further migrations');
            assert.equal(source.staffMigrations[52]?.name, '20260925080000_manual_workspace_discard');
            // Copy only the exact recorded predecessor bytes into a new owned
            // folder; never hide, rename or mutate the working tree migrations.
            const staged = join(directory, 'staff-through-48'), stagedMigrations = join(staged, 'migrations');
            mkdirSync(stagedMigrations, { recursive: true });
            copyFileSync(join(appRoot, 'prisma/schema.prisma'), join(staged, 'schema.prisma'));
            copyFileSync(join(appRoot, 'prisma/migrations/migration_lock.toml'), join(stagedMigrations, 'migration_lock.toml'));
            for (const item of source.staffMigrations.slice(0, 48)) {
                const target = join(stagedMigrations, item.name); mkdirSync(target);
                copyFileSync(join(appRoot, 'prisma/migrations', item.name, 'migration.sql'), join(target, 'migration.sql'));
            }
            assert.deepEqual(inventory(stagedMigrations), source.staffMigrations.slice(0, 48));
            deploy('atlas_staff', 'atlas_fixture_template', join(staged, 'schema.prisma'));
            upgradeLedger = await ledger('atlas_staff');
            assert.equal(upgradeLedger.length, 48);
            for (const [index, item] of source.staffMigrations.slice(0, 48).entries()) {
                assert.equal(upgradeLedger[index].migration_name, item.name); assert.equal(upgradeLedger[index].checksum, item.sha256);
                assert(upgradeLedger[index].finished_at && !upgradeLedger[index].rolled_back_at && upgradeLedger[index].applied_steps_count > 0);
            }
            await createServingRoles();
            writeFileSync(join(directory, 'upgrade-through-48-ledger.json'), JSON.stringify(upgradeLedger, null, 2));
            await beforeUpgradeFrom48({ directory, source, name: 'atlas_fixture_template', customerRole,
                customerUrl: url('atlas_fixture_template', 'customer', 'atlas_customer'), adminUrl: url('atlas_fixture_template'),
                staffUrl: url('atlas_fixture_template', true), operationsUrl: url('atlas_fixture_template', 'operations'),
                sql: (query, values = []) => sql(query, values, 'atlas_fixture_template') });
        }
        deploy('atlas_staff');
        const staffLedger = await ledger('atlas_staff');
        if (upgradeLedger) assert.deepEqual(staffLedger.slice(0, 48), upgradeLedger, 'Upgrade changed an existing successful migration ledger row');
        for (const [observed, declared] of [[publicLedger, source.publicMigrations], [staffLedger, source.staffMigrations]]) {
            assert.equal(observed.length, declared.length);
            for (const item of declared) {
                const rows = observed.filter(r => r.migration_name === item.name);
                assert.equal(rows.length, 1); assert.equal(rows[0].checksum, item.sha256);
                assert(rows[0].finished_at && !rows[0].rolled_back_at && rows[0].applied_steps_count > 0);
            }
        }
        assert.match(deploy('public'), /No pending migrations/);
        assert.match(deploy('atlas_staff'), /No pending migrations/);
        assert.deepEqual(await ledger('public'), publicLedger);
        assert.deepEqual(await ledger('atlas_staff'), staffLedger);
        assert.deepEqual(inventory(join(root, 'packages/database/prisma/migrations')), source.publicMigrations, 'Public migration files changed during validation');
        assert.deepEqual(inventory(join(appRoot, 'prisma/migrations')), source.staffMigrations, 'Staff migration files changed during validation');
        writeFileSync(join(directory, 'ledgers.json'), JSON.stringify({ publicLedger, staffLedger }, null, 2));
        // Upgrade acceptance must rely on migration49's existing ACL transfer;
        // regranting here would conceal a broken upgrade path. All existing
        // serving grants precede its snapshot, including the legacy staff path.
        if (!beforeUpgradeFrom48) await createServingRoles();
        let serial = 0; const released = [];
        return { directory, source, sql, url, role, safe, stop,
            async database() {
                const name = `atlas_fixture_case_${++serial}`;
                await sql(`CREATE DATABASE ${name} TEMPLATE atlas_fixture_template`);
                let disposed = false;
                return { name, adminUrl: url(name), staffUrl: url(name, true), publicUrl: url(name, 'public'), operatorUrl: url(name,'operator'),operationsUrl:url(name,'operations'),
                    customerUrl: url(name, 'customer', 'atlas_customer'),
                    async dispose() {
                        if (disposed) return;
                        assert.deepEqual(JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8')), sentinel);
                        assert.equal(statSync(directory).uid, process.getuid());
                        // The name is generated above and captured here; this
                        // method cannot accept an existing/shared database.
                        await sql(`DROP DATABASE ${name}`); await sql('CHECKPOINT'); disposed = true;
                        released.push({ name, ownedSyntheticDatabaseRemoved: true });
                        writeFileSync(join(directory, 'database-releases.json'), JSON.stringify(released));
                    } };
            } };
    } catch (error) {
        await stop();
        writeFileSync(join(directory, 'result.json'), JSON.stringify({ ok: false, stopped: true, error: safe(error.message) }));
        throw new Error(`Staff fixture failed; stopped cluster and retained evidence at ${directory}: ${safe(error.message)}`);
    }
}
