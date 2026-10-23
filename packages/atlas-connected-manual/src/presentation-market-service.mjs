import { digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { marketHasRetiredReclassification, marketJobStatus } from './market-job-store.mjs';
import { createPresentationMarket, marketPreviewHash, MARKET_UNAVAILABLE_REASONS } from './presentation-market.mjs';
import { projectRetrievedMarketPool } from './market-retrieved-pool.mjs';
import { ARCHIVE_MARKET_ORIGIN, assertMarketArchiveSearchCapability } from './market-archive-search.mjs';

// Automatic approval jobs and explicit staff refresh share saved previews.
// Durable mode never calls a provider inside HTTP; ambiguous requests remain
// fenced. Public report visits read only deliberately selected evidence.
export function createPresentationMarketService({ repository, approved, artifacts, provider = null, readPhoto = null, jobs = null, worker = null, archiveSearch = null }) {
  if (archiveSearch) {
    assertMarketArchiveSearchCapability(archiveSearch, { artifacts });
    requireThat(jobs?.archiveSearch === archiveSearch, 500, 'MARKET_ARCHIVE_CONFIGURATION_INVALID');
  }
  const market = createPresentationMarket();
  async function saved(staff, cardId, requestId, readRepository = repository) {
    const row = await readRepository.market(staff, cardId, requestId);
    const binding = { approvalActionId: row.input.approvalActionId };
    if (row.state === 'STARTED') return { ...binding, state: 'PENDING', previewId: requestId };
    if (row.state !== 'READY') return { ...binding, state: row.state, previewId: requestId,
      ...(row.state === 'UNAVAILABLE' && MARKET_UNAVAILABLE_REASONS.includes(row.saved?.reason) ? { reason: row.saved.reason } : {}) };
    const record = row.saved;
    requireThat(record?.state === 'READY' && record.ref?.kind === 'MARKET_PREVIEW', 503, 'MARKET_PREVIEW_CORRUPT');
    const preview = await artifacts.read(record.ref, { cardId, kind: 'MARKET_PREVIEW', sourceHash: record.artifactHash });
    requireThat(digest(JSON.stringify(preview)) === record.artifactHash && marketPreviewHash(preview) === record.sourceHash, 503, 'MARKET_PREVIEW_CORRUPT');
    await readRepository.market(staff, cardId, requestId);
    return { ...binding, state: 'READY', previewId: requestId, preview, sourceHash: record.sourceHash, ref: record.ref, input: row.input };
  }
  const publicPreview = value => {
    const { sourceHash, ref, input, ...publicValue } = value; return publicValue;
  };
  async function activeStatus(staff, cardId, job) {
    const status = marketJobStatus(job);
    if (status.state !== 'SEARCHING' || job.response?.responsePolicy !== 'ATLAS_SLAB_V1'
      || marketHasRetiredReclassification(job)) return status;
    const source = await (archiveSearch?.approved ?? approved).loadPacket(staff, cardId, job.approval_action_id);
    return { ...status, stage: 'READING_PHOTOS', retrieved: projectRetrievedMarketPool(source, job) };
  }
  return Object.freeze({
    enabled: Boolean(provider && jobs),
    async image(staff, cardId, previewId, sha256) {
      uuid(previewId); requireThat(/^[a-f0-9]{64}$/.test(sha256) && typeof readPhoto === 'function', 404, 'MARKET_IMAGE_NOT_FOUND');
      const value = await saved(staff, cardId, previewId);
      const candidate = value.preview?.candidates?.find(row => row.slabReading?.sha256 === sha256);
      requireThat(candidate?.slabReading?.imageUrl, 404, 'MARKET_IMAGE_NOT_FOUND');
      const photo = await readPhoto(candidate.slabReading.imageUrl, sha256);
      requireThat(photo?.bytes && digest(photo.bytes) === sha256, 503, 'MARKET_IMAGE_CORRUPT');
      await repository.market(staff, cardId, previewId);
      return { bytes: photo.bytes, contentType: photo.mimeType };
    },
    async status(staff, cardId) {
      if (archiveSearch) assertMarketArchiveSearchCapability(archiveSearch, { artifacts });
      // Legacy approval polling may precede publication. Only archive-origin
      // jobs require the PUBLISHED-only read scope at this point. Retained
      // response photo status below is necessarily post-publication.
      let job = jobs ? await jobs.latest(staff, cardId) : null;
      const archive = job?.origin === ARCHIVE_MARKET_ORIGIN;
      if (archive) {
        requireThat(archiveSearch, 503, 'MARKET_ARCHIVE_CONFIGURATION_REQUIRED');
        job = await jobs.latest(staff, cardId, { archive: true });
      }
      const reads = archive ? archiveSearch.repository : repository;
      if (job) {
        const status = await activeStatus(staff, cardId, job);
        if (status.state !== 'READY') return status;
        return { ...status, ...publicPreview(await saved(staff, cardId, status.previewId, reads)) };
      }
      const id = await reads.latestMarket(staff, cardId);
      if (!id) return { state: 'NOT_REQUESTED', refreshable: Boolean(provider && jobs) };
      const value = publicPreview(await saved(staff, cardId, id, reads));
      return { ...value, state: value.state === 'PENDING' ? 'UNKNOWN' : value.state,
        refreshable: !['PENDING','UNKNOWN'].includes(value.state) && Boolean(provider && jobs) };
    },
    async preview(staff, cardId, input) {
      if (!provider) return { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED', refreshable: false };
      requireThat(jobs, 503, 'MARKET_DURABLE_LABEL_WORKER_REQUIRED');
      if (archiveSearch) assertMarketArchiveSearchCapability(archiveSearch, { artifacts });
      const job = await jobs.reserve(staff, cardId, input, { archive: Boolean(archiveSearch) });
      void worker?.wake();
      return job.state === 'READY' ? { ...marketJobStatus(job), ...publicPreview(await saved(staff, cardId, job.request_id, archiveSearch?.repository ?? repository)), requestId: input.requestId } : { ...await activeStatus(staff, cardId, job), requestId: input.requestId };
    },
    async select(staff, cardId, input) {
      object(input, ['requestId','approvalActionId','expectedRevision','previewId','selectedIds']);
      uuid(input.requestId); uuid(input.approvalActionId); uuid(input.previewId);
      requireThat(Array.isArray(input.selectedIds) && input.selectedIds.length > 0);
      const committed = await repository.marketCommitStatus(staff, cardId, input);
      if (committed) return committed;
      const found = await saved(staff, cardId, input.previewId);
      requireThat(found.state === 'READY' && found.input.approvalActionId === input.approvalActionId, 409, 'MARKET_PREVIEW_NOT_READY');
      const source = await approved.loadPacket(staff, cardId, input.approvalActionId);
      const selected = market.select({ ...source, preview: found.preview, sourceHash: found.sourceHash, selectedIds: input.selectedIds });
      return repository.commit(staff, cardId, { requestId: input.requestId, approvalActionId: input.approvalActionId, expectedRevision: input.expectedRevision }, null,
        { market: selected, source: { version: 'atlas-selected-market-source-v1', previewId: input.previewId, ref: found.ref,
          sourceHash: found.sourceHash, selectedIds: [...input.selectedIds] } });
    },
  });
}
