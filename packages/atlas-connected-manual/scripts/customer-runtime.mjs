import { S3Client } from '@aws-sdk/client-s3';
import { createPhotoStorage } from '@atlas/photo-storage';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createCustomerIntakeService } from '@atlas/customer-intake';
import { createCustomerIntakeRepository } from '@atlas/customer-intake/repository';
import { createCustomerIdentifier } from '@atlas/customer-intake/identification';
import { CommerceService } from '@atlas/commerce';
import { createCommerceProviders } from '@atlas/commerce/config';
import { GatewayCommerceRepository } from '@atlas/commerce/repository';
import { consumeStripeWebhook } from '@atlas/commerce/webhook';
import { createCustomerServiceHandler, CustomerServiceError } from '@atlas/service-bridge/customer-service';
import { identificationEffects } from '../src/identification.mjs';
import { createCustomerPrivateDatabase } from './customer-database.mjs';

const requireConfig = ok => { if (!ok) throw new CustomerServiceError(503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED'); };
function secret(value) {
  requireConfig(typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value));
  const key = Buffer.from(value, 'base64'); requireConfig(key.length === 32 && key.toString('base64') === value); return key;
}
function origin(value) { let url; try { url = new URL(value); } catch { requireConfig(false); } requireConfig(url.protocol === 'https:' && url.origin === value); return url.origin; }
export function customerServiceSettings(env) {
  if (env.ATLAS_CUSTOMER_SERVICE_ENABLED !== 'true') return null;
  requireConfig(!env.VERCEL && !env.AWS_LAMBDA_FUNCTION_NAME);
  let binding, database;
  try { binding = JSON.parse(env.ATLAS_CUSTOMER_SERVICE_BINDING_JSON); database = new URL(env.ATLAS_CUSTOMER_PRIVATE_DATABASE_URL); } catch { requireConfig(false); }
  requireConfig(binding && Object.keys(binding).length === 5 && binding.mode === 'PRODUCTION' && binding.origin === 'https://atlasgrading.com'
    && /^[a-z0-9-]+\.vercel\.app$/.test(binding.deploymentId) && /^[a-f0-9]{40}$/.test(binding.releaseSha) && /^[a-f0-9]{64}$/.test(binding.configHash));
  requireConfig(['postgres:', 'postgresql:'].includes(database.protocol) && database.username && database.password
    && database.pathname !== '/' && database.searchParams.get('schema') === 'atlas_customer' && database.searchParams.get('sslmode') === 'require' && !database.hash);
  const key = secret(env.ATLAS_CUSTOMER_SERVICE_KEY), directoryKey = env.ATLAS_CUSTOMER_DIRECTORY_KEY ? secret(env.ATLAS_CUSTOMER_DIRECTORY_KEY) : null;
  requireConfig(!directoryKey || !key.equals(directoryKey));
  for (const other of ['ATLAS_MANUAL_SERVICE_KEY','ATLAS_MANUAL_PUBLIC_READ_KEY','ATLAS_CUSTOMER_SESSION_KEY','ATLAS_CUSTOMER_PHONE_KEY','ATLAS_CUSTOMER_ROUTER_KEY'])
    if (env[other]) { requireConfig(!key.equals(Buffer.from(env[other], 'base64'))); if (directoryKey) requireConfig(!directoryKey.equals(Buffer.from(env[other], 'base64'))); }
  const intakeEnabled = env.ATLAS_CUSTOMER_INTAKE_ENABLED === 'true', identificationEnabled = env.ATLAS_CUSTOMER_IDENTIFICATION_ENABLED === 'true';
  requireConfig(!identificationEnabled || intakeEnabled);
  let storage = null;
  if (intakeEnabled) {
    requireConfig(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.ATLAS_CUSTOMER_STORAGE_BUCKET ?? '')
      && /^[a-z0-9-]{1,40}$/.test(env.ATLAS_CUSTOMER_STORAGE_REGION ?? '') && typeof env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY === 'string'
      && env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY.length >= 8 && typeof env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY === 'string' && env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY.length >= 16);
    storage = { endpoint: origin(env.ATLAS_CUSTOMER_STORAGE_ENDPOINT), uploadOrigin: origin(env.ATLAS_CUSTOMER_UPLOAD_ORIGIN),
      bucket: env.ATLAS_CUSTOMER_STORAGE_BUCKET, region: env.ATLAS_CUSTOMER_STORAGE_REGION };
  }
  return { binding, databaseUrl: database.href, key, directoryKey, intakeEnabled, identificationEnabled, storage };
}

/** Separate restricted customer service role, original session proofs, private
 * immutable photos, and a cold worker. No staff identity or financial writer. */
