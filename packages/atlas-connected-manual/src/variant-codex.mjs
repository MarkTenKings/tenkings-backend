import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, validateVariantReferencePhoto } from '@tenkings/card-catalog-evidence';
import { requireThat } from '@atlas/manual-service/contract';

export const CODEX_LABEL_MODEL = 'gpt-6-astra';
export const CODEX_LABEL_POLICY = 'atlas-slab-label-association-v1';
const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const normalized = value => value === null ? null : value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
/** Catalog identity is separate from a physical submission and a checklist's byte/row IDs. */
export function variantCodexChoice(candidate) {
  const identity = Object.fromEntries(Object.entries(normalizeVariantIdentity(candidate.identity)).map(([key,value]) =>
    [key, key === 'category' ? value : normalized(value)]));
  if (identity.cardNumber) identity.cardNumber = identity.cardNumber.replace(/^#/, '').split('/').map(part => part.replace(/^([a-z]*)(0+)(\d+)$/i, '$1$3')).join('/');
  let card, printing;
  if (candidate.canonical) {
    card = { provider: 'setops', setId: candidate.canonical.publication.setId, cardId: candidate.canonical.cardId };
    printing = { printingId: candidate.canonical.printingId };
  } else if (candidate.source.provider === 'scrydex' && candidate.source.recordId.includes(':variant:')) {
    const split = candidate.source.recordId.lastIndexOf(':variant:');
    card = { provider: 'scrydex', cardId: candidate.source.recordId.slice(0,split), language: identity.language };
    printing = { printingId: candidate.source.recordId.slice(split + 9) };
  } else {
    card = { provider: candidate.source.provider, ...identity };
    printing = { printingId: normalized(candidate.parallel) };
  }
  const cardKey = `atlas-codex-card:v1:${sha(card)}`;
  const printingKey = `atlas-codex-printing:v1:${sha({cardKey,...printing})}`;
  return { key: printingKey, cardKey, catalog: { card, printing }, identity,
    parallel: normalized(candidate.parallel), label: normalized(candidate.label) };
}
export const codexLibraryKey = choice => `atlas-codex-library:v1:${choice.key}`;
export const codexPhotoPoolKey = choice => `atlas-codex-photo-pool:v1:${choice.cardKey}`;
export const codexReadingKey = (request, imageSha) => `atlas-codex-reading:v1:${sha({policy:request.policy,model:request.model,sha256:imageSha})}`;
export const codexImageReservationKey = (request,imageSha) => `atlas-codex-reservation:v1:${codexReadingKey(request,imageSha)}`;
export const codexChoices = catalog => [...new Map(catalog.candidates
  .filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW'))
  .map(c => { const choice=variantCodexChoice(c); return [choice.key,choice]; })).values()].sort((a,b)=>a.key.localeCompare(b.key));
/** Keep provider context outside the stable card/printing identity. Scrydex's
 * year comes from the base expansion, while a printing may have a later origin.
 * These are source claims supplied for review, never physical-card approval. */
export function codexCatalogContext(catalog) {
  return catalog.candidates.filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW')).map(candidate => {
    const scrydex = candidate.source.provider === 'scrydex';
    const origin = scrydex ? candidate.diagnostics.find(d => d.id === 'scrydex:variant-origin')?.description
      .match(/^Provider-reported variant origin: (.+)\. The base card release date does not establish this printing's release date\.$/)?.[1] ?? null : null;
    return { candidateKey: variantCodexChoice(candidate).key,
      identityYearMeaning: scrydex ? 'BASE_EXPANSION_RELEASE_YEAR' : 'CATALOG_IDENTITY_YEAR',
      printingOrigin: origin, diagnostics: candidate.diagnostics,
      source: { provider: candidate.source.provider, recordId: candidate.source.recordId,
        url: candidate.source.url, sha256: candidate.source.sha256 } };
  }).sort((a,b)=>a.candidateKey.localeCompare(b.candidateKey));
}
/** A card's acquired photo pool includes unmatched evidence. Pool membership
 * never claims that the photographed card is the requested identity. */
