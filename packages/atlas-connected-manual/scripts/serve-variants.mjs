import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { privateManualAccessConfig } from '../../../frontend/atlas-app/lib/server/access/config.mjs';
import { createServingConnectedManual } from '../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
import { variantWorkerSettings, variantWorkerEnvironment } from '../../../frontend/atlas-app/lib/server/variant-runtime-settings.mjs';
import sharp from 'sharp';
import { createAtlasCatalogClient } from '../src/research-catalog.mjs';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import { createVariantListingProvider } from '../src/variant-listing-provider.mjs';
import { createVariantPhotoProvider, projectVariantPhotoResponse } from '../src/variant-photo-provider.mjs';
import { createVariantWorker } from '../src/variant-worker.mjs';
import { createVariantAdmission } from '../src/variant-admission.mjs';
import { createVariantRecheck } from '../src/variant-recheck.mjs';
import { createVariantReferenceContribution } from '../src/variant-reference-contribution.mjs';

// Separate process entry point. Never imported by Next.js or the grading host.
// No HTTP listener, batch start, original grading dequeue or report approval.
const env = process.env, settings = variantWorkerSettings(env), config = privateManualAccessConfig(env);
// This entry point runs in its own CPU/memory-limited container. One libvips
// thread and a small cache bound reference/source image processing as well.
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });
const auth = Object.freeze({ config, actors: new WeakMap(),
  async authenticate() { throw Error('Variant worker cannot authenticate browser sessions'); } });
const onError = error => console.log(JSON.stringify({ event: 'VARIANT_BACKGROUND_STATUS',
  code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'VARIANT_BACKGROUND_INTERRUPTED' }));
const runtime = createServingConnectedManual({ env: variantWorkerEnvironment(env, settings), auth,
  staffConfig: config, Client: PrismaClient, assertRequest() { throw Error('Variant worker has no HTTP authority'); }, onWorkerError: onError });
await runtime.validateConfiguration();
const connected = runtime.connected, store = connected.variantJobs;
const listingProvider = settings.listingApiKey ? createVariantListingProvider({ apiKey: settings.listingApiKey, cache: store.cache }) : null;
const catalog = createVariantCatalogService({ catalogClient: settings.catalogToken ? createAtlasCatalogClient({ token: settings.catalogToken }) : null,
  cache: store.cache, scrydex: settings.scrydex, listingProvider });
const provider = createVariantPhotoProvider({ apiKey: settings.apiKey, readReferenceImage: catalog.readImage });
const admitDispatch = createVariantAdmission({ boundary: runtime.boundary });
const recheck = createVariantRecheck({ store, boundary: runtime.boundary, workflow: connected.workflow, assistance: connected.assistance, onError, admitDispatch });
const contributeReference=createVariantReferenceContribution({store,artifacts:runtime.variantArtifacts,boundary:runtime.boundary,
  workflow:connected.workflow,loadPhotos:runtime.readVariantPhotos,catalog});
async function backgroundMaintenance() {
  await recheck();
  if (!settings.catalogToken) return;
  const job = await store.claimContribution();
  if (!job) return;
  try {
    const metadata = await catalog.submitObservation(job.payload, { signal: AbortSignal.timeout(15000) });
    const reference=await contributeReference(job,{signal:AbortSignal.timeout(35000)});
    const receipt={metadata,reference};
    await store.finishContribution(job, { receipt });
  } catch (error) {
    onError(error);
    await store.finishContribution(job, { code: 'VARIANT_CONTRIBUTION_RETRY' });
  }
}
const worker = createVariantWorker({ store, catalog, loadPhotos: runtime.readVariantPhotos, provider,
  projectResponse: projectVariantPhotoResponse, concurrency: settings.concurrency, intervalMs: settings.intervalMs,
  onError, recheck: backgroundMaintenance, admitDispatch });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await worker.stop(); await runtime.close();
}
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
worker.start();
// Worker timers are intentionally unref'ed for embedders. This process has a
// single lifecycle keepalive and clears it only after durable jobs drain.
const keepalive = setInterval(() => {}, 60000);
process.once('SIGTERM', () => { clearInterval(keepalive); });
process.once('SIGINT', () => { clearInterval(keepalive); });
console.log(JSON.stringify({ event: 'VARIANT_WORKER_STARTED', concurrency: settings.concurrency, gradingWorkersStarted: false }));
