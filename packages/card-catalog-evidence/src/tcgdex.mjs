import { createHash } from 'node:crypto';
import { canonicalJson } from './index.mjs';
import { normalizeVariantIdentity, compareVariantCardNumber, variantCandidateId, validateVariantCandidate, isVariantProviderImageUrl } from './variant-review.mjs';
import { createVariantSourceReader } from './source-cache.mjs';

export const TCGDEX_VARIANT_PROVIDER_REVISION = 'tcgdex-variant-import/v1';
const norm = s => s.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const id = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(s);
const safe = s => typeof s === 'string' && s.length > 0 && s.length <= 240 && !/[\x00-\x1f\x7f]/.test(s);
const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const variantLabels = { normal: 'Non-Holo', reverse: 'Reverse Holo', holo: 'Holo' };
const diagnostics = {
  normal: 'Check the physical card under angled light: this provider describes a non-foil printing. The artwork image does not verify that finish.',
  reverse: 'Inspect which parts reflect under angled light. A reverse-holo label alone does not establish the exact foil pattern, stamp or special release.',
  holo: 'Inspect the reflective areas under angled light. Confirm the foil pattern and any stamp against the physical card; the artwork image is not finish evidence.',
};

/** Import public assertions as review candidates, never SetOps canonical IDs or
 * permission to reuse customer photographs. Preserve the original source hashes
 * in a content-bound import record; pricing data is deliberately excluded. */
export function importTcgdexVariantCandidates({ identity, language, card, set, cardSource, setSource }) {
  const target = normalizeVariantIdentity(identity);
  if (target.category !== 'POKEMON' || !id(card?.id) || !id(card?.set?.id) || !id(set?.id) || card.set.id !== set.id
    || !safe(card.name) || !safe(card.localId) || !safe(set.name) || !/^\d{4}-\d{2}-\d{2}$/.test(set.releaseDate ?? '')
    || !card.variants || typeof card.variants !== 'object' || !cardSource?.sha256 || !setSource?.sha256) return [];
  if (!/^[a-f0-9]{64}$/.test(cardSource.sha256) || !/^[a-f0-9]{64}$/.test(setSource.sha256)
    || cardSource.url !== `https://api.tcgdex.net/v2/${language}/cards/${card.id}` || setSource.url !== `https://api.tcgdex.net/v2/${language}/sets/${set.id}`) return [];
  if (target.name && norm(target.name) !== norm(card.name) || target.cardNumber && compareVariantCardNumber(target.cardNumber, card.localId) === 'conflict'
    || target.year && target.year !== set.releaseDate.slice(0, 4)) return [];
  const setNames = [set.name, ...(safe(set.serie?.name) ? [`${set.serie.name} ${set.name}`, `${set.serie.name}—${set.name}`, `${set.serie.name} - ${set.name}`] : [])].map(norm);
  const specialty = /^[a-z]+\d+$/i.test(card.localId);
  // Related subset labels remain visibly unconfirmed. They are not installed as
  // canonical aliases and cannot overwrite the saved physical-card identity.
  const setMatches = !target.setName || setNames.includes(norm(target.setName));
  const relatedSubset = specialty && target.setName && norm(target.setName).includes(norm(set.name));
  if (!setMatches && !relatedSubset) return [];
  const denominator = card.localId.match(/^\d+$/) && Number.isSafeInteger(card.set.cardCount?.official) ? String(card.set.cardCount.official) : null;
  const number = denominator ? `${card.localId}/${denominator}` : card.localId;
  if (target.cardNumber && compareVariantCardNumber(target.cardNumber, number) === 'conflict') return [];
  const importedIdentity = normalizeVariantIdentity({ category: 'POKEMON', name: card.name, year: set.releaseDate.slice(0, 4),
    setName: set.name, cardNumber: number, manufacturer: null, language });
  const record = { schemaVersion: TCGDEX_VARIANT_PROVIDER_REVISION, language,
    card: { id: card.id, name: card.name, localId: card.localId, setId: card.set.id, variants: Object.fromEntries(['normal', 'reverse', 'holo', 'firstEdition', 'wPromo'].filter(k => typeof card.variants[k] === 'boolean').map(k => [k, card.variants[k]])), image: typeof card.image === 'string' ? card.image : null },
    set: { id: set.id, name: set.name, releaseDate: set.releaseDate, officialCount: denominator },
    sources: [cardSource, setSource].map(s => ({ url: s.url, sha256: s.sha256 })) };
  const source = { provider: 'tcgdex', url: cardSource.url, recordId: `${language}:${card.id}`, sha256: sha(record), references: record.sources };
  const sourceImage = typeof card.image === 'string' ? `${card.image}/high.webp` : null;
  const imageParts = sourceImage && isVariantProviderImageUrl(sourceImage, 'tcgdex') ? new URL(sourceImage).pathname.split('/') : [];
  const imageUrl = imageParts[1] === language && imageParts[3] === card.set.id && imageParts[4] === card.localId ? sourceImage : null;
  const choices = Object.entries(variantLabels).filter(([type]) => card.variants[type] === true);
  // Edition/promo booleans do not specify which finish combinations exist.
  // Do not take a cross product or invent a separate first-edition foil record.
  if (!choices.length) choices.push(['unknown', 'Printing — finish unverified']);
  return choices.map(([type, label]) => {
    const unknownFinish = type === 'unknown' || type === 'normal' && specialty;
    const candidate = { authority: 'provider_candidate', label: unknownFinish ? 'Standard printing — finish unverified' : label,
      identity: importedIdentity, parallel: unknownFinish ? null : label, canonical: null, applicability: 'unknown',
      diagnostics: [{ id: `tcgdex:${type}:physical-check`, description: unknownFinish
        ? 'This provider does not establish the specialty printing’s finish. Inspect the foil pattern, texture and stamp on the physical card; retain unknown until confirmed.' : diagnostics[type] }],
      images: imageUrl ? [{ imageId: `tcgdex:${language}:${card.id}:art`, relationship: 'card_art_only', url: imageUrl,
        sha256: null, mimeType: null, width: null, height: null, publication: null,
        provenance: { provider: 'tcgdex', sourceUrl: cardSource.url, sourceSha256: source.sha256, usage: 'provider_reference' }, visibleDiagnosticIds: [] }] : [],
      source: { ...source, recordId: `${source.recordId}:${type}` },
      warnings: ['APPLICABILITY_UNCONFIRMED', ...(target.language === null ? ['LANGUAGE_UNCONFIRMED'] : []),
        ...(!denominator && target.cardNumber?.includes('/') ? ['DENOMINATOR_UNVERIFIED'] : []), ...(!setMatches ? ['SET_NAME_REQUIRES_REVIEW'] : []),
        ...(unknownFinish ? ['FINISH_UNVERIFIED'] : []), ...(imageUrl ? ['CARD_ART_ONLY'] : ['REFERENCE_IMAGE_MISSING'])] };
    return validateVariantCandidate({ candidateId: variantCandidateId(candidate), ...candidate });
  });
}

