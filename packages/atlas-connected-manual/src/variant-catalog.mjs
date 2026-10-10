import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, compareVariantCardNumber, variantChoicesFromPublishedLookup,
  createVariantReviewSnapshot, validateVariantCandidate, validateVariantReviewSnapshot, createVariantSourceReader,
  createTcgdexVariantProvider, createScrydexVariantProvider, createScrydexMetadataReader, createVariantProviderImageReader } from '@tenkings/card-catalog-evidence';
import { prepareVariantCatalogObservation } from './variant-catalog-proposal.mjs';
import { variantChoicesFromDemand } from './variant-demand.mjs';

const abort = signal => signal?.throwIfAborted();
const fail = code => Object.assign(new Error(code), { code });
const scopeFields = ['language', 'edition', 'format', 'channel'];
const pinFrom = p => ({ publicationId: p.publicationId, setId: p.setId, revision: p.revision, manifestSha256: p.manifestSha256 });
const samePin = (a, b) => canonicalJson(pinFrom(a)) === canonicalJson(pinFrom(b));
async function bounded(signal, timeoutMs, work) {
  abort(signal); const controller = new AbortController(); let timer, stopped;
  const stop = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', stop, { once: true });
  const expired = new Promise((_, reject) => {
    stopped = () => reject(controller.signal.reason ?? fail('VARIANT_CATALOG_CANCELLED'));
    controller.signal.addEventListener('abort', stopped, { once: true });
    timer = setTimeout(() => controller.abort(fail('VARIANT_CATALOG_TIMEOUT')), timeoutMs);
  });
  try { return await Promise.race([work(controller.signal), expired]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); controller.signal.removeEventListener('abort', stopped); controller.abort(); }
}
function queryFor(identity, publication = null) {
  return { category: identity.category, ...(publication ? { setId: publication.setId } : { setLabel: identity.setName }),
    ...(identity.year ? { year: identity.year } : {}), ...(identity.name ? { cardName: identity.name } : {}),
    ...(identity.category === 'SPORTS' && identity.manufacturer ? { manufacturer: identity.manufacturer } : {}),
    ...(identity.language ? { language: identity.language } : {}), limit: 24 };
}
function scopedQuery(identity, publication, candidate) {
  return { ...queryFor(identity, publication), cardId: candidate.card.cardId, printingId: candidate.printing.printingId,
    ...Object.fromEntries(scopeFields.filter(k => candidate.printing[k] !== null).map(k => [k, candidate.printing[k]])) };
}

/** Server-owned composition. The existing collect client authenticates current
 * SetOps publication authority. Providers only add explicit review candidates.
 * No physical photos, model requests or saved identities are changed here. */
