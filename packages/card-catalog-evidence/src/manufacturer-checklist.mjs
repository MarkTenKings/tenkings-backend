import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeVariantIdentity, compareVariantCardNumber, variantCandidateId, validateVariantCandidate } from './variant-review.mjs';

export const MANUFACTURER_CHECKLIST_REVISION = 'manufacturer-checklist/v1';
const HASH = /^[a-f0-9]{64}$/;
const norm = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const check = (value, message) => { if (!value) throw new Error(`MANUFACTURER_CHECKLIST_INVALID: ${message}`); };
const string = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function productName(value, manufacturer) {
  let text = norm(value).replace(/^\d{4}(?: \d{2,4})? /, '').replace(/ (baseball|basketball|football)$/, '');
  const maker = norm(manufacturer);
  if (text.startsWith(`${maker} `)) text = text.slice(maker.length + 1);
  return text;
}
function productScope(value) {
  const parts = String(value).split(/\s+[—–]\s+/u);
  return parts.length === 2 && parts.every(v => norm(v))
    ? { product: parts[0], subset: norm(parts[1]) }
    : { product: value, subset: null };
}
function athleteName(value) {
  const names = String(value).split('/').map(norm);
  // The Panini export sometimes repeats the same athlete on both faces. A
  // multi-athlete card with different names is never reduced to one player.
  return [...new Set(names)].join(' / ');
}

/** A server-only reader of retained manufacturer rows. It performs no network
 * request, publication, inference over a parallel family, or human decision.
 * The bundled catalog is a partial acquisition snapshot, never complete scope.
 */
