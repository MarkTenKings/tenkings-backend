import { createHash } from 'node:crypto';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { isStaffInventoryRecoverySourceUrl, StaffInventoryRecoverySourceDiscoverySchema, type StaffInventoryRecoverySourceDiscovery } from '@tenkings/shared';
import type { StaffInventoryResearchDescription } from '../staffInventoryResearch';

export const STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS = Object.freeze({ requests: 2, candidates: 3, timeoutMs: 10000, responseBytes: 262144 });
type Provider = 'bing_rss' | 'duckduckgo_html';
export type InventoryRecoverySourceDiscovery = StaffInventoryRecoverySourceDiscovery;
export type InventoryRecoverySourceDependencies = { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date };
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const searchYear = (value: string) => normalized(value).replace(/[\u2010-\u2015\u2212]/g, '-');
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const safe = (value: string | null, max: number) => value !== null && value.length > 0 && value.length <= max
  && value === value.trim() && !/[\u0000-\u001f\u007f]|https?:|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|<|>|(?:^|\s)(?:\/[\w.-]+){2,}/i.test(value);

/** Demand uses public product descriptors only. Player names, card numbers,
 * private card IDs, originals and saved notes never enter a search request. */
export function inventoryRecoverySourceDemand(description: StaffInventoryResearchDescription): { demand_sha256: string; query: string } | null {
  const category = description.category?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const family = category === 'pokemon' ? 'POKEMON' : category === 'sports' || category === 'sports cards' ? 'SPORTS' : null;
  if (!family || !safe(description.year, 20) || !/^\d{4}(?:[-/\u2010-\u2015\u2212]\d{2,4})?$/.test(description.year!)
    || !safe(description.manufacturer, 160) || !safe(description.set_name, 160)
    || description.card_type !== null && !safe(description.card_type, 160)) return null;
  const demand = { version: 'inventory-source-demand/v1', category: family, year: normalized(description.year!),
    manufacturer: normalized(description.manufacturer!), set_name: normalized(description.set_name!), card_type: description.card_type ? normalized(description.card_type) : null };
  const query = [searchYear(demand.year), demand.manufacturer, demand.set_name, demand.card_type, family === 'POKEMON' ? 'pokemon' : 'trading cards', 'checklist'].filter(Boolean).join(' ');
  if (query.length > 400) return null;
  return { demand_sha256: sha(canonicalJson(demand)), query };
}

export function isInventoryRecoverySourceUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && isStaffInventoryRecoverySourceUrl(value);
}
function decoded(text: string) {
  return text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, match => {
      const entity = match.slice(1, -1).toLowerCase();
      const known: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
      if (entity in known) return known[entity];
      const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    });
}
function title(text: string) {
  const value = decoded(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return safe(value, 240) ? value : null;
}
function candidate(provider: Provider, rawUrl: string, rawTitle: string): InventoryRecoverySourceDiscovery['candidates'][number] | null {
  let url = decoded(rawUrl).trim();
  if (provider === 'duckduckgo_html') {
    try {
      const wrapped = new URL(url, 'https://duckduckgo.com');
      if (wrapped.hostname === 'duckduckgo.com' && wrapped.pathname === '/l/') url = wrapped.searchParams.get('uddg') ?? '';
    } catch { return null; }
  }
  const label = title(rawTitle);
  return label && isInventoryRecoverySourceUrl(url) ? { title: label, url, domain: new URL(url).hostname, provider } : null;
}
function relevant(found: InventoryRecoverySourceDiscovery['candidates'][number], description: StaffInventoryResearchDescription) {
  const text = normalized(`${found.title} ${decodeURIComponent(new URL(found.url).pathname)}`).replace(/[\u2010-\u2015\u2212]/g, '-');
  const year = searchYear(description.year!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);
  const product = normalized(description.set_name!).match(/[\p{L}\p{N}]+/gu) ?? [];
  return new RegExp(`(?:^|[^\\d/-])${year}(?:$|[^\\d/-])`).test(text) && product.length > 0 && product.every(word => words.has(word));
}
function parse(provider: Provider, text: string, description: StaffInventoryResearchDescription) {
  const candidates: InventoryRecoverySourceDiscovery['candidates'] = [];
  const pattern = provider === 'bing_rss' ? /<item\b[^>]*>([\s\S]*?)<\/item>/gi : /<a\b([^>]{0,4096})>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && candidates.length < STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.candidates) {
    let found: InventoryRecoverySourceDiscovery['candidates'][number] | null = null;
    if (provider === 'bing_rss') {
      const link = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(match[1])?.[1], label = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(match[1])?.[1];
      if (link && label) found = candidate(provider, link, label);
    } else if (/\bclass\s*=\s*["'][^"']*\bresult__a\b[^"']*["']/i.test(match[1])) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);
      if (href) found = candidate(provider, href[1] ?? href[2], match[2]);
    }
    if (found && relevant(found, description) && !candidates.some(item => item.url === found!.url)) candidates.push(found);
  }
  return candidates;
}
class DiscoveryFailure extends Error {
  constructor(readonly status: 'failed' | 'oversized' | 'cancelled') { super('Source discovery unavailable.'); }
}
async function responseBytes(response: Response, signal: AbortSignal) {
  const size = response.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.responseBytes)) {
    void response.body?.cancel().catch(() => {}); throw new DiscoveryFailure('oversized');
  }
  if (!response.body) throw new DiscoveryFailure('failed');
  const reader = response.body.getReader(), chunks: Buffer[] = []; let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DiscoveryFailure('cancelled');
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.responseBytes) throw new DiscoveryFailure('oversized');
      chunks.push(Buffer.from(part.value));
    }
    if (signal.aborted) throw new DiscoveryFailure('cancelled');
    return Buffer.concat(chunks, total);
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}

