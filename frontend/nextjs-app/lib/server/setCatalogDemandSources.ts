import { createHash } from 'node:crypto';
import { canonicalJson, CATALOG_DEMAND_VERSION, catalogDemandKey, catalogDemandResultHash, normalizeCatalogDemand,
  isCatalogDemandSourceUrl, catalogDemandSourceKind, validateCatalogDemandAcquisition, type CatalogDemand } from '@tenkings/card-catalog-evidence';
import { prepareRecoverySources } from './staffInventoryResearchRecoverySources';
import type { StaffInventoryResearchDescription } from '../staffInventoryResearch';
import type { parseCatalogDemandSourceFile } from './setOpsDiscovery';

export const CATALOG_DEMAND_ACQUISITION_LIMITS = Object.freeze({ timeoutMs: 18000, sourceBytes: 2 * 1024 * 1024, sources: 2, requests: 5 });
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const norm = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (value: unknown, max = 240): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
  && !/[\x00-\x1f\x7f]/.test(value.trim()) ? value.trim() : null;
const field = (row: Record<string, unknown>, names: string[]) => {
  const entry = Object.entries(row).find(([key]) => names.includes(norm(key).replace(/ /g, ''))); return clean(entry?.[1]);
};
function exactProduct(text: string, demand: CatalogDemand) {
  const words = new Set(norm(text).split(' ')), product = norm(demand.setName).split(' '), year = norm(demand.year).split(' ');
  return product.length > 0 && [...product, ...year].every(word => words.has(word));
}
function sourceProduct(demand: CatalogDemand) {
  // A spaced sports hierarchy separates product from insert. It changes only
  // where we look for a checklist; the original demand/identity stays intact.
  // Do not split Pokémon set names (for example HS — Triumphant), unspaced
  // punctuation, or ambiguous multi-level labels.
  const parts = demand.category === 'SPORTS' ? demand.setName.split(/\s+[—–]\s+/u) : [];
  return parts.length === 2 && parts.every(part => part.trim())
    ? { product: { ...demand, setName: parts[0].trim() }, program: parts[1].trim() }
    : { product: demand, program: null };
}
function matchesProgram(row: Record<string, unknown>, program: string | null) {
  if (program === null) return true;
  const names = ['program', 'programname', 'programlabel', 'cardtype', 'insertset', 'insert', 'subset'];
  const explicit = Object.entries(row).filter(([key]) => names.includes(norm(key).replace(/ /g, '')))
    .map(([, value]) => clean(value)).filter((value): value is string => value !== null);
  if (!explicit.length && row.evidenceKind === 'literal_section') {
    const section = field(row, ['evidencesection']); if (section) explicit.push(section);
  }
  return explicit.length > 0 && explicit.every(value => norm(value) === norm(program));
}
function directLinks(html: string, demand: CatalogDemand) {
  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]{0,4096}href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), 'https://www.topps.com');
      // Remove a cache-busting Shopify query only; the exact fetched URL is retained.
      if (u.hostname === 'cdn.shopify.com' && [...u.searchParams.keys()].every(k => k === 'v')) u.search = '';
      if (isCatalogDemandSourceUrl(u.href) && /\.pdf$/i.test(u.pathname) && exactProduct(`${m[2].replace(/<[^>]*>/g, ' ')} ${decodeURIComponent(u.pathname)}`, demand)) links.push(u.href);
    } catch { /* A malformed source URL is not a fetch target. */ }
  }
  return [...new Set(links)].slice(0, CATALOG_DEMAND_ACQUISITION_LIMITS.sources);
}
async function readBounded(response: Response, signal: AbortSignal) {
  const length = response.headers.get('content-length');
  if (!response.body || length !== null && (!/^\d+$/.test(length) || Number(length) > CATALOG_DEMAND_ACQUISITION_LIMITS.sourceBytes)) {
    void response.body?.cancel(); throw new Error('Source size limit.');
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('Acquisition cancelled.');
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > CATALOG_DEMAND_ACQUISITION_LIMITS.sourceBytes) throw new Error('Source size limit.');
      chunks.push(Buffer.from(part.value));
    }
    if (signal.aborted || !size) throw new Error('Acquisition cancelled or empty.');
    return Buffer.concat(chunks, size);
  } finally { signal.removeEventListener('abort', abort); abort(); }
}

