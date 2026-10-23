// Native-only, default-off composition. No environment reads, clients, storage,
// listener, grants or workers on import/construction. Host registration is separate.
import { requireThat } from '@atlas/manual-service/contract';
import { createDurableStaffBoundary } from '../../atlas-manual-service/src/staff-auth.mjs';
import { createIntakeRepository } from '../../atlas-manual-intake/src/repository.mjs';
import { DurableStaffAuth } from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import { createStaffCompCurationPrivateAdapter } from '../../../frontend/atlas-app/lib/server/staff-comp-curation-private-adapter.mjs';
import { compTransportRoute } from '../../../frontend/atlas-app/lib/staff-comp-curation-transport-contract.mjs';
import { failure } from '../../../frontend/atlas-app/lib/server/staff-comp-curation-transport-boundary.mjs';
import { compEvidenceSelectionPolicy } from './comp-curation-contract.mjs';
import { createCompCurationDatabase, COMP_EVIDENCE_GUARD_VERSION } from './comp-curation-database.mjs';
import { createPublicationRepository } from './publication-repository.mjs';
import { createManualFinishing } from './finishing.mjs';

const refuse = ok => requireThat(ok, 503, 'COMP_NOT_CONFIGURED');
const keys = ['enabled', 'environment', 'auth', 'staffConfig', 'settings', 'createClient', 'artifactReader', 'nonceStore'];
const settingKeys = ['databaseUrl', 'role', 'schemaOwner', 'schemaSha256', 'origin', 'transportKey'];
const optionalSettingKeys = ['guardVersion', 'selectionPolicy', 'archiveCompAccess'];
const allSettingKeys = [...settingKeys, ...optionalSettingKeys];
const name = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value) && value !== 'public' && !value.startsWith('pg_');
const exactKeys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).every(key => allowed.includes(key));
const fields = ['mode', 'application', 'origin', 'basePath', 'deploymentId', 'releaseSha', 'configHash', 'databaseUrl'];
function configPin(config) {
  const values = fields.map(key => config[key]), cookies = config.cookies, cookieText = JSON.stringify(cookies);
  const phoneByHash = config.phoneByHash, phones = JSON.stringify([...phoneByHash]);
  const keyBytes = ['sessionKey', 'phoneKey', 'routerKey'].map(key => [key, config[key], Buffer.from(config[key])]);
  return () => fields.every((key, index) => config[key] === values[index]) && config.cookies === cookies
    && JSON.stringify(cookies) === cookieText && config.phoneByHash === phoneByHash && JSON.stringify([...phoneByHash]) === phones
    && keyBytes.every(([key, original, bytes]) => config[key] === original && original.equals(bytes));
}