export function createVariantCatalogService({ catalogClient = null, providers, cache = null, scrydex = null, inspectProviderImage = null,
  fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 45000 } = {}) {
  if (providers === undefined) {
    providers = [createTcgdexVariantProvider({ reader: createVariantSourceReader({ cache, fetchImpl, now }) })];
    if (scrydex !== null) {
      const inspectImage = inspectProviderImage ?? (async bytes => {
        const sharp = (await import('sharp')).default, decoder = sharp(bytes, { limitInputPixels: 52000000, failOn: 'warning' });
        const info = await decoder.metadata();
        if (info.pages && info.pages !== 1 || !['jpeg', 'png', 'webp'].includes(info.format)) throw fail('VARIANT_IMAGE_INVALID');
        await decoder.clone().raw().toBuffer(); // Force a full decode, retain the original bytes.
        return { mimeType: `image/${info.format}`, width: info.width, height: info.height };
      });
      providers.unshift(createScrydexVariantProvider({ reader: createScrydexMetadataReader({ ...scrydex, cache, fetchImpl, now }),
        imageReader: createVariantProviderImageReader({ cache, inspectImage, fetchImpl, now }) }));
    }
  } else if (scrydex !== null) throw fail('VARIANT_CATALOG_CONFIGURATION');
  if (!Array.isArray(providers) || providers.length > 3 || providers.some(p => typeof p.prepare !== 'function')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000) throw fail('VARIANT_CATALOG_CONFIGURATION');
  async function catalogChoices(identity, signal) {
    if (!catalogClient) return { candidates: [], problems: ['CATALOG_NOT_CONFIGURED'], truncated: false };
    const candidates = [], problems = [];
    let reads = 0, truncated = false;
    const discovered = await catalogClient.findCurrentSetCatalogPublications({ query: queryFor(identity) }, signal);
    for (const publication of discovered.slice(0, 4)) {
      abort(signal);
      const result = await catalogClient.lookupPublishedSetCatalogEvidence({ publication, query: queryFor(identity, publication) }, signal);
      reads++;
      if (!samePin(result.publication, publication)) throw fail('VARIANT_CATALOG_PUBLICATION_CHANGED');
      truncated ||= result.truncated;
      const matching = result.candidates.filter(c => (!identity.cardNumber || compareVariantCardNumber(identity.cardNumber, c.card.number) !== 'conflict')
        && c.recordedApplicability !== 'excluded');
      for (const candidate of matching) {
        let detailed = { ...result, candidates: [candidate] };
        // Candidate-scoped reads enumerate valid choices; they do not assert
        // that the physical card has the candidate's language or edition.
        if (candidate.recordedApplicability === 'supported' && candidate.unresolvedScopeFields.length && scopeFields.every(k => candidate.printing[k] !== null)) {
          if (reads < 20) {
            detailed = await catalogClient.lookupPublishedSetCatalogEvidence({ publication, query: scopedQuery(identity, publication, candidate) }, signal);
            reads++;
          } else truncated = true;
        }
        if (!samePin(detailed.publication, publication)) throw fail('VARIANT_CATALOG_PUBLICATION_CHANGED');
        candidates.push(...variantChoicesFromPublishedLookup(detailed));
      }
      if (!await catalogClient.currentFor(publication, identity.category, signal)) throw fail('VARIANT_CATALOG_PUBLICATION_CHANGED');
    }
    truncated ||= discovered.length > 4;
    if (truncated) problems.push('CATALOG_TRUNCATED');
    return { candidates, problems, truncated };
  }
  return Object.freeze({
    async submitReference(request,{signal}={}) {
      if(!catalogClient?.submitReference)throw fail('VARIANT_CATALOG_NOT_CONFIGURED');
      return bounded(signal,timeoutMs,active=>catalogClient.submitReference(request,active));
    },
    async submitObservation(payload, { signal } = {}) {
      if (!catalogClient) throw fail('VARIANT_CATALOG_NOT_CONFIGURED');
      const prepared = prepareVariantCatalogObservation(payload);
      return bounded(signal, timeoutMs, active => catalogClient.submit(prepared.proposal, active));
    },
    async prepare(input, { signal } = {}) {
      return bounded(signal, timeoutMs, async signal => {
      abort(signal);
      const identity = normalizeVariantIdentity(input.identity), candidates = [], problems = [];
      if (!identity.name || !identity.setName || !identity.cardNumber || !identity.year) {
        return createVariantReviewSnapshot({ identity, candidates, problems: ['IDENTITY_INCOMPLETE'], capturedAt: new Date(now()).toISOString() });
      }
      let truncated = false;
      try {
        const catalog = await catalogChoices(identity, signal); candidates.push(...catalog.candidates); problems.push(...catalog.problems); truncated ||= catalog.truncated;
      } catch { abort(signal); problems.push('CATALOG_UNAVAILABLE'); }
      // Only the isolated worker calls prepare. This uses the shared host's
      // deduplicated set acquisition, never the grading pool or browser GET.
      if(catalogClient?.prepareSetDemand && !candidates.some(c=>c.applicability==='supported')
        && (identity.category!=='SPORTS'||identity.manufacturer)) {
        let demand;
        try { demand=await catalogClient.prepareSetDemand({demand:{category:identity.category,year:identity.year,
          manufacturer:identity.manufacturer,setName:identity.setName,language:identity.language},
          card:{name:identity.name,cardNumber:identity.cardNumber}},signal);
          candidates.push(...variantChoicesFromDemand(demand,identity)); truncated ||= demand.coverage==='truncated';
          if(demand.state==='UNAVAILABLE') problems.push('CATALOG_UNAVAILABLE');
        } catch { abort(signal); problems.push('CATALOG_UNAVAILABLE'); }
        // A sibling request may still be preparing this set. Retry before
        // saving immutable comparison inputs; do not pin an empty READY job.
        if(demand&&['QUEUED','RUNNING'].includes(demand.state)) throw fail('VARIANT_CATALOG_PENDING');
      }
      for (const provider of providers) {
        abort(signal);
        try {
          const result = await provider.prepare(identity, { signal });
          candidates.push(...result.candidates.map(validateVariantCandidate)); problems.push(...result.problems); truncated ||= result.truncated;
        } catch { abort(signal); problems.push('PROVIDER_UNAVAILABLE'); }
      }
      abort(signal);
      return createVariantReviewSnapshot({ identity, candidates, problems, truncated, capturedAt: new Date(now()).toISOString() });
      });
    },
    /** Reauthorize publication and resolve images again after a process restart.
     * The saved descriptor is a hash pin, never a raw storage capability. */
    async readImage({ snapshot, candidateId, imageId }, { signal } = {}) {
      return bounded(signal, Math.min(timeoutMs, 15000), async signal => {
      const valid = validateVariantReviewSnapshot(snapshot), candidate = valid.candidates.find(c => c.candidateId === candidateId), image = candidate?.images.find(i => i.imageId === imageId);
      if (!candidate || !image) throw fail('VARIANT_REFERENCE_UNAVAILABLE');
      if (candidate.authority === 'provider_candidate') {
        const provider = providers.find(p => p.id === candidate.source.provider && typeof p.readImage === 'function');
        if (!provider) throw fail('VARIANT_REFERENCE_UNAVAILABLE');
        const acquired = await provider.readImage({ candidate, image }, { signal });
        if (!Buffer.isBuffer(acquired.bytes) || createHash('sha256').update(acquired.bytes).digest('hex') !== image.sha256
          || acquired.sha256 !== image.sha256 || acquired.mimeType !== image.mimeType || acquired.width !== image.width || acquired.height !== image.height) throw fail('VARIANT_REFERENCE_CHANGED');
        return acquired;
      }
      if (!catalogClient || !image.publication || image.provenance.usage !== 'reviewed_catalog') throw fail('VARIANT_REFERENCE_UNAVAILABLE');
      const publication = image.publication, identity = candidate.identity;
      if (!await catalogClient.currentFor(publication, identity.category, signal)) throw fail('VARIANT_REFERENCE_SUPERSEDED');
      const broad = await catalogClient.lookupPublishedSetCatalogEvidence({ publication,
        query: { ...queryFor(identity, publication), cardId: candidate.canonical.cardId, printingId: candidate.canonical.printingId } }, signal);
      const selected = broad.candidates.find(c => c.card.cardId === candidate.canonical.cardId && c.printing.printingId === candidate.canonical.printingId);
      if (!selected || selected.recordedApplicability !== 'supported' || scopeFields.some(k => selected.printing[k] === null)) throw fail('VARIANT_REFERENCE_UNAVAILABLE');
      const scoped = await catalogClient.lookupPublishedSetCatalogEvidence({ publication, query: scopedQuery(identity, publication, selected) }, signal);
      const current = variantChoicesFromPublishedLookup(scoped).find(c => c.candidateId === candidateId)?.images.find(i => i.imageId === imageId);
      if (!current || canonicalJson(current) !== canonicalJson(image)) throw fail('VARIANT_REFERENCE_CHANGED');
      const bytes = await catalogClient.readPublishedSetCatalogImage({ publication, imageId }, signal);
      if (!Buffer.isBuffer(bytes.bytes) || bytes.bytes.length > 4 * 1024 * 1024 || createHash('sha256').update(bytes.bytes).digest('hex') !== image.sha256
        || bytes.sha256 !== image.sha256 || bytes.width !== image.width || bytes.height !== image.height || bytes.mimeType !== image.mimeType
        || !await catalogClient.currentFor(publication, identity.category, signal)) throw fail('VARIANT_REFERENCE_CHANGED');
      return bytes;
      });
    },
  });
}
