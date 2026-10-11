import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, compareVariantCardNumber, variantChoicesFromPublishedLookup,
  createVariantReviewSnapshot, validateVariantCandidate, validateVariantReviewSnapshot, validateVariantReferencePhoto,
  createScrydexVariantProvider, createScrydexMetadataReader, createVariantProviderImageReader, createManufacturerChecklistVariantProvider } from '@tenkings/card-catalog-evidence';
import { variantCodexChoice, codexLibraryKey, validateCodexLibrary, codexReadingKey, CODEX_LABEL_POLICY, CODEX_LABEL_MODEL } from './variant-codex.mjs';
import { prepareVariantCatalogObservation } from './variant-catalog-proposal.mjs';
import {prepareVariantListingRequest} from './variant-listing-provider.mjs';

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
export function createVariantCatalogService({ catalogClient = null, providers, cache = null, scrydex = null, listingProvider = null, inspectProviderImage = null,
  fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 45000 } = {}) {
  if (providers === undefined) {
    providers = [createManufacturerChecklistVariantProvider()];
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
    async prepare(input, { signal, executeListingSource } = {}) {
      let base;
      try{base = await bounded(signal, timeoutMs, async signal => {
      abort(signal);
      const identity = normalizeVariantIdentity(input.identity), candidates = [], problems = [];
      if (!identity.name || !identity.setName || !identity.cardNumber || !identity.year) {
        return createVariantReviewSnapshot({ identity, candidates, problems: ['IDENTITY_INCOMPLETE'], capturedAt: new Date(now()).toISOString() });
      }
      let truncated = false;
      for (const provider of providers) {
        abort(signal);
        try {
          const result = await provider.prepare(identity, { signal });
          candidates.push(...result.candidates.map(validateVariantCandidate)); problems.push(...result.problems); truncated ||= result.truncated;
        } catch { abort(signal); problems.push('PROVIDER_UNAVAILABLE'); }
      }
      try {
        const catalog = identity.category === 'POKEMON' || candidates.length > 0 ? { candidates: [], problems: [], truncated: false } : await catalogChoices(identity, signal); candidates.push(...catalog.candidates); problems.push(...catalog.problems); truncated ||= catalog.truncated;
      } catch { abort(signal); problems.push('CATALOG_UNAVAILABLE'); }
      abort(signal);
      return createVariantReviewSnapshot({ identity, candidates, problems, truncated, capturedAt: new Date(now()).toISOString() });
      });}catch(error){
        abort(signal);
        if(!listingProvider||error.code!=='VARIANT_CATALOG_TIMEOUT')throw error;
        // A metadata timeout does not spend the independent listing window.
        // The cancelled metadata phase cannot later add to this saved result.
        base=createVariantReviewSnapshot({identity:normalizeVariantIdentity(input.identity),candidates:[],
          problems:['CATALOG_UNAVAILABLE','PROVIDER_UNAVAILABLE'],capturedAt:new Date(now()).toISOString()});
      }
      if(!listingProvider||base.problems.includes('IDENTITY_INCOMPLETE'))return base;
      const identity=normalizeVariantIdentity(input.identity),problems=base.problems.filter(p=>!['NO_VARIANTS_FOUND','NO_DIAGNOSTIC_PHOTOS'].includes(p));
      let candidates=base.candidates,truncated=base.coverage.metadata==='truncated';const referencePhotos=new Map();let labelPool=false;
      // Metadata discovery, billed source retrieval and photo downloads have
      // separate bounded windows. Discovery cannot consume the paid send's
      // deadline. Only the worker can supply this durable dispatch capability.
      if(typeof executeListingSource!=='function')problems.push('LISTING_SOURCE_NOT_CONFIGURED');
      else {
        // One durable, shared request for each catalog printing, never for each
        // staff visit. Bound fan-out; absent photos do not hide known choices.
        const named = candidates.filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW'));
        const searches = [...new Map(named.map(c => [canonicalJson({name:c.label.toLowerCase(),language:c.identity.language}),
          {name:c.label,language:c.identity.language}])).values()];
        const populated=new Set();
        // Permanent Codex references belong to the catalog printing, not this submission.
        for(const candidate of named) {
          const choice=variantCodexChoice(candidate),saved=await cache?.getRetained?.(codexLibraryKey(choice));
          if(saved) {
            const entry=validateCodexLibrary(saved,choice); labelPool=true;
            for(const {image} of entry.references) referencePhotos.set(image.sha256,image);
            populated.add(choice.key);
          }
        }
        const pending = searches.filter(printing => !named.some(c => c.label === printing.name && c.identity.language === printing.language
          && populated.has(variantCodexChoice(c).key)));
        // Snapshot validation already caps this at 48 known choices. Every
        // printing gets one permanent ordinary search; only explicit missing-reference
        // refresh generations may authorize another bounded search.
        for (const printing of pending) try {
          abort(signal);
          const request=prepareVariantListingRequest(identity,printing,{graded:true,...(input.generation?{generation:input.generation}:{})});
          const saved=await bounded(signal,timeoutMs,active=>executeListingSource(request,()=>listingProvider.fetchSource(request,{signal:active})));
          if(saved.state==='UNKNOWN')problems.push('LISTING_SOURCE_OUTCOME_UNKNOWN');
          else {
            if(!['SAVED','REUSED'].includes(saved.state)||!saved.source)throw fail('VARIANT_LISTING_SOURCE_INVALID');
            const isKnownReference=input.generation?async sha256=>{
              const reading=await cache?.getRetained?.(codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},sha256));
              if(!reading)return false;
              if(reading.schemaVersion!=='atlas-codex-reading/v1'||reading.policy!==CODEX_LABEL_POLICY||reading.reading?.sha256!==sha256)throw fail('VARIANT_CODEX_READING_INVALID');
              return true;
            }:undefined;
            const evidence=await bounded(signal,timeoutMs,active=>listingProvider.acquireImages({request,source:saved.source,catalogCandidates:named},{signal:active,imageLimit:2,...(isKnownReference?{isKnownReference}:{})}));
            if(Object.hasOwn(evidence,'referencePhotos')){
              labelPool=true;
              if(!Array.isArray(evidence.referencePhotos)||evidence.referencePhotos.length>2)throw fail('VARIANT_LISTING_SOURCE_INVALID');
              for(const raw of evidence.referencePhotos){const image=validateVariantReferencePhoto(raw);
                if(image.sourceResponseSha256!==saved.source.sha256)throw fail('VARIANT_LISTING_SOURCE_INVALID');
                if(!referencePhotos.has(image.sha256))referencePhotos.set(image.sha256,image);
              }
            }
          }
        } catch(error) { abort(signal);if(error.code==='VARIANT_GRADING_PRIORITY_DEFERRED')throw error;problems.push('LISTING_SOURCE_UNAVAILABLE'); }
      }
      abort(signal);return createVariantReviewSnapshot({identity,candidates,problems,truncated,capturedAt:new Date(now()).toISOString(),...(labelPool?{referencePhotos:[...referencePhotos.values()]}:{})});
    },
    /** Reauthorize publication and resolve images again after a process restart.
     * The saved descriptor is a hash pin, never a raw storage capability. */
    async readImage({ snapshot, candidateId, imageId }, { signal } = {}) {
      return bounded(signal, Math.min(timeoutMs, 15000), async signal => {
      const valid = validateVariantReviewSnapshot(snapshot), candidate = valid.candidates.find(c => c.candidateId === candidateId),
        image = candidateId == null ? valid.referencePhotos?.find(i => i.imageId === imageId) : candidate?.images.find(i => i.imageId === imageId);
      if (!image) throw fail('VARIANT_REFERENCE_UNAVAILABLE');
      if(image.relationship==='listing_photo'){
        if(!listingProvider||typeof listingProvider.readImage!=='function')throw fail('VARIANT_REFERENCE_UNAVAILABLE');
        const acquired=await listingProvider.readImage(image,{signal});
        if(!Buffer.isBuffer(acquired.bytes)||acquired.bytes.length>2097152||createHash('sha256').update(acquired.bytes).digest('hex')!==image.sha256
          ||acquired.sha256!==image.sha256||acquired.mimeType!==image.mimeType||acquired.width!==image.width||acquired.height!==image.height)throw fail('VARIANT_REFERENCE_CHANGED');
        return acquired;
      }
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
