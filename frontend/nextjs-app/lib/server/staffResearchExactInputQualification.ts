import { createHash } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma, canonical, inventoryHash } from '@tenkings/database';
import {
  StaffInventoryResearchInputSchema, StaffInventoryResearchReferenceSchema, StaffInventoryResearchResultSchema,
  isStaffInventoryResearchImageUrl, STAFF_INVENTORY_RESEARCH_MODEL,
  type StaffInventoryResearchInput, type StaffInventoryResearchReference, type StaffInventoryResearchResult,
} from '../staffInventoryResearch';
import { researchStaffInventoryCard, isExactStaffInventoryResearchReference } from './staffInventoryResearch';
import { loadStaffInventoryResearchReferences } from './staffInventoryResearchReferences';
import { readStaffInventoryPhoto, type StaffInventoryVerifiedPhoto } from './staffInventoryIdentification';
import { getStorageMode, isStorageObjectNotFoundError, openStorageObjectRead, presignReadUrl, readStorageBufferBounded, uploadPrivateChecksumBuffer } from './storage';

const MiB = 1024 * 1024;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const photo = z.object({ key: z.string().regex(/^inventory-photos\/[a-f0-9-]{36}\/[a-f0-9]{64}\.jpg$/), sha256: hash }).strict()
  .refine(value => value.key.endsWith(`/${value.sha256}.jpg`));
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const amounts = z.object({ search: money, detail: money, model: money, image: money }).strict();
export const EXACT_INPUT_ACK = 'RUN ONE EXACT INPUT';
export const EXACT_INPUT_LIMITS = Object.freeze({ search: 3, detail: 2, model: 3, image: 12,
  original_reads: 2, reference_image_reads: 0, preflight_ms: 15000, engine_ms: 150000, receipt_ms: 15000,
  invocation_ms: 170000, terminal_reserve_ms: 20000,
  transcript_bytes: 8 * MiB, candidate_image_bytes: 24 * MiB, metadata_bytes: MiB, bundle_bytes: 48 * MiB });
