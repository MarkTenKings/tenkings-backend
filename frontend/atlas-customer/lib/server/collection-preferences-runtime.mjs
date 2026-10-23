// Inert preference-only composition. No environment reads, imports of database
// constructors, connection/probe, grants, migrations, routes or provider calls.
import { CustomerAuth } from './auth.mjs';
import { deny } from './policy.mjs';
import { createCollectionPreferencesHandler } from './collection-preferences-http.mjs';
import { createCardOwnershipPreferencesService } from '../../../../packages/atlas-connected-manual/src/card-ownership-preferences-service.mjs';

const unavailable = () => deny(503, 'PREFERENCES_UNAVAILABLE');
const need = ok => { if (!ok) unavailable(); };
const empty = value => value === undefined || value === null || value === '';
const exact = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === names.length
  && names.every(name => Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, 'value'));
const roleName = name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(name)
  && name !== 'public' && !name.startsWith('pg_');
const methodNames = Object.freeze(['readAccess', 'readPreferences', 'readCard', 'setCollectionPreferences', 'setCardPreferences', 'recoverRequest']);

/** Pure configuration only. schemaOwner is an explicit reviewed installation
 * identity, never inferred from credentials or discovered from a database. */
export function collectionPreferencesConfiguration(settings, customerConfig) {
  need(exact(settings, ['enabled', 'databaseUrl', 'schemaOwner']));
  if (empty(settings.enabled) || settings.enabled === '0') {
    need(empty(settings.databaseUrl) && empty(settings.schemaOwner)); return null;
  }
  need(settings.enabled === '1' && typeof settings.databaseUrl === 'string' && settings.databaseUrl.length <= 2048
    && roleName(settings.schemaOwner) && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(customerConfig?.mode));
  let restricted, customer;
  try { restricted = new URL(settings.databaseUrl); customer = new URL(customerConfig.databaseUrl); } catch { unavailable(); }
  const database = url => ['postgres:', 'postgresql:'].includes(url.protocol) && url.username && url.password
    && url.hostname && /^\/[A-Za-z0-9_.-]{1,100}$/.test(url.pathname) && !url.hash;
  need(database(restricted) && database(customer) && restricted.hostname === customer.hostname
    && (restricted.port || '5432') === (customer.port || '5432') && restricted.pathname === customer.pathname);
  const params = (url, names) => [...url.searchParams.keys()].every(name => names.includes(name) && url.searchParams.getAll(name).length === 1);
  need(params(restricted, ['schema', 'sslmode']) && restricted.searchParams.get('schema') === 'atlas_ownership_preferences'
    && params(customer, ['schema', 'sslmode', 'connection_limit', 'pool_timeout', 'connect_timeout'])
    && customer.searchParams.get('schema') === 'atlas_customer');
  let servingRole, servingPassword, customerRole, customerPassword;
  try { [servingRole, servingPassword, customerRole, customerPassword] =
    [restricted.username, restricted.password, customer.username, customer.password].map(decodeURIComponent); } catch { unavailable(); }
  need(roleName(servingRole) && servingRole !== customerRole && servingRole !== settings.schemaOwner
    && servingPassword !== customerPassword && !/[\x00-\x20\x7f]/.test(servingPassword));
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(restricted.hostname);
  need(customerConfig.mode === 'PRODUCTION'
    ? !loopback && restricted.searchParams.get('sslmode') === 'require' && customer.searchParams.get('sslmode') === 'require'
    : loopback && ['disable', null].includes(restricted.searchParams.get('sslmode')));
  restricted.searchParams.set('connection_limit', '2');
  restricted.searchParams.set('pool_timeout', '3');
  restricted.searchParams.set('connect_timeout', '5');
  return Object.freeze({ databaseUrl: restricted.href, servingRole, schemaOwner: settings.schemaOwner });
}

/** Own one lazy client from the explicit factory. A missing/invalid config
 * returns preferences:null. Ordinary customer routes are outside this module.
 * close() rejects new work, drains in-flight work and disposes only this client.
 * No abort/close error is evidence that an already committed save did not occur.
 */
