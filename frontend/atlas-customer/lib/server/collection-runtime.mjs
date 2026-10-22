// Default-off current collection reader. No import/construction I/O, migration,
// credentials fallback or writer capability. Caller owns the runtime lifetime.
import { CustomerAuth } from './auth.mjs';
import { deny } from './policy.mjs';
import { createCardOwnershipReadService } from '../../../../packages/atlas-connected-manual/src/card-ownership-read-service.mjs';

const unavailable = () => deny(503, 'COLLECTION_UNAVAILABLE');
const need = ok => { if (!ok) unavailable(); };
const empty = value => value === undefined || value === null || value === '';

/** Pure, server-only parsing. This does not create credentials, prove grants or
 * change CustomerControl. Production uses the same database/TLS endpoint as
 * CustomerAuth but a different role AND password. No alternate host/options.
 */
export function collectionConfiguration(settings, customerConfig) {
  need(settings && Object.getPrototypeOf(settings) === Object.prototype
    && Reflect.ownKeys(settings).length === 2 && ['enabled', 'databaseUrl'].every(key =>
      Object.hasOwn(Object.getOwnPropertyDescriptor(settings, key) ?? {}, 'value')));
  if (empty(settings.enabled) || settings.enabled === '0') { need(empty(settings.databaseUrl)); return null; }
  need(settings.enabled === '1' && typeof settings.databaseUrl === 'string' && settings.databaseUrl.length <= 2048
    && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(customerConfig?.mode));
  let reader, customer;
  try { reader = new URL(settings.databaseUrl); customer = new URL(customerConfig.databaseUrl); } catch { unavailable(); }
  const database = url => ['postgres:', 'postgresql:'].includes(url.protocol) && url.username && url.password
    && url.hostname && /^\/[A-Za-z0-9_.-]{1,100}$/.test(url.pathname) && !url.hash;
  need(database(reader) && database(customer) && reader.hostname === customer.hostname
    && (reader.port || '5432') === (customer.port || '5432') && reader.pathname === customer.pathname
    && customer.searchParams.get('schema') === 'atlas_customer');
  let readerUser, readerPassword, customerUser, customerPassword;
  try {
    [readerUser, readerPassword, customerUser, customerPassword] = [reader.username, reader.password, customer.username, customer.password].map(decodeURIComponent);
  } catch { unavailable(); }
  need(/^[a-z][a-z0-9_]{0,62}$/.test(readerUser) && readerUser !== 'public' && !readerUser.startsWith('pg_')
    && readerUser !== customerUser && readerPassword !== customerPassword
    && !/[\x00-\x20\x7f]/.test(readerPassword));
  need([...reader.searchParams.keys()].every(key => ['schema', 'sslmode'].includes(key) && reader.searchParams.getAll(key).length === 1)
    && reader.searchParams.get('schema') === 'atlas_ownership');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(reader.hostname);
  need(customerConfig.mode === 'PRODUCTION'
    ? !loopback && reader.searchParams.get('sslmode') === 'require' && customer.searchParams.get('sslmode') === 'require'
    : loopback && ['disable', null].includes(reader.searchParams.get('sslmode')));
  // Bound this additional pool independently; caller query parameters cannot
  // select another host, role, session setting or unbounded connection count.
  reader.searchParams.set('connection_limit', '2');
  reader.searchParams.set('pool_timeout', '3');
  reader.searchParams.set('connect_timeout', '5');
  return Object.freeze({ databaseUrl: reader.href });
}

/** Own exactly one lazily created restricted client. Existing CustomerAuth's
 * client is never reused. SQL independently validates session/current title;
 * this runtime pins the trusted capability/config across every awaited read.
 * The exposed reader has only read(), suitable for the existing GET/display
 * adapters. close() drains work and disposes once, with no automatic retries.
 */
export function createCollectionRuntime(options) {
  const { customerState: state, settings, createClient } = options ?? {};
  const auth = state?.auth, config = state?.config, guard = state?.assertRequest;
  const authority = CustomerAuth.prototype.authority, digest = CustomerAuth.prototype.digest;
  const configPin = () => JSON.stringify([config?.mode, config?.origin, config?.deploymentId, config?.releaseSha,
    config?.configHash, config?.databaseUrl, config?.binding, config?.cookies, config?.sessionKey,
    config?.routerKey, config?.deploymentHost]);
  let selected = null;
  try {
    need(auth instanceof CustomerAuth && auth.config === config && auth.authority === authority && auth.digest === digest
      && typeof guard === 'function' && typeof createClient === 'function');
    selected = collectionConfiguration(settings, config);
  } catch { /* Only collection is unavailable; ordinary customer routes work. */ }
  const encoded = configPin();
  const settingPin = JSON.stringify([settings?.enabled, settings?.databaseUrl]);
  let clientPromise = null, service = null, closed = false, closePromise = null, active = 0;
  const idle = new Set();
  function current() {
    need(!closed && selected && options.customerState === state && options.settings === settings && options.createClient === createClient
      && state.auth === auth && state.config === config && state.assertRequest === guard && auth.config === config
      && auth.authority === authority && auth.digest === digest && configPin() === encoded
      && JSON.stringify([settings?.enabled, settings?.databaseUrl]) === settingPin);
  }
  function client() {
    if (!clientPromise) clientPromise = Promise.resolve().then(async () => {
      current(); let value;
      try { value = await createClient(selected.databaseUrl); } catch { unavailable(); }
      const general = value === auth.database || value === auth.database?.client;
      if (!value || general || typeof value.$transaction !== 'function' || typeof value.$disconnect !== 'function') {
        if (value && !general && typeof value.$disconnect === 'function') {
          try { await Reflect.apply(value.$disconnect, value, []); } catch { unavailable(); }
        }
        unavailable();
      }
      // Retain disposal ownership even if close/config drift happened during
      // construction; the caller checks current() before any transaction.
      return { value, transaction: value.$transaction, disconnect: value.$disconnect };
    });
    return clientPromise;
  }
  const restricted = Object.freeze({ async $transaction(work, transactionOptions) {
    current();
    const owned = await client(); current();
    need(owned.value.$transaction === owned.transaction && owned.value.$disconnect === owned.disconnect);
    const result = await Reflect.apply(owned.transaction, owned.value, [work, transactionOptions]);
    current(); need(owned.value.$transaction === owned.transaction && owned.value.$disconnect === owned.disconnect);
    return result;
  } });
  if (selected) {
    try { service = createCardOwnershipReadService({ auth, client: restricted }); }
    catch { selected = null; }
  }
  const reader = Object.freeze({ async read(...args) {
    current(); active++;
    try { const result = await service.read(...args); current(); return result; }
    finally { if (--active === 0) { for (const resolve of idle) resolve(); idle.clear(); } }
  } });
  return Object.freeze({ reader, close() {
    if (!closePromise) {
      closed = true;
      closePromise = (async () => {
        if (active) await new Promise(resolve => idle.add(resolve));
        if (!clientPromise) return;
        let owned; try { owned = await clientPromise; } catch { return; }
        need(owned.value.$disconnect === owned.disconnect);
        try { await Reflect.apply(owned.disconnect, owned.value, []); } catch { unavailable(); }
      })();
    }
    return closePromise;
  } });
}
