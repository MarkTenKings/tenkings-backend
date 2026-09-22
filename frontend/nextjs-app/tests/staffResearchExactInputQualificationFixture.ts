import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { canonical, inventoryHash } from '@tenkings/database';
import type { StaffInventoryResearchInput } from '../lib/staffInventoryResearch';
import { researchStaffInventoryCard } from '../lib/server/staffInventoryResearch';
import { exactInputQualificationPlan, type ExactInputConfiguration, type ExactInputDependencies, type ExactInputRow } from '../lib/server/staffResearchExactInputQualification';

export const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const invocation = 'c647368a-901d-4f36-9a64-ab21f2e6f601';
export const actorId = 'qualification-fixture-human';
export async function exactFixture() {
  const bytes = await Promise.all(['blue', 'white', 'red', 'green'].map(background => sharp({ create: { width: 40, height: 60, channels: 3, background } }).jpeg().toBuffer()));
  const key = (index: number) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes[index])}.jpg`;
  const input: StaffInventoryResearchInput = { schema_version: 1, unit_id: 'fixture:existing:card:0001', description_event_id: 'fixture-description', description_hash: 'b'.repeat(64),
    description: { name: 'Example Player', category: 'Sports cards', manufacturer: 'Topps', year: '2020', set_name: 'Topps Baseball', card_number: '85A-BB', variant: null, card_type: 'Baseball' }, front_photo_key: key(0), back_photo_key: key(1) };
  const config: ExactInputConfiguration = { schema_version: 1, run_label: 'synthetic-existing-input', application_sha: 'a'.repeat(40), job_id: 'c647368a-901d-4f36-9a64-ab21f2e6f602',
    unit_id: input.unit_id, input_sha256: inventoryHash(input), description_event_id: input.description_event_id, description_sha256: input.description_hash,
    photos: { front: { key: key(0), sha256: sha(bytes[0]) }, back: { key: key(1), sha256: sha(bytes[1]) } }, billing: null };
  const row: ExactInputRow = { id: config.job_id, unitId: input.unit_id, input: canonical(input), inputHash: inventoryHash(input), descriptionEventId: input.description_event_id, descriptionHash: input.description_hash, status: 'complete' };
  const env = { VERCEL_GIT_COMMIT_SHA: config.application_sha, STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_CONFIG: JSON.stringify(config), STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED: 'true',
    OPENAI_API_KEY: 'fixture-openai-secret', SOLDCOMPS_API_KEY: 'fixture-sold-secret', NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'qualified-main.vercel.app', STAFF_RESEARCH_PROVIDER_QUALIFICATION_PREVIEW_HOST: 'qualified-main.vercel.app' };
  const storage = new Map<string, Buffer>(), operations: string[] = [], requests: { url: string; init: RequestInit }[] = [];
  const items = [0, 1].map(index => ({ itemId: String(900000000000 + index), url: `https://www.ebay.com/itm/${900000000000 + index}`, title: '2020 Topps Baseball Example Player #85A-BB Base Raw',
    soldPrice: '10.00', soldCurrency: 'USD', listingType: 'sold', endedAt: '2026-09-08', condition: 'Ungraded', thumbnailUrl: `https://i.ebayimg.com/images/g/exact${index}/s-l400.jpg` }));
  const transport = (async (url, init) => {
    const uri = String(url); operations.push('dispatch'); requests.push({ url: uri, init: init! });
    assert.ok(operations.includes('photo:0') && operations.includes('photo:1'), 'Originals must be verified before paid work');
    assert.ok([...storage.keys()].some(key => key.endsWith('/initial.json')), 'Initial receipt before dispatch');
    if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) return Response.json({ keyword: new URL(uri).searchParams.get('keyword'), page: 1, totalItems: items.length, hasNextPage: false, items });
    if (uri.includes('/v1/item/')) { const item = items.find(item => uri.includes(item.itemId))!; return Response.json({ itemId: item.itemId, title: item.title, price: item.soldPrice, currency: 'USD', bestOfferAccepted: false,
      ended: true, endedDate: 'Sep 08, 2026 18:17:08 PDT', soldBanner: 'Item sold on Tue, Sep 8 at 6:17 PM' }); }
    if (uri === 'https://api.openai.com/v1/responses') return Response.json({ id: 'synthetic-response', model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
      usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
        identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No exact published variant evidence.', reference_ids: [], photo_features: [] },
        photo_identity: { schema_version: 1, status: 'unresolved', observations: [], reason: 'The original photos do not establish a distinct printing.' },
        target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Original photos show a raw card.' }, selected_candidate_ids: [], refinement: null,
        comparisons: items.map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'possible', identity_match: true, variant_match: false, visual_match: false, condition_match: true, reason: 'The exact printing remains unresolved.' })),
      }) }] }] }, { headers: { 'x-request-id': 'synthetic-openai-request' } });
    const index = items.findIndex(item => item.thumbnailUrl === uri); assert.ok(index >= 0, 'No unexpected destination');
    return new Response(new Uint8Array(bytes[index + 2]), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const deps: ExactInputDependencies = { readInput: async () => { operations.push('read-input'); return row; }, readReferences: async () => [],
    readPhoto: async photoKey => { const index = [key(0), key(1)].indexOf(photoKey); assert.ok(index >= 0); operations.push(`photo:${index}`); return { key: photoKey, sha256: sha(bytes[index]), bytes: bytes[index] }; },
    readReceipt: async (key, max) => { operations.push('read-receipt'); const bytes = storage.get(key); if (bytes) assert.ok(bytes.length <= max); return bytes ?? null; },
    writeReceipt: async (key, bytes) => { operations.push('write-receipt'); assert.ok(!storage.has(key)); storage.set(key, Buffer.from(bytes)); },
    signReceipt: async key => `https://private.example/${key}?expires=60`, durableStorage: () => true, fetchImpl: transport, research: researchStaffInventoryCard, now: () => new Date('2026-09-21T12:00:00.000Z') };
  const plan = await exactInputQualificationPlan(env, deps);
  return { bytes, input, config, row, env, storage, operations, requests, items, deps, plan, key };
}