export function createCollectionPreferencesRuntime(options) {
  const shaped = exact(options, ['customerState', 'settings', 'createClient']);
  const state = shaped ? options.customerState : null, settings = shaped ? options.settings : null, createClient = shaped ? options.createClient : null;
  const auth = state?.auth, config = state?.config, guard = state?.assertRequest;
  const generalDatabase = auth?.database, generalClient = generalDatabase?.client;
  const authority = CustomerAuth.prototype.authority, digest = CustomerAuth.prototype.digest;
  const configPin = () => JSON.stringify([config?.mode, config?.origin, config?.deploymentId, config?.releaseSha,
    config?.configHash, config?.databaseUrl, config?.binding, config?.cookies, config?.sessionKey, config?.routerKey, config?.deploymentHost]);
  const settingsPin = () => JSON.stringify([settings?.enabled, settings?.databaseUrl, settings?.schemaOwner]);
  let selected = null, encoded = null, selectedPin = null;
  try {
    need(auth instanceof CustomerAuth && auth.config === config && auth.authority === authority && auth.digest === digest
      && typeof guard === 'function' && typeof createClient === 'function');
    selected = collectionPreferencesConfiguration(settings, config);
    if (selected) { encoded = configPin(); selectedPin = settingsPin(); }
  } catch { selected = null; }
  let closed = false, active = 0, clientPromise = null, ownedClient = null, closePromise = null, service = null, failedDisposal = false;
  const idle = new Set();
  function current() {
    need(!closed && selected && options.customerState === state && options.settings === settings && options.createClient === createClient
      && state.auth === auth && state.config === config && state.assertRequest === guard && auth.config === config
      && auth.authority === authority && auth.digest === digest && auth.database === generalDatabase && auth.database?.client === generalClient
      && configPin() === encoded && settingsPin() === selectedPin
      && (!ownedClient || ownedClient.value.$transaction === ownedClient.transaction && ownedClient.value.$disconnect === ownedClient.disconnect));
  }
  function client() {
    if (!clientPromise) clientPromise = Promise.resolve().then(async () => {
      current(); let value;
      try { value = await createClient(selected.databaseUrl); } catch { unavailable(); }
      const general = value === generalDatabase || value === generalClient || value === auth.database || value === auth.database?.client;
      if (!value || general || typeof value.$transaction !== 'function' || typeof value.$disconnect !== 'function') {
        // A malformed newly owned result can still own resources. Never close
        // the ordinary customer client, and never retry a failed construction.
        if (value && !general && typeof value.$disconnect === 'function') {
          try { await Reflect.apply(value.$disconnect, value, []); } catch { failedDisposal = true; unavailable(); }
        }
        unavailable();
      }
      ownedClient = { value, transaction: value.$transaction, disconnect: value.$disconnect };
      return ownedClient;
    });
    return clientPromise;
  }
  const restricted = Object.freeze({ async $transaction(work, transactionOptions) {
    current(); const owned = await client();
    const bound = () => { current(); need(owned.value.$transaction === owned.transaction && owned.value.$disconnect === owned.disconnect); };
    bound();
    const result = await Reflect.apply(owned.transaction, owned.value, [async tx => {
      bound();
      const query = tx?.$queryRawUnsafe, execute = tx?.$executeRawUnsafe;
      need(typeof query === 'function' && typeof execute === 'function');
      const txCurrent = () => { bound(); need(tx.$queryRawUnsafe === query && tx.$executeRawUnsafe === execute); };
      const guarded = Object.freeze({
        async $queryRawUnsafe(...args) { txCurrent(); const value = await Reflect.apply(query, tx, args); txCurrent(); return value; },
        async $executeRawUnsafe(...args) { txCurrent(); const value = await Reflect.apply(execute, tx, args); txCurrent(); return value; },
      });
      const value = await work(guarded); txCurrent(); return value;
    }, transactionOptions]);
    // A rejection here may follow commit; the unchanged HTTP/controller keep
    // the original immutable request UNKNOWN until exact recovery or retry.
    bound(); return result;
  } });
  if (selected) {
    try { service = createCardOwnershipPreferencesService({ customerAuth: auth, client: restricted,
      servingRole: selected.servingRole, schemaOwner: selected.schemaOwner }); } catch { selected = null; }
  }
  let preferences = selected && service ? Object.freeze(Object.fromEntries(methodNames.map(name => [name, async (...args) => {
    current(); active++;
    try { const result = await service[name](...args); current(); return result; }
    finally { if (--active === 0) { for (const resolve of idle) resolve(); idle.clear(); } }
  }]))) : null;
  // Created once against this exact frozen capability and trusted state. Every
  // operation starts with its live readAccess method, which checks current().
  let handler = null;
  if (preferences) {
    try { handler = createCollectionPreferencesHandler({ customerState: state, preferences }); }
    catch { service.close(); selected = null; preferences = null; }
  }
  return Object.freeze({ preferences, handler, get configuredForDisplay() {
    // Display discovery only. No role query, session authority or readiness claim.
    if (!preferences) return false;
    try { current(); return true; } catch { return false; }
  }, close() {
    if (!closePromise) {
      closed = true; service?.close();
      closePromise = (async () => {
        if (active) await new Promise(resolve => idle.add(resolve));
        if (!clientPromise) return;
        let owned; try { owned = await clientPromise; } catch { if (failedDisposal) unavailable(); return; }
        need(owned.value.$disconnect === owned.disconnect);
        try { await Reflect.apply(owned.disconnect, owned.value, []); } catch { unavailable(); }
      })();
    }
    return closePromise;
  } });
}
