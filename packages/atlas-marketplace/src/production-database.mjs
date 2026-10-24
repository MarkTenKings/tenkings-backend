import { isIP } from 'node:net';
import { loadPinnedProofPostgresClient } from './proof-retention-postgres-connection.mjs';
import { engineDataOptions } from './proof-decoder-engine-json.mjs';
import { requireValue } from './contract.mjs';

const roles = Object.freeze({ atlas_proof_request: 'atlas_grading', atlas_proof_settler: 'atlas_grading',
    atlas_proof_revoker: 'atlas_grading', atlas_marketplace_writer: 'atlas_marketplace' });
const check = value => requireValue(value, 'PRODUCTION_DATABASE_REFUSED');

/** One bounded checkout per dedicated role; no ambient PG settings, admin
 * identity, shared auth pool, retry or caller-provided client/query factory.
 */
export function createProductionDatabasePool({ configuration, role, password } = {}) {
    const c = engineDataOptions(configuration, ['driverDirectory', 'endpoint']);
    const e = engineDataOptions(c.endpoint, ['hostname', 'port', 'ca']);
    check(Object.hasOwn(roles, role) && typeof password === 'string' && password.length >= 16 && password.length <= 4096 && !password.includes('\0')
        && typeof e.hostname === 'string' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(e.hostname) && !isIP(e.hostname)
        && Number.isInteger(e.port) && e.port > 0 && e.port <= 65535 && typeof e.ca === 'string' && e.ca.length <= 8192
        && e.ca.startsWith('-----BEGIN CERTIFICATE-----\n') && e.ca.trimEnd().endsWith('-----END CERTIFICATE-----'));
    const Client = loadPinnedProofPostgresClient(c.driverDirectory), secret = Buffer.from(password);
    let closed = false, active = null, connecting = false, pending = null, closing; const endings = new Set(), ended = new WeakMap();
    function end(client) {
        if (ended.has(client)) return ended.get(client);
        const done = Promise.resolve().then(() => client.end()); ended.set(client, done); endings.add(done);
        done.then(() => endings.delete(done), () => endings.delete(done)); return done;
    }
    return Object.freeze({
        async connect() {
            check(!closed && !active && !connecting); connecting = true;
            const ssl = { rejectUnauthorized: true, ca: e.ca, servername: e.hostname, minVersion: 'TLSv1.2' };
            const readPassword = () => { check(!closed); return secret.toString('utf8'); };
            const client = new Client({ host: e.hostname, port: e.port, database: roles[role], user: role, password: readPassword,
                ssl, options: '-c search_path=pg_catalog -c synchronous_commit=on', application_name: 'atlas-r2-production-v1',
                client_encoding: 'UTF8', binary: false, replication: false, connectionTimeoutMillis: 5000,
                statement_timeout: 15000, lock_timeout: 1500, idle_in_transaction_session_timeout: 5000,
                query_timeout: 20000, keepAlive: true, keepAliveInitialDelayMillis: 1000, enableChannelBinding: true });
            client.connectionParameters.binary = false; client.connectionParameters.replication = false; client.binary = false; client.replication = false;
            client.on('error', () => {});
            let complete; pending = new Promise(resolve => { complete = resolve; });
            try {
                await client.connect();
                check(!closed && client.connection.stream.encrypted === true && client.connection.stream.authorized === true);
                const { rows: [actual] } = await client.query("SELECT current_user AS role,current_database() AS database,current_setting('synchronous_commit') AS durable");
                check(actual?.role === role && actual.database === roles[role] && actual.durable === 'on');
                active = client; let released = false;
                client.release = () => { if (released) return; released = true; active = null; void end(client).catch(() => {}); };
                return client;
            } catch (error) { await end(client).catch(() => {}); throw error; }
            finally { connecting = false; complete(); pending = null; }
        },
        close() { return closing ??= (async () => {
            closed = true; secret.fill(0);
            if (pending) await pending;
            if (active) { const client = active; active = null; await end(client).catch(() => {}); }
            await Promise.allSettled([...endings]);
        })(); },
    });
}
