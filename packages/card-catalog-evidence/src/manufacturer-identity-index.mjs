import { createHash } from 'node:crypto';

export const MANUFACTURER_IDENTITY_INDEX_VERSION = 'manufacturer-identity-index/v1';
export const manufacturerIdentityCanonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
export const manufacturerIdentityCatalogHash = value => createHash('sha256').update(manufacturerIdentityCanonical(value)).digest('hex');
const norm = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const manufacturerAthleteKey = value => [...new Set(String(value ?? '').split('/').map(norm))].join(' / ');

/** Build-time acceleration only. Every returned identity still comes from a
 * verified source shard; this index never supplies card identity or authority. */
export function createManufacturerIdentityIndexBuilder(catalog) {
  const names = new Map();
  return {
    add(sourceIndex, data) {
      const sourceNames = new Set(data.rows.map(row => manufacturerAthleteKey(data.strings ? data.strings[row[3]] : row[3])));
      for (const name of sourceNames) {
        if (!names.has(name)) names.set(name, []);
        names.get(name).push(sourceIndex);
      }
    },
    finish() {
      return { schemaVersion: MANUFACTURER_IDENTITY_INDEX_VERSION, catalogSha256: manufacturerIdentityCatalogHash(catalog),
        sourceCount: catalog.sources.length, rowCount: catalog.sources.reduce((sum, source) => sum + source.shard.rowCount, 0),
        names: [...names].sort(([a], [b]) => a.localeCompare(b)) };
    },
  };
}

export function validateManufacturerIdentityIndex(value, catalog) {
  const invalid = () => { throw new Error('MANUFACTURER_IDENTITY_INDEX_INVALID'); };
  if (value?.schemaVersion !== MANUFACTURER_IDENTITY_INDEX_VERSION
    || value.catalogSha256 !== manufacturerIdentityCatalogHash(catalog)
    || value.sourceCount !== catalog.sources.length
    || value.rowCount !== catalog.sources.reduce((sum, source) => sum + source.shard.rowCount, 0)
    || !Array.isArray(value.names) || value.names.length > 1000000) invalid();
  const names = new Map();
  for (const pair of value.names) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0] || pair[0].length > 1536
      || manufacturerAthleteKey(pair[0]) !== pair[0] || names.has(pair[0]) || !Array.isArray(pair[1]) || !pair[1].length
      || pair[1].some((index, i) => !Number.isSafeInteger(index) || index < 0 || index >= catalog.sources.length || i > 0 && index <= pair[1][i - 1])) invalid();
    names.set(pair[0], pair[1]);
  }
  return names;
}
