import sharp from 'sharp';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { parseDerivative, parseDecodedFrame, descriptorSha256 } from '@atlas/photo-core';
import { processedPhoto } from '@atlas/manual-intake';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { parseReportImages, reportImageURL } from '@atlas/report-view/report-images-contract';
import { reportImageRecipeHash } from './report-image-provider.mjs';
import { createGradingPhotoReader } from './grading-photo-reader.mjs';

const SIDES = ['FRONT','BACK'];
const safeCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'REPORT_IMAGE_INTERRUPTED';
const NEAR_OPAQUE_MIN = 250;
function qualifiedAlpha(alpha, pixels) {
  // Historical readers may have retained the old numeric field. New records
  // use pixelCount: `pixels` is reserved for binary payloads by the store.
  return (alpha?.pixelCount === pixels || alpha?.pixelCount === undefined && alpha?.pixels === pixels)
    && (alpha?.pixels === undefined || alpha.pixels === pixels) && alpha.nearOpaqueMin === NEAR_OPAQUE_MIN
    && [alpha.transparentPixels,alpha.opaquePixels,alpha.nearOpaquePixels].every(value => Number.isSafeInteger(value) && value >= 0 && value <= pixels)
    && alpha.opaquePixels <= alpha.nearOpaquePixels && alpha.transparentPixels + alpha.nearOpaquePixels <= pixels
    && alpha.transparentPixels >= Math.ceil(pixels * 0.001) && alpha.nearOpaquePixels >= Math.ceil(pixels * 0.1);
}
/** Fully decode returned PNG; an alpha flag alone does not prove transparency.
 * This verifies a display asset, never preservation of printed card pixels. */
export async function inspectReportImage(bytes) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, 503, 'REPORT_IMAGE_OUTPUT_INVALID');
  const instance = sharp(bytes, { limitInputPixels: 8_294_400, failOn: 'warning', animated: false });
  const metadata = await instance.metadata();
  requireThat(metadata.format === 'png' && metadata.hasAlpha && !metadata.pages && metadata.width >= 2 && metadata.height >= 2
    && metadata.width <= 4096 && metadata.height <= 4096, 503, 'REPORT_IMAGE_OUTPUT_INVALID');
  const { data, info } = await instance.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, opaque = 0, nearOpaque = 0;
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] === 0) transparent++; if (data[i] === 255) opaque++; if (data[i] >= NEAR_OPAQUE_MIN) nearOpaque++;
  }
  // Actual provider cutouts can peak at 254 with a 252–253 foreground.
  // Measure that returned alpha without normalizing or changing any pixel.
  const alpha = { transparentPixels: transparent, opaquePixels: opaque, nearOpaquePixels: nearOpaque,
    nearOpaqueMin: NEAR_OPAQUE_MIN, pixelCount: info.width * info.height };
  requireThat(qualifiedAlpha(alpha, alpha.pixelCount), 503, 'REPORT_IMAGE_ALPHA_INVALID');
  return { width: info.width, height: info.height, sha256: digest(bytes), byteCount: bytes.length,
    contentType: 'image/png', alpha };
}
function mediaOnly(saved) { return { descriptor: saved.descriptor, frame: saved.frame, original: saved.original, decodePlan: saved.decodePlan }; }
function sourceMatches(saved, packet, side, cardId) {
  const d = parseDerivative(saved.descriptor, saved.frame, saved.original, saved.decodePlan), expected = packet.images[side];
  requireThat(saved.original.binding.cardId === cardId && saved.original.binding.side === side && d.purpose === 'inspection'
    && d.raster.content.sha256 === expected.sha256 && d.raster.content.byteCount === expected.byteCount
    && d.raster.content.mime === expected.contentType && d.raster.dimensions.width === expected.width
    && d.raster.dimensions.height === expected.height, 503, 'REPORT_IMAGE_SOURCE_MISMATCH');
}
function gradingFrame(job, output, keyPrefix) {
  const source = job.sourceMedia;
  return parseDecodedFrame({ schemaVersion: 3, kind: 'decoded-frame', id: `grading-image:${job.key}`,
    originalDescriptorSha256: descriptorSha256(source.original), decodePlanSha256: descriptorSha256(source.decodePlan),
    raster: { content: { mime:'image/png', sha256:output.sha256, byteCount:output.byteCount },
      dimensions: { width:output.width, height:output.height },
      object: { key:`${keyPrefix}/derived/${job.source_card_id}/grading-image/${job.key}/${output.sha256}.png`, versionId:null } },
    sourceToFrame:[1,0,0,0,1,0,0,0,1],
    treatment:{decoder:'openai-images-edit',version:job.recipe.model,policyVersion:'atlas-generated-grading-image-v1',
      channels:4,bitDepth:8,colorSpace:'sRGB',colorTreatment:'converted',hdrTreatment:'not-present'},
    generation:{sourceFrame:source.frame,recipeHash:reportImageRecipeHash(job.recipe),model:job.recipe.model,promptVersion:job.recipe.promptVersion},
  }, source.original, source.decodePlan);
}
function outputDescriptor(job, output, keyPrefix, frame) {
  const source = job.sourceMedia;
  return parseDerivative({ schemaVersion: 1, kind: 'derivative',
    originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: descriptorSha256(frame),
    id: `card-cutout:${job.key}`, purpose: 'reveal', frameToDerivative: [1,0,0,0,1,0,0,0,1],
    raster: { content: { mime: 'image/png', sha256: output.sha256, byteCount: output.byteCount },
      dimensions: { width: output.width, height: output.height },
      object: { key: `${keyPrefix}/derived/${job.source_card_id}/card-cutout/${job.key}/${output.sha256}.png`, versionId: null } },
    encoder: { name: job.recipe.execution === 'OPENAI_BUILT_IN' ? 'openai-built-in-image-edit' : 'openai-images-edit',
      version: job.recipe.model ?? 'model-not-reported', settingsSha256: reportImageRecipeHash(job.recipe) } },
  frame, source.original, source.decodePlan);
}

