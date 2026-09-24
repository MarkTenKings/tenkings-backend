import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

// This is a single reviewed synthetic-fixture transport, not a general remote
// database option. Application/Prisma code stays local. No host credential or
// filesystem is mounted into the container, and no global Docker context moves.
export const REMOTE_POSTGRES_HOST = 'root@104.131.27.245';
export const REMOTE_POSTGRES_IMAGE = 'sha256:a2ea0e68c465e0acf4c3672471b22b6b62972bb341e6f31544c855d85ba43745';
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3'];
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export const remoteCommand = args => args.map(quote).join(' ');
const fullId = value => /^[a-f0-9]{64}$/.test(value ?? '');
// The existing authorized SSH login uses the local agent. Preserve only its
// socket reference for SSH; never broaden the database/client environment.
const sshEnv = env => ({ ...env, ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) });

export function createRemotePostgresTransport() {
    let nonce = null, ownedId = null, tunnel = null;
    const ssh = (args, options = {}) => spawnSync('ssh', [...sshOptions, REMOTE_POSTGRES_HOST, remoteCommand(args)], { ...options, env: sshEnv(options.env) });
    return {
        image: REMOTE_POSTGRES_IMAGE, architecture: 'amd64', host: REMOTE_POSTGRES_HOST,
        execute(args, options) {
            assert(Array.isArray(args) && args.every(value => typeof value === 'string'));
            let input, command = [...args];
            if (args[0] === 'create') {
                assert.equal(nonce, null, 'Only one owned container may be created per transport');
                const name = args[args.indexOf('--name') + 1];
                assert.match(name, /^atlas-fixture-[a-f0-9]{32}$/); nonce = name.slice('atlas-fixture-'.length);
                assert(args.includes(REMOTE_POSTGRES_IMAGE)); assert(args.includes('--pull=never'));
                const envIndex = args.indexOf('--env-file'); assert(envIndex > 0);
                const info = statSync(args[envIndex + 1]);
                assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o600); assert(info.isFile());
                input = readFileSync(args[envIndex + 1], 'utf8');
                assert.match(input, /^POSTGRES_USER=atlas_fixture_owner\nPOSTGRES_PASSWORD=[a-f0-9]{48}\nPGDATA=\/var\/lib\/postgresql\/data\/pgdata\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C\n$/);
                // Docker reads the synthetic environment from encrypted SSH
                // stdin; there is no remote secret file to leave or clean up.
                command[envIndex + 1] = '/dev/stdin';
            } else if (args[0] === 'context') {
                assert.deepEqual(args, ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']);
            } else if (args[0] === 'image') {
                assert.deepEqual(args, ['image', 'inspect', REMOTE_POSTGRES_IMAGE]);
            } else if (args[0] === 'inspect') {
                assert.equal(args.length, 2); assert(nonce, 'No existing container inspection is accepted by this transport');
                assert(args[1] === ownedId || args[1] === `atlas-fixture-${nonce}`);
            } else {
                assert(fullId(ownedId), 'No existing container action is accepted by this transport');
                const allowed = { start: ['start', ownedId], stop: ['stop', '--time=10', ownedId],
                    rm: ['rm', ownedId], logs: ['logs', '--tail=2000', '--timestamps', ownedId] };
                assert.deepEqual(args, allowed[args[0]], 'Only bounded actions on the captured owned ID are allowed');
            }
            const result = ssh(['docker', ...command], { ...options, input });
            if (args[0] === 'create' && fullId(result.stdout?.trim())) ownedId = result.stdout.trim();
            if (args[0] === 'inspect' && !ownedId && result.status === 0) {
                const inspected = JSON.parse(result.stdout)[0];
                assert.equal(inspected.Name, `/atlas-fixture-${nonce}`);
                assert.equal(inspected.Image, REMOTE_POSTGRES_IMAGE);
                assert.equal(inspected.Config?.Labels?.['com.atlas.disposable-postgres.nonce'], nonce);
                assert(fullId(inspected.Id)); ownedId = inspected.Id;
            }
            return result;
        },
        portAvailable(port, env) {
            assert(Number.isInteger(port) && port > 0 && port <= 65535);
            const result = ssh(['python3', '-c', 'import socket,sys; s=socket.socket(); s.bind(("127.0.0.1",int(sys.argv[1]))); s.close()', String(port)],
                { env, encoding: 'utf8', timeout: 15_000 });
            if (result.status === 0) return true;
            assert(result.status === 1 && result.stderr.includes('Address already in use'), 'Remote port preflight failed');
            return false;
        },
        startTunnel(port, env) {
            assert(fullId(ownedId) && !tunnel); assert(Number.isInteger(port) && port > 0 && port <= 65535);
            tunnel = spawn('ssh', [...sshOptions, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `127.0.0.1:${port}:127.0.0.1:${port}`, REMOTE_POSTGRES_HOST],
                { env: sshEnv(env), stdio: 'ignore' });
            // The caller's actual authenticated PostgreSQL readiness probe is
            // the tunnel success check; failed forwarding can never pass it.
            tunnel.on('error', () => {});
        },
        async stopTunnel() {
            if (!tunnel) return;
            const child = tunnel; tunnel = null;
            if (child.exitCode !== null || child.signalCode !== null) return;
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Owned SSH tunnel did not exit')); }, 10_000);
                child.once('exit', () => { clearTimeout(timeout); resolve(); });
                child.kill('SIGTERM');
            });
        },
    };
}
