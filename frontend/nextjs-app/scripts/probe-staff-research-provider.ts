/**
 * Explicit bounded provider qualification. Never imports app/database writers.
 * Dry-run: node --import tsx scripts/probe-staff-research-provider.ts
 * Execute with SOLDCOMPS_API_KEY and --execute --output /private/path/report.json.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import sharp from 'sharp';

async function main() {
const searches = [
  { label: 'sports_anniversary', keyword: '2020 Topps Bo Bichette 85A-BB PSA 9', sold: true },
  { label: 'pokemon', keyword: 'Pokemon Snivy RC1 Legendary Treasures', sold: true },
  { label: 'sports_parallel', keyword: '2023 Panini Prizm Victor Wembanyama 136 Silver', sold: true },
  { label: 'active_control', keyword: 'Pokemon Snivy RC1 Legendary Treasures', sold: false },
] as const;
const plan = { searches, maximum_searches: 4, maximum_detail_requests: 4, maximum_image_requests: 6,
  maximum_provider_quota: 11, provider_timeout_ms: 20000, image_timeout_ms: 6000,
  writes_inventory: false, invokes_models: false };
const args = process.argv.slice(2), execute = args.includes('--execute');
if (!execute) { process.stdout.write(JSON.stringify(plan, null, 2) + '\n'); process.exit(0); }
const output = args[args.indexOf('--output') + 1], key = process.env.SOLDCOMPS_API_KEY?.trim();
if (!args.includes('--output') || !output || !isAbsolute(output) || !key) throw new Error('Explicit private output path and provider key are required.');
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
function imageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.search && !u.hash && !u.username && !u.password && !u.port &&
    (u.hostname === 'ebayimg.com' || u.hostname.endsWith('.ebayimg.com')) && u.toString() === value; } catch { return false; }
}
async function read(url: string, image = false) {
  const start = Date.now(), response = await fetch(url, { redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(image ? plan.image_timeout_ms : plan.provider_timeout_ms),
    headers: image ? { Accept: 'image/jpeg,image/png,image/webp' } : { Authorization: `Bearer ${key}` } });
  const reader = response.body?.getReader(); if (!reader) throw new Error('missing_response');
  const chunks: Buffer[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length;
    if (size > (image ? 2 : 5) * 1024 * 1024) throw new Error('response_too_large'); chunks.push(Buffer.from(next.value)); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.includes(Buffer.from(key!))) throw new Error('unsafe_response');
  return { bytes, status: response.status, elapsed_ms: Date.now() - start, sha256: hash(bytes), content_type: response.headers.get('content-type') };
}
const report: any = { schema_version: 1, started_at: new Date().toISOString(), plan, searches: [], details: [], images: [] };
const itemKeys = ['itemId', 'title', 'listingType', 'soldPrice', 'soldCurrency', 'endedAt', 'bestOfferAccepted', 'boaHydrated',
  'boaAcceptedPrice', 'boaAcceptedCurrency', 'buyingFormat', 'bidCount', 'thumbnailUrl', 'fullResThumbnailUrl', 'currentPrice', 'currentPriceMax', 'soldPriceMax'];
const pick = (item: any, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(item, k)).map(k => [k, item[k]]));
const detailTargets = new Map<string, string>();
const imageTargets: { id: string; thumbnail: string; full: string }[] = [];
for (const search of searches) {
  const params = new URLSearchParams({ keyword: search.keyword, ebaySite: 'ebay.com', count: '12', page: '1',
    sold: String(search.sold), includeCompleteListing: 'true', exactMatch: 'true', hydrateBoa: String(search.sold) });
  try {
    const response = await read('https://api.sold-comps.com/v1/scrape?' + params);
    const payload = JSON.parse(response.bytes.toString('utf8'));
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 40).map((i: any) => pick(i, itemKeys)) : [];
    report.searches.push({ ...search, status: response.status, elapsed_ms: response.elapsed_ms, response_sha256: response.sha256,
      response_keys: Object.keys(payload), totalItems: payload.totalItems, hasNextPage: payload.hasNextPage, items });
    const first = items.find((i: any) => typeof i.itemId === 'string' && /^\d{10,15}$/.test(i.itemId));
    if (first && detailTargets.size < 4) detailTargets.set(first.itemId, search.label);
    const imageItem = items.find((i: any) => imageUrl(i.thumbnailUrl) && imageUrl(i.fullResThumbnailUrl));
    if (search.sold && imageItem && imageTargets.length < 3) imageTargets.push({ id: imageItem.itemId, thumbnail: imageItem.thumbnailUrl, full: imageItem.fullResThumbnailUrl });
  } catch (error) { report.searches.push({ ...search, error: error instanceof Error ? error.name : 'failure' }); }
}
for (const [id, cohort] of detailTargets) {
  try {
    const response = await read(`https://api.sold-comps.com/v1/item/${id}?ebaySite=ebay.com`);
    const payload = JSON.parse(response.bytes.toString('utf8'));
    report.details.push({ requested_id: id, cohort, status: response.status, elapsed_ms: response.elapsed_ms, response_sha256: response.sha256,
      response_keys: Object.keys(payload), ...pick(payload, ['itemId', 'title', 'price', 'currency', 'ended', 'endedDate', 'soldBanner', 'bestOfferAccepted', 'bidCount', 'images', 'itemSpecifics']) });
  } catch (error) { report.details.push({ requested_id: id, cohort, error: error instanceof Error ? error.name : 'failure' }); }
}
for (const target of imageTargets) for (const kind of ['thumbnail', 'full'] as const) {
  try {
    const response = await read(target[kind], true);
    if (response.status !== 200) throw new Error('image_http_failure');
    const metadata = await sharp(response.bytes, { limitInputPixels: 16_000_000, failOn: 'warning' }).metadata();
    report.images.push({ item_id: target.id, kind, source_url: target[kind], sha256: response.sha256, bytes: response.bytes.length,
      content_type: response.content_type, width: metadata.width, height: metadata.height, format: metadata.format, elapsed_ms: response.elapsed_ms });
  } catch (error) { report.images.push({ item_id: target.id, kind, error: error instanceof Error ? error.name : 'failure' }); }
}
report.finished_at = new Date().toISOString();
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
process.stdout.write(JSON.stringify({ output, searches: report.searches.length, details: report.details.length, images: report.images.length }) + '\n');
}
void main().catch(() => { process.stderr.write('Provider probe did not complete; no inventory was changed.\n'); process.exitCode = 1; });