export function createServingCustomerService({ env, Client, onEvent = () => {} }) {
  const settings = customerServiceSettings(env); if (!settings) return null;
  const client = new Client({ datasources: { db: { url: settings.databaseUrl } }, errorFormat: 'minimal' });
  const database = createCustomerPrivateDatabase({ client, binding: settings.binding });
  const customerCall = (name, authority, input) => database.call('customer', { name, authority, input });
  const providers = createCommerceProviders(env);
  const commerce = authority => new CommerceService({ ...providers,
    repository: new GatewayCommerceRepository((name, input) => {
      if (name === 'commerce_checkout' && !providers.enabled) return customerCall(name, authority, input);
      return database.call('commerce', { name, providerBinding: providers.binding, input: { ...input, ...(authority ? { authority } : {}) } });
    }) });
  const workerCommerce = commerce(null);
  const handlers = {
    'dealer-locations': ({ input }) => database.call('directory', { input }),
    'commerce-checkout': ({ authority, input }) => commerce(authority).checkout(input.draftId),
    'commerce-quote': ({ authority, input }) => commerce(authority).quote(input),
    'commerce-pay': ({ authority, input }) => commerce(authority).pay(input),
    'commerce-reconcile': ({ authority, input }) => commerce(authority).reconcile(input.attemptId),
  };
  let objectClient = null, intake = null;
  if (settings.intakeEnabled) {
    objectClient = new S3Client({ region: settings.storage.region, endpoint: settings.storage.endpoint, maxAttempts: 1,
      credentials: { accessKeyId: env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY, secretAccessKey: env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY } });
    const base = createPhotoStorage({ client: objectClient, bucket: settings.storage.bucket, keyPrefix: 'atlas-customer',
      limits: { maxObjectBytes: 256 * 1024 * 1024, timeoutMs: 90000 } });
    const storage = { ...base, async createOriginalUpload(input) {
      const signed = await base.createOriginalUpload(input); requireConfig(new URL(signed.url).origin === settings.storage.uploadOrigin); return signed;
    } };
    const processPhoto = createPhotoProcessor({ storage, keyPrefix: 'atlas-customer',
      decodeLimits: { maxInputBytes: 64 * 1024 * 1024, maxPixels: 52_000_000, maxRasterBytes: 512 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024, timeoutMs: 90000 } });
    const effects = settings.identificationEnabled ? identificationEffects({ openaiKey: env.ATLAS_CUSTOMER_OPENAI_KEY, googleKey: env.ATLAS_CUSTOMER_GOOGLE_VISION_KEY }) : null;
    const identify = effects ? createCustomerIdentifier({
      readWorkingPhoto: async (frame, { photo }) => (await storage.readDecodedFrame({ frame, original: photo.original, decodePlan: photo.decodePlan })).bytes,
      ocr: async (request, context) => (await effects.ocr(request, { ...context, engineVersion: 'card-identification-v2' })).bytes,
      model: async (request, context) => (await effects.model(request, { ...context, engineVersion: 'card-identification-v2' })).bytes,
    }) : async () => { throw new CustomerServiceError(503, 'IDENTIFICATION_NOT_CONFIGURED'); };
    intake = createCustomerIntakeService({ repository: createCustomerIntakeRepository({ customerCall,
      workerCall: (name, input) => database.call('intake', { name, input }) }), storage, processPhoto, identify });
    handlers['intake-sign'] = ({ authority, input }) => intake.sign(authority, input);
    handlers['intake-complete'] = ({ authority, input }) => intake.complete(authority, input);
  }
  const signedHandler = createCustomerServiceHandler({ key: settings.key, directoryKey: settings.directoryKey, handlers });
  async function handler(req, res) {
    if (req.url !== '/internal/commerce/stripe-webhook') return signedHandler(req, res);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST' || !providers.enabled || !env.ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET) throw new CustomerServiceError(503, 'COMMERCE_NOT_CONFIGURED');
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 262144) throw new CustomerServiceError(413, 'REQUEST_TOO_LARGE'); parts.push(part); }
      const result = await consumeStripeWebhook({ rawBody: Buffer.concat(parts, size), signature: req.headers['stripe-signature'],
        secret: env.ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET, payment: providers.payment, repository: workerCommerce.repository });
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      res.end(JSON.stringify({ error: /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code ?? '') ? error.code : 'COMMERCE_UNAVAILABLE' })); }
    return true;
  }
  const loops = [];
  function loop(work) {
    let stopped = true, timer = null, inFlight = null, previousError = null;
    async function tick() {
      let delay = 2000;
      try { await work(); previousError = null; }
      catch (error) {
        const code = /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code ?? '') ? error.code : 'CUSTOMER_WORKER_UNAVAILABLE';
        if (code !== previousError) onEvent({ event: 'CUSTOMER_WORKER_PAUSED', code }); previousError = code; delay = 60000;
      } finally { if (!stopped) { timer = setTimeout(() => { inFlight = tick(); }, delay); timer.unref(); } }
    }
    const value = { start() { if (!stopped) return; stopped = false; inFlight = tick(); },
      async stop() { stopped = true; clearTimeout(timer); await inFlight; } };
    loops.push(value);
  }
  if (settings.identificationEnabled) loop(() => intake.runOnce());
  if (providers.enabled) loop(async () => {
    let firstError = null;
    const { effects = [] } = await workerCommerce.repository.call('commerce_pending_effects', {});
    for (const effect of effects) {
      try { await workerCommerce.runEffect(effect); } catch (error) { firstError ??= error; }
    }
    const recoveries = await workerCommerce.repository.call('commerce_reconcilable_effects', {});
    for (const effect of recoveries.effects ?? []) {
      try { await workerCommerce.reconcileEffect(effect); } catch (error) { firstError ??= error; }
    }
    if (firstError) throw firstError;
  });
  return { handler, binding: settings.binding,
    start() { for (const value of loops) value.start(); },
    async stopWorkers() { await Promise.all(loops.map(value => value.stop())); },
    async close() { await Promise.all(loops.map(value => value.stop())); objectClient?.destroy(); await client.$disconnect(); },
  };
}