/** Public metadata only: fixed origin, no token, at most 6 card details and one
 * bounded search page. Unknown target language is retained, never assumed en. */
export function createTcgdexVariantProvider({ reader = createVariantSourceReader(), discoveryLanguage = 'en' } = {}) {
  if (!/^[a-z]{2}(?:-[a-z]{2,8})?$/.test(discoveryLanguage)) throw new Error('VARIANT_SOURCE_LANGUAGE');
  return Object.freeze({ id: 'tcgdex', revision: TCGDEX_VARIANT_PROVIDER_REVISION,
    async prepare(identity, { signal } = {}) {
      const target = normalizeVariantIdentity(identity);
      if (target.category !== 'POKEMON') return { candidates: [], problems: ['PROVIDER_NOT_SUPPORTED'], truncated: false };
      if (!target.name || !target.cardNumber || !target.setName || !target.year) return { candidates: [], problems: ['IDENTITY_INCOMPLETE'], truncated: false };
      const language = target.language ?? discoveryLanguage, prefix = `https://api.tcgdex.net/v2/${language}`, budget = { remaining: 14 };
      const localId = target.cardNumber.replace(/^#/, '').split('/')[0];
      if (!id(localId) || /[|:*<>]/.test(target.name)) return { candidates: [], problems: ['IDENTITY_INCOMPLETE'], truncated: false };
      const normalizedId = localId.replace(/^([A-Za-z]*)(0+)(\d+)$/, '$1$3');
      const search = new URL(`${prefix}/cards`);
      search.searchParams.set('name', target.name);
      search.searchParams.set('localId', `eq:${[...new Set([localId, normalizedId])].join('|')}`);
      search.searchParams.set('pagination:page', '1'); search.searchParams.set('pagination:itemsPerPage', '7');
      const found = await reader.json(search.href, { signal, budget });
      if (!Array.isArray(found.data) || found.data.length > 7) throw new Error('VARIANT_SOURCE_INVALID');
      const matches = found.data.filter(c => id(c?.id) && safe(c?.name) && safe(c?.localId) && norm(c.name) === norm(target.name)
        && compareVariantCardNumber(localId, c.localId) !== 'conflict');
      const candidates = [], sets = new Map(), problems = [];
      for (const item of matches.slice(0, 6)) {
        signal?.throwIfAborted();
        const detail = await reader.json(`${prefix}/cards/${item.id}`, { signal, budget });
        if (detail.data?.id !== item.id || !id(detail.data?.set?.id)) throw new Error('VARIANT_SOURCE_INVALID');
        const setId = detail.data.set.id;
        if (!sets.has(setId)) sets.set(setId, await reader.json(`${prefix}/sets/${setId}`, { signal, budget }));
        const set = sets.get(setId);
        candidates.push(...importTcgdexVariantCandidates({ identity: target, language, card: detail.data, set: set.data, cardSource: detail.source, setSource: set.source }));
      }
      const truncated = found.data.length === 7 || matches.length > 6;
      if (truncated) problems.push('PROVIDER_TRUNCATED');
      return { candidates, problems, truncated };
    },
  });
}
