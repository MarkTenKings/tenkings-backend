import { randomUUID } from 'node:crypto';
import { canonical, digest, object, requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDerivative } from '@atlas/photo-core';
import { processedPhoto } from '@atlas/manual-intake';
import { geometryBase, preparationBase, validatePhotoGeometryQuad } from '@atlas/manual-workspace/geometry-actions';
import { preparationRuntimeIdentity, proposePhotoGeometry, preparePhotoGeometry, describePreparationDerivative,
  adoptPhysicalGeometryProposal, adoptGeometryPreparation } from '@atlas/preparation-runtime';

const SIDES = ['FRONT', 'BACK'];
const POLICY = 'atlas-early-photo-geometry-v1';
const TERMINAL = ['READY', 'NEEDS_REVIEW', 'FAILED'];
const safeCode = error => /^(?:GEOMETRY|PREPARATION|PHOTO|MANUAL_PROCESSING)_[A-Z_]{1,80}$/.test(error?.code ?? '') ? error.code : 'GEOMETRY_PROCESSING_FAILED';
const equal = (a, b) => canonical(a) === canonical(b);
const usable = proposal => {
  if (proposal?.outcome !== 'ACCEPTED') return null;
  try { return validatePhotoGeometryQuad(proposal.proposal); } catch { return null; }
};

export function geometryCacheInput(upload, photo, settings, engine) {
  requireThat(upload?.source && photo.original.binding.side === upload.side && photo.original.binding.version === upload.version,
    409, 'GEOMETRY_PHOTO_CHANGED');
  requireThat(['BLACK','WHITE','MAGENTA'].includes(settings.matColor) && ['SQUARE','ROUNDED_3_18_MM'].includes(settings.cornerShape));
  return { policy: POLICY, cardId: photo.original.binding.cardId, side: upload.side, uploadId: upload.uploadId,
    photoSource: upload.source, plan: upload.plan, verification: upload.verification,
    frameDescriptorSha256: descriptorSha256(photo.workingFrame),
    settings: { matColor: settings.matColor, cornerShape: settings.cornerShape }, engine, engineHash: digest(canonical(engine)) };
}

export function geometryJobStatus(job, uploadId = null, key = null) {
  return { state: job?.state ?? (uploadId ? 'QUEUED' : 'WAITING_PHOTO'), uploadId, key,
    canRetry: ['FAILED','NEEDS_REVIEW'].includes(job?.state), error: job?.error ?? null,
    physical: job?.result?.physical ?? null, printed: job?.result?.printed ?? null, prepared: job?.result?.prepared === true };
}

/** Rebind verified immutable pixel work to the actual current workspace only
 * at its normal authenticated/CAS commit boundary. No placeholder identity. */