export function createManufacturerChecklistVariantProvider({ catalog = null, loadCatalog = null, limit = 48 } = {}) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 48, 'limit');
  check(catalog === null || loadCatalog === null, 'choose one catalog reader');
  let loaded;
  async function load() {
    if (!loaded) loaded = (async () => {
      const data = catalog ?? await (loadCatalog ?? (async () => JSON.parse(gunzipSync(await readFile(new URL('../data/manufacturer-checklists.json.gz', import.meta.url)), { maxOutputLength: 96 * 1024 * 1024 }).toString('utf8'))))();
      check(data?.schemaVersion === MANUFACTURER_CHECKLIST_REVISION && data.complete === false, 'version/coverage');
      check(Array.isArray(data.sources) && data.sources.length <= 20000 && Array.isArray(data.rows) && data.rows.length <= 1500000, 'bounds');
      const strings = data.strings ?? null;
      check(strings === null || Array.isArray(strings) && strings.length <= 1500000 && strings.every(v => string(v,160)), 'strings');
      const cell = (row, column) => strings ? strings[row[column]] : row[column];
      const sources = data.sources.map(source => {
        check(source && string(source.manufacturer) && string(source.year) && string(source.setName) && string(source.sport)
          && ['baseball','basketball','football'].includes(source.sport) && string(source.url, 2048) && HASH.test(source.sha256)
          && Array.isArray(source.aliases) && source.aliases.length <= 12 && source.aliases.every(v => string(v))
          && (source.manufacturerAliases === undefined || Array.isArray(source.manufacturerAliases) && source.manufacturerAliases.length <= 8 && source.manufacturerAliases.every(v => string(v))), 'source');
        const url = new URL(source.url);
        check(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'source URL');
        return { ...source, products: new Set([source.setName, ...source.aliases].map(v => productName(v, source.manufacturer))) };
      });
      const index = new Map();
      for (const row of data.rows) {
        check(Array.isArray(row) && row.length === 5 && Number.isSafeInteger(row[0]) && sources[row[0]]
          && (!strings || row.slice(1).every(v => Number.isSafeInteger(v) && v >= 0 && v < strings.length))
          && string(cell(row,1),120) && string(cell(row,2),120) && string(cell(row,3),120) && string(cell(row,4),160), 'row');
        const source = sources[row[0]], key = `${norm(source.year)}|${athleteName(cell(row,3))}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(row);
      }
      return { sources, index, cell };
    })();
    try { return await loaded; } catch (error) { loaded = null; throw error; }
  }
  return Object.freeze({
    id: 'manufacturer_checklist', revision: MANUFACTURER_CHECKLIST_REVISION,
    async prepare(input, { signal } = {}) {
      signal?.throwIfAborted();
      const identity = normalizeVariantIdentity(input), empty = { candidates: [], problems: [], truncated: false };
      if (identity.category !== 'SPORTS') return empty;
      if (!identity.name || !identity.year || !identity.setName || !identity.cardNumber || !identity.manufacturer)
        return { ...empty, problems: ['IDENTITY_INCOMPLETE'] };
      const { sources, index, cell } = await load(); signal?.throwIfAborted();
      const scope = productScope(identity.setName), athlete = athleteName(identity.name);
      const maker = norm(identity.manufacturer);
      function matchingRows(year) {
        return (index.get(`${norm(year)}|${athlete}`) ?? []).filter(row => {
          const source = sources[row[0]], label = norm(cell(row,1));
          // A composite's suffix constrains the literal checklist subset. It
          // is never discarded to turn an unrelated insert into a candidate.
          return [source.manufacturer, ...(source.manufacturerAliases ?? [])].some(v => norm(v) === maker)
            && source.products.has(productName(scope.product, source.manufacturer))
            && compareVariantCardNumber(identity.cardNumber, cell(row,2)) === 'match'
            && (!scope.subset || label === scope.subset || label.startsWith(`${scope.subset} `));
        });
      }
      let rows = matchingRows(identity.year), seasonFallback = false;
      // A bare starting year is a constrained lookup alias for basketball
      // only. An explicit season never falls back, and exact-year rows win.
      if (!rows.length && /^\d{4}$/.test(identity.year)) {
        const endYear = Number(identity.year) + 1;
        rows = [...matchingRows(`${identity.year}-${String(endYear).slice(-2)}`),
          ...matchingRows(`${identity.year}-${endYear}`)].filter(row => sources[row[0]].sport === 'basketball');
        const scopes = new Set(rows.map(row => {
          const source = sources[row[0]];
          return `${norm(source.manufacturer)}|${productName(source.setName, source.manufacturer)}`;
        }));
        if (scopes.size > 1) return { ...empty, problems: ['PROVIDER_NOT_SUPPORTED'] };
        seasonFallback = rows.length > 0;
      }
      const candidates = [], seen = new Set();
      for (const row of rows) {
        const source = sources[row[0]];
        const parallel = cell(row,1), key = norm(parallel);
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = { authority: 'provider_candidate', label: parallel, identity,
          parallel, canonical: null, applicability: 'unknown',
          diagnostics: seasonFallback ? [{ id: 'manufacturer-checklist-season',
            description: `Official checklist season: ${source.year}. Requested starting year: ${identity.year}. Source locator: ${cell(row,4)}.` }] : [], images: [],
          source: { provider: 'manufacturer_checklist', recordId: `manufacturer-row:v1:${digest([source.sha256, row.slice(1).map((_,i) => cell(row,i+1))])}`,
            url: source.url, sha256: source.sha256, references: [] },
          warnings: ['APPLICABILITY_UNCONFIRMED', 'REFERENCE_IMAGE_MISSING'] };
        candidates.push(validateVariantCandidate({ ...candidate, candidateId: variantCandidateId(candidate) }));
      }
      candidates.sort((a,b) => Number(!/^(base|rookie|rated rookies?)( cards? [ivx]+)?$/i.test(a.label)) - Number(!/^(base|rookie|rated rookies?)( cards? [ivx]+)?$/i.test(b.label)) || a.label.localeCompare(b.label));
      const truncated = candidates.length > limit;
      return { candidates: candidates.slice(0, limit), problems: truncated ? ['PROVIDER_TRUNCATED'] : [], truncated };
    },
  });
}