/** Public product descriptors only. No originals, model calls or SetOps draft
 * writes. Each actual byte stream is retained separately for authorized review. */
export async function acquireSetCatalogDemand(input: CatalogDemand, attempt: number, dependencies: {
  signal?: AbortSignal; fetchImpl?: typeof fetch; now?: () => Date;
  discover?: typeof prepareRecoverySources; parse?: typeof parseCatalogDemandSourceFile;
} = {}) {
  const demand = normalizeCatalogDemand(input), now = dependencies.now ?? (() => new Date());
  const { product, program } = sourceProduct(demand);
  const signal = dependencies.signal ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(CATALOG_DEMAND_ACQUISITION_LIMITS.timeoutMs)]) : AbortSignal.timeout(CATALOG_DEMAND_ACQUISITION_LIMITS.timeoutMs);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let requests = 0;
  const fetchBounded: typeof fetch = async (url, init) => {
    if (signal.aborted || requests >= CATALOG_DEMAND_ACQUISITION_LIMITS.requests) throw new Error('Acquisition request budget.');
    requests++;
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([fetchImpl(url, { ...init, signal: combined }), new Promise<never>((_, reject) => { abort = () => reject(new Error('Acquisition deadline.')); combined.addEventListener('abort', abort, { once: true }); })]);
    } finally { if (abort) combined.removeEventListener('abort', abort); }
  };
  const get = async (url: string) => {
    if (!isCatalogDemandSourceUrl(url)) throw new Error('Source is not allowed.');
    const response = await fetchBounded(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal,
      headers: { Accept: 'application/pdf,text/html,text/csv,application/json,text/plain', 'User-Agent': 'TenKingsCatalogSourceReview/1.0' } });
    if (response.status !== 200 || response.redirected || response.url && response.url !== url) { void response.body?.cancel(); throw new Error('Source unavailable.'); }
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['application/pdf', 'text/html', 'text/csv', 'application/json', 'text/plain'].includes(contentType)) { void response.body?.cancel(); throw new Error('Unsupported source type.'); }
    return { url, contentType, bytes: await readBounded(response, signal) };
  };
  const problems = new Set<string>(), artifacts: { sourceId: string; sha256: string; bytes: Buffer; contentType: string }[] = [];
  let urls: string[] = [];
  if (demand.category === 'SPORTS' && /\btopps\b/i.test(demand.manufacturer ?? '')) {
    try { const index = await get('https://www.topps.com/pages/checklists'); urls = directLinks(index.bytes.toString('utf8'), product); }
    catch { problems.add('MANUFACTURER_INDEX_UNAVAILABLE'); }
  }
  if (!urls.length && !signal.aborted) {
    const description = { category: product.category, year: product.year, manufacturer: product.manufacturer ?? 'Pokemon', set_name: product.setName, card_type: null } as StaffInventoryResearchDescription;
    try {
      const found = await (dependencies.discover ?? prepareRecoverySources)(description, signal, { fetchImpl: fetchBounded });
      urls = found.candidates.map(c => c.url).filter(isCatalogDemandSourceUrl).slice(0, CATALOG_DEMAND_ACQUISITION_LIMITS.sources);
      if (!urls.length) problems.add(found.candidates.length ? 'SOURCE_DISCOVERY_POLICY_REJECTED'
        : found.status === 'not_found' ? 'SOURCE_DISCOVERY_NOT_FOUND' : 'SOURCE_DISCOVERY_UNAVAILABLE');
      for (const request of found.requests ?? []) {
        if (request.status !== 'completed') problems.add(`SOURCE_DISCOVERY_${request.provider.toUpperCase()}_${request.status.toUpperCase()}`);
      }
    } catch { problems.add('SOURCE_DISCOVERY_UNAVAILABLE'); }
  }
  const sources: any[] = [], choices: any[] = [], context: any[] = [];
  let truncated = false;
  for (const url of urls) {
    if (signal.aborted) { problems.add('SOURCE_BUDGET_EXHAUSTED'); break; }
    try {
      const acquired = await get(url), sha256 = digest(acquired.bytes), sourceId = hash({ url, sha256 });
      const parse = dependencies.parse ?? (await import('./setOpsDiscovery')).parseCatalogDemandSourceFile;
      const parsed = parse({ fileName: new URL(url).pathname.split('/').pop()!, fileBuffer: acquired.bytes, contentType: acquired.contentType });
      // A discovery hit alone is not card evidence. Its exact document must identify
      // the requested product before any row can be offered for human review.
      if (!exactProduct(parsed.text.slice(0, 1500), product)) { problems.add('SOURCE_PRODUCT_UNRESOLVED'); continue; }
      sources.push({ sourceId, url, sha256, kind: catalogDemandSourceKind(url), byteSize: acquired.bytes.length });
      artifacts.push({ sourceId, sha256, bytes: acquired.bytes, contentType: acquired.contentType });
      truncated ||= parsed.truncated;
      for (const [index, row] of parsed.rows.entries()) {
        // A parent checklist is not proof that one of its other inserts, or an
        // unlabelled card row, belongs to the explicitly requested program.
        if (!matchesProgram(row, program)) continue;
        const name = field(row, ['player', 'playerseed', 'name', 'cardname']), number = field(row, ['cardnumber', 'number', 'card', 'no']);
        const printing = field(row, ['parallel', 'variant', 'finish']);
        // Base Set denotes a checklist program; prefix guesses and section-only
        // insert names cannot establish the physical finish of its members.
        const explicitPrinting = printing && (row.evidenceKind === 'literal_columns' || /\b(?:refractor|prizm|holo|foil|shimmer|wave|sparkle|atomic|speckle|ice|mojo)\b|\/\s*\d+/i.test(printing));
        if (!name || !number || !printing || !explicitPrinting || /^(?:base(?: set)?|checklist|unknown|n\/a)$/i.test(printing)) continue;
        const language = field(row, ['language']), validLanguage = language && /^[a-z]{2}(?:-[a-z]{2,8})?$/i.test(language) ? language.toLowerCase() : null;
        const identity = { category: demand.category, name, year: demand.year, setName: demand.setName, cardNumber: number, manufacturer: demand.manufacturer, language: validLanguage };
        const locator = `checklist-row:${index + 1}`, rowId = hash({ sourceId, identity, parallel: printing, locator });
        choices.push({ rowId, identity, parallel: printing, sourceId, locator, diagnostics: ['Unreviewed source row. Confirm the physical card and finish; source inclusion is not catalog approval.'] });
      }
      for (const [index, row] of parsed.context.entries()) {
        if (!matchesProgram(row, program)) continue;
        const parallel = field(row, ['parallel', 'variant']); if (!parallel) continue;
        context.push({ parallel, program: field(row, ['program', 'programname']), serial: field(row, ['serial', 'serialnumber', 'printRun']), sourceId, locator: `program-parallel-row:${index + 1}` });
      }
    } catch { problems.add('SOURCE_ACQUISITION_UNAVAILABLE'); }
  }
  const uniqueChoices = [...new Map(choices.map(c => [canonicalJson({ identity: c.identity, parallel: c.parallel, sourceId: c.sourceId }), c])).values()];
  truncated ||= uniqueChoices.length > 5000 || context.length > 5000;
  // Keep the full retained review packet within the hosting response bound.
  // Source byte artifacts remain complete even when parsed rows are truncated.
  while (Buffer.byteLength(canonicalJson({ choices: uniqueChoices, context })) > 3 * 1024 * 1024) {
    truncated = true; if (uniqueChoices.length >= context.length) uniqueChoices.splice(Math.max(0, uniqueChoices.length - 100)); else context.splice(Math.max(0, context.length - 100));
  }
  const result = { schemaVersion: CATALOG_DEMAND_VERSION, demandKey: catalogDemandKey(demand), demand, state: sources.length ? 'READY' : 'UNAVAILABLE', attempt,
    coverage: truncated ? 'truncated' : sources.length ? 'partial' : 'unknown', sources, choices: uniqueChoices.slice(0, 5000), context: context.slice(0, 5000),
    problems: [...problems, 'UNREVIEWED_SOURCE_CANDIDATES', 'REFERENCE_IMAGES_NOT_ACQUIRED'], capturedAt: now().toISOString(), snapshotHash: '' };
  result.snapshotHash = catalogDemandResultHash(result);
  return { result: validateCatalogDemandAcquisition(result), artifacts, requests };
}
