import { createHash } from 'node:crypto';
import { canonicalJson } from './index.mjs';
import { normalizeVariantIdentity, compareVariantCardNumber, variantCandidateId, validateVariantCandidate, isVariantProviderImageUrl } from './variant-review.mjs';
import { isScrydexMetadataUrl } from './scrydex-reader.mjs';

export const SCRYDEX_VARIANT_PROVIDER_REVISION = 'scrydex-variant-import/v2';
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const norm = s => s.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const safe = s => typeof s === 'string' && s.trim() === s && s.length > 0 && s.length <= 240 && !/[\x00-\x1f\x7f]/.test(s);
const identifier = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(s);
const stripPin = ({ sha256, mimeType, width, height, ...image }) => image;
const imageUrl = image => ['large', 'medium', 'small'].map(k => image?.[k]).find(v => isVariantProviderImageUrl(v, 'scrydex')) ?? null;
const frontImages = images => Array.isArray(images) ? images.filter(i => i?.type === 'front').map(imageUrl).filter(Boolean) : [];
const knownLabels = new Map([
  ['normal', 'Normal'], ['holofoil', 'Holofoil'], ['reverseHolofoil', 'Reverse Holofoil'],
  ['cosmosHolofoil', 'Cosmos Holofoil'], ['pokemonTogetherStamp', 'Pokémon Together Stamp'], ['snowflakeStamp', 'Snowflake Stamp'],
]);
const labelFor = name => knownLabels.get(name) ?? name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^first edition\b/i, '1st Edition').replace(/\bnon holofoil\b/ig, 'Non-Holo');

/** The provider's variant gallery is distinct from its generic card gallery.
 * Neither its existence nor an individual human selection publishes SetOps
 * applicability. Repeated/generic artwork never becomes finish evidence. */