export const ExactInputConfigurationSchema = z.object({
  schema_version: z.literal(1), run_label: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  application_sha: z.string().regex(/^[a-f0-9]{40}$/), job_id: z.string().uuid(), unit_id: identity,
  input_sha256: hash, description_event_id: identity, description_sha256: hash,
  photos: z.object({ front: photo, back: photo }).strict(),
  // These are operator-supplied substantiated maximum charges, never inferred prices.
  billing: z.object({ currency: z.literal('USD'), maximum_total_microusd: money,
    maximum_per_dispatch_microusd: amounts, basis: z.string().min(1).max(1000), basis_sha256: hash,
  }).strict().nullable().default(null),
}).strict();
export type ExactInputConfiguration = z.infer<typeof ExactInputConfigurationSchema>;
export type ExactInputPlan = {
  schema_version: 1; diagnostic_version: 'exact-input-v1'; config: ExactInputConfiguration;
  input: StaffInventoryResearchInput; references: StaffInventoryResearchReference[]; references_sha256: string;
  limits: typeof EXACT_INPUT_LIMITS; model: { requested: typeof STAFF_INVENTORY_RESEARCH_MODEL; reasoning: 'medium'; store: false; max_output_tokens: 6500 };
  effects: { sale_details: true; catalog: false; full_resolution: false; candidate_archive: false; business_writes: false; private_receipt_writes: 2 };
  cost_status: 'unavailable' | 'configured_upper_bounds'; deployment: string | null;
  global_once_only: false; receipt_concurrency: 'per-execution-limits; concurrent copies can overwrite the same invocation receipt';
};
export type ExactInputPlanResponse = { enabled: boolean; reason: string | null; plan: ExactInputPlan | null; plan_sha256: string | null; acknowledge: string };
export type ExactInputRow = { id: string; unitId: string; input: string; inputHash: string; descriptionEventId: string; descriptionHash: string; status: string };
export type ExactInputDependencies = {
  readInput(config: ExactInputConfiguration): Promise<ExactInputRow | null>;
  readReferences: typeof loadStaffInventoryResearchReferences;
  readPhoto(key: string, signal: AbortSignal): Promise<StaffInventoryVerifiedPhoto>;
  readReceipt(key: string, maximum: number, signal: AbortSignal): Promise<Buffer | null>;
  writeReceipt(key: string, bytes: Buffer, signal: AbortSignal): Promise<void>;
  signReceipt(key: string): Promise<string>;
  durableStorage(): boolean; fetchImpl: typeof fetch; research: typeof researchStaffInventoryCard;
  now(): Date;
  /** Shortens deadlines for offline tests only. */
  timeoutMs?: number;
};
class QualificationError extends Error { constructor(readonly code: string) { super(code); } }
function fail(code: string): never { throw new QualificationError(code); }
function check(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
const failureCode = (error: unknown) => error instanceof QualificationError ? error.code : 'operation_failed';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function noSecrets(value: string | Buffer, secrets: string[]) {
  check(!secrets.some(secret => typeof value === 'string' ? value.includes(secret) : value.includes(Buffer.from(secret))), 'credential_echo');
}
async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  check(!signal.aborted, 'cancelled');
  let stop: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { stop = () => reject(new QualificationError('cancelled')); signal.addEventListener('abort', stop, { once: true }); });
  try { return await Promise.race([task, cancelled]); } finally { signal.removeEventListener('abort', stop); }
}
async function bounded<T>(milliseconds: number, operation: (signal: AbortSignal) => Promise<T>, deps: Pick<ExactInputDependencies, 'timeoutMs'>, parent?: AbortSignal): Promise<T> {
  check(!parent?.aborted, 'cancelled');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(milliseconds, deps.timeoutMs ?? milliseconds));
  const stop = () => controller.abort(); parent?.addEventListener('abort', stop, { once: true });
  try { return await abortable(operation(controller.signal), controller.signal); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', stop); controller.abort(); }
}
function configuration(env: Record<string, string | undefined>) {
  const source = env.STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_CONFIG;
  if (!source || Buffer.byteLength(source) > 16384) return null;
  try { const parsed = ExactInputConfigurationSchema.safeParse(JSON.parse(source)); return parsed.success ? parsed.data : null; } catch { return null; }
}
function verifiedInput(config: ExactInputConfiguration, row: ExactInputRow | null) {
  check(row && row.status !== 'superseded' && row.id === config.job_id && row.unitId === config.unit_id, 'stale_input');
  check(Buffer.byteLength(row.input) <= 16384, 'input_integrity');
  const parsed = StaffInventoryResearchInputSchema.safeParse(JSON.parse(row.input));
  check(parsed.success, 'input_integrity');
  const input = parsed.data;
  check(inventoryHash(input) === config.input_sha256 && row.inputHash === config.input_sha256
    && input.unit_id === row.unitId && input.description_event_id === row.descriptionEventId && input.description_hash === row.descriptionHash
    && input.description_event_id === config.description_event_id && input.description_hash === config.description_sha256
    && input.front_photo_key === config.photos.front.key && input.back_photo_key === config.photos.back.key, 'stale_input');
  return input;
}
function verifiedReferences(input: StaffInventoryResearchInput, values: StaffInventoryResearchReference[]) {
  check(Array.isArray(values) && values.length <= 24, 'reference_integrity');
  const refs = values.map(value => StaffInventoryResearchReferenceSchema.parse(value));
  check(new Set(refs.map(value => value.id)).size === refs.length
    && refs.every(value => value.image === null && !value.catalog_binding && isExactStaffInventoryResearchReference(input.description, value)), 'reference_integrity');
  return refs.sort((a, b) => a.id.localeCompare(b.id));
}
export async function exactInputQualificationPlan(env: Record<string, string | undefined>, deps = exactInputDependencies(), parent?: AbortSignal): Promise<ExactInputPlanResponse> {
  const config = configuration(env), empty = { enabled: false, reason: 'An exact existing physical input has not been configured.', plan: null, plan_sha256: null, acknowledge: EXACT_INPUT_ACK };
  if (!config) return empty;
  if (config.application_sha !== env.VERCEL_GIT_COMMIT_SHA) return { ...empty, reason: 'The configured source revision does not match this deployment.' };
  const plan = await bounded(EXACT_INPUT_LIMITS.preflight_ms, async signal => {
    const input = verifiedInput(config, await abortable(deps.readInput(config), signal));
    const references = verifiedReferences(input, await abortable(deps.readReferences(input.description, signal), signal));
    return { schema_version: 1 as const, diagnostic_version: 'exact-input-v1' as const, config, input, references,
      references_sha256: inventoryHash(references), limits: EXACT_INPUT_LIMITS,
      model: { requested: STAFF_INVENTORY_RESEARCH_MODEL, reasoning: 'medium' as const, store: false as const, max_output_tokens: 6500 as const },
      effects: { sale_details: true as const, catalog: false as const, full_resolution: false as const, candidate_archive: false as const, business_writes: false as const, private_receipt_writes: 2 as const },
      cost_status: config.billing ? 'configured_upper_bounds' as const : 'unavailable' as const,
      deployment: env.VERCEL_DEPLOYMENT_ID ?? null, global_once_only: false as const,
      receipt_concurrency: 'per-execution-limits; concurrent copies can overwrite the same invocation receipt' as const };
  }, deps, parent);
  const reason = env.STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED !== 'true' ? 'Execution is disabled.'
    : !env.OPENAI_API_KEY?.trim() || !env.SOLDCOMPS_API_KEY?.trim() ? 'The existing server provider credentials are unavailable.'
      : !deps.durableStorage() ? 'Private durable receipt storage is unavailable.' : null;
  check(Buffer.byteLength(JSON.stringify(plan)) <= 128 * 1024, 'plan_size');
  noSecrets(JSON.stringify(plan), [env.OPENAI_API_KEY, env.SOLDCOMPS_API_KEY].filter((value): value is string => !!value));
  return { enabled: reason === null, reason, plan, plan_sha256: inventoryHash(plan), acknowledge: EXACT_INPUT_ACK };
}

