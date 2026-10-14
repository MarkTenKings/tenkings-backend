import { randomUUID } from 'node:crypto';
import { canonical, digest, object, requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDerivative } from '@atlas/photo-core';
import { processedPhoto } from '@atlas/manual-intake';
import { geometryProcessingSettings } from './geometry-processing.mjs';
import { geometrySideSettings } from './details.mjs';
import { geometryBase, preparationBase, parseGeometryWorkspace } from '@atlas/manual-workspace/geometry-actions';
import { machineGeometryCandidate, MACHINE_GEOMETRY_POLICY } from './machine-geometry.mjs';
import { ASTRA_GEOMETRY_POLICY, runAstraGeometry, geometryProposal, projectAstraGeometryResponse, gradingToCanonical } from './astra-geometry.mjs';
import { preparationRuntimeIdentity, preparePhotoGeometry, describePreparationDerivative,
  describePreparationPreview,
  adoptPhysicalGeometryProposal, adoptGeometryPreparation, PREPARATION_CORE_V1, PREPARATION_REVEALS_V1,
  preparationOutputNames } from '@atlas/preparation-runtime';

const SIDES = ['FRONT', 'BACK'];
const POLICY = 'atlas-early-clean-geometry-v2';
const TERMINAL = ['READY', 'NEEDS_REVIEW', 'FAILED'];
const safeCode = error => /^(?:GEOMETRY|PREPARATION|PHOTO|MANUAL_PROCESSING)_[A-Z_]{1,80}$/.test(error?.code ?? '') ? error.code : 'GEOMETRY_PROCESSING_FAILED';
const equal = (a, b) => canonical(a) === canonical(b);
const usable = proposal => machineGeometryCandidate(proposal)?.quad ?? null;

export function geometryCacheInput(upload, photo, settings, engine) {
  requireThat(upload?.source && photo.original.binding.side === upload.side && photo.original.binding.version === upload.version,
    409, 'GEOMETRY_PHOTO_CHANGED');
  const sideSettings = geometrySideSettings(settings, upload.side);
  return { policy: POLICY, cardId: photo.original.binding.cardId, side: upload.side, uploadId: upload.uploadId,
    photoSource: upload.source, plan: upload.plan, verification: upload.verification,
    frameDescriptorSha256: descriptorSha256(photo.workingFrame),
    settings: sideSettings, engine, engineHash: digest(canonical(engine)) };
}