export function importScrydexVariantCandidates({ identity, card, source }) {
  const target = normalizeVariantIdentity(identity), expansion = card?.expansion;
  if (target.category !== 'POKEMON' || !identifier(card?.id) || !safe(card.name) || !safe(card.number) || !identifier(expansion?.id)
    || !safe(expansion.name) || !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(expansion.release_date ?? '') || expansion.is_online_only !== false
    || !isScrydexMetadataUrl(source?.url) || !/^[a-f0-9]{64}$/.test(source.sha256) || !Array.isArray(card.variants) || card.variants.length > 48) return [];
  const language = typeof card.language_code === 'string' ? card.language_code.toLowerCase() : null;
  if (!language || !/^[a-z]{2}(?:-[a-z]{2,8})?$/.test(language) || target.language && target.language !== language) return [];
  if (target.name && norm(target.name) !== norm(card.name) || target.year && target.year !== expansion.release_date.slice(0, 4)) return [];
  const number = safe(card.printed_number) ? card.printed_number : /^\d+$/.test(card.number) && Number.isSafeInteger(expansion.printed_total) && expansion.printed_total > 0
    ? `${card.number}/${expansion.printed_total}` : card.number;
  if (compareVariantCardNumber(card.number, number) === 'conflict' || target.cardNumber && compareVariantCardNumber(target.cardNumber, number) === 'conflict') return [];
  const setMatches = !target.setName || [expansion.name, ...(safe(expansion.series) ? [`${expansion.series} ${expansion.name}`, `${expansion.series}—${expansion.name}`, `${expansion.series} - ${expansion.name}`] : [])].map(norm).includes(norm(target.setName));
  // A provider-scoped, retained-source alias only. It does not create a SetOps
  // alias or silently equate the other Classic decks. The candidate keeps the
  // provider's actual expansion identity and asks for review before adoption.
  const classicCharizardAlias = expansion.id === 'clc' && norm(expansion.name) === 'pokémon tcg classic - charizard'
    && expansion.release_date.slice(0, 4) === '2023' && language === 'en' && target.setName
    && norm(target.setName) === 'classic collection (charizard)';
  if (!setMatches && !classicCharizardAlias && !(target.setName && /^[A-Za-z]+\d+/.test(card.number) && norm(target.setName).includes(norm(expansion.name)))) return [];
  const imported = normalizeVariantIdentity({ category: 'POKEMON', name: card.name, year: expansion.release_date.slice(0, 4), setName: expansion.name,
    cardNumber: number, manufacturer: null, language });
  const generic = frontImages(card.images), uses = new Map();
  for (const variant of card.variants) for (const url of new Set(frontImages(variant.images))) uses.set(url, (uses.get(url) ?? 0) + 1);
  const choices = [], seen = new Set();
  for (const variant of card.variants) {
    if (!safe(variant?.name) || variant.name.length > 100 || seen.has(variant.name)) continue; seen.add(variant.name);
    const label = labelFor(variant.name), finishUnknown = /^(?:normal|standard|unknown)$/i.test(label), recordId = `${card.id}:variant:${variant.name}`;
    if (label.length > 120) continue;
    const exact = frontImages(variant.images).filter(url => !generic.includes(url) && uses.get(url) === 1);
    const images = [...new Set(exact.length ? exact : generic)].slice(0, 4).map(url => ({
      imageId: exact.length ? `scrydex:variant-image:v1:${hash({ url, recordId, source: source.sha256 })}` : `scrydex:art:v1:${hash({ url, cardId: card.id, source: source.sha256 })}`,
      relationship: exact.length ? 'exact' : 'card_art_only', url, sha256: null, mimeType: null, width: null, height: null, publication: null,
      provenance: { provider: 'scrydex', sourceUrl: source.url, sourceSha256: source.sha256, usage: 'provider_reference' }, visibleDiagnosticIds: [],
    }));
    const c = { authority: 'provider_candidate', label, identity: imported, parallel: finishUnknown ? null : label, canonical: null, applicability: 'unknown',
      diagnostics: [{ id: 'scrydex:variant-reference', description: `The provider labels this variant “${label}”. Compare the actual stamp, border and foil pattern; the image may not reveal every feature.` },
        ...(safe(variant.origin) ? [{ id: 'scrydex:variant-origin', description: `Provider-reported variant origin: ${variant.origin}. The base card release date does not establish this printing's release date.` }] : [])],
      images, source: { provider: 'scrydex', recordId, url: source.url, sha256: source.sha256, references: [{ url: source.url, sha256: source.sha256 }] },
      warnings: ['APPLICABILITY_UNCONFIRMED', ...(target.language === null ? ['LANGUAGE_UNCONFIRMED'] : []), ...(!setMatches ? ['SET_NAME_REQUIRES_REVIEW'] : []),
        ...(!number.includes('/') && target.cardNumber?.includes('/') ? ['DENOMINATOR_UNVERIFIED'] : []), ...(finishUnknown ? ['FINISH_UNVERIFIED'] : []),
        ...(!images.length ? ['REFERENCE_IMAGE_MISSING'] : !exact.length ? ['CARD_ART_ONLY'] : [])] };
    choices.push(validateVariantCandidate({ candidateId: variantCandidateId(c), ...c }));
  }
  return choices;
}

