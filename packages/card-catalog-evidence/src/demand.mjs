import { createHash } from 'node:crypto';
import { canonicalJson, CatalogContractError } from './index.mjs';

export const CATALOG_DEMAND_VERSION = 'catalog-demand-result/v1';
export const CATALOG_DEMAND_POLICY = 'catalog-demand-source-2026-10-09-v1';
export const CATALOG_DEMAND_LIMITS = Object.freeze({ sources: 4, rows: 5000, choices: 48, context: 48, resultBytes: 768 * 1024 });
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const fail = (condition, path) => { if (!condition) throw new CatalogContractError('INVALID_CATALOG_DEMAND', path); };
const text = (value, max = 240) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const nullable = (value, max) => value === null || text(value, max);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const norm = value => value.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
const unique = values => new Set(values).size === values.length;
const domains = ['topps.com', 'paniniamerica.net', 'paninigroup.com', 'upperdeck.com', 'pokemon.com', 'tcdb.com', 'tradingcarddb.com', 'cardboardconnection.com', 'beckett.com', 'sportscardspro.com', 'breakninja.com', 'baseballcardpedia.com'];
export function isCatalogDemandSourceUrl(value) {
  if (!text(value, 2048)) return false;
  try { const u = new URL(value), path = decodeURIComponent(u.pathname);
    return u.href === value && u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && !u.search
      && path !== '/' && !/[\x00-\x1f\x7f\\]/.test(path) && !/(?:^|\/)(?:search|searchresults|login|signin|register|account|cart|checkout)(?:[\/._-]|$)/i.test(path)
      && (domains.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))
        || u.hostname === 'cdn.shopify.com' && /^\/s\/files\/1\/0662\/9749\/5709\/files\/[A-Za-z0-9._-]+\.pdf$/i.test(path));
  } catch { return false; }
}
export function catalogDemandSourceKind(url) {
  fail(isCatalogDemandSourceUrl(url), 'source.url'); const host = new URL(url).hostname;
  return ['topps.com', 'paniniamerica.net', 'paninigroup.com', 'upperdeck.com', 'pokemon.com'].some(d => host === d || host.endsWith(`.${d}`)) || host === 'cdn.shopify.com'
    ? 'manufacturer' : 'secondary';
}
/** Set demand keys contain public product descriptors only. Same-set cards
 * share acquisition; no physical-card identifier or photograph enters a key. */
