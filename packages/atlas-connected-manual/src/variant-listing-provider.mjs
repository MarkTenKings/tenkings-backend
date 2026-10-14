import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity } from '@tenkings/card-catalog-evidence';
import { isStaffInventoryResearchImageUrl } from '@tenkings/card-research-core/contract';
import { researchImageOptions } from '../../card-research-core/src/evidence.mjs';
import { boundedProviderOperation, readBoundedProviderBody } from '../../card-catalog-evidence/src/provider-media.mjs';
import { validVariantReferenceListing } from '../../card-catalog-evidence/src/variant-review.mjs';
import { resolveVariantSourceSeasonYear } from '../../card-catalog-evidence/src/variant-season.mjs';

export const VARIANT_LISTING_REVISION = 'variant-reference-photos-v3';
export const VARIANT_LISTING_LIMITS = Object.freeze({results:240,responseResults:240,sourceBytes:1024*1024,
 imageBytes:2*1024*1024,imagePixels:16000000,imageRequests:240,images:240,totalImageBytes:12*1024*1024,
 timeoutMs:45000,imageTimeoutMs:10000,ttlMs:86400000});
const endpoint='https://api.sold-comps.com/v1/scrape';
const listingProviderId='ebay_sold_comps_v2';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const check=(ok,code='VARIANT_LISTING_INVALID')=>{if(!ok)throw fail(code);};
const HASH=/^[a-f0-9]{64}$/;
const keys=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...fields].sort().join('|');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const normalize=v=>v.normalize('NFC').trim().replace(/\s+/gu,' ');
const languageNames={en:'english',ja:'japanese',fr:'french',de:'german',es:'spanish',it:'italian',pt:'portuguese',ko:'korean',zh:'chinese'};
export function variantChecklistListingIdentity(input,candidates,year,{retainedOnly=false}={}){
 const identity=normalizeVariantIdentity(input);
 const matching=candidates.filter(c=>c.source.provider==='manufacturer_checklist'
  && same({...c.identity,year:null},{...identity,year:null}));
 // A separate retained exact-year release remains eligible when discovery
 // also returns other seasons. It supplies its own year, not a season alias.
 if(!identity.year&&identity.category==='SPORTS'&&typeof year==='string'
  && matching.some(c=>!c.source.season&&c.identity.year===year))return {...identity,year};
 const sourced=matching.filter(c=>c.source.season
  && resolveVariantSourceSeasonYear(c.identity.year,c.source.season)!==null
  && (!identity.year||resolveVariantSourceSeasonYear(identity.year,c.source.season)!==null));
 if(sourced.length){
  check(typeof year==='string'&&sourced.some(c=>year===c.source.season.year
   || retainedOnly && (year===identity.year || c.source.season.startingYearAlias&&year===c.source.season.year.slice(0,4))), 'VARIANT_LISTING_REQUEST_CHANGED');
  return {...identity,year};
 }
 if(identity.year)return identity;
 check(identity.category==='SPORTS'&&typeof year==='string'&&matching.some(c=>c.identity.year===year),'VARIANT_LISTING_REQUEST_CHANGED');
 return {...identity,year};
}
/** Only retained journals use these source-proven year aliases. No alias is a
 * fallback search or a new acquisition key. Unrelated exact-year rows cannot
 * grant a bare-year alias because the reader sets startingYearAlias:false. */
export function variantChecklistListingYears(input,candidate){
 const season=candidate.source.provider==='manufacturer_checklist'?candidate.source.season:null;
 if(!season)return [candidate.identity.year];
 const years=[season.year];
 if(input.year&&resolveVariantSourceSeasonYear(input.year,season))years.push(input.year);
 if(season.startingYearAlias)years.push(season.year.slice(0,4));
 return [...new Set(years)];
}
/** A single concise search per printing. Search wording is discovery, never
 * proof of printing, grade or authenticity. Raw cards remain eligible. */