export function scrydexVariantSearchUrl(identity) {
  const target = normalizeVariantIdentity(identity), local = target.cardNumber?.replace(/^#/, '').split('/')[0];
  if (!target.name || !identifier(local) || !target.year || !target.setName || /[\\"\x00-\x1f]/.test(target.name)) throw new Error('VARIANT_SOURCE_IDENTITY');
  const numbers = [...new Set([local, local.replace(/^([A-Za-z]*)(0+)(\d+)$/, '$1$3')])];
  const u = new URL('https://api.scrydex.com/pokemon/v1/cards');
  u.searchParams.set('q', `!name:"${target.name}" (${numbers.map(n => `number:"${n}"`).join(' OR ')})${target.language ? ` language_code:"${target.language.toUpperCase()}"` : ''}`);
  u.searchParams.set('page', '1'); u.searchParams.set('page_size', '7'); u.searchParams.set('casing', 'snake');
  u.searchParams.set('select', 'id,name,number,printed_number,expansion,language_code,variants,images');
  return u.href;
}

/** The live list envelope has no status field. An optional explicit error status
 * still fails closed; pagination/counts must agree with this bounded first page. */
function validateScrydexEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.status !== undefined && value.status !== 'success'
    || !Array.isArray(value.data) || value.data.length > 7
    || value.page !== undefined && value.page !== 1 || value.page_size !== undefined && value.page_size !== 7
    || value.count !== undefined && value.count !== value.data.length
    || value.total_count !== undefined && (!Number.isSafeInteger(value.total_count) || value.total_count < value.data.length)) throw new Error('VARIANT_SOURCE_INVALID');
}

/** Opt-in metadata transport handles authentication and the durable GET count.
 * Image reads consume no API credits; at most eight actual references acquire.
 * Unsupported sports remains with reviewed SetOps, never a Pokémon fallback. */
export function createScrydexVariantProvider({ reader, imageReader = null } = {}) {
  if (!reader?.json || !reader?.retained) throw new Error('SCRYDEX_NOT_CONFIGURED');
  return Object.freeze({ id: 'scrydex', revision: SCRYDEX_VARIANT_PROVIDER_REVISION,
    async prepare(identity, { signal } = {}) {
      const target = normalizeVariantIdentity(identity);
      if (target.category !== 'POKEMON') return { candidates: [], problems: ['PROVIDER_NOT_SUPPORTED'], truncated: false };
      const found = await reader.json(scrydexVariantSearchUrl(target), { signal, budget: { remaining: 1 } });
      validateScrydexEnvelope(found.data);
      const choices = found.data.data.flatMap(card => importScrydexVariantCandidates({ identity: target, card, source: found.source })), candidates = [];
      let count = 0;
      for (const choice of choices.slice(0, 48)) {
        const c = structuredClone(choice);
        for (const image of c.images) if (image.relationship === 'exact' && imageReader && count < 8) {
          signal?.throwIfAborted(); count++;
          try { const acquired = await imageReader.read(image.url, { signal });
            for (const field of ['sha256', 'mimeType', 'width', 'height']) image[field] = acquired[field];
          } catch { signal?.throwIfAborted(); c.warnings.push('REFERENCE_IMAGE_MISSING'); }
        }
        c.warnings = [...new Set(c.warnings)]; candidates.push(validateVariantCandidate(c));
      }
      const total = found.data.total_count ?? found.data.totalCount, truncated = found.data.data.length === 7 || Number.isSafeInteger(total) && total > found.data.data.length || choices.length > 48;
      return { candidates, problems: truncated ? ['PROVIDER_TRUNCATED'] : [], truncated };
    },
    async readImage({ candidate, image }, { signal } = {}) {
      validateVariantCandidate(candidate);
      if (!imageReader || candidate.source.provider !== 'scrydex' || !candidate.images.some(i => canonicalJson(i) === canonicalJson(image)) || !image.sha256) throw new Error('VARIANT_REFERENCE_UNAVAILABLE');
      const saved = await reader.retained(candidate.source.url, candidate.source.sha256);
      validateScrydexEnvelope(saved.data);
      const replayed = saved.data.data.flatMap(card => importScrydexVariantCandidates({ identity: candidate.identity, card, source: saved.source }))
        .find(c => c.candidateId === candidate.candidateId)?.images.find(i => i.imageId === image.imageId);
      if (!replayed || canonicalJson(stripPin(replayed)) !== canonicalJson(stripPin(image))) throw new Error('VARIANT_REFERENCE_CHANGED');
      return imageReader.readRetained(image.url, { signal, expectedSha256: image.sha256 });
    },
  });
}