/** Bounded review packet only: this does not fetch candidate pages, import a
 * checklist, change an existing draft or confer catalog/reference authority. */
export async function prepareRecoverySources(description: StaffInventoryResearchDescription, signal: AbortSignal,
  deps: InventoryRecoverySourceDependencies = {}): Promise<InventoryRecoverySourceDiscovery> {
  const demand = inventoryRecoverySourceDemand(description);
  if (!demand) throw new Error('Complete public product details are required for source discovery.');
  if (signal.aborted) throw new Error('Source discovery cancelled.');
  const receipt: InventoryRecoverySourceDiscovery = { schema_version: 1, disposition: 'review_required', ...demand,
    requested_at: (deps.now ?? (() => new Date()))().toISOString(), status: 'unavailable', requests: [], candidates: [] };
  const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  const timeoutMs = Number.isFinite(deps.timeoutMs) ? Math.max(1, Math.min(STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.timeoutMs, deps.timeoutMs!)) : STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.timeoutMs;
  const timer = setTimeout(abort, timeoutMs);
  try {
    for (const provider of ['bing_rss', 'duckduckgo_html'] as const) {
      if (controller.signal.aborted || receipt.candidates.length >= STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.candidates) break;
      const url = provider === 'bing_rss' ? `https://www.bing.com/search?format=rss&q=${encodeURIComponent(demand.query)}`
        : `https://duckduckgo.com/html/?q=${encodeURIComponent(demand.query)}`;
      let rejectAbort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new DiscoveryFailure('cancelled')); controller.signal.addEventListener('abort', rejectAbort, { once: true });
        });
        const read = async () => {
          const response = await (deps.fetchImpl ?? fetch)(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
            headers: { Accept: provider === 'bing_rss' ? 'application/rss+xml,application/xml,text/xml' : 'text/html', 'User-Agent': 'TenKingsCatalogSourceReview/1.0' } });
          if (controller.signal.aborted || !response.ok || response.redirected || response.url && response.url !== url) {
            void response.body?.cancel().catch(() => {}); throw new DiscoveryFailure(controller.signal.aborted ? 'cancelled' : 'failed');
          }
          if (!/^(?:application\/(?:rss\+xml|xml)|text\/(?:xml|html))\b/i.test(response.headers.get('content-type') ?? '')) {
            void response.body?.cancel().catch(() => {}); throw new DiscoveryFailure('failed');
          }
          return responseBytes(response, controller.signal);
        };
        const bytes = await Promise.race([read(), cancelled]);
        receipt.requests.push({ provider, response_sha256: sha(bytes), status: 'completed' });
        for (const found of parse(provider, bytes.toString('utf8'), description)) {
          if (!receipt.candidates.some(prior => prior.url === found.url)) receipt.candidates.push(found);
          if (receipt.candidates.length === STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.candidates) break;
        }
      } catch (error) {
        receipt.requests.push({ provider, response_sha256: null, status: error instanceof DiscoveryFailure ? error.status : 'failed' });
      } finally { if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort); }
    }
    if (signal.aborted) throw new Error('Source discovery cancelled.');
    receipt.status = receipt.candidates.length ? 'candidates' : receipt.requests.some(request => request.status === 'completed') ? 'not_found' : 'unavailable';
    return StaffInventoryRecoverySourceDiscoverySchema.parse(receipt);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
}
