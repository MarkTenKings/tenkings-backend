// Default-off server wiring. Import and construction perform no I/O. The sole
// owned client is created lazily after the qualified GET/auth/ingress boundary.
import { deny } from './policy.mjs';
import { createOwnershipLifecycleReadComposition } from './ownership-lifecycle-read-composition.mjs';

const unavailable = () => deny(503, 'OWNERSHIP_CLAIMS_UNAVAILABLE');
const need = ok => { if (!ok) unavailable(); };
const empty = value => value === undefined || value === null || value === '';

/** Pure, server-only parsing. This does not create credentials, prove grants or
 * change CustomerControl. Production uses the same database/TLS endpoint as
 * CustomerAuth but a different role AND password. No alternate host/options.
 */
export function ownershipHistoryConfiguration(settings, customerConfig) {
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
    && reader.searchParams.get('schema') === 'atlas_ownership_lifecycle_reader');
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

/** One instance per trusted customer runtime. Invalid/absent history settings
 * leave ordinary customer routes working and cause history reads to refuse.
 * createClient must return a NEW owned client with $transaction/$disconnect;
 * the actual database role is checked by the unchanged reader on EVERY call.
 * No connect/probe/grant or retry is performed here. close() is explicit,
 * idempotent, rejects new reads, waits for active reads, then disconnects once.
 */
export function createOwnershipHistoryRuntime({ customerState, settings, createClient }) {
  let selected = null;
  try { selected = ownershipHistoryConfiguration(settings, customerState?.config); } catch { /* History only is unavailable. */ }
  let clientPromise = null, closed = false, closePromise = null, active = 0;
  const idle = new Set();
  function client() {
    if (!clientPromise) clientPromise = Promise.resolve().then(async () => {
      need(!closed && selected && typeof createClient === 'function');
      let value;
      try { value = await createClient(selected.databaseUrl); } catch { unavailable(); }
      const general = value === customerState.auth.database || value === customerState.auth.database?.client;
      if (!value || general || typeof value.$transaction !== 'function' || typeof value.$disconnect !== 'function') {
        // A returned malformed owned client may still have disposable resources.
        // Retire it before refusing; never dispose a substituted general client.
        if (value && !general && typeof value.$disconnect === 'function') {
          try { await Reflect.apply(value.$disconnect, value, []); } catch { unavailable(); }
        }
        unavailable();
      }
      return { value, transaction: value.$transaction, disconnect: value.$disconnect };
    });
    return clientPromise;
  }
  const restricted = Object.freeze({ async $transaction(work, options) {
    need(!closed && selected); active++;
    try {
      const owned = await client();
      need(!closed && owned.value.$transaction === owned.transaction && owned.value.$disconnect === owned.disconnect);
      const result = await Reflect.apply(owned.transaction, owned.value, [work, options]);
      need(owned.value.$transaction === owned.transaction && owned.value.$disconnect === owned.disconnect);
      return result;
    } finally {
      if (--active === 0) { for (const resolve of idle) resolve(); idle.clear(); }
    }
  } });
  const composition = createOwnershipLifecycleReadComposition({ customerState, readerClient: restricted });
  return Object.freeze({ handler: composition.handler, close() {
    if (!closePromise) {
      closed = true;
      closePromise = (async () => {
        if (active) await new Promise(resolve => idle.add(resolve));
        if (!clientPromise) return;
        let owned; try { owned = await clientPromise; } catch { return; }
        // Never call a swapped disposal method or dispose the general client.
        need(owned.value.$disconnect === owned.disconnect);
        try { await Reflect.apply(owned.disconnect, owned.value, []); } catch { unavailable(); }
      })();
    }
    return closePromise;
  } });
}