type Kind = 'search' | 'detail' | 'model' | 'image';
type BlobRecord = { sha256: string; encoding: 'base64'; bytes: number; data: string };
type Call = { sequence: number; kind: Kind; url: string; method: string; started_at: string; finished_at: string | null;
  outcome: 'pending' | 'response' | 'failed'; failure: string | null; http_status: number | null; response_sha256: string | null;
  response_blob_sha256: string | null; content_type: string | null; request_id: string | null; returned_model: string | null; usage: unknown;
  request_sha256: string | null; request_template: unknown; request_images: { sha256: string; mime_type: string; original_key: string | null }[];
};
function addBlob(blobs: Map<string, BlobRecord>, bytes: Buffer) { const id = sha(bytes); if (!blobs.has(id)) blobs.set(id, { sha256: id, encoding: 'base64', bytes: bytes.length, data: bytes.toString('base64') }); return id; }
async function responseBytes(response: Response, maximum: number, signal: AbortSignal) {
  const advertised = response.headers.get('content-length');
  check(!advertised || /^\d+$/.test(advertised) && Number(advertised) <= maximum, 'response_size');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks: Buffer[] = []; let total = 0;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) { const part = await abortable(reader.read(), signal); if (part.done) break;
      total += part.value.byteLength; check(total <= maximum, 'response_size'); chunks.push(Buffer.from(part.value)); }
    check(!advertised || response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity' || total === Number(advertised), 'response_length');
    return Buffer.concat(chunks, total);
  } finally { signal.removeEventListener('abort', stop); stop(); }
}
/** Independent dispatch guard and exact-byte tape. No provider call until admitted. */
export function exactInputQualificationTransport(plan: ExactInputPlan, originals: StaffInventoryVerifiedPhoto[], env: Record<string, string | undefined>, deps: Pick<ExactInputDependencies, 'fetchImpl' | 'now'>, outer: AbortSignal) {
  const counts = { search: 0, detail: 0, model: 0, image: 0 }, calls: Call[] = [], blobs = new Map<string, BlobRecord>();
  const originalByHash = new Map(originals.map(value => [value.sha256, value])), suppliedImages = new Set<string>(), detailIds = new Set<string>();
  const secrets = [env.OPENAI_API_KEY, env.SOLDCOMPS_API_KEY].filter((value): value is string => !!value);
  let transcriptBytes = 0, imageBytes = 0, metadataBytes = 0, reserved = 0n, stopped = false, blocked = false;
  const violations: string[] = [];
  const fetchImpl = (async (input, init) => {
    let call: Call | undefined;
    try {
      check(!stopped && !blocked && !outer.aborted && init?.signal && !init.signal.aborted, 'cancelled');
      const uri = String(input), url = new URL(uri), headers = new Headers(init.headers), method = init.method ?? 'GET';
      noSecrets(uri, secrets);
      let kind: Kind;
      if (url.origin === 'https://api.sold-comps.com' && url.pathname === '/v1/scrape') {
        const keys = ['keyword', 'ebaySite', 'sold', 'count', 'page', 'includeCompleteListing', 'exactMatch', 'hydrateBoa'];
        check(!url.hash && !url.username && !url.password && [...url.searchParams.keys()].every(key => keys.includes(key))
          && [...url.searchParams.keys()].length === new Set(url.searchParams.keys()).size
          && url.searchParams.get('sold') === 'true' && url.searchParams.get('page') === '1' && url.searchParams.get('count') === '240'
          && url.searchParams.get('ebaySite') === 'ebay.com' && url.searchParams.get('includeCompleteListing') === 'true'
          && url.searchParams.get('exactMatch') === 'true' && url.searchParams.get('hydrateBoa') === 'true'
          && !!url.searchParams.get('keyword') && url.searchParams.get('keyword')!.length <= 400, 'search_request');
        kind = 'search';
      } else if (/^https:\/\/api\.sold-comps\.com\/v1\/item\/\d{6,20}\?ebaySite=ebay\.com$/.test(uri)) {
        kind = 'detail'; check(!detailIds.has(uri), 'detail_retry');
      } else if (uri === 'https://api.openai.com/v1/responses') kind = 'model';
      else { check(isStaffInventoryResearchImageUrl(uri) && suppliedImages.has(uri), 'unexpected_destination'); kind = 'image'; }
      check(method === (kind === 'model' ? 'POST' : 'GET') && init.redirect === 'error' && init.cache === 'no-store', 'request_policy');
      check(headers.get('authorization') === (kind === 'image' ? null : `Bearer ${kind === 'model' ? env.OPENAI_API_KEY : env.SOLDCOMPS_API_KEY}`), 'credential_destination');
      check(counts[kind] < EXACT_INPUT_LIMITS[kind], 'dispatch_cap');
      let template: unknown = null, requestHash: string | null = null;
      const requestImages: Call['request_images'] = [];
      if (kind === 'model') {
        check(typeof init.body === 'string' && Buffer.byteLength(init.body) <= 40 * MiB, 'model_request');
        noSecrets(init.body, secrets); requestHash = sha(init.body);
        const parsed = JSON.parse(init.body), content = parsed.input?.[0]?.content;
        check(parsed.model === STAFF_INVENTORY_RESEARCH_MODEL && parsed.store === false && parsed.reasoning?.effort === 'medium'
          && parsed.max_output_tokens === 6500 && parsed.tools === undefined && Array.isArray(content), 'model_settings');
        for (const part of content) if (part.type === 'input_image') {
          check(typeof part.image_url === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(part.image_url) && part.detail === 'high', 'model_image');
          const comma = part.image_url.indexOf(','), mime = part.image_url.slice(5, part.image_url.indexOf(';'));
          const bytes = Buffer.from(part.image_url.slice(comma + 1), 'base64'), id = sha(bytes);
          check(originalByHash.has(id) || blobs.has(id), 'unretained_model_image');
          requestImages.push({ sha256: id, mime_type: mime, original_key: originalByHash.get(id)?.key ?? null });
          part.image_url = `diagnostic-image-sha256:${id}`;
        }
        check(requestImages.length <= 14 && originals.every(original => requestImages.some(image => image.sha256 === original.sha256)), 'model_originals');
        // Preserve wire field order as text; canonical receipt serialization sorts object keys.
        template = JSON.stringify(parsed);
        // Parsing/reconstruction must reproduce the exact wire body, not merely equivalent JSON.
        const replay = JSON.parse(JSON.stringify(parsed));
        for (const part of replay.input[0].content) if (part.type === 'input_image') {
          const id = part.image_url.slice('diagnostic-image-sha256:'.length), proof = requestImages.find(image => image.sha256 === id)!;
          part.image_url = `data:${proof.mime_type};base64,${originalByHash.get(id)?.bytes.toString('base64') ?? blobs.get(id)!.data}`;
        }
        check(sha(JSON.stringify(replay)) === requestHash, 'request_reconstruction');
        metadataBytes += Buffer.byteLength(JSON.stringify(template)); check(metadataBytes <= EXACT_INPUT_LIMITS.metadata_bytes / 2, 'metadata_cap');
      }
      const charge = BigInt(plan.config.billing?.maximum_per_dispatch_microusd[kind] ?? 0);
      check(!plan.config.billing || reserved + charge <= BigInt(plan.config.billing.maximum_total_microusd), 'configured_cost_cap');
      reserved += charge; counts[kind]++; if (kind === 'detail') detailIds.add(uri);
      call = { sequence: calls.length + 1, kind, url: uri, method, started_at: deps.now().toISOString(), finished_at: null, outcome: 'pending', failure: null,
        http_status: null, response_sha256: null, response_blob_sha256: null, content_type: null, request_id: null, returned_model: null, usage: null,
        request_sha256: requestHash, request_template: template, request_images: requestImages }; calls.push(call);
      const response = await abortable(deps.fetchImpl(uri, init), init.signal);
      check(!stopped && !outer.aborted && !init.signal.aborted, 'cancelled');
      call.http_status = response.status;
      check(!response.redirected && (!response.url || response.url === uri) && !(response.status >= 300 && response.status < 400), 'redirect');
      const bytes = await responseBytes(response, kind === 'image' ? 2 * MiB : kind === 'model' ? 256 * 1024 : 5 * MiB, init.signal);
      check(!stopped && !outer.aborted && !init.signal.aborted, 'cancelled'); noSecrets(bytes, secrets);
      const contentType = response.headers.get('content-type') ?? '';
      noSecrets(contentType, secrets);
      let parsed: unknown;
      if (kind !== 'image' && bytes.length) { try { parsed = JSON.parse(bytes.toString('utf8')); noSecrets(JSON.stringify(parsed), secrets); } catch (error) { if (error instanceof QualificationError) throw error; } }
      if (kind === 'image') { imageBytes += bytes.length; check(imageBytes <= EXACT_INPUT_LIMITS.candidate_image_bytes, 'image_capture_cap'); }
      else { transcriptBytes += bytes.length; check(transcriptBytes <= EXACT_INPUT_LIMITS.transcript_bytes, 'transcript_cap'); }
      call.response_sha256 = sha(bytes); call.response_blob_sha256 = addBlob(blobs, bytes); call.content_type = contentType.slice(0, 200);
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id');
      if (requestId && /^[A-Za-z0-9_.:-]{1,200}$/.test(requestId)) { noSecrets(requestId, secrets); call.request_id = requestId; }
      if (kind === 'model') {
        const obj = record(parsed); call.returned_model = typeof obj.model === 'string' ? obj.model.slice(0, 200) : null;
        check(Buffer.byteLength(JSON.stringify(obj.usage ?? null)) <= 4096, 'usage_size'); call.usage = obj.usage ?? null;
      }
      if (kind === 'search' && response.ok) {
        const items = record(parsed).items;
        if (Array.isArray(items)) for (const item of items.slice(0, 240)) for (const name of ['thumbnailUrl', 'fullResThumbnailUrl']) {
          const value = record(item)[name]; if (isStaffInventoryResearchImageUrl(value)) suppliedImages.add(value);
        }
      }
      call.outcome = 'response'; call.finished_at = deps.now().toISOString();
      // Fetch has already decoded content-encoding; forward exactly retained bytes.
      return new Response(new Uint8Array(bytes), { status: response.status, headers: { 'content-type': contentType, 'content-length': String(bytes.length) } });
    } catch (error) {
      const code = failureCode(error);
      if (!stopped) {
        if (call) { call.outcome = 'failed'; call.failure = code; call.finished_at = deps.now().toISOString(); }
        // Missing/corrupt/redacted tape and guard failures invalidate the attempt.
        // Ordinary transport failures/timeouts remain explicit uncertain calls.
        if (error instanceof QualificationError && code !== 'cancelled') { violations.push(code); blocked = true; }
        else if (!call && !blocked) { violations.push(code); blocked = true; }
      }
      throw new QualificationError(code);
    }
  }) as typeof fetch;
  return { fetchImpl, finish() { stopped = true; return JSON.parse(JSON.stringify({ counts, calls, violations, blobs: [...blobs.values()],
    cost: { status: plan.cost_status, reserved_microusd: plan.config.billing ? reserved.toString() : null, actual_billed_cost: null,
      note: 'Dispatches, including failed or uncertain requests, retain their configured reservation. Returned usage is evidence, not a bill.' } })) as {
        counts: typeof counts; calls: Call[]; violations: string[]; blobs: BlobRecord[]; cost: Record<string, unknown>;
      }; } };
}