export function createNativeCompCurationRuntime(options = {}) {
  if (options?.enabled !== true) return null;
  refuse(exactKeys(options, keys));
  const { environment, auth, staffConfig, settings, createClient, artifactReader, nonceStore } = options;
  refuse(environment && typeof environment === 'object' && !environment.VERCEL && !environment.AWS_LAMBDA_FUNCTION_NAME);
  refuse(auth instanceof DurableStaffAuth && auth.config === staffConfig && auth.actors instanceof WeakMap
    && staffConfig?.application === 'atlas-staff' && staffConfig.basePath === '/admin'
    && staffConfig.phoneByHash instanceof Map && staffConfig.cookies && typeof createClient === 'function');
  const authNames = ['authenticate', 'maybeAuthenticate', 'current', 'actor', 'digest', 'jar'];
  refuse(authNames.every(key => auth[key] === DurableStaffAuth.prototype[key]));
  refuse(['sessionKey', 'phoneKey', 'routerKey'].every(key => Buffer.isBuffer(staffConfig[key]) && staffConfig[key].length === 32));
  refuse(exactKeys(settings, allSettingKeys) && settingKeys.every(key => Object.hasOwn(settings, key))
    && name(settings.role) && name(settings.schemaOwner) && settings.role !== settings.schemaOwner
    && /^[a-f0-9]{64}$/.test(settings.schemaSha256 ?? ''));
  const { databaseUrl, role, schemaOwner, schemaSha256, origin, transportKey } = settings;
  const guardVersion = settings.guardVersion === undefined ? 'SQL011' : settings.guardVersion;
  const selectionPolicy = settings.selectionPolicy === undefined ? null : settings.selectionPolicy;
  const archiveCompAccess = settings.archiveCompAccess === undefined ? false : settings.archiveCompAccess;
  refuse(['SQL011', COMP_EVIDENCE_GUARD_VERSION].includes(guardVersion) && typeof archiveCompAccess === 'boolean');
  const selection = compEvidenceSelectionPolicy(selectionPolicy);
  refuse(selection === null || guardVersion === COMP_EVIDENCE_GUARD_VERSION);
  const optionalPins = optionalSettingKeys.map(key => [key, settings[key]]), policyText = JSON.stringify(selectionPolicy);
  let dbUrl, authUrl, publicUrl;
  try { dbUrl = new URL(databaseUrl); authUrl = new URL(staffConfig.databaseUrl); publicUrl = new URL(origin); } catch { refuse(false); }
  refuse(['postgres:', 'postgresql:'].includes(dbUrl.protocol) && ['postgres:', 'postgresql:'].includes(authUrl.protocol)
    && dbUrl.hostname === authUrl.hostname && (dbUrl.port || '5432') === (authUrl.port || '5432') && dbUrl.pathname === authUrl.pathname
    && dbUrl.pathname !== '/' && dbUrl.password && decodeURIComponent(dbUrl.username) === role
    && decodeURIComponent(authUrl.username) !== role && dbUrl.hash === ''
    && dbUrl.searchParams.get('schema') === 'atlas_manual'
    && [...dbUrl.searchParams.keys()].every(key => ['schema', 'sslmode'].includes(key))
    && new Set(dbUrl.searchParams.keys()).size === [...dbUrl.searchParams.keys()].length
    && (staffConfig.mode !== 'PRODUCTION' || dbUrl.searchParams.get('sslmode') === 'require'));
  refuse(origin === staffConfig.origin && publicUrl.origin === origin
    && (publicUrl.protocol === 'https:' || staffConfig.mode !== 'PRODUCTION' && publicUrl.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(publicUrl.hostname)));
  refuse(Buffer.isBuffer(transportKey) && transportKey.length === 32
    && ['sessionKey', 'phoneKey', 'routerKey'].every(key => !transportKey.equals(staffConfig[key])));
  refuse(exactKeys(artifactReader, ['read']) && typeof artifactReader.read === 'function'
    && nonceStore && typeof nonceStore.consume === 'function');
  const readArtifact = artifactReader.read, consume = nonceStore.consume, keyCopy = Buffer.from(transportKey);
  const database = auth.database, actors = auth.actors, authClient = database?.client,
    dbTransaction = database?.transaction, dbRead = database?.readTransaction;
  refuse(typeof dbTransaction === 'function' && (dbRead === undefined || typeof dbRead === 'function'));
  const authMethods = authNames.map(key => [key, auth[key]]), configCurrent = configPin(staffConfig);
  let closing = false, closed = false, initializationFailed = false, client, transaction, disconnect, initialization, closingPromise;
  const active = new Set();
  const current = () => {
    refuse(!closed && !initializationFailed && exactKeys(options, keys) && options.enabled === true && options.environment === environment
      && !environment.VERCEL && !environment.AWS_LAMBDA_FUNCTION_NAME && options.auth === auth && options.staffConfig === staffConfig
      && auth.config === staffConfig && auth.actors === actors && auth.database === database
      && database.client === authClient && database.transaction === dbTransaction && database.readTransaction === dbRead
      && authMethods.every(([key, fn]) => auth[key] === fn) && configCurrent()
      && options.settings === settings && exactKeys(settings, allSettingKeys)
      && settings.databaseUrl === databaseUrl && settings.role === role && settings.schemaOwner === schemaOwner
      && optionalPins.every(([key,value]) => settings[key] === value) && JSON.stringify(selectionPolicy) === policyText
      && settings.schemaSha256 === schemaSha256 && settings.origin === origin && settings.transportKey === transportKey && transportKey.equals(keyCopy)
      && options.createClient === createClient && options.artifactReader === artifactReader && artifactReader.read === readArtifact
      && exactKeys(artifactReader, ['read']) && options.nonceStore === nonceStore && nonceStore.consume === consume
      && (!client || client.$transaction === transaction && client.$disconnect === disconnect));
  };
  const owned = () => initialization ??= Promise.resolve().then(async () => {
    current();
    // Initialization is single-flight and retained on failure. Capture the
    // owned cleanup before validating the transaction method, including an
    // asynchronously supplied invalid candidate. Never own the staff client.
    const value = await Reflect.apply(createClient, undefined, [{ databaseUrl }]);
    if (value && value !== authClient && typeof value.$disconnect === 'function') {
      client = value; transaction = value.$transaction; disconnect = value.$disconnect;
    }
    refuse(client === value && typeof transaction === 'function'); current(); return value;
  }).catch(error => { initializationFailed = true; throw error; });
  const db = createCompCurationDatabase({ role, schemaOwner, schemaSha256, guardVersion, client: Object.freeze({
    async $transaction(work, transactionOptions) {
      current(); const value = await owned(); current();
      const result = await Reflect.apply(transaction, value, [async tx => {
        current(); const output = await work(tx); current(); return output;
      }, transactionOptions]);
      current(); return result;
    },
  }) });
  const boundary = createDurableStaffBoundary({ auth, manualClient: db });
  const intake = createIntakeRepository({ boundary, keyPrefix: 'comp-curation-read-only', maxOriginalBytes: 1 });
  const validateAccess = async context => { current(); await intake.assertActiveInTransaction(context.tx, context.cardId); current(); };
  const artifacts = Object.freeze({ async read(ref, expected, readOptions = {}) {
    current(); refuse(['PUBLIC_REPORT', 'MARKET_PREVIEW'].includes(expected?.kind) && ref?.kind === expected.kind);
    const signal = readOptions.signal ? AbortSignal.any([readOptions.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    signal.throwIfAborted();
    const result = await Reflect.apply(readArtifact, artifactReader, [ref, expected, { signal }]);
    signal.throwIfAborted(); current(); return result;
  } });
  const repository = createPublicationRepository({ boundary, validateAccess });
  const finishing = createManualFinishing({ repository: Object.freeze({ load: repository.load }), artifacts });
  const adapter = createStaffCompCurationPrivateAdapter({ enabled: true, key: keyCopy, origin, nonceStore,
    native: { environment, auth: Object.freeze({ async authenticate(...args) {
      current(); const value = await Reflect.apply(authMethods[0][1], auth, args); current(); return value;
    } }), boundary, approved: Object.freeze({ loadPacket: finishing.loadPacket }), artifacts, validateAccess, selectionPolicy, archiveCompAccess } });
  current();
  return Object.freeze({
    get configuredForDisplay() { try { current(); return !closing; } catch { return false; } },
    async handler(req, res) {
      if (!compTransportRoute(req.url, { privateAlias: true })) return false;
      try {
        current(); refuse(!closing); requireThat(active.size < 2, 503, 'COMP_BUSY');
        const work = Promise.resolve().then(() => { current(); return adapter.handler(req, res); }); active.add(work);
        try { return await work; } finally { active.delete(work); }
      } catch (error) { failure(res, error); return true; }
    },
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      closingPromise = (async () => {
        await Promise.allSettled([...active]);
        if (initialization) await Promise.allSettled([initialization]);
        closed = true; adapter.close(); db.close();
        if (client) await Reflect.apply(disconnect, client, []);
      })();
      return closingPromise;
    },
  });
}
