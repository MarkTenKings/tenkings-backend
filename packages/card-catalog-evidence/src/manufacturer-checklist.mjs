import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeVariantIdentity, compareVariantCardNumber, variantCandidateId, validateVariantCandidate } from './variant-review.mjs';

export const MANUFACTURER_CHECKLIST_REVISION = 'manufacturer-checklist/v1';
const HASH = /^[a-f0-9]{64}$/;
const norm = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const check = (value, message) => { if (!value) throw new Error(`MANUFACTURER_CHECKLIST_INVALID: ${message}`); };
const string = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function checklistYear(value) {
  const text = String(value ?? '').trim();
  const season = /^(\d{4})\s*[-\u2010-\u2015/]\s*(\d{2}|\d{4})$/.exec(text);
  if (!season) return norm(text);
  const end = Number(season[1]) + 1;
  if (Number(season[2]) !== (season[2].length === 2 ? end % 100 : end)) return norm(text);
  return `${season[1]}-${String(end).slice(-2)}`;
}
function shortSeason(value) {
  const season = /^(\d{2})\s*[-\u2010-\u2015/]\s*(\d{2})$/.exec(String(value ?? '').trim());
  return season && Number(season[2]) === (Number(season[1]) + 1) % 100 ? `${season[1]}-${season[2]}` : null;
}
function productName(value, manufacturer) {
  let text = norm(value).replace(/^(?:\d{4}(?: \d{2,4})?|\d{2} \d{2}) /, '').replace(/ (baseball|basketball|football|hockey|golf)$/, '');
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

const INDEX_REVISION = 'manufacturer-checklist-index/v2';
const INDEX_BYTES = 16 * 1024 * 1024, SHARD_BYTES = 4 * 1024 * 1024, DECODED_BYTES = 8 * 1024 * 1024;
const bytesHash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
async function boundedFile(url, maximum) {
  const file = await open(url, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= maximum, 'file bounds');
    const bytes = await file.readFile();
    check(bytes.length === stat.size && bytes.length <= maximum, 'file changed/bounds');
    return bytes;
  } finally { await file.close(); }
}
async function bundledCatalog() {
  try { return JSON.parse(await boundedFile(new URL('../data/manufacturer-checklists.index.json', import.meta.url), INDEX_BYTES)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Retain the v1 bundle/fixture reader while older qualified releases exist.
  return JSON.parse(gunzipSync(await boundedFile(new URL('../data/manufacturer-checklists.json.gz', import.meta.url), 16 * 1024 * 1024), { maxOutputLength: 96 * 1024 * 1024 }));
}
function sourceMetadata(source) {
  check(source && string(source.manufacturer) && string(source.year) && string(source.setName) && string(source.sport)
    && ['baseball','basketball','football','hockey','golf'].includes(source.sport) && string(source.url, 2048) && HASH.test(source.sha256)
    && Array.isArray(source.aliases) && source.aliases.length <= 12 && source.aliases.every(v => string(v))
    && (source.manufacturerAliases === undefined || Array.isArray(source.manufacturerAliases) && source.manufacturerAliases.length <= 8 && source.manufacturerAliases.every(v => string(v))), 'source');
  const url = new URL(source.url);
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'source URL');
  return { ...source, products: new Set([source.setName, ...source.aliases].map(v => productName(v, source.manufacturer))) };
}
function rowCatalog(data, rowLimit = 1500000) {
  check(data?.schemaVersion === MANUFACTURER_CHECKLIST_REVISION && data.complete === false, 'version/coverage');
  check(Array.isArray(data.sources) && data.sources.length <= 20000 && Array.isArray(data.rows) && data.rows.length <= rowLimit, 'bounds');
  const strings = data.strings ?? null;
  check(strings === null || Array.isArray(strings) && strings.length <= 1500000 && strings.every(v => string(v,160)), 'strings');
  const cell = (row, column) => strings ? strings[row[column]] : row[column];
  const sources = data.sources.map(sourceMetadata), index = new Map();
  for (const row of data.rows) {
    check(Array.isArray(row) && row.length === 5 && Number.isSafeInteger(row[0]) && sources[row[0]]
      && (!strings || row.slice(1).every(v => Number.isSafeInteger(v) && v >= 0 && v < strings.length))
      && string(cell(row,1),120) && string(cell(row,2),120) && string(cell(row,3),120) && string(cell(row,4),160), 'row');
    const key = `${checklistYear(sources[row[0]].year)}|${athleteName(cell(row,3))}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return { kind: 'rows', sources, index, cell };
}
function shardIndex(data) {
  check(data.schemaVersion === INDEX_REVISION && data.complete === false && Object.keys(data).sort().join(',') === 'complete,schemaVersion,sources', 'index version/coverage');
  check(Array.isArray(data.sources) && data.sources.length <= 20000 && Buffer.byteLength(JSON.stringify(data)) <= INDEX_BYTES, 'index bounds');
  const sources = data.sources.map(entry => {
    const { shard, ...metadata } = structuredClone(entry);
    const source = sourceMetadata(metadata);
    check(shard && Object.keys(shard).sort().join(',') === 'compressedBytes,decodedBytes,decodedSha256,path,rowCount,sha256'
      && HASH.test(shard.sha256) && HASH.test(shard.decodedSha256)
      && shard.path === `manufacturer-checklists/${shard.sha256}.json.gz`
      && Number.isSafeInteger(shard.compressedBytes) && shard.compressedBytes > 0 && shard.compressedBytes <= SHARD_BYTES
      && Number.isSafeInteger(shard.decodedBytes) && shard.decodedBytes > 0 && shard.decodedBytes <= DECODED_BYTES
      && Number.isSafeInteger(shard.rowCount) && shard.rowCount >= 0 && shard.rowCount <= 100000, 'shard descriptor');
    return { ...source, metadata, shard };
  });
  return { kind: 'shards', sources, cell: (row, column) => row[column] };
}

/** A server-only reader of retained manufacturer rows. It performs no network
 * request, publication, inference over a parallel family, or human decision.
 * The bundled catalog is a partial acquisition snapshot, never complete scope.
 */
export function createManufacturerChecklistVariantProvider({ catalog = null, loadCatalog = null, loadShard = null, limit = 48 } = {}) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 48, 'limit');
  check(catalog === null || loadCatalog === null, 'choose one catalog reader');
  check(loadShard === null || typeof loadShard === 'function', 'shard reader');
  let loaded, loading = Promise.resolve();
  const cache = new Map(), inFlight = new Map();
  async function load() {
    if (!loaded) loaded = (async () => {
      const data = catalog ?? await (loadCatalog ?? bundledCatalog)();
      return data?.schemaVersion === INDEX_REVISION ? shardIndex(data) : rowCatalog(data);
    })();
    try { return await loaded; } catch (error) { loaded = null; throw error; }
  }
  async function rowsFor(source) {
    const key = source.shard.sha256;
    const binding = canonical([source.metadata, source.shard]);
    function bound(value) { check(value.binding === binding, 'shard source binding'); return value.rows; }
    if (cache.has(key)) {
      const value = cache.get(key); cache.delete(key); cache.set(key, value);
      return bound(value);
    }
    if (!inFlight.has(key)) {
      // At most one uncached decode at a time and two retained shards. Do not
      // cancel a shared read when just one of its callers leaves the card.
      const work = loading.then(async () => {
        const bytes = await (loadShard ?? (descriptor => boundedFile(new URL(`../data/${descriptor.path}`, import.meta.url), SHARD_BYTES)))(source.shard);
        check(bytes instanceof Uint8Array && bytes.byteLength === source.shard.compressedBytes && bytesHash(bytes) === key, 'shard compressed bytes/hash');
        const decoded = gunzipSync(bytes, { maxOutputLength: DECODED_BYTES });
        check(decoded.byteLength === source.shard.decodedBytes && bytesHash(decoded) === source.shard.decodedSha256, 'shard decoded bytes/hash');
        const data = JSON.parse(decoded);
        check(Array.isArray(data.sources) && data.sources.length === 1 && canonical(data.sources[0]) === canonical(source.metadata)
          && Array.isArray(data.rows) && data.rows.length === source.shard.rowCount, 'shard source/row count');
        const value = { binding, rows: rowCatalog(data, 100000) };
        cache.set(key, value);
        while (cache.size > 2) cache.delete(cache.keys().next().value);
        return value;
      });
      inFlight.set(key, work);
      loading = work.then(() => { inFlight.delete(key); }, () => { inFlight.delete(key); });
    }
    return bound(await inFlight.get(key));
  }
  return Object.freeze({
    id: 'manufacturer_checklist', revision: MANUFACTURER_CHECKLIST_REVISION,
    async prepare(input, { signal } = {}) {
      signal?.throwIfAborted();
      const identity = normalizeVariantIdentity(input), empty = { candidates: [], problems: [], truncated: false };
      if (identity.category !== 'SPORTS') return empty;
      if (!identity.name || !identity.year || !identity.setName || !identity.cardNumber || !identity.manufacturer)
        return { ...empty, problems: ['IDENTITY_INCOMPLETE'] };
      const archive = await load(); signal?.throwIfAborted();
      const { sources, index, cell } = archive;
      const scope = productScope(identity.setName), athlete = athleteName(identity.name);
      const maker = norm(identity.manufacturer);
      function matchesProduct(source) {
        return [source.manufacturer, ...(source.manufacturerAliases ?? [])].some(v => norm(v) === maker)
          && source.products.has(productName(scope.product, source.manufacturer));
      }
      function matchesSource(source, year, basketballOnly) {
        return checklistYear(source.year) === checklistYear(year) && (!basketballOnly || source.sport === 'basketball')
          && matchesProduct(source);
      }
      function matchesSubset(row, readCell) {
        const label = norm(readCell(row,1));
        return !scope.subset || label === scope.subset || label.startsWith(`${scope.subset} `);
      }
      function reviewableRows(rows, readCell) {
        const numbered = rows.filter(row => compareVariantCardNumber(identity.cardNumber, readCell(row,2)) === 'match');
        if (numbered.length) return numbered;
        // Some manufacturer inserts list a numeric checklist position while
        // the physical card prints a letter code. Show the explicit variants
        // for one athlete/insert/number; never turn those numbers into aliases
        // or replace the photographed identity. Human confirmation is required.
        const numbers = new Set(rows.map(row => readCell(row,2)));
        return scope.subset && /^[a-z][a-z0-9]*-[a-z0-9]+$/i.test(identity.cardNumber)
          && numbers.size === 1 && /^\d+$/.test([...numbers][0]) ? rows : [];
      }
      async function matchingRows(year, basketballOnly = false) {
        const key = `${checklistYear(year)}|${athlete}`;
        if (archive.kind === 'rows') return reviewableRows((index.get(key) ?? []).filter(row => matchesSource(sources[row[0]], year, basketballOnly) && matchesSubset(row, cell)), cell);
        const matching = [];
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
          const source = sources[sourceIndex];
          if (!matchesSource(source, year, basketballOnly)) continue;
          signal?.throwIfAborted();
          const shard = await rowsFor(source); signal?.throwIfAborted();
          for (const row of shard.index.get(key) ?? []) if (matchesSubset(row, shard.cell))
            matching.push([sourceIndex, ...row.slice(1).map((_, i) => shard.cell(row, i + 1))]);
        }
        return reviewableRows(matching, cell);
      }
      let lookupYear = identity.year;
      const abbreviatedSeason = shortSeason(identity.year);
      if (abbreviatedSeason) {
        // Resolve the century from this product's explicit catalog seasons,
        // never a moving date pivot or a guess from a two-digit bare year.
        const seasons = new Set(sources.filter(matchesProduct).map(source => checklistYear(source.year))
          .filter(year => /^\d{4}-\d{2}$/.test(year) && year.slice(2) === abbreviatedSeason));
        if (seasons.size !== 1) return { ...empty, problems: seasons.size ? ['PROVIDER_NOT_SUPPORTED'] : [] };
        lookupYear = [...seasons][0];
      }
      let rows = await matchingRows(lookupYear), seasonFallback = false;
      // A bare starting year is a constrained lookup alias for basketball
      // only. An explicit season never falls back, and exact-year rows win.
      if (!rows.length && /^\d{4}$/.test(identity.year)) {
        const endYear = Number(identity.year) + 1;
        rows = await matchingRows(`${identity.year}-${String(endYear).slice(-2)}`, true);
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
        const numberDiffers = compareVariantCardNumber(identity.cardNumber, cell(row,2)) !== 'match';
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = { authority: 'provider_candidate', label: parallel, identity,
          parallel, canonical: null, applicability: 'unknown',
          diagnostics: [...(seasonFallback ? [{ id: 'manufacturer-checklist-season',
            description: `Official checklist season: ${source.year}. Requested starting year: ${identity.year}. Source locator: ${cell(row,4)}.` }] : []),
            ...(numberDiffers ? [{ id: 'manufacturer-checklist-number',
              description: `Manufacturer checklist number: ${cell(row,2)}. Photographed card number: ${identity.cardNumber}. Same set, player and insert; confirm the physical printing. Source locator: ${cell(row,4)}.` }] : [])], images: [],
          source: { provider: 'manufacturer_checklist', recordId: `manufacturer-row:v1:${digest([source.sha256, row.slice(1).map((_,i) => cell(row,i+1))])}`,
            url: source.url, sha256: source.sha256, references: [] },
          warnings: ['APPLICABILITY_UNCONFIRMED', 'REFERENCE_IMAGE_MISSING', ...(numberDiffers ? ['SCOPE_UNCONFIRMED'] : [])] };
        candidates.push(validateVariantCandidate({ ...candidate, candidateId: variantCandidateId(candidate) }));
      }
      candidates.sort((a,b) => Number(!/^(base|rookie|rated rookies?)( cards? [ivx]+)?$/i.test(a.label)) - Number(!/^(base|rookie|rated rookies?)( cards? [ivx]+)?$/i.test(b.label)) || a.label.localeCompare(b.label));
      const truncated = candidates.length > limit;
      return { candidates: candidates.slice(0, limit), problems: truncated ? ['PROVIDER_TRUNCATED'] : [], truncated };
    },
  });
}