export function validateCodexPhotoPool(saved,choice) {
  requireThat(saved?.schemaVersion==='atlas-codex-photo-pool/v1' && saved.cardKey===choice.cardKey
    && Array.isArray(saved.photos) && new Set(saved.photos.map(photo=>photo.sha256)).size===saved.photos.length,
  503,'VARIANT_CODEX_POOL_INVALID');
  saved.photos.forEach(validateVariantReferencePhoto);
  return saved;
}
export function validateCodexLibrary(saved,choice) {
  requireThat(saved?.schemaVersion==='atlas-codex-library/v1' && saved.policy===CODEX_LABEL_POLICY
    && saved.choice?.key===choice.key && saved.choice.cardKey===choice.cardKey && canonicalJson(saved.choice.catalog)===canonicalJson(choice.catalog)
    && ['category','name','year','cardNumber','language'].every(k=>saved.choice.identity[k]===choice.identity[k]) && Array.isArray(saved.references) && saved.references.length>0,
  503,'VARIANT_CODEX_LIBRARY_INVALID');
  for (const entry of saved.references) {
    validateVariantReferencePhoto(entry.image);
    requireThat(entry.reading?.candidateKey===choice.key && entry.reading.sha256===entry.image.sha256
      && typeof entry.reading.labelText==='string' && typeof entry.reading.gradingCompany==='string'
      && /^[a-f0-9]{64}$/.test(entry.responseHash) && typeof entry.requestKey==='string',503,'VARIANT_CODEX_LIBRARY_INVALID');
  }
  return saved;
}
/** A result may associate only retained image bytes with one admitted catalog printing. */
export function validateVariantReferenceLabels(value,catalog) {
  requireThat(value?.version==='atlas-slab-label-associations/v1' && value.catalogHash===catalog.snapshotHash
    && Array.isArray(value.readings) && value.readings.length<=(catalog.referencePhotos?.length??0)
    && new Set(value.readings.map(r=>r.sha256)).size===value.readings.length,503,'VARIANT_LABEL_RESULT_INVALID');
  for (const r of value.readings) {
    const image=catalog.referencePhotos?.find(i=>i.sha256===r.sha256 && i.imageId===r.imageId);
    const candidate=catalog.candidates.find(c=>c.candidateId===r.candidateId);
    requireThat(image && (r.candidateId===null || candidate && r.canonicalPrintingKey===variantCodexChoice(candidate).key)
      && (r.candidateId===null ? r.canonicalPrintingKey===null && r.canonicalCardKey===null
        : r.canonicalCardKey===variantCodexChoice(candidate).cardKey && typeof r.labelText==='string' && r.labelText.length>0 && typeof r.gradingCompany==='string' && r.gradingCompany.length>0) && typeof r.reason==='string' && r.reason.length<=1000
      && (r.labelText===null || typeof r.labelText==='string' && r.labelText.length<=2000)
      && (r.gradingCompany===null || typeof r.gradingCompany==='string' && r.gradingCompany.length<=120),503,'VARIANT_LABEL_RESULT_INVALID');
  }
  return value;
}
const labelWords = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .split(/\s+/).map(word => word.replace(/^([a-z]*)0+(\d+)$/, '$1$2')).join(' ');
const labelLanguages = { en: 'english', ja: 'japanese', fr: 'french', de: 'german', es: 'spanish', it: 'italian',
  pt: 'portuguese', ko: 'korean', zh: 'chinese' };
/** Reassociation is a local projection of permanent OCR, not another image or
 * model request. A new choice or newly supplied sourced printing origin still
 * needs an exact printing line and full literal identity anchors. Abbreviations,
 * missing language/number/year and ambiguous finishes remain unmatched. */
export function reassociateCodexReading(reading, catalog, previousChoices = [], previousContext = []) {
  if (reading.candidateKey !== null || !reading.labelText || !reading.gradingCompany) return reading;
  const oldKeys = new Set(previousChoices.map(choice => choice.key));
  const text = ` ${labelWords(reading.labelText)} `;
  const contains = value => Boolean(value) && text.includes(` ${labelWords(value)} `);
  const lines = new Set(reading.labelText.split(/\r?\n/).map(labelWords));
  const years = [...reading.labelText.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const contexts = codexCatalogContext(catalog);
  const matches = codexChoices(catalog).filter(choice => {
    const identity = choice.identity;
    const context = contexts.find(value => value.candidateKey === choice.key);
    const origin = context?.identityYearMeaning === 'BASE_EXPANSION_RELEASE_YEAR' ? context.printingOrigin : null;
    const originYears = origin?.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    // A prior refusal can be revisited only with separately sourced origin
    // context that the original request did not receive. Require literal full
    // identity and printing lines; no seller text, abbreviations or guessed
    // language/collector denominator enter this deterministic projection.
    const addedOrigin = origin && originYears.length === 1 && contains(origin)
      && !previousContext.some(value => value.candidateKey === choice.key && value.printingOrigin === origin);
    const identityAnchors = addedOrigin ? [identity.name, identity.cardNumber, origin]
      : [identity.name, identity.year, identity.cardNumber, ...String(identity.setName ?? '').split(/\s+[—–]\s+/u)];
    const allowedYears = addedOrigin ? [identity.year, ...originYears] : labelWords(identity.year).split(' ');
    return (!oldKeys.has(choice.key) || addedOrigin) && lines.has(labelWords(choice.parallel))
      && identityAnchors.every(contains) && years.every(year => allowedYears.includes(year))
      && (!identity.manufacturer || contains(identity.manufacturer))
      && (!identity.language || contains(identity.language) || contains(labelLanguages[identity.language]));
  });
  if (matches.length !== 1) return reading;
  return { ...reading, candidateKey: matches[0].key,
    reason: 'Exact literal label identity and printing match newly available catalog identity or sourced printing-origin context. Original label reading is retained.' };
}
export function projectCodexReading(reading,catalog,previousChoices = null,previousContext = []) {
  if (previousChoices !== null) reading = reassociateCodexReading(reading,catalog,previousChoices,previousContext);
  const image=catalog.referencePhotos.find(i=>i.sha256===reading.sha256);
  const matches=catalog.candidates.filter(c=>variantCodexChoice(c).key===reading.candidateKey);
  const candidate=matches.length===1?matches[0]:null;
  return {imageId:image.imageId,sha256:reading.sha256,candidateId:candidate?.candidateId??null,
    canonicalCardKey:candidate?variantCodexChoice(candidate).cardKey:null,canonicalPrintingKey:candidate?variantCodexChoice(candidate).key:null,
    gradingCompany:reading.gradingCompany,labelText:reading.labelText,reason:reading.reason};
}
