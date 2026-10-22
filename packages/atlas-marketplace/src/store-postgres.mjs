import { AsyncLocalStorage } from 'node:async_hooks';
import { isAsyncFunction } from 'node:util/types';
import { canonicalJSON, clone, hash, requireValue } from './contract.mjs';
import { assertJournal } from './ledger.mjs';

export const POSTGRES_STORE_FORMAT = 'atlas-marketplace-v2';
export const emptyMarketplaceState = () => ({ listings: {}, reservations: {}, receipts: {}, journals: [], intents: {}, orders: {}, fulfillment: {}, events: [], consent: {} });

// The caller supplies an already configured dedicated pool. No connection URL,
// environment discovery, migration, role creation or retry is performed here.
export function createPostgresStore({ pool, environment, expectedRole, expectedDatabase, expectedFunctionOwner, clock = Date.now, enabled = false } = {}) {
  requireValue(enabled === true && pool?.connect && ['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(environment), 'POSTGRES_STORE_DISABLED');
  requireValue(typeof expectedRole === 'string' && expectedRole.length > 0 && typeof expectedDatabase === 'string' && expectedDatabase.length > 0, 'DATABASE_BINDING_REQUIRED');
  requireValue(typeof expectedFunctionOwner === 'string' && expectedFunctionOwner.length > 0 && expectedFunctionOwner !== expectedRole, 'DATABASE_FUNCTION_OWNER_REQUIRED');
  const allowedFunctions = new Set(['read_state()', 'lock_state()', 'commit_state(bigint, text, jsonb, text, bigint)']);
  const context = new AsyncLocalStorage(); let closed = false;
  async function acquire() {
    requireValue(!closed, 'STORE_CLOSED');
    const client = await pool.connect();
    try {
      const { rows: [row] } = await client.query('SELECT current_user AS role,current_database() AS database,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user');
      requireValue(row?.role === expectedRole && row.database === expectedDatabase && ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].every(key => row[key] === false), 'DATABASE_AUTHORITY_REFUSED');
      const { rows: [membership] } = await client.query('SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS present');
      requireValue(membership?.present === false, 'DATABASE_ROLE_MEMBERSHIP_REFUSED');
      // Check effective grants everywhere, including PUBLIC and column grants.
      // A dedicated writer may enter only the three reviewed gateway functions.
      const {rows:[privileges]}=await client.query(`SELECT
        has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
        has_schema_privilege(current_user,'atlas_marketplace','USAGE') AS gateway_usage,
        EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND (n.nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) OR has_schema_privilege(current_user,n.oid,'CREATE'))) AS schema_write,
        EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f')
          AND (c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
            OR has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
              AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES')))) AS direct_table,
        EXISTS(WITH sequences AS MATERIALIZED (
          SELECT c.oid,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
        ) SELECT 1 FROM sequences WHERE relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
          OR has_sequence_privilege(current_user,oid,'USAGE,SELECT,UPDATE')) AS sequence_access,
        EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS database_owner`);
      requireValue(privileges?.gateway_usage === true && ['database_create','schema_write','direct_table','sequence_access','database_owner'].every(key => privileges[key] === false), 'DATABASE_GRANTS_REFUSED');
      const { rows: routines } = await client.query(`SELECT n.nspname AS schema,
        p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' AS name,
        p.prosecdef AS definer,p.proconfig AS config,pg_catalog.pg_get_userbyid(p.proowner) AS owner
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND (p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
            OR has_function_privilege(current_user,p.oid,'EXECUTE'))`);
      requireValue(routines.length === allowedFunctions.size && new Set(routines.map(item => item.name)).size === allowedFunctions.size
        && routines.every(item => item.schema === 'atlas_marketplace' && allowedFunctions.has(item.name)
          && item.definer === true && item.owner === expectedFunctionOwner
          && Array.isArray(item.config) && item.config.length === 1 && item.config[0] === 'search_path=pg_catalog'), 'DATABASE_FUNCTION_GRANTS_REFUSED');
      return client;
    } catch (error) { client.release(); throw error; }
  }
  function decode(row) {
    requireValue(row?.format === POSTGRES_STORE_FORMAT && row.environment === environment && Number.isSafeInteger(Number(row.revision)), 'DATABASE_SCOPE_MISMATCH');
    requireValue(hash(row.document) === row.state_hash, 'STORE_CORRUPT');
    assertJournal(row.document.journals);
    return clone(row.document);
  }
  async function read(fn = value => value) {
    requireValue(typeof fn === 'function', 'INVALID_READ_CALLBACK');
    const client = await acquire();
    try { const { rows } = await client.query('SELECT * FROM atlas_marketplace.read_state()'); requireValue(rows.length === 1, 'STORE_UNINITIALIZED'); return clone(fn(decode(rows[0]))); }
    finally { client.release(); }
  }
  async function transaction(fn) {
    requireValue(typeof fn === 'function', 'INVALID_TRANSACTION_CALLBACK');
    requireValue(!isAsyncFunction(fn), 'ASYNC_TRANSACTION_REFUSED');
    requireValue(!context.getStore(), 'NESTED_TRANSACTION');
    const client = await acquire(); let began = false, commitAttempted = false, broken = false;
    try {
      await client.query('BEGIN'); began = true;
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
      const { rows: [row] } = await client.query('SELECT * FROM atlas_marketplace.lock_state()');
      const state = decode(row), prior = clone(state), now = clock();
      requireValue(Number.isSafeInteger(now) && now >= 0, 'INVALID_CLOCK');
      const tx = { state, now, emit(type,payload) { state.events.push({ sequence:state.events.length+1,type,payload:clone(payload),at:now,environment }); } };
      const result = context.run(true, () => fn(tx));
      if (result && typeof result.then === 'function') {
        // A non-async wrapper can still return a rejected Promise. Observe it
        // before refusing so rejection cannot escape after this rollback.
        Promise.resolve(result).catch(() => {});
        requireValue(false, 'ASYNC_TRANSACTION_REFUSED');
      }
      requireValue(state.journals.length >= prior.journals.length && hash(state.journals.slice(0,prior.journals.length)) === hash(prior.journals), 'JOURNAL_MUTATION');
      requireValue(state.events.length >= prior.events.length && hash(state.events.slice(0,prior.events.length)) === hash(prior.events), 'EVENT_MUTATION');
      assertJournal(state.journals);
      const stateHash = hash(state);
      if (stateHash !== row.state_hash) await client.query('SELECT atlas_marketplace.commit_state($1,$2,$3::jsonb,$4,$5)', [row.revision,row.state_hash,canonicalJSON(state),stateHash,now]);
      commitAttempted = true; await client.query('COMMIT'); began = false;
      return clone(result);
    } catch (error) {
      if (began && !commitAttempted) { try { await client.query('ROLLBACK'); } catch { broken=true; } }
      if (commitAttempted) { const unknown = new Error('Database commit outcome unknown; read the original durable request before any retry.'); unknown.code='STORE_COMMIT_UNKNOWN'; unknown.cause=error; throw unknown; }
      throw error;
    } finally { client.release(broken || commitAttempted && began); }
  }
  return Object.freeze({ read, transaction, close() { closed=true; } });
}