export function adoptEarlyGeometry(geometry, side, packet, input) {
  const slot = geometry.sides[side], frame = packet?.binding?.frameDescriptorSha256;
  requireThat(packet?.policy === POLICY && packet.key === digest(canonical(input)) && equal(packet.binding, input)
    && frame === input.frameDescriptorSha256 && geometry.cardId === input.cardId && side === input.side
    && slot.image?.version === input.plan.binding.version && slot.image.originalSha256 === input.plan.expected.sha256
    && slot.matColor === input.settings.matColor && slot.cornerShape === input.settings.cornerShape
    && !slot.physical && !slot.prepared && !slot.printed && !slot.confirmation, 409, 'GEOMETRY_CACHE_STALE');
  const photoFrame = packet.photoFrame;
  requireThat(descriptorSha256(photoFrame) === frame && slot.image.frameId === photoFrame.id
    && slot.image.frameSha256 === photoFrame.raster.content.sha256
    && slot.image.width === photoFrame.raster.dimensions.width && slot.image.height === photoFrame.raster.dimensions.height,
  409, 'GEOMETRY_CACHE_STALE');
  for (const result of [packet.physical, packet.preparation].filter(Boolean)) requireThat(
    result.frameDescriptorSha256 === frame && equal(result.identity, input.engine.runtime.identity), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
  let state = geometry;
  if (packet.physical) state = adoptPhysicalGeometryProposal(state, { ...packet.physical, side, base: geometryBase(state, side, 'PHYSICAL') }).state;
  if (!state.sides[side].physical || !packet.preparation) return { geometry: state, prepared: null };
  const prepared = packet.preparation;
  const adopted = adoptGeometryPreparation(state, { ...prepared, side, base: preparationBase(state, side),
    settingsRevision: state.sides[side].settingsRevision, ...input.settings,
    frame: { ...prepared.frame, version: state.sides[side].preparationRevision + 1 } });
  return { geometry: adopted.state, prepared: packet.preparedImages };
}

export function createEarlyGeometry({ store, intake, details, storage, artifacts, keyPrefix, limited, pythonExecutable, limits,
  runtimeIdentity = preparationRuntimeIdentity, physical = proposePhotoGeometry, prepare = preparePhotoGeometry,
  intervalMs = 2000, onEvent = () => {} }) {
  let enginePromise = null, stopped = true, closed = false, timer = null, cycling = null, discoveryCursor = null, wakePending = false;
  const controllers = new Set(), tasks = new Set();
  const engine = () => {
    if (!enginePromise) {
      enginePromise = limited(async () => ({ policy: POLICY, runtime: await runtimeIdentity(pythonExecutable), limits }));
      enginePromise.catch(() => { enginePromise = null; });
    }
    return enginePromise;
  };
  const emit = event => { try { onEvent(event); } catch { /* Observability is not authority. */ } };
  async function inputs(staff, cardId, settingsOverride = null) {
    const [{ card }, saved] = await Promise.all([intake.read(staff, cardId), details.read(staff, cardId)]);
    const actualEngine = SIDES.some(side => card.sides[side].upload?.source) ? await engine() : null;
    const result = {};
    for (const side of SIDES) {
      const upload = card.sides[side].upload;
      if (!upload?.source) { result[side] = null; continue; }
      const { photo } = await intake.readSource(staff, cardId, upload.uploadId);
      result[side] = geometryCacheInput(upload, photo, settingsOverride?.[side] ?? saved.details, actualEngine);
    }
    return result;
  }
  async function statusFor(staff, cardId, current) {
    return Object.fromEntries(await Promise.all(SIDES.map(async side => {
      const input = current[side], key = input ? digest(canonical(input)) : null;
      return [side, geometryJobStatus(key ? await store.read(staff, cardId, key) : null, input?.uploadId ?? null, key)];
    })));
  }
  async function compute(job, signal) {
    const input = job.input;
    requireThat(input.policy === POLICY && equal(input.engine, await engine()), 409, 'GEOMETRY_ENGINE_CHANGED');
    const stored = await artifacts.read(input.photoSource.ref, { cardId: input.cardId, kind: 'PHOTO_SOURCE', sourceHash: input.photoSource.photoSourceHash }, { signal });
    const photo = processedPhoto(stored, input.plan, input.verification);
    requireThat(descriptorSha256(photo.workingFrame) === input.frameDescriptorSha256, 409, 'GEOMETRY_PHOTO_CHANGED');
    const found = await storage.readDecodedFrame({ frame: photo.workingFrame, original: photo.original, decodePlan: photo.decodePlan, signal });
    const source = { original: photo.original, decodePlan: photo.decodePlan, frame: photo.workingFrame, bytes: found.bytes };
    const options = { source, matColor: input.settings.matColor, engine: input.engine.runtime, limits: input.engine.limits, pythonExecutable, signal };
    const proposed = await physical(options), quad = usable(proposed.proposal);
    const packet = { policy: POLICY, key: job.key, binding: input, photoFrame: photo.workingFrame,
      physical: proposed, preparation: null, preparedImages: null };
    let printed = null, preparationError = null;
    if (quad) {
      try {
      const prepared = await prepare({ ...options, quad });
      const images = {};
      for (const [name, output] of Object.entries(prepared.outputs)) {
        const descriptor = describePreparationDerivative(prepared, name, source, { id: `${prepared.id}:${name}`,
          object: { key: `${keyPrefix}/derived/${input.cardId}/preparation/${prepared.id}-${name}.webp`, versionId: null } });
        images[name] = await storage.writeDerivative({ descriptor, frame: source.frame, original: source.original,
          decodePlan: source.decodePlan, bytes: output.bytes, signal });
      }
      const value = { frameId: prepared.frame.id, images, identity: prepared.identity, encoderSettings: prepared.encoderSettings };
      const sourceHash = digest(JSON.stringify(value));
      const ref = await artifacts.write(value, { cardId: input.cardId, kind: 'PREPARED_IMAGES', sourceHash }, { signal });
      const { outputs, ...metadata } = prepared;
      packet.preparation = metadata; packet.preparedImages = { ref, sourceHash }; printed = usable(prepared.proposal);
      } catch (error) {
        if (error?.name !== 'PreparationError') throw error;
        preparationError = safeCode(error);
      }
    }
    const ref = await artifacts.write(packet, { cardId: input.cardId, kind: 'EARLY_GEOMETRY', sourceHash: job.key }, { signal });
    requireThat(!signal.aborted, 503, 'GEOMETRY_INTERRUPTED');
    const result = { ref, sourceHash: job.key, physical: quad, printed, prepared: Boolean(packet.preparation) };
    return { state: quad && printed ? 'READY' : 'NEEDS_REVIEW', result, error: preparationError };
  }
  async function one(actualEngine) {
    let job = null;
    const controller = new AbortController(); controllers.add(controller);
    const deadline = setTimeout(() => controller.abort(), 600000); deadline.unref?.();
    try {
      // Reserve the shared native slot BEFORE acquiring a durable job lease.
      return await limited(async () => {
        job = await store.claim(digest(canonical(actualEngine)), randomUUID());
        if (!job) return false;
        if (stopped) { await store.finish(job, 'QUEUED', null, 'GEOMETRY_INTERRUPTED'); return false; }
        const result = await compute(job, controller.signal);
        await store.finish(job, result.state, result.result, result.error); return true;
      });
    } catch (error) {
      if (job) await store.finish(job, controller.signal.aborted ? 'QUEUED' : 'FAILED', null,
        controller.signal.aborted ? 'GEOMETRY_INTERRUPTED' : safeCode(error)).catch(() => {});
      if (error?.code !== 'MANUAL_PROCESSING_BUSY') emit({ event: 'MANUAL_GEOMETRY_PENDING', code: safeCode(error) });
      return false;
    } finally { clearTimeout(deadline); controllers.delete(controller); }
  }
  async function cycle() {
    if (stopped || cycling) return;
    cycling = (async () => {
      const actualEngine = await engine();
      const pending = await store.pending(digest(canonical(actualEngine)), discoveryCursor);
      requireThat(Array.isArray(pending) && pending.length <= 2, 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      discoveryCursor = pending.length === 2 ? { createdAt: new Date(pending.at(-1).created_at).toISOString(), uploadId: pending.at(-1).upload_id } : null;
      for (const row of pending) {
        if (stopped) break;
        try {
          const plan = JSON.parse(row.plan), verification = JSON.parse(row.verification), source = JSON.parse(row.source);
          const stored = await artifacts.read(source.ref, { cardId: row.card_id, kind: 'PHOTO_SOURCE', sourceHash: source.photoSourceHash });
          const photo = processedPhoto(stored, plan, verification);
          await store.stage(geometryCacheInput({ uploadId: row.upload_id, side: row.side, version: plan.binding.version,
            source, plan, verification }, photo, row.settings, actualEngine));
        } catch (error) { emit({ event: 'MANUAL_GEOMETRY_SOURCE_PENDING', uploadId: row.upload_id, code: safeCode(error) }); }
      }
      if (!stopped) {
        const available = 2 - tasks.size;
        for (let i = 0; i < available; i++) {
          const work = one(actualEngine); tasks.add(work);
          void work.then(didWork => { tasks.delete(work); if (didWork) wake(); }, () => { tasks.delete(work); });
        }
      }
    })();
    try { await cycling; } catch (error) { emit({ event: 'MANUAL_GEOMETRY_SCAN_PENDING', code: safeCode(error) }); }
    finally {
      cycling = null;
      if (!stopped) {
        if (wakePending) { wakePending = false; queueMicrotask(() => { void cycle(); }); }
        else { timer = setTimeout(() => { timer = null; void cycle(); }, intervalMs); timer.unref?.(); }
      }
    }
  }
  function wake() {
    if (stopped) return;
    if (timer) clearTimeout(timer); timer = null;
    if (cycling) wakePending = true;
    else void cycle();
  }
  const api = {
    start() { if (!stopped || closed) return false; stopped = false; discoveryCursor = null; void cycle(); return true; },
    async stop() {
      closed = true; stopped = true; if (timer) clearTimeout(timer); timer = null;
      for (const controller of controllers) controller.abort();
      await cycling?.catch(() => {}); await Promise.allSettled([...tasks]);
    },
    async status(staff, cardId) { return statusFor(staff, cardId, await inputs(staff, cardId)); },
    async sourcePrepared(staff, cardId, uploadId) {
      try { await store.intent(staff, cardId, uploadId); }
      catch (error) { if (error?.code === 'GEOMETRY_PHOTO_CHANGED') return; throw error; }
      api.start(); wake();
    },
    async ensure(staff, cardId, request = {}, settingsOverride = null) {
      const retry = Object.keys(request).length > 0;
      if (retry) { object(request, ['side','expectedKey']); requireThat(SIDES.includes(request.side) && /^[a-f0-9]{64}$/.test(request.expectedKey)); }
      else object(request, []);
      const current = await inputs(staff, cardId, settingsOverride);
      if (retry) requireThat(current[request.side] && digest(canonical(current[request.side])) === request.expectedKey, 409, 'GEOMETRY_RETRY_STALE');
      for (const side of SIDES) if (current[side] && (!retry || side === request.side)) await store.ensure(staff, current[side], { retry });
      api.start(); wake();
      return { earlyGeometry: await statusFor(staff, cardId, current) };
    },
    async consume(staff, cardId, side, upload, photo, settings, { timeoutMs = 180000 } = {}) {
      const input = geometryCacheInput(upload, photo, settings, await engine());
      const key = digest(canonical(input)); await store.ensure(staff, input); api.start();
      const until = Date.now() + timeoutMs;
      let job;
      do {
        job = await store.read(staff, cardId, key);
        if (TERMINAL.includes(job?.state)) break;
        requireThat(Date.now() < until, 503, 'GEOMETRY_PROCESSING_PENDING');
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (true);
      if (job.state === 'FAILED') return { input, packet: null };
      const packet = await artifacts.read(job.result.ref, { cardId, kind: 'EARLY_GEOMETRY', sourceHash: key });
      requireThat(packet.key === key && equal(packet.binding, input), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      if (packet.preparation) {
        const manifest = await artifacts.read(packet.preparedImages.ref, { cardId, kind: 'PREPARED_IMAGES', sourceHash: packet.preparedImages.sourceHash });
        const names = ['rectified','inspection','normalized','microDefect','directional'];
        requireThat(manifest.frameId === packet.preparation.frame.id && equal(manifest.identity, input.engine.runtime.identity)
          && Object.keys(manifest.images).length === names.length && names.every(name => manifest.images[name]), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
        for (const name of names) parseDerivative(manifest.images[name], photo.workingFrame, photo.original, photo.decodePlan);
        requireThat(manifest.images.rectified.raster.content.sha256 === packet.preparation.frame.rectified.sha256
          && manifest.images.inspection.raster.content.sha256 === packet.preparation.frame.inspection.sha256,
        503, 'GEOMETRY_STORED_CONTENT_INVALID');
      }
      return { input, packet };
    },
  };
  return Object.freeze(api);
}
