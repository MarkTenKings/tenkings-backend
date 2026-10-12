import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, validateVariantReferencePhoto } from '@tenkings/card-catalog-evidence';
import { requireThat } from '@atlas/manual-service/contract';

export const CODEX_LABEL_MODEL = 'gpt-6-astra';
export const CODEX_LABEL_POLICY = 'atlas-slab-label-association-v1';
export const CODEX_ASSOCIATION_REVISION = 'atlas-reference-association-v2';
const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const normalized = value => value === null ? null : value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
/** Catalog identity is separate from a physical submission and a checklist's byte/row IDs. */
export function variantCodexChoice(candidate, { literalIdentity = false } = {}) {
  const identity = Object.fromEntries(Object.entries(normalizeVariantIdentity(candidate.identity)).map(([key,value]) =>
    [key, key === 'category' ? value : normalized(value)]));
  if (identity.cardNumber) identity.cardNumber = identity.cardNumber.replace(/^#/, '').split('/').map(part => part.replace(/^([a-z]*)(0+)(\d+)$/i, '$1$3')).join('/');
  // Only a retained manufacturer source may establish a season alias. A bare
  // year on a submission does not globally alias the following sports season.
  if (!literalIdentity && candidate.source.provider === 'manufacturer_checklist') {
    const years = new Set(candidate.diagnostics.filter(d => ['manufacturer-checklist-year','manufacturer-checklist-season'].includes(d.id))
      .flatMap(d => d.description.match(/^Official checklist (?:year|season): (\d{4}-\d{2})\./)?.slice(1) ?? []));
    if (years.size === 1) {
      const season = [...years][0];
      if (identity.year === season || identity.year === season.slice(0,4)) identity.year = season;
    }
  }
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
/** Read-only aliases import retained libraries into the current identity; they
 * never issue an old search or change the photographed submission. */
export function variantCodexAliases(candidate) {
  const choice = variantCodexChoice(candidate), aliases = [choice];
  if (candidate.source.provider === 'manufacturer_checklist' && /^\d{4}-\d{2}$/.test(choice.identity.year ?? '')
    && candidate.diagnostics.some(d => ['manufacturer-checklist-year','manufacturer-checklist-season'].includes(d.id))) {
    const historic = variantCodexChoice({...candidate, identity: {...candidate.identity,year:choice.identity.year.slice(0,4)}},{literalIdentity:true});
    if (historic.key !== choice.key) aliases.push(historic);
  }
  return aliases;
}
export const codexLibraryKey = choice => `atlas-codex-library:v1:${choice.key}`;
export const codexPhotoPoolKey = choice => `atlas-codex-photo-pool:v1:${choice.cardKey}`;
export const codexReadingKey = (request, imageSha) => `atlas-codex-reading:v1:${sha({policy:request.policy,model:request.model,sha256:imageSha})}`;
export const codexImageReservationKey = (request,imageSha) => `atlas-codex-reservation:v1:${codexReadingKey(request,imageSha)}`;
export const codexChoices = (catalog, options) => [...new Map(catalog.candidates
  .filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW'))
  .map(c => { const choice=variantCodexChoice(c,options); return [choice.key,choice]; })).values()].sort((a,b)=>a.key.localeCompare(b.key));
/** Keep provider context outside the stable card/printing identity. Scrydex's
 * year comes from the base expansion, while a printing may have a later origin.
 * These are source claims supplied for review, never physical-card approval. */
export function codexCatalogContext(catalog, options) {
  return catalog.candidates.filter(c => c.parallel && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW')).map(candidate => {
    const scrydex = candidate.source.provider === 'scrydex';
    const origin = scrydex ? candidate.diagnostics.find(d => d.id === 'scrydex:variant-origin')?.description
      .match(/^Provider-reported variant origin: (.+)\. The base card release date does not establish this printing's release date\.$/)?.[1] ?? null : null;
    return { candidateKey: variantCodexChoice(candidate,options).key,
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
    && typeof entry.reading.labelText==='string' && (entry.reading.gradingCompany===null || typeof entry.reading.gradingCompany==='string')
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
    const accepted = candidate ? [variantCodexChoice(candidate),variantCodexChoice(candidate,{literalIdentity:true})]
      .find(choice=>choice.key===r.canonicalPrintingKey&&choice.cardKey===r.canonicalCardKey) : null;
    requireThat(image && (r.candidateId===null || candidate && accepted)
      && (r.candidateId===null ? r.canonicalPrintingKey===null && r.canonicalCardKey===null
        : accepted && typeof r.labelText==='string' && r.labelText.length>0) && typeof r.reason==='string' && r.reason.length<=1000
      && (r.labelText===null || typeof r.labelText==='string' && r.labelText.length<=2000)
      && (r.gradingCompany===null || typeof r.gradingCompany==='string' && r.gradingCompany.length<=120),503,'VARIANT_LABEL_RESULT_INVALID');
    requireThat(r.evidenceKind===undefined || ['SLABBED','RAW','UNCERTAIN'].includes(r.evidenceKind),503,'VARIANT_LABEL_RESULT_INVALID');
  }
  return value;
}
const labelWords = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .split(/\s+/).map(word => word.replace(/^([a-z]*)0+(\d+)$/, '$1$2')).join(' ');
const labelLanguages = { en: 'english', ja: 'japanese', fr: 'french', de: 'german', es: 'spanish', it: 'italian',
  pt: 'portuguese', ko: 'korean', zh: 'chinese' };
const printingWords = value => labelWords(value).replace(/\bholofoil\b|\bholographic\b/g,'holo')
  .replace(/\bc holo\b|\bcosmo holo\b/g,'cosmos holo').replace(/\brev holo\b/g,'reverse holo')
  .replace(/\bcal\b/g,'calendar').replace(/\bexcl\b/g,'exclusive').replace(/\bstamped\b/g,'stamp')
  .replace(/\brefractors\b/g,'refractor').replace(/\bsuperfractors\b/g,'superfractor').replace(/\bray wave\b/g,'raywave');
const containsWords = (text,value) => Boolean(value) && ` ${text} `.includes(` ${value} `);
/** Association is a versioned projection, independent of immutable OCR. Both
 * prior matches and refusals may be projected against corrected catalog data. */
export function reassociateCodexReading(reading, catalog, previousChoices = [], previousContext = []) {
  const choices = codexChoices(catalog);
  if (reading.candidateKey && choices.some(c=>c.key===reading.candidateKey)) return reading;
  if (reading.candidateKey) {
    const previous = previousChoices.find(c=>c.key===reading.candidateKey);
    const equivalent = catalog.candidates.filter(c=>variantCodexAliases(c).some(alias=>alias.key===previous?.key));
    if (equivalent.length === 1) return {...reading,candidateKey:variantCodexChoice(equivalent[0]).key};
  }
  if (!reading.labelText) return {...reading,candidateKey:null};
  const text = ` ${labelWords(reading.labelText)} `;
  const contains = value => Boolean(value) && text.includes(` ${labelWords(value)} `);
  const finish = printingWords(reading.labelText);
  const years = [...reading.labelText.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  const contexts = codexCatalogContext(catalog);
  const matches = choices.filter(choice => {
    const identity = choice.identity;
    const context = contexts.find(value => value.candidateKey === choice.key);
    const origin = context?.identityYearMeaning === 'BASE_EXPANSION_RELEASE_YEAR' ? context.printingOrigin : null;
    const originYears = origin?.match(/\b(?:19|20)\d{2}\b/g) ?? [];
    const originMatch = origin && printingWords(origin).split(' ').every(word=>containsWords(finish,word));
    const parallel = printingWords(choice.parallel);
    const printingMatch = (identity.category === 'SPORTS' ? parallel.split(' ').every(word=>containsWords(finish,word)) : containsWords(finish,parallel)) || originMatch;
    const number = String(identity.cardNumber??'').split('/').map(labelWords);
    const printedNumbers = [...reading.labelText.matchAll(/#?\b([A-Za-z]*0*\d+[A-Za-z]*|[A-Za-z]+-[A-Za-z0-9]+)\s*\/\s*(\d+)\b/g)];
    const numberMatch = number[0] && contains(number[0]) && !printedNumbers.some(m=>labelWords(m[1])===number[0] && number[1] && labelWords(m[2])!==number[1]);
    const allowedYears = [identity.year?.slice(0,4),...originYears];
    const languageConflict = Object.entries(labelLanguages).some(([code,name])=>code!==identity.language && (contains(name)||contains(code==='ja'?'JP':code==='en'?'EN':null)));
    const setMatch = String(identity.setName??'').split(/\s+[—–]\s+/u).every(contains) || originMatch;
    // A broad Holo token must never consume explicitly different finishes.
    const extraFinish = parallel==='holo' && /\b(?:reverse|cosmos|non) holo\b/.test(finish)
      || parallel==='cosmos holo' && /\breverse cosmos holo\b/.test(finish);
    return printingMatch && !extraFinish && contains(identity.name) && numberMatch && setMatch
      && years.every(year=>allowedYears.includes(year)) && (!identity.language || !languageConflict)
      && (!identity.manufacturer || contains(identity.manufacturer));
  });
  // Sports labels commonly reverse "Blue Refractor" / "Refractors Blue".
  // An explicit named finish outranks its subset/base or generic Refractor
  // tokens. Equally specific conflicting printings remain unassigned.
  const specific = matches.filter(choice => !matches.some(other => other.key !== choice.key
    && choice.identity.category === 'SPORTS'
    && printingWords(other.parallel).split(' ').length > printingWords(choice.parallel).split(' ').length));
  if (specific.length !== 1) return {...reading,candidateKey:null};
  return { ...reading, candidateKey: specific[0].key,
    reason: 'Saved visible text matches this catalog card and printing using documented label abbreviations or printing-origin context. Original evidence is retained.' };
}
export function projectCodexReading(reading,catalog,previousChoices = null,previousContext = []) {
  if (previousChoices !== null) reading = reassociateCodexReading(reading,catalog,previousChoices,previousContext);
  const image=catalog.referencePhotos.find(i=>i.sha256===reading.sha256);
  const matches=catalog.candidates.filter(c=>variantCodexChoice(c).key===reading.candidateKey);
  const candidate=matches.length===1?matches[0]:null;
  return {imageId:image.imageId,sha256:reading.sha256,candidateId:candidate?.candidateId??null,
    canonicalCardKey:candidate?variantCodexChoice(candidate).cardKey:null,canonicalPrintingKey:candidate?variantCodexChoice(candidate).key:null,
    gradingCompany:reading.gradingCompany,labelText:reading.labelText,reason:reading.reason,
    evidenceKind:reading.evidenceKind??(reading.gradingCompany?'SLABBED':'UNCERTAIN')};
}
