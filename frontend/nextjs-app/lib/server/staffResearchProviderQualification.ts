import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isStaffInventoryResearchImageUrl } from '../staffInventoryResearch';

/** Fixed, human-invoked provider observation; never imports an application writer. */
export const PROVIDER_QUALIFICATION_COHORTS = [
  { id: 'sports_anniversary', keyword: '2020 Topps Bo Bichette 85A-BB PSA 9', sold: true },
  { id: 'pokemon', keyword: 'Pokemon Snivy RC1 Legendary Treasures', sold: true },
  { id: 'sports_parallel', keyword: '2023 Panini Prizm Victor Wembanyama 136 Silver', sold: true },
  { id: 'active_control', keyword: 'Pokemon Snivy RC1 Legendary Treasures', sold: false },
] as const;
export type ProviderQualificationCohort = typeof PROVIDER_QUALIFICATION_COHORTS[number]['id'];
export const PROVIDER_QUALIFICATION_ACK = 'RUN ONE BOUNDED PROVIDER CHECK';
export const PROVIDER_QUALIFICATION_PLAN = Object.freeze({
  schema_version: 2, cohorts: PROVIDER_QUALIFICATION_COHORTS, maximum_searches: 1,
  maximum_detail_requests: 1, maximum_image_requests: 2, provider_timeout_ms: 20000,
  image_timeout_ms: 6000, overall_timeout_ms: 55000, maximum_source_bytes: 5 * 1024 * 1024,
  maximum_image_bytes: 2 * 1024 * 1024, maximum_image_pixels: 16_000_000,
  requested_items: 12, writes_inventory: false, invokes_models: false,
  provider_billing_units: 'Not established by request count; confirm provider accounting before execution.',
});
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const PROVIDER_QUALIFICATION_PLAN_HASH = hash(JSON.stringify(PROVIDER_QUALIFICATION_PLAN));
export function providerQualificationHost(host: string | undefined, production: boolean) {
  return host === 'collect.tenkings.co' || !production && /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host ?? '');
}
export class ProviderQualificationError extends Error {
  constructor(readonly code: 'unavailable' | 'timeout' | 'http_failure' | 'unsafe_response' | 'invalid_response' | 'invalid_image' | 'response_too_large') {
    super(code); this.name = 'ProviderQualificationError';
  }
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
type EvidenceRow = Record<string, string | number | boolean | null | string[]>;
const itemFields = ['itemId', 'title', 'listingType', 'soldPrice', 'soldCurrency', 'endedAt', 'bestOfferAccepted', 'boaHydrated', 'boaAcceptedPrice', 'boaAcceptedCurrency', 'buyingFormat', 'bidCount', 'currentPrice', 'currentPriceMax', 'soldPriceMax', 'thumbnailUrl', 'fullResThumbnailUrl'] as const;
const detailFields = ['itemId', 'title', 'price', 'currency', 'ended', 'endedDate', 'soldBanner', 'bestOfferAccepted', 'bidCount'] as const;
const booleanFields = new Set(['bestOfferAccepted', 'boaHydrated', 'ended']);
function safeText(value: string, key: string) {
  return value.length <= 500 && !value.includes(key) && !/[\u0000-\u001f\u007f]|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|<\/?[a-z][^>]*>/i.test(value);
}
function pick(row: Record<string, unknown>, fields: readonly string[], key: string): EvidenceRow {
  const evidence: EvidenceRow = {}, invalid: string[] = [];
  for (const field of fields) {
    if (!Object.hasOwn(row, field)) continue;
    const value = row[field];
    if (value === null) evidence[field] = null;
    else if (booleanFields.has(field) ? typeof value === 'boolean'
      : field === 'itemId' ? typeof value === 'string' && /^\d{10,15}$/.test(value)
        : field.endsWith('Url') ? typeof value === 'string' && isStaffInventoryResearchImageUrl(value)
          : typeof value === 'number' ? Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
            : typeof value === 'boolean' || typeof value === 'string' && safeText(value, key) && !/https?:\/\/|(?:^|\s)(?:\/[\w.-]+){2,}/i.test(value)) {
      evidence[field] = value as string | number | boolean;
    } else invalid.push(field);
  }
  evidence.invalid_fields = invalid;
  return evidence;
}
type RequestReceipt = { sha256: string; elapsed_ms: number; status: number; bytes: Buffer; content_type: string };
type Observation = { status: 'observed'; receipt: Omit<RequestReceipt, 'bytes'>; items: EvidenceRow[]; returned_count: number; has_next_page: boolean; total_items: number } | { status: 'failed'; error_code: string };
export type ProviderQualificationReport = {
  schema_version: 2; plan_sha256: string; cohort: ProviderQualificationCohort; started_at: string; finished_at: string;
  request_counts: { search: number; detail: number; image: number }; search: Observation;
  detail: { requested_item_id: string; status: 'observed' | 'failed'; evidence?: EvidenceRow; receipt?: Omit<RequestReceipt, 'bytes'>; error_code?: string } | null;
  images: Array<{ item_id: string; kind: 'thumbnail' | 'full_primary'; source_url: string; status: 'observed' | 'failed'; sha256?: string; byte_size?: number; width?: number; height?: number; format?: string; content_type?: string; elapsed_ms?: number; error_code?: string }>;
  coverage: { explicit_sold: number; active: number; unknown_status: number; explicit_no_offer: number; missing_offer_flag: number; hydrated_offer: number; undisclosed_offer: number };
  limitations: string[];
};

export async function qualifyStaffResearchProvider(cohortId: ProviderQualificationCohort, deps: {
  apiKey: string; fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number;
}): Promise<ProviderQualificationReport> {
  const cohort = PROVIDER_QUALIFICATION_COHORTS.find(row => row.id === cohortId);
  if (!cohort || !deps.apiKey.trim()) throw new ProviderQualificationError('unavailable');
  const now = deps.now ?? (() => new Date()), apiKey = deps.apiKey.trim();
  const limit = (ms: number) => Math.max(1, Math.min(ms, deps.timeoutMs ?? ms));
  const totalBudget = limit(PROVIDER_QUALIFICATION_PLAN.overall_timeout_ms), totalEndsAt = Date.now() + totalBudget;
  const total = AbortSignal.timeout(totalBudget);
  const report: ProviderQualificationReport = {
    schema_version: 2, plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH, cohort: cohort.id, started_at: now().toISOString(), finished_at: '',
    request_counts: { search: 0, detail: 0, image: 0 }, search: { status: 'failed', error_code: 'not_started' }, detail: null, images: [],
    coverage: { explicit_sold: 0, active: 0, unknown_status: 0, explicit_no_offer: 0, missing_offer_flag: 0, hydrated_offer: 0, undisclosed_offer: 0 },
    limitations: [
      'Provider-reported fields are observations, not independently verified realized prices.',
      'A preset query does not guarantee an ordinary sale, accepted offer, or ended-unsold example; absent cohorts remain unqualified.',
      'Images are checked and hashed in memory; image bytes are not returned or retained. Dimensions do not establish readable visual discriminants or model improvement.',
      'No item details, full-resolution setting, inventory, model decision, catalog authority, or price estimate is changed by this check.',
    ],
  };
  const errorCode = (error: unknown) => error instanceof ProviderQualificationError ? error.code : 'invalid_response';
  async function read(url: string, kind: 'search' | 'detail' | 'image'): Promise<RequestReceipt> {
    if (total.aborted) throw new ProviderQualificationError('timeout');
    const ceiling = kind === 'image' ? 2 : 1;
    if (report.request_counts[kind] >= ceiling) throw new ProviderQualificationError('invalid_response');
    report.request_counts[kind]++;
    const isImage = kind === 'image', maximum = isImage ? PROVIDER_QUALIFICATION_PLAN.maximum_image_bytes : PROVIDER_QUALIFICATION_PLAN.maximum_source_bytes;
    const controller = new AbortController();
    let rejectAbort: (reason: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort(new ProviderQualificationError('timeout')); };
    const timer = setTimeout(abort, limit(isImage ? 6000 : 20000));
    total.addEventListener('abort', abort, { once: true });
    const started = Date.now();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const operation = (async () => {
      const response = await (deps.fetchImpl ?? fetch)(url, { redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: isImage ? { Accept: 'image/jpeg,image/png,image/webp' } : { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new ProviderQualificationError('timeout'); }
      if (!response.ok || response.redirected || response.url && response.url !== url) { void response.body?.cancel().catch(() => {}); throw new ProviderQualificationError('http_failure'); }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!(isImage ? ['image/jpeg', 'image/png', 'image/webp'].includes(contentType) : contentType === 'application/json')) { void response.body?.cancel().catch(() => {}); throw new ProviderQualificationError('invalid_response'); }
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) { void response.body?.cancel().catch(() => {}); throw new ProviderQualificationError('response_too_large'); }
      reader = response.body?.getReader();
      if (!reader) throw new ProviderQualificationError('invalid_response');
      const chunks: Buffer[] = []; let size = 0;
      for (;;) {
        if (controller.signal.aborted) throw new ProviderQualificationError('timeout');
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > maximum) throw new ProviderQualificationError('response_too_large');
        chunks.push(Buffer.from(part.value));
      }
      if (controller.signal.aborted) throw new ProviderQualificationError('timeout');
      if (length && (!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity') && Number(length) !== size) throw new ProviderQualificationError('invalid_response');
      const bytes = Buffer.concat(chunks);
      if (bytes.includes(Buffer.from(apiKey))) throw new ProviderQualificationError('unsafe_response');
      return { bytes, sha256: hash(bytes), elapsed_ms: Date.now() - started, status: response.status, content_type: contentType };
    })();
    try { return await Promise.race([operation, cancelled]); }
    finally { clearTimeout(timer); total.removeEventListener('abort', abort); controller.abort(); void reader?.cancel().catch(() => {}); }
  }
  function json(receipt: RequestReceipt) {
    const value: unknown = JSON.parse(receipt.bytes.toString('utf8'));
    // Catch escaped copies of the credential after parsing as well as raw bytes.
    if (JSON.stringify(value).includes(apiKey)) throw new ProviderQualificationError('unsafe_response');
    const record = object(value); if (!record) throw new ProviderQualificationError('invalid_response'); return record;
  }
  const receipt = ({ bytes: _bytes, ...value }: RequestReceipt) => value;
  let items: Record<string, unknown>[] = [];
  try {
    const params = new URLSearchParams({ keyword: cohort.keyword, ebaySite: 'ebay.com', count: '12', page: '1', sold: String(cohort.sold), includeCompleteListing: 'true', exactMatch: 'true', hydrateBoa: String(cohort.sold) });
    const response = await read(`https://api.sold-comps.com/v1/scrape?${params}`, 'search'), payload = json(response);
    if (payload.keyword !== cohort.keyword || payload.page !== 1 || !Array.isArray(payload.items) || !Number.isSafeInteger(payload.totalItems) || Number(payload.totalItems) < 0 || typeof payload.hasNextPage !== 'boolean') throw new ProviderQualificationError('invalid_response');
    items = payload.items.slice(0, 12).map(object).filter((row): row is Record<string, unknown> => row !== null);
    report.search = { status: 'observed', receipt: receipt(response), items: items.map(row => pick(row, itemFields, apiKey)), returned_count: payload.items.length, total_items: Number(payload.totalItems), has_next_page: payload.hasNextPage };
    for (const row of items) {
      report.coverage[row.listingType === 'sold' ? 'explicit_sold' : row.listingType === 'active' ? 'active' : 'unknown_status']++;
      if (row.bestOfferAccepted === false) report.coverage.explicit_no_offer++;
      else if (row.bestOfferAccepted !== true) report.coverage.missing_offer_flag++;
      else report.coverage[row.boaHydrated === true ? 'hydrated_offer' : 'undisclosed_offer']++;
    }
  } catch (error) { report.search = { status: 'failed', error_code: errorCode(error) }; }
  const identified = items.filter(row => typeof row.itemId === 'string' && /^\d{10,15}$/.test(row.itemId));
  const detail = identified.find(row => row.bestOfferAccepted === true) ?? identified.find(row => row.bestOfferAccepted == null) ?? identified[0];
  if (detail && !total.aborted) {
    const id = String(detail.itemId);
    try {
      const response = await read(`https://api.sold-comps.com/v1/item/${id}?ebaySite=ebay.com`, 'detail'), payload = json(response);
      if (payload.itemId !== id) throw new ProviderQualificationError('invalid_response');
      report.detail = { requested_item_id: id, status: 'observed', receipt: receipt(response), evidence: pick(payload, detailFields, apiKey) };
    } catch (error) { report.detail = { requested_item_id: id, status: 'failed', error_code: errorCode(error) }; }
  }
  const imageItem = identified.find(row => isStaffInventoryResearchImageUrl(row.thumbnailUrl) && isStaffInventoryResearchImageUrl(row.fullResThumbnailUrl));
  if (imageItem) for (const kind of ['thumbnail', 'full_primary'] as const) {
    const url = String(imageItem[kind === 'thumbnail' ? 'thumbnailUrl' : 'fullResThumbnailUrl']);
    const base = { item_id: String(imageItem.itemId), kind, source_url: url };
    try {
      const imageStarted = Date.now();
      const response = await read(url, 'image');
      const secondsLeft = Math.floor((totalEndsAt - Date.now()) / 1000);
      if (secondsLeft < 1) throw new ProviderQualificationError('timeout');
      const decoder = sharp(response.bytes, { limitInputPixels: 16_000_000, failOn: 'warning' }).timeout({ seconds: Math.min(6, secondsLeft) });
      const meta = await decoder.metadata();
      const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : null;
      if (!mime || mime !== response.content_type || !meta.width || !meta.height || (meta.pages ?? 1) !== 1) throw new ProviderQualificationError('invalid_image');
      // Force full decode; metadata alone can accept a truncated/corrupt image.
      await decoder.stats();
      if (total.aborted) throw new ProviderQualificationError('timeout');
      report.images.push({ ...base, status: 'observed', sha256: response.sha256, byte_size: response.bytes.length, width: meta.width, height: meta.height, format: meta.format, content_type: mime, elapsed_ms: Date.now() - imageStarted });
    } catch (error) { report.images.push({ ...base, status: 'failed', error_code: errorCode(error) }); }
  }
  report.finished_at = now().toISOString();
  return report;
}
