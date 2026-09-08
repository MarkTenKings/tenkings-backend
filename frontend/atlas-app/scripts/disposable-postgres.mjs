import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../lib/server/policy.mjs';
import { staffGrantSQL } from '../lib/server/access/privileges.mjs';
import { publicGrantSQL } from '../../atlas-public/lib/server/privileges.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(appRoot, '../..');
const cleanEnv = { HOME: process.env.HOME ?? tmpdir(), PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C',
    PRISMA_HIDE_UPDATE_MESSAGE: '1', NEXT_TELEMETRY_DISABLED: '1' };

/** This helper accepts binaries, never an existing database or data directory. */
export async function disposablePostgres(args) {
    for (let i = 0; i < args.length; i++) {
        if (['--postgres-bin', '--pg-module'].includes(args[i])) { assert(args[++i] && !args[i].startsWith('--')); continue; }
        assert(['--ack-disposable-local-postgres', '--serve'].includes(args[i]), 'Unknown disposable fixture argument');
    }
    assert(args.includes('--ack-disposable-local-postgres'), 'Explicit disposable fixture acknowledgement required');
    assert(!Object.keys(process.env).some(k => /^(DATABASE_URL|DIRECT_URL|ATLAS_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATA|PGSERVICE|PGSERVICEFILE)$/.test(k)), 'Refusing inherited database configuration');
    const option = flag => { const index = args.indexOf(flag); assert(index >= 0 && args[index + 1]); return realpathSync(args[index + 1]); };
    const bin = option('--postgres-bin'), pgModule = option('--pg-module');
    const { Client } = createRequire(import.meta.url)(pgModule);
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-staff-db-')));
    const data = join(directory, 'data'), owner = 'atlas_fixture_owner', role = 'atlas_fixture_staff';
    const ownerPassword = randomBytes(24).toString('hex'), staffPassword = randomBytes(24).toString('hex'), publicPassword = randomBytes(24).toString('hex');
    const publicRole = 'atlas_fixture_public';
    const passwordFile = join(directory, 'owner-password');
    writeFileSync(passwordFile, ownerPassword, { mode: 0o600 });
    const sentinel = { nonce: randomBytes(16).toString('hex'), data, ownerPid: process.pid, uid: process.getuid(), createdByHarness: true };
    writeFileSync(join(directory, 'ownership.json'), JSON.stringify(sentinel), { mode: 0o600 });
    let log = '', started = false;
    const safe = value => String(value).replaceAll(ownerPassword, '[fixture-password]').replaceAll(staffPassword, '[fixture-password]').replaceAll(publicPassword, '[fixture-password]');
    function run(command, commandArgs, env = cleanEnv) {
        const result = spawnSync(command, commandArgs, { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        log += safe(`${result.stdout ?? ''}${result.stderr ?? ''}`);
        writeFileSync(join(directory, 'validation.log'), log, { mode: 0o600 });
        if (result.error || result.status !== 0) throw new Error(safe(result.error?.message ?? result.stderr ?? 'Fixture child failed'));
        return result.stdout;
    }
    const port = await new Promise((done, reject) => {
        const socket = createServer().once('error', reject);
        socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(error => error ? reject(error) : done(value)); });
    });
    function url(database, staff = false, schema = 'atlas_staff') {
        assert(/^[a-z][a-z0-9_]+$/.test(database));
        return `postgresql://${staff === 'public' ? publicRole : staff ? role : owner}:${staff === 'public' ? publicPassword : staff ? staffPassword : ownerPassword}@127.0.0.1:${port}/${database}?schema=${schema}&connection_limit=4`;
    }
    async function sql(query, values = [], database = 'postgres') {
        const client = new Client({ connectionString: url(database, false, 'public') });
        await client.connect();
        try { return await client.query(query, values); } finally { await client.end(); }
    }
    async function stop() {
        assert.deepEqual(JSON.parse(readFileSync(join(directory, 'ownership.json'), 'utf8')), sentinel);
        assert.equal(statSync(directory).uid, process.getuid());
        if (started) {
            const status = spawnSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: cleanEnv, encoding: 'utf8' });
            if (status.status === 0) run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
            else assert.equal(status.status, 3, 'Unknown fixture cluster status');
            assert.equal(spawnSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: cleanEnv }).status, 3);
            assert.equal(realpathSync(data), data);
            rmSync(data, { recursive: true });
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
        run(join(bin, 'initdb'), ['-D', data, '--username', owner, '--pwfile', passwordFile, '--auth-host=scram-sha-256', '--auth-local=reject', '--encoding=UTF8', '--locale=C']);
        started = true;
        run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start']);
        const settings = (await sql("SELECT current_setting('data_directory') AS data, current_setting('listen_addresses') AS host")).rows[0];
        assert.deepEqual(settings, { data, host: '127.0.0.1' });
        await sql('CREATE DATABASE atlas_fixture_template');
        const cli = join(appRoot, 'node_modules/prisma/build/index.js');
        const deploy = (scope, database = 'atlas_fixture_template') => {
            const schema = scope === 'public' ? join(root, 'packages/database/prisma/schema.prisma') : join(appRoot, 'prisma/schema.prisma');
            return run(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], { ...cleanEnv,
                [scope === 'public' ? 'DATABASE_URL' : 'ATLAS_DATABASE_URL']: url(database, false, scope) });
        };
        const ledger = async scope => (await sql(`SELECT * FROM ${scope}."_prisma_migrations" ORDER BY migration_name,id`, [], 'atlas_fixture_template')).rows;
        deploy('public');
        const publicLedger = await ledger('public');
        deploy('atlas_staff');
        const staffLedger = await ledger('atlas_staff');
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
        writeFileSync(join(directory, 'ledgers.json'), JSON.stringify({ publicLedger, staffLedger }, null, 2));
        // This brand-new role exists only inside this owned disposable cluster.
        await sql(`CREATE ROLE ${role} LOGIN PASSWORD '${staffPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        await sql(staffGrantSQL(role), [], 'atlas_fixture_template');
        await sql(`CREATE ROLE ${publicRole} LOGIN PASSWORD '${publicPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        await sql(publicGrantSQL(publicRole), [], 'atlas_fixture_template');
        let serial = 0;
        return { directory, source, sql, url, role, safe, stop,
            async database() {
                const name = `atlas_fixture_case_${++serial}`;
                await sql(`CREATE DATABASE ${name} TEMPLATE atlas_fixture_template`);
                return { name, adminUrl: url(name), staffUrl: url(name, true), publicUrl: url(name, 'public') };
            } };
    } catch (error) {
        await stop();
        writeFileSync(join(directory, 'result.json'), JSON.stringify({ ok: false, stopped: true, error: safe(error.message) }));
        throw new Error(`Staff fixture failed; stopped cluster and retained evidence at ${directory}: ${safe(error.message)}`);
    }
}