export function prepareVariantListingRequest(input,printing=null,{generation=null}={}){
 const fields=['category','name','year','setName','cardNumber','manufacturer','language'];
 check(input&&Object.keys(input).every(k=>fields.includes(k)),'VARIANT_LISTING_IDENTITY');
 const normalized=normalizeVariantIdentity(Object.fromEntries(Object.entries(input).map(([k,v])=>[k,typeof v==='string'?normalize(v):v])));
 const identity=normalizeVariantIdentity(Object.fromEntries(Object.entries(normalized).map(([k,v])=>[k,v===null||k==='category'?v:v.toLowerCase()])));
 check(identity.name&&identity.setName&&identity.cardNumber,'VARIANT_LISTING_IDENTITY_INCOMPLETE');
 check(generation===null||typeof generation==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(generation),'VARIANT_LISTING_REFRESH_GENERATION');
 if(printing!==null){
  check(keys(printing,['name','language'])&&typeof printing.name==='string'&&printing.name.trim()&&printing.name.length<=120&&!/[\x00-\x1f\x7f]/.test(printing.name),'VARIANT_LISTING_PRINTING');
  printing={name:normalize(printing.name).toLowerCase(),language:normalizeVariantIdentity({category:identity.category,language:printing.language}).language};
  check(!identity.language||!printing.language||identity.language===printing.language,'VARIANT_LISTING_PRINTING_LANGUAGE');
 }
 const finish=printing?.name.replace(/\bholofoil\b|\bholographic\b/g,'holo').replace(/^expansion stamp$/,'stamped')
  .replace(/^base cards?(?: [ivx]+)?(?:\s+|$)/,'').replace(/^chrome rookie red rc variation$/,'red rc');
 const term=/^(?:base|normal|base cards?)$/.test(finish??'')?null:finish;
 const query=[identity.name,identity.cardNumber.replace(/^#/,'').trim(),term,printing?.language&&printing.language!=='en'?languageNames[printing.language]??printing.language:null].filter(Boolean).join(' ');
 const url=new URL(endpoint);url.search=new URLSearchParams({keyword:query,ebaySite:'ebay.com',count:'240',page:'1',sold:'true',includeCompleteListing:'true',exactMatch:'true',hydrateBoa:'false'}).toString();
 const request={schemaVersion:'variant-listing-request/v1',revision:VARIANT_LISTING_REVISION,parserRevision:'photo-evidence-v3',identity,...(printing?{printing}:{}),...(generation?{generation}:{}),query,url:url.href};
 return {...request,requestKey:`variant-listing-source:v1:${hash(canonicalJson(request))}`};
}
function validateRequest(request){
 check(request?.revision===VARIANT_LISTING_REVISION&&same(request,prepareVariantListingRequest(request.identity,request.printing??null,{generation:request.generation??null})),'VARIANT_LISTING_REQUEST_CHANGED');return request;
}
function validateSource(request,source){
 validateRequest(request);
 check(keys(source,['schemaVersion','requestKey','url','httpStatus','contentType','bodyText','sha256','capturedAt'])&&source.schemaVersion==='variant-listing-response/v1'&&source.requestKey===request.requestKey&&source.url===request.url&&Number.isInteger(source.httpStatus)&&source.httpStatus>=100&&source.httpStatus<=599&&typeof source.contentType==='string'&&source.contentType.length<=200&&typeof source.bodyText==='string'&&Buffer.byteLength(source.bodyText)<=VARIANT_LISTING_LIMITS.sourceBytes&&HASH.test(source.sha256)&&hash(source.bodyText)===source.sha256&&date(source.capturedAt),'VARIANT_LISTING_SOURCE_CHANGED');
 if(source.httpStatus!==200)throw fail(source.httpStatus===401?'VARIANT_LISTING_CONFIGURATION':[403,429].includes(source.httpStatus)?'VARIANT_LISTING_LIMITED':'VARIANT_LISTING_HTTP_FAILURE');
 check(/^application\/json(?:\s*;|$)/i.test(source.contentType),'VARIANT_LISTING_SOURCE_TYPE');
 let payload;try{payload=JSON.parse(source.bodyText);}catch{throw fail('VARIANT_LISTING_SOURCE_JSON');}
 check(payload&&payload.keyword===request.query&&payload.page===1&&Number.isSafeInteger(payload.totalItems)&&payload.totalItems>=0&&typeof payload.hasNextPage==='boolean'&&Array.isArray(payload.items)&&payload.totalItems>=payload.items.length,'VARIANT_LISTING_SOURCE_SHAPE');return payload;
}
function referenceListing(raw){
 const clean=(v,n)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,n)||null:null;let url=null;
 try{const link=new URL(raw.url);if(link.protocol==='https:'&&!link.username&&!link.password&&!link.port&&(link.hostname==='ebay.com'||link.hostname.endsWith('.ebay.com'))&&link.pathname.startsWith('/itm/')){link.hash='';url=link.href.length<=2048?link.href:null;}}catch{}
 return {id:clean(raw.itemId,200),title:clean(raw.title,2000),url};
}
export function projectVariantListingSource(request,source){
 const payload=validateSource(request,source);
 return {schemaVersion:'variant-listing-evidence/v1',revision:VARIANT_LISTING_REVISION,requestKey:request.requestKey,identity:request.identity,query:request.query,source:{url:source.url,sha256:source.sha256,capturedAt:source.capturedAt},authority:'provider_candidate',coverage:'partial',requiresReview:true,
 listings:payload.items.map((value,sourceIndex)=>{const raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};return {sourceIndex,listing:referenceListing(raw),imageOptions:researchImageOptions(raw,true).image_options,image:null};}),excluded:[],warnings:['LISTING_CLAIMS_UNREVIEWED','REFERENCE_USAGE_NOT_REVIEWED',...(payload.hasNextPage||payload.totalItems>payload.items.length?['SOURCE_TRUNCATED']:[])]};
}
const listingOperation=(_request,signal,_timeoutMs,work)=>work(signal??new AbortController().signal);
function catalogListingImage(image,source){validateImageDescriptor(image);check(image.sourceResponseSha256===source.sha256,'VARIANT_LISTING_IMAGE_SOURCE');return {...image,publication:null,provenance:{provider:'ebay_sold_comps_v2',sourceUrl:source.url,sourceSha256:source.sha256,usage:'provider_reference'},visibleDiagnosticIds:[]};}
const imageKey = url => `variant-listing-image:v1:${hash(url)}`;
const retainedImageKey = (url, sha256) => `variant-listing-image-evidence:v1:${hash(url)}:${sha256}`;
export const retainedListingImageBodyKey = sha256 => `variant-listing-image-body:v1:${sha256}`;
const referenceKey = image => `variant-listing-reference:v1:${hash(canonicalJson(image))}`;
function validMetadata(v) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(v?.mimeType) && Number.isSafeInteger(v.width)
    && Number.isSafeInteger(v.height) && v.width > 0 && v.height > 0 && v.width <= 8000 && v.height <= 8000
    && v.width * v.height <= VARIANT_LISTING_LIMITS.imagePixels;
}
function verifyImage(entry, url) {
  check(keys(entry, ['schemaVersion', 'url', 'body', 'sha256', 'mimeType', 'width', 'height', 'capturedAt', 'expiresAt'])
    && entry.schemaVersion === 'variant-provider-image/v1' && entry.url === url && validMetadata(entry)
    && date(entry.capturedAt) && date(entry.expiresAt) && Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) === VARIANT_LISTING_LIMITS.ttlMs
    && typeof entry.body === 'string' && entry.body.length <= Math.ceil(VARIANT_LISTING_LIMITS.imageBytes / 3) * 4
    && HASH.test(entry.sha256), 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  const bytes = Buffer.from(entry.body, 'base64');
  check(bytes.length > 0 && bytes.length <= VARIANT_LISTING_LIMITS.imageBytes && bytes.toString('base64') === entry.body
    && hash(bytes) === entry.sha256, 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  return { bytes, sha256: entry.sha256, mimeType: entry.mimeType, width: entry.width, height: entry.height };
}
/** A content body has no URL or capture timestamp: identical bytes have one
 * immutable serialization across listings and independent acquisition paths. */
export function validateRetainedListingImageBody(entry) {
  check(keys(entry, ['schemaVersion', 'body', 'sha256', 'mimeType', 'width', 'height'])
    && entry.schemaVersion === 'variant-provider-image-body/v1' && validMetadata(entry)
    && typeof entry.body === 'string' && entry.body.length <= Math.ceil(VARIANT_LISTING_LIMITS.imageBytes / 3) * 4
    && HASH.test(entry.sha256), 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  const bytes = Buffer.from(entry.body, 'base64');
  check(bytes.length > 0 && bytes.length <= VARIANT_LISTING_LIMITS.imageBytes && bytes.toString('base64') === entry.body
    && hash(bytes) === entry.sha256, 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  return { bytes, sha256: entry.sha256, mimeType: entry.mimeType, width: entry.width, height: entry.height };
}
async function readImageEntry(entry, url, cache) {
  // Old inline evidence stays readable without a rewrite, migration or fetch.
  if (entry?.schemaVersion === 'variant-provider-image/v1') return verifyImage(entry, url);
  check(keys(entry, ['schemaVersion', 'url', 'bodyKey', 'sha256', 'mimeType', 'width', 'height', 'capturedAt', 'expiresAt'])
    && entry.schemaVersion === 'variant-provider-image/v2' && entry.url === url && validMetadata(entry)
    && HASH.test(entry.sha256) && entry.bodyKey === retainedListingImageBodyKey(entry.sha256)
    && date(entry.capturedAt) && date(entry.expiresAt)
    && Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) === VARIANT_LISTING_LIMITS.ttlMs,
  'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  const media = validateRetainedListingImageBody(await cache.getRetained(entry.bodyKey));
  check(['sha256', 'mimeType', 'width', 'height'].every(k => media[k] === entry[k]), 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  return media;
}
function validateImageDescriptor(image) {
  check(keys(image, ['imageId', 'relationship', 'url', 'sha256', 'mimeType', 'width', 'height', 'sourceResponseSha256', 'listing'])
    && image.relationship === 'listing_photo' && isStaffInventoryResearchImageUrl(image.url)
    && HASH.test(image.sha256) && HASH.test(image.sourceResponseSha256) && validMetadata(image)
    && validVariantReferenceListing(image.listing)
    && image.imageId === `listing-image:${hash(canonicalJson({ listing: image.listing, sha256: image.sha256, sourceResponseSha256: image.sourceResponseSha256 }))}`,
  'VARIANT_LISTING_IMAGE_DESCRIPTOR');
}
async function decodeImage(bytes) {
  const sharp = (await import('sharp')).default, decoder = sharp(bytes, { limitInputPixels: VARIANT_LISTING_LIMITS.imagePixels, failOn: 'warning' });
  const info = await decoder.metadata();
  check((!info.pages || info.pages === 1) && ['jpeg', 'png', 'webp'].includes(info.format), 'VARIANT_LISTING_IMAGE_INVALID');
  await decoder.clone().raw().toBuffer();
  return { mimeType: `image/${info.format}`, width: info.width, height: info.height };
}

/** Serving uses exact retained bytes only; it cannot initiate an image fetch. */
export async function readSavedListingPhoto(url, sha256, { cache } = {}) {
  check(cache?.getRetained && isStaffInventoryResearchImageUrl(url) && HASH.test(sha256), 'VARIANT_LISTING_IMAGE_URL');
  const media = await readImageEntry(await cache.getRetained(retainedImageKey(url, sha256)), url, cache);
  check(media.sha256 === sha256, 'VARIANT_LISTING_REFERENCE_CHANGED');
  return media;
}

/** Shared permanent public-image read for reference and market slab evidence. */
export async function readRetainedListingPhoto(url, { cache, fetchImpl = globalThis.fetch, inspectImage = decodeImage,
  now = () => Date.now(), signal, timeoutMs = VARIANT_LISTING_LIMITS.imageTimeoutMs, beforeFetch = () => {}, admitBytes = () => {} } = {}) {
  check(cache?.getRetained && cache?.put && isStaffInventoryResearchImageUrl(url), 'VARIANT_LISTING_IMAGE_URL');
  const saved = await cache.getRetained(imageKey(url));
  if (saved && Date.parse(saved.capturedAt) <= now()) return readImageEntry(saved, url, cache);
  beforeFetch();
  return boundedProviderOperation(signal, timeoutMs, async active => {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: active,
      headers: { Accept: 'image/jpeg,image/png,image/webp' } });
    check(response.ok && !response.redirected && (!response.url || response.url === url), 'VARIANT_LISTING_IMAGE_UNAVAILABLE');
    const bytes = await readBoundedProviderBody(response, active, VARIANT_LISTING_LIMITS.imageBytes);
    const metadata = await inspectImage(bytes), captured = now(); active.throwIfAborted();
    check(validMetadata(metadata) && (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === metadata.mimeType, 'VARIANT_LISTING_IMAGE_INVALID');
    const body = { schemaVersion: 'variant-provider-image-body/v1', body: bytes.toString('base64'), sha256: hash(bytes),
      mimeType: metadata.mimeType, width: metadata.width, height: metadata.height };
    const entry = { schemaVersion: 'variant-provider-image/v2', url, bodyKey: retainedListingImageBodyKey(body.sha256), sha256: body.sha256,
      mimeType: body.mimeType, width: body.width, height: body.height,
      capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + VARIANT_LISTING_LIMITS.ttlMs).toISOString() };
    const verified = validateRetainedListingImageBody(body); admitBytes(bytes, entry.sha256); active.throwIfAborted();
    // Body first: an interrupted pointer write can leave unused evidence but
    // cannot publish a binding before its body has committed.
    await cache.put(entry.bodyKey, body); active.throwIfAborted();
    await cache.put(retainedImageKey(url, entry.sha256), entry); active.throwIfAborted();
    await cache.put(imageKey(url), entry); return verified;
  });
}

/** apiKey is optional for cold/read-only serving. Only fetchSource needs it.
 * An ambiguous dispatched GET must be reconciled by the caller, never retried
 * automatically here. Listing image requests are public bounded CDN reads. */
export function createVariantListingProvider({ apiKey = null, cache = null, fetchImpl = globalThis.fetch,
  inspectImage = decodeImage, now = () => Date.now(), timeoutMs = VARIANT_LISTING_LIMITS.timeoutMs } = {}) {
  check(apiKey === null || typeof apiKey === 'string' && apiKey.trim() === apiKey && apiKey.length > 0 && apiKey.length <= 4096, 'VARIANT_LISTING_CONFIGURATION');
  check(typeof fetchImpl === 'function' && typeof inspectImage === 'function' && typeof now === 'function'
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= VARIANT_LISTING_LIMITS.timeoutMs, 'VARIANT_LISTING_CONFIGURATION');
  const requireCache = () => check(cache?.get && cache?.getRetained && cache?.put, 'VARIANT_LISTING_CACHE_REQUIRED');
  return Object.freeze({
    async fetchSource(request, { signal } = {}) {
      validateRequest(request);
      check(apiKey !== null, 'VARIANT_LISTING_CREDENTIAL_MISSING');
      return listingOperation(request, signal, timeoutMs, async active => {
        active.throwIfAborted();
        const response = await fetchImpl(request.url, { method: 'GET', redirect: 'error', signal: active,
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
        check(!response.redirected && (!response.url || response.url === request.url), 'VARIANT_LISTING_SOURCE_REDIRECT');
        const bytes = await readBoundedProviderBody(response, active, VARIANT_LISTING_LIMITS.sourceBytes), bodyText = bytes.toString('utf8');
        const contentType = response.headers.get('content-type') ?? '';
        check(Buffer.from(bodyText).equals(bytes) && !bodyText.includes(apiKey) && !contentType.includes(apiKey), 'VARIANT_LISTING_SOURCE_UNSAFE');
        active.throwIfAborted();
        // Retain even a bounded HTTP failure for the journal's exact outcome.
        return { schemaVersion: 'variant-listing-response/v1', requestKey: request.requestKey, url: request.url,
          httpStatus: response.status, contentType, bodyText, sha256: hash(bytes), capturedAt: new Date(now()).toISOString() };
      });
    },
    async acquireImages({ request, source }, { signal, imageLimit, retainedOnly = false } = {}) {
      requireCache();
      check(typeof retainedOnly === 'boolean', 'VARIANT_LISTING_READ_ONLY');
      imageLimit ??= Infinity;
      check(imageLimit === Infinity || Number.isInteger(imageLimit) && imageLimit > 0, 'VARIANT_LISTING_IMAGE_BUDGET');
      const result = projectVariantListingSource(request, source), byUrl = new Map(), byHash = new Set();
      let requests = 0, totalBytes = 0, images = 0;
      return listingOperation(request, signal, timeoutMs, async active => {
        for (const listing of result.listings) {
          const options = [...new Set([listing.imageOptions.full_resolution_url, listing.imageOptions.thumbnail_url].filter(Boolean))];
          for (const url of options) {
            active.throwIfAborted();
            if (!byUrl.has(url)) {
              let media = null;
              try {
                if (retainedOnly || images >= imageLimit) {
                  // Historical discovery can recover saved bytes, never buy
                  // another download or decode from an old raw result page.
                  const saved = await cache.getRetained(imageKey(url));
                  if (saved && Date.parse(saved.capturedAt) <= now()) media = await readImageEntry(saved, url, cache);
                } else media = await readRetainedListingPhoto(url, { cache, fetchImpl, inspectImage, now, signal: active,
                  timeoutMs: Math.min(timeoutMs, VARIANT_LISTING_LIMITS.imageTimeoutMs),
                  beforeFetch: () => { requests++; } });
              } catch { active.throwIfAborted(); }
              // The image reader has already retained the exact bytes. Keep
              // only descriptors here so a full result page does not retain
              // every decoded/downloaded image in worker memory.
              byUrl.set(url, media ? { sha256: media.sha256, mimeType: media.mimeType,
                width: media.width, height: media.height, byteLength: media.bytes.length } : null);
            }
            const media = byUrl.get(url); if (!media) continue;
            // Already-read bytes still belong in this catalog. The Codex
            // reuses their literal reading and can revisit its association.
            const image = { imageId: `listing-image:${hash(canonicalJson({ listing: listing.listing, sha256: media.sha256, sourceResponseSha256: source.sha256 }))}`,
              relationship: 'listing_photo', url, sha256: media.sha256, mimeType: media.mimeType, width: media.width, height: media.height,
              sourceResponseSha256: source.sha256, listing: listing.listing };
            validateImageDescriptor(image); active.throwIfAborted();
            if (!retainedOnly) await cache.put(referenceKey(image), { schemaVersion: 'variant-listing-reference/v1', image,
              sourceUrl: source.url, capturedAt: source.capturedAt, expiresAt: new Date(Date.parse(source.capturedAt) + VARIANT_LISTING_LIMITS.ttlMs).toISOString() });
            // Every distinct listing/source/URL descriptor is permanent even
            // when its bytes were already admitted for display or model input.
            listing.image = image;
            if (!byHash.has(media.sha256) && images < imageLimit) { byHash.add(media.sha256); totalBytes += media.byteLength; images++; }
            break;
          }
        }
        const displayPhotos = new Map();
        for (const listing of result.listings) if (listing.image && byHash.has(listing.image.sha256) && !displayPhotos.has(listing.image.sha256))
          displayPhotos.set(listing.image.sha256, catalogListingImage(listing.image, result.source));
        return { ...result, referencePhotos: [...displayPhotos.values()], acquisition: { requests, images, uniqueImages: byHash.size, bytes: totalBytes },
          warnings: [...result.warnings, ...(result.listings.some(v => !v.image) ? ['LISTING_IMAGES_INCOMPLETE'] : [])] };
      });
    },
    async readImage(image, { signal } = {}) {
      requireCache();
      const sourceUrl = image?.provenance?.sourceUrl;
      if (image?.provenance) {
        check(keys(image, ['imageId', 'relationship', 'url', 'sha256', 'mimeType', 'width', 'height', 'sourceResponseSha256', 'listing',
          'publication', 'provenance', 'visibleDiagnosticIds']) && image.publication === null && same(image.visibleDiagnosticIds, [])
          && keys(image.provenance, ['provider', 'sourceUrl', 'sourceSha256', 'usage'])
          && image.provenance.provider === listingProviderId && image.provenance.usage === 'provider_reference'
          && image.provenance.sourceSha256 === image.sourceResponseSha256, 'VARIANT_LISTING_IMAGE_DESCRIPTOR');
        const { publication, provenance, visibleDiagnosticIds, ...descriptor } = image; image = descriptor;
      }
      validateImageDescriptor(image); signal?.throwIfAborted();
      const reference = await cache.getRetained(referenceKey(image));
      check(reference?.schemaVersion === 'variant-listing-reference/v1' && same(reference.image, image)
        && (sourceUrl === undefined || sourceUrl === reference.sourceUrl), 'VARIANT_LISTING_REFERENCE_UNAVAILABLE');
      const entry = await cache.getRetained(retainedImageKey(image.url, image.sha256));
      const media = await readImageEntry(entry, image.url, cache); signal?.throwIfAborted();
      check(['sha256', 'mimeType', 'width', 'height'].every(k => media[k] === image[k]), 'VARIANT_LISTING_REFERENCE_CHANGED');
      return media;
    },
  });
}