type Binding = { plan_sha256: string; actor_sha256: string; invocation_id: string };
function binding(actor: string, planHash: string, invocation: string): Binding {
  check(hash.safeParse(planHash).success && z.string().uuid().safeParse(invocation).success && identity.safeParse(actor).success, 'receipt_binding');
  return { plan_sha256: planHash, actor_sha256: sha(actor), invocation_id: invocation };
}
function receiptKey(bound: Binding, stage: 'initial' | 'terminal') { return `inventory-research-qualification/${bound.actor_sha256}/${bound.plan_sha256}/${bound.invocation_id}/${stage}.json`; }
function envelope(payload: Record<string, unknown>) { return Buffer.from(canonical({ schema_version: 1, payload_sha256: inventoryHash(payload), payload })); }
function parseReceipt(bytes: Buffer, bound: Binding) {
  const value = record(JSON.parse(bytes.toString('utf8'))), payload = record(value.payload);
  check(value.schema_version === 1 && inventoryHash(payload) === value.payload_sha256
    && Object.entries(bound).every(([key, expected]) => payload[key] === expected), 'receipt_integrity');
  return payload;
}
export type ExactInputReceiptStatus = { status: 'not_found' | 'uncertain' | 'completed' | 'failed' | 'stale_input'; invocation_id: string;
  message: string; receipt_sha256: string | null; download_url: string | null; summary: Record<string, unknown> | null };