export function normalizeCatalogDemand(input) {
  fail(input && ['SPORTS', 'POKEMON'].includes(input.category), 'category');
  const result = { category: input.category, year: input.year, manufacturer: input.manufacturer ?? null, setName: input.setName, language: input.language ?? null };
  fail(text(result.year, 20) && /^\d{4}(?:[-/]\d{2,4})?$/.test(result.year) && text(result.setName) && nullable(result.manufacturer, 160)
    && nullable(result.language, 20) && [result.year, result.setName, result.manufacturer].filter(Boolean).every(v => !/https?:|data:|[<>]|(?:^|\s)(?:\/[\w.-]+){2,}|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}/i.test(v)), 'identity');
  if (result.language !== null) { result.language = norm(result.language); fail(/^[a-z]{2}(?:-[a-z]{2,8})?$/.test(result.language), 'language'); }
  fail(result.category !== 'SPORTS' || result.manufacturer !== null, 'manufacturer');
  return frozen(result);
}
export function catalogDemandKey(input) {
  const normalized = normalizeCatalogDemand(input);
  return hash({ policy: CATALOG_DEMAND_POLICY, demand: Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k, typeof v === 'string' ? norm(v) : v])) });
}
export function catalogDemandResultHash(value) { const { snapshotHash, ...rest } = value; return hash(rest); }
function validateResult(input, stored = false) {
  const v = JSON.parse(canonicalJson(input));
  fail(keys(v, ['schemaVersion', 'demandKey', 'demand', 'state', 'attempt', 'coverage', 'sources', 'choices', 'context', 'problems', 'capturedAt', 'snapshotHash'])
    && v.schemaVersion === CATALOG_DEMAND_VERSION && v.demandKey === catalogDemandKey(v.demand), 'result');
  fail(keys(v.demand, ['category', 'year', 'manufacturer', 'setName', 'language']), 'demand.fields'); normalizeCatalogDemand(v.demand);
  fail(['QUEUED', 'RUNNING', 'READY', 'UNAVAILABLE'].includes(v.state) && Number.isSafeInteger(v.attempt) && v.attempt >= 0 && v.attempt <= 3
    && ['partial', 'unknown', 'truncated'].includes(v.coverage), 'state');
  fail(Array.isArray(v.sources) && v.sources.length <= CATALOG_DEMAND_LIMITS.sources && unique(v.sources.map(s => s.sourceId)), 'sources');
  for (const s of v.sources) fail(keys(s, ['sourceId', 'url', 'sha256', 'kind', 'byteSize']) && sha(s.sourceId) && sha(s.sha256)
    && s.sourceId === hash({ url: s.url, sha256: s.sha256 }) && isCatalogDemandSourceUrl(s.url) && s.kind === catalogDemandSourceKind(s.url)
    && Number.isSafeInteger(s.byteSize) && s.byteSize > 0 && s.byteSize <= 2 * 1024 * 1024, 'source');
  fail(Array.isArray(v.choices) && v.choices.length <= (stored ? CATALOG_DEMAND_LIMITS.rows : CATALOG_DEMAND_LIMITS.choices) && unique(v.choices.map(c => c.rowId)), 'choices');
  for (const c of v.choices) {
    fail(keys(c, ['rowId', 'identity', 'parallel', 'sourceId', 'locator', 'diagnostics']) && sha(c.rowId)
      && v.sources.some(s => s.sourceId === c.sourceId) && text(c.locator, 240) && text(c.parallel, 120), 'choice');
    fail(keys(c.identity, ['category', 'name', 'year', 'setName', 'cardNumber', 'manufacturer', 'language'])
      && c.identity.category === v.demand.category && c.identity.year === v.demand.year && c.identity.setName === v.demand.setName
      && c.identity.manufacturer === v.demand.manufacturer && text(c.identity.name) && text(c.identity.cardNumber)
      && nullable(c.identity.language, 20), 'choice.identity');
    fail(Array.isArray(c.diagnostics) && c.diagnostics.length <= 8 && c.diagnostics.every(d => text(d, 500)), 'choice.diagnostics');
  }
  fail(Array.isArray(v.context) && v.context.length <= (stored ? CATALOG_DEMAND_LIMITS.rows : CATALOG_DEMAND_LIMITS.context), 'context');
  for (const c of v.context) fail(keys(c, ['parallel', 'program', 'serial', 'sourceId', 'locator']) && text(c.parallel, 160)
    && nullable(c.program, 160) && nullable(c.serial, 80) && v.sources.some(s => s.sourceId === c.sourceId) && text(c.locator, 240), 'context.row');
  fail(Array.isArray(v.problems) && v.problems.length <= 16 && unique(v.problems) && v.problems.every(s => /^[A-Z][A-Z0-9_]{0,79}$/.test(s)), 'problems');
  fail(typeof v.capturedAt === 'string' && Number.isFinite(Date.parse(v.capturedAt)) && new Date(v.capturedAt).toISOString() === v.capturedAt
    && v.snapshotHash === catalogDemandResultHash(v) && Buffer.byteLength(canonicalJson(v)) <= (stored ? 8 * 1024 * 1024 : CATALOG_DEMAND_LIMITS.resultBytes), 'hash');
  return frozen(v);
}

export function validateCatalogDemandResult(input) { return validateResult(input); }
export function validateCatalogDemandAcquisition(input) { return validateResult(input, true); }
const cardNumber = value => norm(value).replace(/^#/, '').replace(/\s/g, '').replace(/(^|\/)([a-z]*?)0+(?=\d)/g, '$1$2');
export function filterCatalogDemandResult(input, card = null) {
  const record = validateCatalogDemandAcquisition(input);
  if (card !== null) fail(keys(card, ['name', 'cardNumber']) && text(card.name) && text(card.cardNumber), 'card');
  const matches = record.choices.filter(c => {
    if (!card) return true;
    const source = cardNumber(c.identity.cardNumber).split('/'), target = cardNumber(card.cardNumber).split('/');
    return norm(c.identity.name) === norm(card.name) && source[0] === target[0] && (!source[1] || !target[1] || source[1] === target[1]);
  });
  const result = { ...record, coverage: matches.length > CATALOG_DEMAND_LIMITS.choices || record.context.length > CATALOG_DEMAND_LIMITS.context ? 'truncated' : record.coverage,
    choices: matches.slice(0, CATALOG_DEMAND_LIMITS.choices), context: record.context.slice(0, CATALOG_DEMAND_LIMITS.context), snapshotHash: '' };
  result.snapshotHash = catalogDemandResultHash(result); return validateCatalogDemandResult(result);
}