export function geometryJobStatus(job, uploadId = null, key = null) {
  return { state: job?.state ?? (uploadId ? 'QUEUED' : 'WAITING_PHOTO'), uploadId, key,
    canRetry: ['FAILED','NEEDS_REVIEW'].includes(job?.state), error: job?.error ?? null,
    physical: job?.result?.physical ?? null, printed: job?.result?.printed ?? null, prepared: job?.result?.prepared === true,
    machineUsable: job?.result?.machineUsable === true,
    requiresHumanConfirmation: true, ambiguous: job?.result?.ambiguous === true,
    unresolved: job?.result?.unresolved ?? [] };
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
  for (const result of [packet.preparation].filter(Boolean)) requireThat(
    result.frameDescriptorSha256 === frame && equal(result.identity, input.engine.runtime.identity), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
  if (packet.physical) requireThat(packet.physical.frameDescriptorSha256 === frame
    && equal(packet.physical.identity, ASTRA_GEOMETRY_POLICY), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
  let state = geometry;
  if (packet.visual) state=parseGeometryWorkspace({...state,sides:{...state.sides,[side]:{...state.sides[side],visualObservation:{
    frameSha256:photoFrame.raster.content.sha256,responseHash:packet.visual.responseHash,model:ASTRA_GEOMETRY_POLICY.model,reasoning:ASTRA_GEOMETRY_POLICY.reasoning,
    ...Object.fromEntries(['physical','printed'].map(kind=>[kind,{outlineLocated:Boolean(packet.visual[kind].quad),uncertainty:packet.visual[kind].uncertainty,observation:packet.visual[kind].observation}]))
  }}}});
  if (packet.physical) state = adoptPhysicalGeometryProposal(state, { ...packet.physical, side, base: geometryBase(state, side, 'PHYSICAL') }).state;
  if (!state.sides[side].physical || !packet.preparation) return { geometry: state, prepared: null };
  const prepared = packet.preparation;
  let adopted = adoptGeometryPreparation(state, { ...prepared, side, base: preparationBase(state, side),
    settingsRevision: state.sides[side].settingsRevision, ...input.settings,
    frame: { ...prepared.frame, version: state.sides[side].preparationRevision + 1 } });
  return { geometry: adopted.state, prepared: packet.preparedImages };
}

export function createEarlyGeometry({ store, intake, details, storage, artifacts, keyPrefix, limited, pythonExecutable, limits,
  runtimeIdentity = preparationRuntimeIdentity, model = null, readGradingPhoto, isCleanPhotoPrepared = null, prepare = preparePhotoGeometry, runVisual = runAstraGeometry,
  geometryConcurrency = 2, geometryDiscoveryPageSize = 2, intervalMs = 2000, onEvent = () => {} }) {
  geometryProcessingSettings({ geometryConcurrency, geometryDiscoveryPageSize });
  let enginePromise = null, stopped = true, closed = false, timer = null, cycling = null, discoveryCursor = null, wakePending = false;
  const controllers = new Set(), tasks = new Set();
  const engine = () => {
    if (!enginePromise) {
      enginePromise = limited(async () => ({ policy: POLICY, outputContract: PREPARATION_CORE_V1, machineGeometryPolicy: MACHINE_GEOMETRY_POLICY, visual: ASTRA_GEOMETRY_POLICY,
        runtime: await runtimeIdentity(pythonExecutable), limits }));
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
      const { photo: uploaded } = await intake.readSource(staff, cardId, upload.uploadId);
      if (!await cleanPrepared({cardId,uploadId:upload.uploadId,side})) { result[side] = { pendingClean:true, cardId, uploadId:upload.uploadId, side }; continue; }
      const { photo } = await readGradingPhoto({ cardId, uploadId:upload.uploadId, side, photo:uploaded });
      result[side] = geometryCacheInput(upload, photo, settingsOverride?.[side] ?? saved.details, actualEngine);
    }
    return result;
  }
  async function statusFor(staff, cardId, current) {
    return Object.fromEntries(await Promise.all(SIDES.map(async side => {
      const input = current[side], key = input && !input.pendingClean ? digest(canonical(input)) : null;
      return [side, geometryJobStatus(key ? await store.read(staff, cardId, key, input) : null, input?.uploadId ?? null, key)];
    })));
  }
  const cleanPrepared = input => !isCleanPhotoPrepared || isCleanPhotoPrepared({ cardId: input.cardId, uploadId: input.uploadId, side: input.side });
  async function retained(staff, cardId, side, uploadId, photoFrame, { responseHash = null, input = null } = {}) {
    requireThat([1, 2].includes(photoFrame?.schemaVersion) || photoFrame?.schemaVersion === 3 && photoFrame.generation,
      409, 'GEOMETRY_GRADING_PHOTO_REQUIRED');
    const frameHash = descriptorSha256(photoFrame);
    const jobs = await store.retainedForPhoto(staff, cardId, side, uploadId, frameHash);
    for (const job of jobs) {
      requireThat(job.input.cardId === cardId && job.input.side === side && job.input.uploadId === uploadId
        && job.input.frameDescriptorSha256 === frameHash, 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      if (job.input.policy !== POLICY || !equal(job.input.engine.visual, ASTRA_GEOMETRY_POLICY)) continue;
      // Native codec/runtime changes may re-use the same immutable Astra
      // observation; a changed photo/settings contract may not adopt its cache.
      if (input) {
        const comparable = value => { const { engine, engineHash, ...rest } = value; return rest; };
        if (!equal(comparable(job.input), comparable(input))) continue;
      }
      const modelAction = await store.readModel(job);
      if (!modelAction?.response || modelAction.response.httpStatus < 200 || modelAction.response.httpStatus >= 300) continue;
      const evidence = modelAction.request.evidence;
      requireThat(evidence.frameDescriptorSha256 === frameHash && evidence.gradingSha256 === photoFrame.raster.content.sha256
        && evidence.requestHash === modelAction.requestHash && equal(evidence.policy, ASTRA_GEOMETRY_POLICY), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      const visual = projectAstraGeometryResponse(await artifacts.read(modelAction.response.ref,
        { cardId, kind: 'GEOMETRY_MODEL_RESPONSE', sourceHash: modelAction.requestHash }), evidence);
      if (responseHash && visual.responseHash !== responseHash) continue;
      return { job, visual };
    }
    return null;
  }
  async function compute(job, signal) {
    const input = job.input;
    requireThat(input.policy === POLICY && equal(input.engine, await engine()), 409, 'GEOMETRY_ENGINE_CHANGED');
    const stored = await artifacts.read(input.photoSource.ref, { cardId: input.cardId, kind: 'PHOTO_SOURCE', sourceHash: input.photoSource.photoSourceHash }, { signal });
    const uploaded = processedPhoto(stored, input.plan, input.verification);
    const { photo, bytes } = await readGradingPhoto({cardId:input.cardId,uploadId:input.uploadId,side:input.side,photo:uploaded,signal});
    requireThat(descriptorSha256(photo.workingFrame) === input.frameDescriptorSha256, 409, 'GEOMETRY_PHOTO_CHANGED');
    const source = { original: photo.original, decodePlan: photo.decodePlan, frame: photo.workingFrame, bytes };
    const options = { source, matColor: input.settings.matColor, engine: input.engine.runtime, limits: input.engine.limits, pythonExecutable, signal };
    const visual = await runVisual({ job, source, model, store, artifacts, signal });
    const proposed = { id: visual.responseHash, actor: 'ASTRA', identity: ASTRA_GEOMETRY_POLICY,
      frameDescriptorSha256: input.frameDescriptorSha256, proposal: geometryProposal(visual, 'physical'),
      ...(visual.physical.contour.length ? { materialContour: visual.physical.contour } : {}) };
    const quad = usable(proposed.proposal);
    const packet = { policy: POLICY, key: job.key, binding: input, photoFrame: photo.workingFrame,
      physical: proposed, visual, preparation: null, preparedImages: null };
    let printed = null, preparationError = null;
    if (quad) {
      try {
      const prepared = await limited(() => prepare({ ...options, quad, outputContract: PREPARATION_CORE_V1 }));
      const names = preparationOutputNames(PREPARATION_CORE_V1);
      requireThat(prepared.outputContract === PREPARATION_CORE_V1 && prepared.outputs && prepared.frame
        && equal(prepared.sourceQuad, quad)
        && Object.keys(prepared.outputs).length === names.length && names.every(name => prepared.outputs[name]),
      503, 'GEOMETRY_STORED_CONTENT_INVALID');
      {
        prepared.actor = 'ASTRA';
        prepared.proposal = geometryProposal(visual, 'printed');
        if (visual.printed.quad) prepared.proposal.proposal = gradingToCanonical(visual.printed.quad, source, prepared);
        if (visual.physical.contour.length) prepared.frame.materialContour = gradingToCanonical(visual.physical.contour, source, prepared, { pixelCenters: true })
          .map(p => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
      }
      const images = {};
      for (const [name, output] of Object.entries(prepared.outputs)) {
        const descriptor = describePreparationDerivative(prepared, name, source, { id: `${prepared.id}:${name}`,
          object: { key: `${keyPrefix}/derived/${input.cardId}/preparation/${prepared.id}-${name}.webp`, versionId: null } });
        images[name] = await storage.writeDerivative({ descriptor, frame: source.frame, original: source.original,
          decodePlan: source.decodePlan, bytes: output.bytes, signal });
      }
      let inspectionPreview;
      if (prepared.inspectionPreview) {
        const descriptor = describePreparationPreview(prepared, source, { id: `${prepared.id}:inspection-preview`,
          object: { key: `${keyPrefix}/derived/${input.cardId}/preparation/${prepared.id}-inspection-preview.jpg`, versionId: null } });
        inspectionPreview = { policyVersion: prepared.inspectionPreview.policyVersion, sourceSha256: prepared.inspectionPreview.sourceSha256,
          descriptor: await storage.writeDerivative({ descriptor, frame: source.frame, original: source.original,
            decodePlan: source.decodePlan, bytes: prepared.inspectionPreview.bytes, signal }) };
      }
      const { outputs, inspectionPreview: previewBytes, ...metadata } = prepared;
      const value = { frameId: prepared.frame.id, images, identity: prepared.identity, encoderSettings: prepared.encoderSettings,
        ...(inspectionPreview ? { inspectionPreview } : {}),
        outputContract: PREPARATION_CORE_V1, deferredReveals: { outputContract: PREPARATION_REVEALS_V1,
          workingFrame: source.frame, preparation: metadata } };
      const sourceHash = digest(JSON.stringify(value));
      const ref = await artifacts.write(value, { cardId: input.cardId, kind: 'PREPARED_IMAGES', sourceHash }, { signal });
      packet.preparation = metadata; packet.preparedImages = { ref, sourceHash }; printed = usable(prepared.proposal);
      } catch (error) {
        if (error?.name !== 'PreparationError') throw error;
        preparationError = safeCode(error);
      }
    }
    const ref = await artifacts.write(packet, { cardId: input.cardId, kind: 'EARLY_GEOMETRY', sourceHash: job.key }, { signal });
    requireThat(!signal.aborted, 503, 'GEOMETRY_INTERRUPTED');
    const result = { ref, sourceHash: job.key, physical: quad, printed, prepared: Boolean(packet.preparation),
      machineUsable: Boolean(quad && packet.preparation && !preparationError),
      ambiguous: Boolean(machineGeometryCandidate(proposed.proposal)?.ambiguous || machineGeometryCandidate(packet.preparation?.proposal)?.ambiguous),
      unresolved: [!quad && 'PHYSICAL_GEOMETRY_UNRESOLVED', !packet.preparation && 'PREPARED_FRAME_UNAVAILABLE',
        !printed && 'PRINTED_GEOMETRY_UNRESOLVED'].filter(Boolean) };
    return { state: result.machineUsable ? 'READY' : 'NEEDS_REVIEW', result, error: preparationError };
  }
  async function one(actualEngine) {
    let job = null;
    const controller = new AbortController(); controllers.add(controller);
    const deadline = setTimeout(() => controller.abort(), 600000); deadline.unref?.();
    try {
      // Provider concurrency uses the durable geometry lease. Only the CPU
      // transform takes a native slot; model latency must not block decoding.
      {
        job = await store.claim(digest(canonical(actualEngine)), randomUUID(), geometryConcurrency);
        if (!job) return false;
        if (stopped) { await store.finish(job, 'QUEUED', null, 'GEOMETRY_INTERRUPTED'); return false; }
        const result = await compute(job, controller.signal);
        await store.finish(job, result.state, result.result, result.error); return true;
      }
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
      const pending = await store.pending(digest(canonical(actualEngine)), discoveryCursor, geometryDiscoveryPageSize);
      requireThat(Array.isArray(pending) && pending.length <= geometryDiscoveryPageSize, 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      // PostgreSQL retains microseconds; Date would round this down and repeat
      // a failed source forever with one-row pages. Keep the SQL cursor exact.
      discoveryCursor = pending.length === geometryDiscoveryPageSize ? {
        createdAt: pending.at(-1).cursor_created_at ?? new Date(pending.at(-1).created_at).toISOString(), uploadId: pending.at(-1).upload_id,
      } : null;
      for (const row of pending) {
        if (stopped) break;
        if (row.previous_engine) continue;
        try {
          const plan = JSON.parse(row.plan), verification = JSON.parse(row.verification), source = JSON.parse(row.source);
          const stored = await artifacts.read(source.ref, { cardId: row.card_id, kind: 'PHOTO_SOURCE', sourceHash: source.photoSourceHash });
          if (!await cleanPrepared({cardId:row.card_id,uploadId:row.upload_id,side:row.side})) continue;
          const uploaded = processedPhoto(stored, plan, verification);
          const { photo } = await readGradingPhoto({cardId:row.card_id,uploadId:row.upload_id,side:row.side,photo:uploaded});
          const pendingInput = geometryCacheInput({ uploadId: row.upload_id, side: row.side, version: plan.binding.version,
            source, plan, verification }, photo, row.settings, actualEngine);
          await store.stage(pendingInput);
        } catch (error) { emit({ event: 'MANUAL_GEOMETRY_SOURCE_PENDING', uploadId: row.upload_id, code: safeCode(error) }); }
      }
      if (!stopped) {
        const available = geometryConcurrency - tasks.size;
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
    async retainedVisual(staff, cardId, side, uploadId, photoFrame, options = {}) {
      return (await retained(staff, cardId, side, uploadId, photoFrame, options))?.visual ?? null;
    },
    async ensure(staff, cardId, request = {}, settingsOverride = null) {
      const retry = Object.keys(request).length > 0;
      if (retry) { object(request, ['side','expectedKey']); requireThat(SIDES.includes(request.side) && /^[a-f0-9]{64}$/.test(request.expectedKey)); }
      else object(request, []);
      const current = await inputs(staff, cardId, settingsOverride);
      if (retry) requireThat(current[request.side] && !current[request.side].pendingClean && digest(canonical(current[request.side])) === request.expectedKey, 409, 'GEOMETRY_RETRY_STALE');
      for (const side of SIDES) if (current[side] && !current[side].pendingClean && (!retry || side === request.side) && await cleanPrepared(current[side])) await store.ensure(staff, current[side], { retry });
      api.start(); wake();
      return { earlyGeometry: await statusFor(staff, cardId, current) };
    },
    async consume(staff, cardId, side, upload, photo, settings, { timeoutMs = 0 } = {}) {
      if (!await cleanPrepared({cardId,uploadId:upload.uploadId,side})) return {input:null,packet:null};
      ({photo}=await readGradingPhoto({cardId,uploadId:upload.uploadId,side,photo}));
      const input = geometryCacheInput(upload, photo, settings, await engine());
      const key = digest(canonical(input));
      if (!await cleanPrepared(input)) return { input, packet: null };
      const recover = async () => {
        const saved = await retained(staff, cardId, side, upload.uploadId, photo.workingFrame, { input });
        if (!saved) return { input, packet: null };
        const { visual, job: original } = saved;
        // Native output is deliberately absent. The current native preparer
        // consumes these exact retained proposals after the codec repair.
        return { input: original.input, packet: { policy: POLICY, key: original.key, binding: original.input, photoFrame: photo.workingFrame,
          physical: { id: visual.responseHash, actor: 'ASTRA', identity: ASTRA_GEOMETRY_POLICY,
            frameDescriptorSha256: original.input.frameDescriptorSha256, proposal: geometryProposal(visual, 'physical'),
            ...(visual.physical.contour.length ? { materialContour: visual.physical.contour } : {}) },
          visual, preparation: null, preparedImages: null } };
      };
      // Resolve an existing proposal before any scheduling side effect. A
      // native-code change never authorizes buying a replacement Astra reply.
      let job = await store.read(staff, cardId, key, input);
      if (job?.error === 'GEOMETRY_REFRESH_AVAILABLE') return recover();
      await store.ensure(staff, input); api.start();
      const until = Date.now() + timeoutMs;
      do {
        job = await store.read(staff, cardId, key, input);
        if (TERMINAL.includes(job?.state)) break;
        if (Date.now() >= until) return { input, packet: null };
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (true);
      if (job.state === 'FAILED' || !job.result) return recover();
      const packet = await artifacts.read(job.result.ref, { cardId, kind: 'EARLY_GEOMETRY', sourceHash: key });
      requireThat(packet.key === key && equal(packet.binding, input), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
      if (packet.preparation) {
        const manifest = await artifacts.read(packet.preparedImages.ref, { cardId, kind: 'PREPARED_IMAGES', sourceHash: packet.preparedImages.sourceHash });
        const names = preparationOutputNames(PREPARATION_CORE_V1);
        requireThat(manifest.frameId === packet.preparation.frame.id && equal(manifest.identity, input.engine.runtime.identity)
          && manifest.outputContract === PREPARATION_CORE_V1 && packet.preparation.outputContract === PREPARATION_CORE_V1
          && manifest.deferredReveals?.outputContract === PREPARATION_REVEALS_V1
          && equal(manifest.deferredReveals.workingFrame, photo.workingFrame)
          && equal(manifest.deferredReveals.preparation, packet.preparation)
          && equal(packet.preparation.sourceQuad, packet.physical.proposal.proposal)
          && manifest.images && Object.keys(manifest.images).length === names.length && names.every(name => manifest.images[name]), 503, 'GEOMETRY_STORED_CONTENT_INVALID');
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
