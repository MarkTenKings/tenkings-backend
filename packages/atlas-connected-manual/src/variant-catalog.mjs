import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity,
  createVariantReviewSnapshot, validateVariantCandidate, validateVariantReviewSnapshot, validateVariantReferencePhoto,
  createScrydexVariantProvider, createScrydexMetadataReader, createVariantProviderImageReader, createManufacturerChecklistVariantProvider } from '@tenkings/card-catalog-evidence';
import { variantCodexChoice, variantCodexAliases, codexLibraryKey, validateCodexLibrary, codexPhotoPoolKey, validateCodexPhotoPool,
  codexReadingKey, reassociateCodexReading, CODEX_LABEL_POLICY, CODEX_LABEL_MODEL } from './variant-codex.mjs';
import {prepareVariantListingRequest,variantChecklistListingIdentity} from './variant-listing-provider.mjs';

const abort = signal => signal?.throwIfAborted();
const fail = code => Object.assign(new Error(code), { code });
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
/** ATLAS-owned provider composition. Manufacturer bundles and direct provider
 * evidence feed the retained reference cache; no external catalog authority. */
export function createVariantCatalogService({ providers, cache = null, scrydex = null, listingProvider = null, inspectProviderImage = null,
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
  return Object.freeze({
    async prepare(input, { signal, executeListingSource, priorCatalog = null, onCatalog = null } = {}) {
      const localOnly = input.localOnly === true;
      // Initial preparation has a durable browser request ID, but it still
      // reuses ordinary paid journals. Only an explicit refresh of a prior
      // job authorizes a fresh missing-reference acquisition generation.
      const listingGeneration = input.reuseJobKey === null ? null : input.generation;
      let base;
      try{base = await bounded(signal, timeoutMs, async signal => {
      abort(signal);
      const identity = normalizeVariantIdentity(input.identity), candidates = [], problems = [];
      if (!identity.name || !identity.setName || !identity.cardNumber
        || !identity.year && (identity.category === 'POKEMON' || !identity.manufacturer)) {
        return createVariantReviewSnapshot({ identity, candidates, problems: ['IDENTITY_INCOMPLETE'], capturedAt: new Date(now()).toISOString() });
      }
      let truncated = false;
      for (const provider of providers) {
        abort(signal);
        try {
          const result = await provider.prepare(identity, { signal, retainedOnly:localOnly });
          candidates.push(...result.candidates.map(validateVariantCandidate)); problems.push(...result.problems); truncated ||= result.truncated;
        } catch { abort(signal); problems.push('PROVIDER_UNAVAILABLE'); }
      }
      abort(signal);
      return createVariantReviewSnapshot({ identity, candidates, problems, truncated, capturedAt: new Date(now()).toISOString() });
      });}catch(error){
        abort(signal);
        if(!listingProvider||error.code!=='VARIANT_CATALOG_TIMEOUT')throw error;
        // A metadata timeout does not spend the independent listing window.
        // The cancelled metadata phase cannot later add to this saved result.
        base=createVariantReviewSnapshot({identity:normalizeVariantIdentity(input.identity),candidates:[],
          problems:['PROVIDER_UNAVAILABLE'],capturedAt:new Date(now()).toISOString()});
      }
      if(!listingProvider||base.problems.includes('IDENTITY_INCOMPLETE'))return base;
      const identity=normalizeVariantIdentity(input.identity),problems=base.problems.filter(p=>!['NO_VARIANTS_FOUND','NO_DIAGNOSTIC_PHOTOS'].includes(p));
      let candidates=base.candidates,truncated=base.coverage.metadata==='truncated';const referencePhotos=new Map((priorCatalog?.referencePhotos??[]).map(p=>[p.sha256,p]));let labelPool=referencePhotos.size>0;
      const checkpoint=async()=>{
        if(onCatalog)await onCatalog(createVariantReviewSnapshot({identity,candidates,problems:[...problems,'REFERENCE_ACQUISITION_PENDING'],truncated,
          capturedAt:new Date(now()).toISOString(),...(labelPool?{referencePhotos:[...referencePhotos.values()]}:{})}));
      };
      await checkpoint();
      // Metadata discovery has its own timeout. Paid listing work follows the
      // worker lease; image reads have their own bounded transport/byte checks.
      if(typeof executeListingSource!=='function')problems.push('LISTING_SOURCE_NOT_CONFIGURED');
      else {
        // One durable, shared request for each catalog printing, never for each
        // staff visit. Bound fan-out; absent photos do not hide known choices.
        const named = candidates.filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW'));
        // A missing sports year may use each exact retained manufacturer row
        // as its source-bound search identity;
        // the store verifies that row independently before any reservation.
        const searchable = identity.year ? named : named.filter(c => {
          try { variantChecklistListingIdentity(identity, [c], c.identity.year); return true; } catch { return false; }
        });
        const searches = [...new Map(searchable.map(c => [canonicalJson({name:c.label.toLowerCase(),language:c.identity.language,cardNumber:c.identity.cardNumber,
          ...(!identity.year?{year:c.identity.year}:{})}), {name:c.label,language:c.identity.language,cardNumber:c.identity.cardNumber,...(!identity.year?{year:c.identity.year}:{})}])).values()];
        const listingRequest = (printing, generation = null) => prepareVariantListingRequest(
          {...(identity.year ? identity : variantChecklistListingIdentity(identity, searchable, printing.year)),cardNumber:printing.cardNumber},
          {name:printing.name,language:printing.language},{...(generation?{generation}:{})});
        const populated=new Set(),choiceKeys=new Set(named.map(candidate=>variantCodexChoice(candidate).key)),readings=new Map();
        const revisitReadings=async photos=>{
          for(const image of photos){
            if(!readings.has(image.sha256))readings.set(image.sha256,await cache?.getRetained?.(codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},image.sha256))??null);
            const reading=readings.get(image.sha256);if(!reading)continue;
            if(reading.schemaVersion!=='atlas-codex-reading/v1'||reading.policy!==CODEX_LABEL_POLICY||reading.reading?.sha256!==image.sha256
              ||!Array.isArray(reading.choices)||reading.reading.candidateKey!==null&&!reading.choices.some(c=>c.key===reading.reading.candidateKey))throw fail('VARIANT_CODEX_READING_INVALID');
            const projected=reassociateCodexReading(reading.reading,base,reading.choices,reading.catalogContext??[]);
            if(choiceKeys.has(projected.candidateKey))populated.add(projected.candidateKey);
          }
        };
        // Permanent Codex references belong to the catalog printing, not this submission.
        for(const candidate of named) for(const choice of variantCodexAliases(candidate)) {
          const saved=await cache?.getRetained?.(codexLibraryKey(choice));
          if(saved) {
            const entry=validateCodexLibrary(saved,choice); labelPool=true;
            for(const {image} of entry.references) referencePhotos.set(image.sha256,image);
            populated.add(variantCodexChoice(candidate).key);
          }
        }
        // Shared pools also retain photos which had no catalog match. Revisit
        // their literal readings before buying a search for an added printing.
        const cards=[...new Map(named.flatMap(candidate=>variantCodexAliases(candidate).map(choice=>[choice.cardKey,choice]))).values()];
        for(const choice of cards){
          const saved=await cache?.getRetained?.(codexPhotoPoolKey(choice));if(!saved)continue;
          const pool=validateCodexPhotoPool(saved,choice);labelPool=true;
          for(const image of pool.photos)referencePhotos.set(image.sha256,image);
          await revisitReadings(pool.photos);
        }
        const hasReference=printing=>named.some(candidate=>candidate.label===printing.name&&candidate.identity.language===printing.language
          &&(!printing.year||candidate.identity.year===printing.year)
          &&populated.has(variantCodexChoice(candidate).key));
        const acquireRetainedPhotos=async(request,saved,{retainedOnly=false}={})=>{
            if(!['SAVED','REUSED'].includes(saved.state)||!saved.source)throw fail('VARIANT_LISTING_SOURCE_INVALID');
            const evidence=await listingProvider.acquireImages({request:saved.request??request,source:saved.source,catalogCandidates:named},{signal,retainedOnly});
            if(Object.hasOwn(evidence,'referencePhotos')){
              labelPool=true;
              if(!Array.isArray(evidence.referencePhotos))throw fail('VARIANT_LISTING_SOURCE_INVALID');
              for(const raw of evidence.referencePhotos){const image=validateVariantReferencePhoto(raw);
                if(image.sourceResponseSha256!==saved.source.sha256)throw fail('VARIANT_LISTING_SOURCE_INVALID');
              }
              await revisitReadings(evidence.referencePhotos);
              // Retain every saved photograph; local-only refresh never buys OCR.
              for(const image of evidence.referencePhotos)if(!referencePhotos.has(image.sha256))referencePhotos.set(image.sha256,image);
              await checkpoint();
            }
        };
        // R8 libraries contained only matched photos. Read every current
        // printing's ordinary journals first, even when its library is full,
        // so unmatched siblings can populate the shared pool before any new
        // printing acquires a source. A probe cannot reserve or dispatch.
        const retained=new Map();let bootstrapFailed=false;
        for(const printing of searches)try{
          abort(signal);const request=listingRequest(printing);
          const saved=await executeListingSource(request,()=>{throw fail('VARIANT_LISTING_READ_ONLY');},{retainedOnly:true});
          if(!['MISSING','UNKNOWN','REUSED'].includes(saved.state))throw fail('VARIANT_LISTING_READ_ONLY');
          retained.set(printing,saved.state);
          if(saved.state==='REUSED')await acquireRetainedPhotos(request,saved,{retainedOnly:true});
        }catch(error){abort(signal);if(error.code==='VARIANT_GRADING_PRIORITY_DEFERRED')throw error;bootstrapFailed=true;problems.push('LISTING_SOURCE_UNAVAILABLE');}
        for(const printing of searches){
          if(hasReference(printing))continue;
          if(!listingGeneration&&retained.get(printing)==='UNKNOWN')problems.push('LISTING_SOURCE_OUTCOME_UNKNOWN');
        }
        // One permanent ordinary request; deliberate missing-reference
        // generations retain their separate authority for a fresh search.
        const pending=searches.filter(printing=>!hasReference(printing)&&(listingGeneration||retained.get(printing)==='MISSING'));
        if(!localOnly&&(!bootstrapFailed||listingGeneration))for (const printing of pending) try {
          abort(signal);if(hasReference(printing))continue;
          const request=listingRequest(printing,listingGeneration);
          const saved=await executeListingSource(request,()=>listingProvider.fetchSource(request,{signal}));
          if(saved.state==='UNKNOWN')problems.push('LISTING_SOURCE_OUTCOME_UNKNOWN');
          else await acquireRetainedPhotos(request,saved);
        } catch(error) { abort(signal);if(error.code==='VARIANT_GRADING_PRIORITY_DEFERRED')throw error;problems.push('LISTING_SOURCE_UNAVAILABLE'); }
      }
      abort(signal);return createVariantReviewSnapshot({identity,candidates,problems,truncated,capturedAt:new Date(now()).toISOString(),...(labelPool?{referencePhotos:[...referencePhotos.values()]}:{})});
    },
    /** Resolve retained provider evidence after restart, checking its exact bytes. */
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
      throw fail('VARIANT_REFERENCE_UNAVAILABLE');
      });
    },
  });
}