export async function recoverExactInputQualification(actor: string, planHash: string, invocation: string, deps = exactInputDependencies(), parent?: AbortSignal): Promise<ExactInputReceiptStatus> {
  const bound = binding(actor, planHash, invocation);
  return bounded(EXACT_INPUT_LIMITS.receipt_ms, async signal => {
    for (const stage of ['terminal', 'initial'] as const) {
      const key = receiptKey(bound, stage), bytes = await abortable(deps.readReceipt(key, stage === 'terminal' ? EXACT_INPUT_LIMITS.bundle_bytes : EXACT_INPUT_LIMITS.metadata_bytes, signal), signal);
      if (!bytes) continue;
      const payload = parseReceipt(bytes, bound);
      if (stage === 'initial') return { status: 'uncertain', invocation_id: invocation, receipt_sha256: sha(bytes), download_url: null, summary: null,
        message: 'An initial receipt exists. Completion and final charges are uncertain. Do not repeat provider work.' };
      check(['completed', 'failed', 'stale_input'].includes(String(payload.status)), 'receipt_integrity');
      const summary = record(payload.summary); check(Buffer.byteLength(JSON.stringify(summary)) <= 768 * 1024, 'summary_size');
      let downloadUrl: string | null = null;
      try { downloadUrl = await abortable(deps.signReceipt(key), signal); } catch { /* Evidence remains durable; a later read can issue a fresh URL. */ }
      return { status: payload.status as 'completed' | 'failed' | 'stale_input', invocation_id: invocation, receipt_sha256: sha(bytes),
        download_url: downloadUrl, summary, message: downloadUrl ? 'Private terminal evidence recovered. Review failures and unknowns before drawing conclusions.'
          : 'Private terminal evidence exists; its download link is unavailable. Read the receipt again to obtain a link without repeating providers.' };
    }
    return { status: 'not_found', invocation_id: invocation, receipt_sha256: null, download_url: null, summary: null,
      message: 'No receipt was found. An uncertain request is not proof of zero remote work. Do not automatically retry.' };
  }, deps, parent);
}
export async function runExactInputQualification(actor: string, planHash: string, invocation: string, env: Record<string, string | undefined>, deps = exactInputDependencies(), disconnected?: AbortSignal): Promise<ExactInputReceiptStatus> {
  const endsAt = Date.now() + Math.min(EXACT_INPUT_LIMITS.invocation_ms, deps.timeoutMs ?? EXACT_INPUT_LIMITS.invocation_ms);
  const remaining = (reserve = 0) => { const value = endsAt - Date.now() - reserve; check(value > 0, 'invocation_deadline'); return value; };
  const phase = <T>(maximum: number, operation: (signal: AbortSignal) => Promise<T>, reserve: number = EXACT_INPUT_LIMITS.terminal_reserve_ms) =>
    bounded(Math.min(maximum, remaining(deps.timeoutMs ? 0 : reserve)), operation, deps);
  check(!disconnected?.aborted, 'cancelled');
  const reviewed = await phase(EXACT_INPUT_LIMITS.preflight_ms, signal => exactInputQualificationPlan(env, deps, signal));
  check(reviewed.enabled && reviewed.plan && reviewed.plan_sha256 === planHash, 'plan_changed_or_disabled');
  const plan = reviewed.plan, bound = binding(actor, planHash, invocation);
  // This catches sequential replay, not cross-instance races. Storage PUT is not an atomic claim.
  const prior = await phase(EXACT_INPUT_LIMITS.receipt_ms, signal => recoverExactInputQualification(actor, planHash, invocation, deps, signal));
  if (prior.status !== 'not_found') return prior;
  const originals = await phase(EXACT_INPUT_LIMITS.preflight_ms, async signal => {
    verifiedInput(plan.config, await abortable(deps.readInput(plan.config), signal));
    return Promise.all((['front', 'back'] as const).map(async side => {
      const expected = plan.config.photos[side], value = await abortable(deps.readPhoto(expected.key, signal), signal);
      check(value.key === expected.key && value.sha256 === expected.sha256 && sha(value.bytes) === expected.sha256 && value.bytes.length <= 2 * MiB, 'unverified_photo');
      const metadata = await abortable(sharp(value.bytes, { limitInputPixels: 1400 * 1400, failOn: 'warning' }).metadata(), signal);
      check(metadata.format === 'jpeg' && metadata.width && metadata.height && metadata.width <= 1400 && metadata.height <= 1400 && (metadata.pages ?? 1) === 1, 'unverified_photo');
      return value;
    }));
  });
  const initial = { ...bound, stage: 'initial', started_at: deps.now().toISOString(), plan, original_byte_verification: originals.map(value => ({ key: value.key, sha256: value.sha256, bytes: value.bytes.length })),
    reserved_maximum_microusd: plan.config.billing?.maximum_total_microusd ?? null, global_once_only: false };
  await phase(EXACT_INPUT_LIMITS.receipt_ms, async signal => {
    const bytes = envelope(initial), key = receiptKey(bound, 'initial');
    check(bytes.length <= EXACT_INPUT_LIMITS.metadata_bytes, 'metadata_cap');
    await abortable(deps.writeReceipt(key, bytes, signal), signal);
    const saved = await abortable(deps.readReceipt(key, EXACT_INPUT_LIMITS.metadata_bytes, signal), signal);
    check(saved && sha(saved) === sha(bytes), 'initial_receipt_unverified');
  });
  let result: StaffInventoryResearchResult | null = null, errorCode: string | null = null, stale = false;
  let tape: ReturnType<ReturnType<typeof exactInputQualificationTransport>['finish']> | null = null;
  await phase(EXACT_INPUT_LIMITS.engine_ms, async phaseSignal => {
    const control = new AbortController(), stop = () => control.abort();
    phaseSignal.addEventListener('abort', stop, { once: true }); disconnected?.addEventListener('abort', stop, { once: true });
    if (phaseSignal.aborted || disconnected?.aborted) control.abort();
    const signal = control.signal;
    const transport = exactInputQualificationTransport(plan, originals, env, deps, signal);
    try {
      // Recheck after receipt I/O and before allowing the first dispatch.
      verifiedInput(plan.config, await abortable(deps.readInput(plan.config), signal));
      result = StaffInventoryResearchResultSchema.parse(await abortable(deps.research(plan.input, {
        env: { OPENAI_API_KEY: env.OPENAI_API_KEY, SOLDCOMPS_API_KEY: env.SOLDCOMPS_API_KEY,
          STAFF_INVENTORY_RESEARCH_SALE_DETAILS: 'true', STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: 'false' },
        fetchImpl: transport.fetchImpl, loadPhoto: async key => { const value = originals.find(photo => photo.key === key); check(value, 'unverified_photo'); return value; },
        loadReferences: async () => plan.references, now: deps.now, ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
      }, signal), signal));
      check(result.engine_version === 'staff-inventory-research-v5' && result.unit_id === plan.input.unit_id
        && result.description_event_id === plan.input.description_event_id && result.description_hash === plan.input.description_hash, 'result_binding');
    } catch (error) { errorCode = failureCode(error); }
    finally { tape = transport.finish(); phaseSignal.removeEventListener('abort', stop); disconnected?.removeEventListener('abort', stop); control.abort(); }
  }).catch(error => { errorCode = failureCode(error); });
  try { await phase(5000, async signal => verifiedInput(plan.config, await abortable(deps.readInput(plan.config), signal)), 15000); }
  catch { stale = true; }
  const captured = tape as ReturnType<ReturnType<typeof exactInputQualificationTransport>['finish']> | null;
  const status = stale ? 'stale_input' : errorCode || !captured || captured.violations.length ? 'failed' : 'completed';
  const summary = { status, result, result_sha256: result ? inventoryHash(result) : null, error_code: errorCode,
    global_once_only: false, receipt_concurrency: plan.receipt_concurrency,
    counts: captured?.counts ?? null, calls: captured?.calls.map(({ request_template, request_images, ...call }) => ({ ...call, request_images })) ?? [],
    cost: captured?.cost ?? { status: plan.cost_status, actual_billed_cost: null }, violations: captured?.violations ?? [], stale_input: stale };
  check(Buffer.byteLength(JSON.stringify(summary)) <= 768 * 1024, 'summary_size');
  const payload = { ...initial, stage: 'terminal', completed_at: deps.now().toISOString(), status, summary, tape: captured };
  await phase(EXACT_INPUT_LIMITS.receipt_ms, async signal => {
    const bytes = envelope(payload); check(bytes.length <= EXACT_INPUT_LIMITS.bundle_bytes, 'bundle_cap');
    noSecrets(bytes, [env.OPENAI_API_KEY, env.SOLDCOMPS_API_KEY].filter((value): value is string => !!value));
    await abortable(deps.writeReceipt(receiptKey(bound, 'terminal'), bytes, signal), signal);
  }, 0);
  return phase(EXACT_INPUT_LIMITS.receipt_ms, signal => recoverExactInputQualification(actor, planHash, invocation, deps, signal), 0);
}