/** A cold, optional worker/read facade. Only start()/tick() discover or execute
 * edits; public HTTP methods below only read saved records and cached bytes. */
export function createReportImages({ store, artifacts, storage, provider, keyPrefix, concurrency = 2,
  intervalMs = 5000, onError = () => {}, timers = globalThis, inspect = inspectReportImage } = {}) {
  requireThat(store && artifacts && storage && provider?.recipe && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPrefix)
    && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8, 503, 'REPORT_IMAGE_CONFIG_INVALID');
  const emit = error => { try { onError({ code: safeCode(error) }); } catch {} };
  async function publicationSource(row, signal) {
    requireThat(digest(row.manifest) === row.manifest_hash, 503, 'REPORT_IMAGE_PUBLICATION_INVALID');
    const manifest = JSON.parse(row.manifest);
    requireThat(manifest.version === 'atlas-manual-publication-manifest-v1' && manifest.publicHash === row.public_hash
      && manifest.packet.ref.sha256 === row.public_hash, 503, 'REPORT_IMAGE_PUBLICATION_INVALID');
    async function artifact(saved, kind) { const value = await artifacts.read(saved.ref, { cardId: row.card_id, kind, sourceHash: saved.sourceHash }, { signal });
      requireThat(digest(JSON.stringify(value)) === saved.sourceHash, 503, 'REPORT_IMAGE_PUBLICATION_INVALID'); return value; }
    const packet = parsePublicManualReport(await artifact(manifest.packet, 'PUBLIC_REPORT'));
    requireThat(packet.approvalVersion === row.version && packet.mode === row.mode && digest(JSON.stringify(packet)) === row.public_hash,
      503, 'REPORT_IMAGE_PUBLICATION_INVALID');
    return { packet, media: await artifact(manifest.media, 'APPROVED_MEDIA') };
  }
  let discoveryCursor = '';
  async function discover(signal) {
    for (const row of await store.photoCandidates()) {
      try {
        signal.throwIfAborted();
        const saved = JSON.parse(row.source), plan = JSON.parse(row.plan), verification = JSON.parse(row.verification);
        const source = await artifacts.read(saved.ref, { cardId: row.card_id, kind: 'PHOTO_SOURCE', sourceHash: saved.photoSourceHash }, { signal });
        const photo = processedPhoto(source, plan, verification);
        await store.enqueuePhoto(row, { descriptor: photo.workingFrame, frame: photo.workingFrame,
          original: photo.original, decodePlan: photo.decodePlan }, provider.recipe);
      } catch (error) { emit(error); if (signal.aborted) throw error; }
    }
    let publications = await store.candidates(8, discoveryCursor);
    if (!publications.length && discoveryCursor) { discoveryCursor = ''; publications = await store.candidates(8, ''); }
    for (const row of publications) {
      discoveryCursor = `${row.card_id}:${row.action_id}`;
      try { signal.throwIfAborted(); const { packet, media } = await publicationSource(row, signal);
        for (const side of SIDES) {
          sourceMatches(media[side], packet, side, row.card_id);
          await store.bindPhotoToPublication(row, side, mediaOnly(media[side]));
        }
      } catch (error) { emit(error); if (signal.aborted) throw error; }
    }
  }
  async function persist(job, bytes, receipt, signal) {
    const output = await inspect(bytes); signal.throwIfAborted();
    const frame = await storage.writeGeneratedFrame({ ...job.sourceMedia, frame:gradingFrame(job, output, keyPrefix), bytes, signal });
    const descriptor = await storage.writeDerivative({ ...job.sourceMedia, frame, descriptor: outputDescriptor(job, output, keyPrefix, frame), bytes, signal });
    return { version: 'atlas-report-image-result-v1', sourceSha256: job.source_hash, recipeHash: reportImageRecipeHash(job.recipe),
      media: { ...job.sourceMedia, frame, descriptor }, output, receipt };
  }
  const tasks = new Set(), controllers = new Set(); let stopped = true, closed = false, timer = null, cycling = null;
  async function execute(job) {
    const controller = new AbortController(); controllers.add(controller); let renewing = null, dispatched = false, providerReceipt = null;
    const heartbeat = timers.setInterval(() => { if (renewing) return;
      renewing = store.renew(job).then(ok => { if (!ok) controller.abort(new Error('REPORT_IMAGE_LEASE_LOST')); })
        .catch(error => controller.abort(error)).finally(() => { renewing = null; }); }, 30000); heartbeat?.unref?.();
    try {
      // A resumed queue may contain recipes from a different deployment.
      // Never execute today's provider under yesterday's immutable cache key.
      requireThat(job.recipe_hash === reportImageRecipeHash(job.recipe)
        && job.recipe_hash === reportImageRecipeHash(provider.recipe), 503, 'REPORT_IMAGE_RECIPE_UNSUPPORTED');
      const source = job.sourceMedia.descriptor.kind === 'decoded-frame'
        ? await storage.readDecodedFrame({ frame: job.sourceMedia.frame, original: job.sourceMedia.original,
          decodePlan: job.sourceMedia.decodePlan, signal: controller.signal })
        : await storage.readDerivative({ ...job.sourceMedia, signal: controller.signal });
      requireThat(digest(source.bytes) === job.source_hash, 503, 'REPORT_IMAGE_SOURCE_MISMATCH');
      controller.signal.throwIfAborted();
      // If the dispatch transaction itself loses its reply, assume it may
      // have committed. A REQUESTED marker must never be reset for a retry.
      dispatched = true;
      if (!await store.dispatch(job)) { dispatched = false; requireThat(false, 409, 'REPORT_IMAGE_LEASE_LOST'); }
      const generated = await provider.edit({ bytes: source.bytes, sourceSha256: job.source_hash,
        contentType: job.sourceMedia.descriptor.raster.content.mime, requestId: job.claim_id, signal: controller.signal });
      providerReceipt = generated.receipt;
      await store.recordReceipt(job, providerReceipt);
      requireThat(providerReceipt?.execution === job.recipe.execution && providerReceipt.model === job.recipe.model
        && providerReceipt.promptVersion === job.recipe.promptVersion && providerReceipt.promptSha256 === digest(job.recipe.prompt)
        && providerReceipt.recipeHash === job.recipe_hash && providerReceipt.sourceSha256 === job.source_hash
        && providerReceipt.clientRequestId === job.claim_id && providerReceipt.outputSha256 === digest(generated.bytes)
        && providerReceipt.byteCount === generated.bytes.length, 503, 'REPORT_IMAGE_RECEIPT_MISMATCH');
      const result = await persist(job, generated.bytes, generated.receipt, controller.signal);
      await store.finish(job, { result });
    } catch (error) {
      emit(error);
      const receipt = error.receipt ?? providerReceipt;
      if (receipt) { try { await store.recordReceipt(job, receipt); } catch (saveError) { emit(saveError); } }
      try { await store.finish(job, { code: safeCode(error), receipt,
        disposition: error.disposition ?? (['REPORT_IMAGE_OUTPUT_INVALID','REPORT_IMAGE_ALPHA_INVALID','REPORT_IMAGE_RECIPE_UNSUPPORTED','REPORT_IMAGE_RECEIPT_MISMATCH'].includes(error.code) ? 'FAILED' : dispatched ? 'UNKNOWN' : ['PHOTO_STORAGE_CONFLICT','REPORT_IMAGE_SOURCE_MISMATCH'].includes(error.code) ? 'FAILED' : 'RETRY') }); }
      catch (saveError) { emit(saveError); }
    } finally { timers.clearInterval(heartbeat); await renewing; controllers.delete(controller); }
  }
  async function cycle() {
    if (stopped || cycling) return cycling;
    cycling = (async () => { const discovery = new AbortController(); controllers.add(discovery);
      try { await discover(discovery.signal); } finally { controllers.delete(discovery); }
      while (!stopped && tasks.size < concurrency) {
        const job = await store.claim(concurrency, reportImageRecipeHash(provider.recipe)); if (!job) break;
        const task = execute(job).finally(() => tasks.delete(task)); tasks.add(task);
      }
    })().catch(emit).finally(() => { cycling = null; }); return cycling;
  }
  function checked(job, packet, publicHash, side) {
    const result = job.result, descriptor = result?.media?.descriptor;
    const publicationBound = job.report_source_hash != null;
    requireThat(result?.version === 'atlas-report-image-result-v1'
      && (publicationBound ? job.report_source_hash === packet.images[side].sha256
        && /^[a-f0-9]{64}$/.test(job.original_sha256 ?? '') : result.sourceSha256 === packet.images[side].sha256)
      && job.source_hash === result.sourceSha256 && result.recipeHash === job.recipe_hash && descriptor?.purpose === 'reveal'
      && descriptor.raster.content.sha256 === result.output.sha256 && descriptor.raster.content.byteCount === result.output.byteCount
      && descriptor.raster.dimensions.width === result.output.width && descriptor.raster.dimensions.height === result.output.height
      && qualifiedAlpha(result.output.alpha, result.output.width * result.output.height), 503, 'REPORT_IMAGE_BINDING_INVALID');
    const value = { publicToken: packet.publicToken, approvalVersion: packet.approvalVersion, publicHash, side,
      sourceSha256: packet.images[side].sha256,
      ...(publicationBound ? { generationSourceSha256: result.sourceSha256, originalSha256: job.original_sha256 } : {}),
      sha256: result.output.sha256, width: result.output.width, height: result.output.height,
      byteCount: result.output.byteCount, contentType: 'image/png', transparent: true, presentationOnly: true,
      preservesOriginalRGB: false, alignment: 'approximate-frame-fit', promptVersion: job.recipe.promptVersion,
      model: job.recipe.model, execution: job.recipe.execution };
    return { ...value, url: reportImageURL(value) };
  }
  async function manifest(row, packet) {
    const images = {};
    for (const job of await store.readyMany(row)) {
      requireThat(SIDES.includes(job.side) && !images[job.side], 503, 'REPORT_IMAGE_BINDING_INVALID');
      images[job.side] = checked(job, packet, row.public_hash, job.side);
    }
    return parseReportImages({ version: 'atlas-report-images-v1', publicToken: packet.publicToken, approvalVersion: packet.approvalVersion,
      publicHash: row.public_hash, images }, { packet, publicHash: row.public_hash });
  }
  return Object.freeze({
    manifest,
    ...createGradingPhotoReader({ photo: (cardId, uploadId, side) => store.photo(cardId, uploadId, side), storage }),
    async photo({ cardId, uploadId, side }) {
      requireThat(SIDES.includes(side), 404, 'REPORT_IMAGE_NOT_FOUND');
      return store.photo(cardId, uploadId, side);
    },
    async readCleanPhoto({ cardId, uploadId, side, signal, waitMs = 240000 }) {
      requireThat(SIDES.includes(side) && Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 240000, 400, 'REPORT_IMAGE_INPUT_INVALID');
      const deadline = Date.now() + waitMs;
      if (!await store.photoIntent(cardId, uploadId, side)) return null;
      while (true) {
        signal?.throwIfAborted();
        const job = await store.photo(cardId, uploadId, side);
        if (job?.state === 'READY') {
          const found = await storage.readDerivative({ ...job.result.media, signal });
          requireThat(digest(found.bytes) === job.result.output.sha256 && found.bytes.length === job.result.output.byteCount,
            503, 'REPORT_IMAGE_OUTPUT_INVALID');
          // The upload may have changed while reading. Never attach its cutout
          // to a replacement photograph, even when the card id is the same.
          const current = await store.photo(cardId, uploadId, side);
          requireThat(current?.key === job.key, 409, 'REPORT_IMAGE_SOURCE_CHANGED');
          return { bytes: found.bytes, contentType: 'image/png', sha256: job.result.output.sha256,
            width: job.result.output.width, height: job.result.output.height };
        }
        if (job && ['FAILED','UNKNOWN'].includes(job.state) || Date.now() >= deadline) return null;
        await new Promise((resolve, reject) => {
          const abort = () => { timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
          const timer = timers.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Math.min(1000, deadline - Date.now()));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
    },
    wake() { return cycle(); },
    async image(row, packet, side, outputSha256, signal) {
      const job = await store.ready(row, side); if (!job) return null;
      const value = checked(job, packet, row.public_hash, side); if (value.sha256 !== outputSha256) return null;
      const found = await storage.readDerivative({ ...job.result.media, signal });
      requireThat(found.bytes.length === value.byteCount && digest(found.bytes) === value.sha256, 503, 'REPORT_IMAGE_OUTPUT_INVALID');
      return { bytes: found.bytes, contentType: 'image/png' };
    },
    start() { if (closed || !stopped) return; stopped = false; timer = timers.setInterval(() => { void cycle(); }, intervalMs); timer?.unref?.(); void cycle(); },
    async tick() { if (closed) return; const wasStopped = stopped; stopped = false; await cycle(); await Promise.allSettled([...tasks]); stopped = wasStopped; },
    async stop() { if (closed) return; closed = true; stopped = true; timers.clearInterval(timer);
      for (const controller of controllers) controller.abort(Object.assign(new Error('REPORT_IMAGE_STOPPED'), { code: 'REPORT_IMAGE_STOPPED' }));
      await cycling; await Promise.allSettled([...tasks]); },
  });
}