export function exactInputDependencies(): ExactInputDependencies {
  return {
    readInput: async config => {
      const rows = await prisma.$queryRaw<ExactInputRow[]>(Prisma.sql`SELECT "id", "unitId", "input", "inputHash", "descriptionEventId", "descriptionHash", "status"
        FROM "StaffInventoryResearchJobV2" WHERE "id" = ${config.job_id} AND "unitId" = ${config.unit_id} AND "status" <> 'superseded' LIMIT 1`);
      return rows[0] ?? null;
    }, readReferences: loadStaffInventoryResearchReferences,
    readPhoto: (key, signal) => readStaffInventoryPhoto(key, {}, signal),
    readReceipt: async (key, maximum, signal) => {
      let body: Awaited<ReturnType<typeof openStorageObjectRead>>['body'] | undefined;
      const stop = () => body?.destroy?.(); signal.addEventListener('abort', stop, { once: true });
      try { return await readStorageBufferBounded(key, maximum, { openRead: async storageKey => {
        const read = await openStorageObjectRead(storageKey); body = read.body;
        if (signal.aborted) { stop(); fail('cancelled'); } return read;
      } }); } catch (error) { if (isStorageObjectNotFoundError(error)) return null; throw error; }
      finally { signal.removeEventListener('abort', stop); stop(); }
    },
    writeReceipt: async (key, bytes, signal) => { await uploadPrivateChecksumBuffer(key, bytes, 'application/json', { checksumSha256: sha(bytes), cacheControl: 'private, no-store', signal }); },
    signReceipt: key => presignReadUrl(key, 60), durableStorage: () => getStorageMode() === 's3', fetchImpl: fetch, research: researchStaffInventoryCard, now: () => new Date(),
  };
}
