import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import type { StaffInventoryResearchReference } from '../lib/staffInventoryResearch';

const enabled = process.env.TEN_KINGS_RESEARCH_V5_CRON_DISPOSABLE_VALIDATION === '1';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const optionalFlags = ['SET_CATALOG_EVIDENCE_ENABLED', 'STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE',
  'STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED', 'STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES'];

// No application import occurs until the owned-cluster guard passes. This test
// deliberately imports the DEFAULT cron export; it never supplies run/worker
// dependencies and never replaces the engine or a durable writer.
test('V5 enabled: default cron → worker → engine → durable PostgreSQL evidence and disabled-reader continuity', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.ok(process.version.startsWith('v22.'));
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(databaseUrl.protocol, 'postgresql:'); assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname, '/tenkings_research_v5_cron_disposable'); assert.ok(databaseUrl.port);
  assert.equal(databaseUrl.username, 'postgres'); assert.ok(databaseUrl.password);
  const receiptPath = await realpath(process.env.TEN_KINGS_RESEARCH_V5_CRON_OWNERSHIP_FILE ?? '');
  assert.equal(basename(receiptPath), 'fixture-ownership.json'); assert.ok(basename(dirname(receiptPath)).startsWith('tk-research-v5-cron-'));
  const ownership = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(databaseUrl.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_RESEARCH_V5_CRON_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); assert.ok(Number.isSafeInteger(ownership.postgres_pid) && ownership.postgres_pid > 1);
  process.kill(ownership.postgres_pid, 0);
  assert.equal(process.env.OPENAI_API_KEY, 'fixture-openai-key'); assert.equal(process.env.SOLDCOMPS_API_KEY, 'fixture-sold-key');
  assert.match(process.env.CRON_SECRET ?? '', /^fixture-cron-[a-f0-9]{64}$/);
  assert.equal(process.env.CARD_STORAGE_MODE, 's3');
  assert.equal(process.env.STAFF_INVENTORY_RESEARCH_SALE_DETAILS, 'true');
  const resultFile = process.env.TEN_KINGS_RESEARCH_V5_CRON_RESULT_FILE;
  assert.equal(resultFile, ownership.result_file); assert.ok(resultFile);
  assert.equal(basename(resultFile), 'fixture-result.json');
  for (const flag of optionalFlags) assert.equal(process.env[flag], undefined, `${flag} must remain absent/default OFF`);
  for (const key of Object.keys(process.env)) if (/^(?:AWS_|CARD_STORAGE_)/.test(key)) {
    assert.ok(['AWS_EC2_METADATA_DISABLED', 'CARD_STORAGE_MODE'].includes(key), `Unexpected storage credential/configuration: ${key}`);
  }
  assert.equal(Object.hasOwn(globalThis, 'prisma'), false, 'The guarded source Prisma singleton must not have been preloaded.');

  const bytes = await Promise.all(['white', 'blue', 'red', 'green', 'yellow', 'purple', 'orange', 'black'].map(background =>
    sharp({ create: { width: 60, height: 90, channels: 3, background } }).jpeg().toBuffer()));
  const photoKey = (data: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${digest(data)}.jpg`;
  const originals = new Map(bytes.slice(0, 2).map(data => [photoKey(data), data]));
  const storedImages = new Map<string, Buffer>();
  const calls = { heads: 0, photoReads: 0, references: 0, archives: 0, searches: 0, details: 0, models: 0, images: 0, unexpected: 0 };
  const savedModules = new Map<string, NodeModule | undefined>();
  const source = (relative: string) => require.resolve(relative);
  const replaceTransport = (path: string, exports: unknown) => {
    savedModules.set(path, require.cache[path]);
    require.cache[path] = { id: path, filename: path, loaded: true, exports } as NodeModule;
  };
  const restoration: (() => void)[] = [];
  const denyNetwork = () => { calls.unexpected++; throw new Error('Only in-memory fixture transports and the owned PostgreSQL connection are allowed.'); };
  // The real storage/photo/archive validation remains. Substitute only storage
  // transport I/O; in-memory originals have real JPEG bytes and SHA-256 keys.
  const storagePath = source('../lib/server/storage');
  const storage = require(storagePath) as typeof import('../lib/server/storage');
  replaceTransport(storagePath, { ...storage,
    headStorageObject: async (key: string) => {
      calls.heads++; const data = originals.get(key); assert.ok(data, 'Unrecognized original photo key.');
      return { storageKey: key, byteSize: data.length, contentType: 'image/jpeg', metadata: {}, checksumSha256: digest(data), nativeChecksumPresent: true, checksumSource: 'provider_native' };
    },
    openStorageObjectRead: async (key: string) => {
      calls.photoReads++; const data = originals.get(key); assert.ok(data, 'Unrecognized original photo key.');
      return { storageKey: key, byteSize: data.length, contentType: 'image/jpeg', body: Readable.from([data]) };
    },
    uploadPrivateChecksumBuffer: async (key: string, data: Buffer, type: string, options: { checksumSha256: string; signal: AbortSignal }) => {
      calls.archives++; assert.equal(options.signal.aborted, false); assert.equal(type, 'image/jpeg');
      assert.equal(key, `research-evidence/${digest(data)}.jpg`); assert.equal(options.checksumSha256, digest(data));
      if (storedImages.has(key)) assert.deepEqual(storedImages.get(key), data);
      storedImages.set(key, Buffer.from(data));
    },
  });
  const reference: StaffInventoryResearchReference = {
    id: 'catalog:cron-base', kind: 'catalog', trust: 'published_catalog', catalog_id: 'cron-base',
    identity: { name: 'Fixture Runner', category: 'Sports cards', year: '2024', manufacturer: 'Fixture Cards', set_name: 'Fixture Chrome', card_number: '007' },
    variant_name: 'Base', variant_kind: 'BASE', source_url: null, source_sha256: 'c'.repeat(64), captured_at: new Date().toISOString(),
    distinguishing_features: ['A circular base mark beneath the card number'], image: null,
  };
  replaceTransport(source('../lib/server/staffInventoryResearchReferences'), {
    loadStaffInventoryResearchReferences: async (description: { name: string }, signal: AbortSignal) => {
      calls.references++; assert.equal(signal.aborted, false); assert.equal(description.name, 'Fixture Runner'); return [reference];
    },
  });
  // Any accidental non-fetch HTTP/S/AWS transport fails before opening a socket.
  for (const name of ['node:http', 'node:https']) {
    const transport = require(name);
    for (const method of ['request', 'get']) { const original = transport[method]; transport[method] = denyNetwork; restoration.push(() => { transport[method] = original; }); }
  }
  const tls = require('node:tls'), oldTlsConnect = tls.connect; tls.connect = denyNetwork; restoration.push(() => { tls.connect = oldTlsConnect; });
  const net = require('node:net'), oldConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: unknown, ...args: unknown[]) {
    const options = typeof args[0] === 'object' && args[0] !== null ? args[0] as { host?: string; port?: number } : { port: args[0], host: args[1] };
    if (options.host !== '127.0.0.1' || Number(options.port) !== Number(databaseUrl.port)) return denyNetwork();
    return oldConnect.apply(this, args);
  };
  restoration.push(() => { net.Socket.prototype.connect = oldConnect; });
  type Item = Record<string, unknown> & { itemId: string; title: string; thumbnailUrl: string };
  const title = '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base PSA 9';
  const item = (index: number, changes: Record<string, unknown> = {}): Item => ({
    itemId: `93111111111${index}`, url: `https://www.ebay.com/itm/93111111111${index}`,
    title, soldPrice: index ? '10.02' : '10.01', soldCurrency: 'USD', listingType: 'sold',
    endedAt: '2026-09-08', condition: 'Graded', thumbnailUrl: `https://i.ebayimg.com/images/g/v5cron${index}/s-l225.jpg`, ...changes,
  });
  const ordinary = [item(0), item(1, { bestOfferAccepted: null })];
  const controls = [
    item(0, { title: title.replace('#007', '#008'), bestOfferAccepted: false }),
    item(1, { title: title.replace('Base', 'Blue Refractor'), bestOfferAccepted: false }),
    item(2, { title: title.replace('PSA 9', 'PSA 8'), bestOfferAccepted: false }),
    item(3, { title: title.replace('PSA 9', 'Raw'), condition: 'Ungraded', bestOfferAccepted: false }),
    item(4, { bestOfferAccepted: true }),
    item(5, { listingType: 'active', bestOfferAccepted: false }),
  ];
  const detailBody = (row: Item) => ({ itemId: row.itemId, title: row.title,
    price: row.soldPrice, currency: 'USD', bestOfferAccepted: false, ended: true,
    endedDate: 'Sep 08, 2026 18:17:08 PDT', soldBanner: 'Item sold on Tue, Sep 8 at 6:17 PM' });
  const phases = ['positive', 'controls', 'optional-failure'] as const;
  type Phase = typeof phases[number];
  let phase: Phase = 'positive', activeUnit = '';
  const perPhase = Object.fromEntries(phases.map(name => [name, { searches: 0, details: 0, models: 0, images: 0 }])) as Record<Phase, { searches: number; details: number; models: number; images: number }>;
  const rowsForPhase = () => phase === 'controls' ? controls : ordinary;
  const refinements = ['2024 Fixture Chrome Runner 007', '2024 Fixture Chrome Runner 007 PSA 9'];
  const expectedQueries = ['2024 Fixture Cards Chrome Runner 007 Base', ...refinements];
  const sourceReceipts = new Map<Phase, string[]>(), detailReceipts = new Map<string, string>();
  const observedClaims = new Map<string, { jobId: string; leaseToken: string; attempt: number; unitId: string }>();
  const count = (field: 'searches' | 'details' | 'models' | 'images') => {
    calls[field]++; perPhase[phase][field]++;
    const attemptCaps = { searches: 3, details: 2, models: 3, images: 12 };
    assert.ok(perPhase[phase][field] <= attemptCaps[field], `Per-attempt ${field} cap exceeded.`);
    assert.ok(calls[field] <= attemptCaps[field] * 3, `Fixture ${field} cap exceeded.`);
  };
  let activeDetails = 0, maxActiveDetails = 0, timeoutAborts = 0;
  let lateDetail: (() => void) | undefined;
  const beginDetail = () => { activeDetails++; maxActiveDetails = Math.max(maxActiveDetails, activeDetails); assert.ok(activeDetails <= 2); };
  const oldFetch = globalThis.fetch;
  type Database = typeof import('@tenkings/database');
  let database: Database | undefined;
  globalThis.fetch = (async (url, init) => {
    const uri = String(url); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal); assert.equal(init.signal.aborted, false);
    if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) {
      count('searches'); assert.equal(init.method, 'GET'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-sold-key');
      const params = new URL(uri).searchParams;
      assert.equal(params.get('keyword'), expectedQueries[perPhase[phase].searches - 1]); assert.equal(params.get('count'), '240');
      assert.equal(params.get('sold'), 'true'); assert.equal(params.get('hydrateBoa'), 'true');
      assert.ok(database);
      const rows = await database.prisma.$queryRawUnsafe<Array<{ id: string; unitId: string; leaseToken: string; leaseExpiresAt: Date; attemptCount: number }>>(
        'SELECT "id", "unitId", "leaseToken", "leaseExpiresAt", "attemptCount" FROM "StaffInventoryResearchJobV2" WHERE "unitId" = $1 AND status = $2', activeUnit, 'running');
      assert.equal(rows.length, 1); const running = rows[0]; assert.ok(running.leaseToken); assert.ok(running.leaseExpiresAt.getTime() > Date.now() + 140_000);
      const claim = { jobId: running.id, leaseToken: running.leaseToken, attempt: running.attemptCount, unitId: running.unitId };
      if (observedClaims.has(activeUnit)) assert.deepEqual(claim, observedClaims.get(activeUnit));
      else observedClaims.set(activeUnit, claim);
      const body = JSON.stringify({ keyword: params.get('keyword'), page: 1, totalItems: rowsForPhase().length, hasNextPage: false, items: rowsForPhase() });
      sourceReceipts.set(phase, [...sourceReceipts.get(phase) ?? [], digest(body)]);
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    }
    const detailMatch = /^https:\/\/api\.sold-comps\.com\/v1\/item\/(\d+)\?ebaySite=ebay\.com$/.exec(uri);
    if (detailMatch) {
      count('details'); assert.notEqual(phase, 'controls');
      assert.equal(init.method, 'GET'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-sold-key');
      const row = ordinary.find(row => row.itemId === detailMatch[1]); assert.ok(row);
      beginDetail();
      if (phase === 'optional-failure' && row === ordinary[0]) {
        activeDetails--; return new Response('controlled optional detail rate limit', { status: 429 });
      }
      const body = JSON.stringify(detailBody(row)); detailReceipts.set(row.itemId, digest(body));
      if (phase === 'optional-failure') {
        // Deliberately ignore abort until the fixture releases this response
        // after persistence. The real six-second detail deadline must win.
        init.signal.addEventListener('abort', () => { timeoutAborts++; activeDetails--; }, { once: true });
        return new Promise<Response>(done => { lateDetail = () => done(new Response(body, { headers: { 'content-type': 'application/json' } })); });
      }
      await new Promise<void>(done => setImmediate(done)); activeDetails--;
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    }
    if (uri === 'https://api.openai.com/v1/responses') {
      count('models'); assert.equal(init.method, 'POST'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-openai-key');
      const body = JSON.parse(String(init.body)); assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.store, false); assert.equal(body.tools, undefined);
      const content = body.input[0].content as Array<{ type: string; text?: string }>;
      const candidates = content.filter(part => part.text?.startsWith('Candidate data: ')).map(part => JSON.parse(part.text!.slice('Candidate data: '.length)));
      assert.equal(candidates.length, rowsForPhase().length); assert.ok(candidates.every(candidate => candidate.image_sha256));
      const analysis = {
        identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The exact published base checklist and photographed circular mark agree.', reference_ids: [reference.id],
          photo_features: [{ side: 'back', photo_sha256: digest(bytes[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: circular base mark beneath 007.' }] },
        target_condition: { status: 'graded', grader: 'PSA', numeric_grade: 9, photo_evidence: 'Front grading label reads PSA 9.' },
        refinement: phase === 'optional-failure' && perPhase[phase].models < 3
          ? { query: refinements[perPhase[phase].models - 1], reason: 'Preserve exact identity while varying optional wording to find supported ordinary sales.' } : null,
        selected_candidate_ids: phase === 'positive' ? ordinary.map(row => `ebay:${row.itemId}`) : [],
        // Wrong-card/parallel/grade/raw controls deliberately challenge
        // deterministic rejection with optimistic model comparisons.
        comparisons: candidates.map(candidate => ({ candidate_id: candidate.id, classification: 'matched', identity_match: true, variant_match: true, visual_match: true, condition_match: true,
          reason: 'Synthetic model reports matching identity, finish and PSA 9; deterministic source and condition gates must still hold.' })),
      };
      return Response.json({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] });
    }
    const index = rowsForPhase().findIndex(row => row.thumbnailUrl === uri);
    if (index >= 0) { count('images'); return new Response(new Uint8Array(bytes[index + 2]), { headers: { 'content-type': 'image/jpeg' } }); }
    return denyNetwork(); // Includes full-resolution images and any unplanned URL.
  }) as typeof fetch;
  restoration.push(() => { globalThis.fetch = oldFetch; });

  try {
    assert.equal(await realpath(require.resolve('@tenkings/database')), await realpath(resolve(__dirname, '../../../packages/database/src/index.ts')));
    for (const path of ['../pages/api/cron/inventory-research', '../lib/server/staffInventoryResearchWorker', '../lib/server/staffInventoryResearch']) {
      assert.equal(await realpath(source(path)), await realpath(resolve(__dirname, `${path}.ts`)));
      assert.equal(savedModules.has(source(path)), false, 'Application orchestration must be the actual source module.');
    }
    database = require('@tenkings/database') as Database;
    assert.equal(database.prisma, (require('../../../packages/database/src/client') as typeof import('../../../packages/database/src/client')).prisma);
    const db = database.prisma;
    const identity = await db.$queryRawUnsafe<Array<{ database: string; host: string; encoding: string }>>('SELECT current_database() AS database, host(inet_server_addr()) AS host, current_setting(\'server_encoding\') AS encoding');
    assert.deepEqual(identity, [{ database: 'tenkings_research_v5_cron_disposable', host: '127.0.0.1', encoding: 'UTF8' }]);
    const cron = (require('../pages/api/cron/inventory-research') as typeof import('../pages/api/cron/inventory-research')).default;
    const worker = require('../lib/server/staffInventoryResearchWorker') as typeof import('../lib/server/staffInventoryResearchWorker');
    const defaultDependencies = worker.staffInventoryResearchWorkerDependencies;
    assert.equal(savedModules.has(source('../lib/server/staffInventoryResearchWorker')), false);
    assert.equal(savedModules.has(source('../lib/server/staffInventoryResearch')), false);
    const callCron = async (options: { authorization?: string; method?: string; query?: Record<string, string> } = {}) => {
      const captured = { code: 0, body: null as any, headers: {} as Record<string, string> };
      const res = { setHeader(name: string, value: string) { captured.headers[name] = value; }, status(code: number) { captured.code = code; return this; }, json(body: unknown) { captured.body = body; return this; } } as unknown as NextApiResponse;
      await cron({ method: options.method ?? 'GET', headers: { authorization: options.authorization ?? `Bearer ${process.env.CRON_SECRET}` }, query: options.query ?? {} } as NextApiRequest, res);
      assert.equal(captured.headers['Cache-Control'], 'private, no-store'); return captured;
    };
    const tx = <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => db.$transaction(callback, { isolationLevel: 'ReadCommitted', timeout: 30_000 });
    const location = await db.location.create({ data: { name: 'DISPOSABLE V5 CRON FIXTURE', slug: 'v5-cron-fixture', address: 'fixture', recentRips: [], locationType: 'hq' } });
    const command = () => ({ action: 'add', request_id: randomUUID(), effective_at: '2026-09-08T00:00:00.000Z', note: 'Disposable V5 default worker qualification.',
      origin: 'purchase', quantity: 1, total_cost_cents: 123, cost_method: 'documented_unit', expected_price_cents: 456,
      destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed',
      description: { name: 'Fixture Runner', category: 'Sports cards', notes: '', photo_key: photoKey(bytes[0]), back_photo_key: photoKey(bytes[1]),
        card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: 'Base', card_type: 'Baseball' }, planned_sales_channel: 'eBay' } });
    const unit = (value: ReturnType<typeof command>) => `staff:${value.request_id}:card:0001`;
    const save = (value: ReturnType<typeof command>) => tx(client => database!.recordStaffInventoryV2(client, value, 'fixture-default-cron-staff'));
    const read = async (unitId: string) => (await database!.readStaffInventoryResearchV2(db, { unitIds: [unitId] }))[0];
    const raw = async (unitId: string) => {
      const rows = await db.$queryRawUnsafe<Array<{ id: string; status: string; attemptCount: number; maxAttempts: number; leaseToken: string | null; leaseExpiresAt: Date | null;
        nextAttemptAt: Date; result: string | null; resultHash: string | null; inputHash: string; attempts: Array<{ outcome: string; error?: { code: string; message: string } }>; errorCode: string | null; errorMessage: string | null }>>(
        'SELECT * FROM "StaffInventoryResearchJobV2" WHERE "unitId" = $1', unitId);
      assert.equal(rows.length, 1); return rows[0];
    };
    const history = async () => database!.canonical(await database!.readWorkflowHistoryV2(db));
    const persisted: Array<{ unitId: string; result: string; resultHash: string; attempts: unknown }> = [];
    const outcomes: Array<Record<string, unknown>> = [];
    for (const nextPhase of phases) {
      phase = nextPhase;
      const input = command(); activeUnit = unit(input);
      assert.equal((await save(input)).outcome, 'RECORDED'); assert.equal((await save(input)).outcome, 'REPLAY');
      const before = await history(), queued = await raw(activeUnit); assert.equal(queued.status, 'queued'); assert.equal(queued.attemptCount, 0);
      if (phase === 'positive') for (const [options, code] of [[{ authorization: 'Bearer not-the-cron-capability' }, 401], [{ method: 'POST' }, 405], [{ query: { unit_id: activeUnit } }, 400]] as const) {
        assert.equal((await callCron(options)).code, code); assert.equal((await raw(activeUnit)).attemptCount, 0); assert.equal(calls.searches, 0);
      }
      const began = Date.now(), completed = await callCron(), elapsed = Date.now() - began;
      assert.equal(completed.code, 200); assert.deepEqual(completed.body, { ok: true, claimed: 1, completed: 1, failed: 0, superseded: 0 });
      const stored = await raw(activeUnit), visible = await read(activeUnit), result = visible.result!;
      assert.equal(stored.status, 'complete'); assert.equal(stored.attemptCount, 1); assert.equal(stored.leaseToken, null); assert.equal(stored.leaseExpiresAt, null);
      assert.equal(stored.errorCode, null); assert.equal(stored.errorMessage, null);
      assert.ok(stored.result && stored.resultHash); assert.equal(stored.resultHash, database.inventoryHash(JSON.parse(stored.result)));
      assert.equal(database.canonical(result), stored.result); assert.equal(result.engine_version, 'staff-inventory-research-v6');
      assert.equal(result.sale_details!.base_engine_version, 'staff-inventory-research-v3'); assert.equal(Object.hasOwn(result, 'catalog_context'), false);
      assert.ok(result.candidates.every(({ image }) => image !== null && image.storage_key === `research-evidence/${image.sha256}.jpg`));
      assert.deepEqual(stored.attempts.map(attempt => attempt.outcome), ['complete']); assert.equal(await history(), before);
      assert.deepEqual(result.research_queries!.map(query => query.source_response_sha256), sourceReceipts.get(phase));
      assert.equal(stored.result.includes('fixture-openai-key'), false); assert.equal(stored.result.includes('fixture-sold-key'), false);
      if (phase === 'positive') {
        assert.equal(result.estimate.value_cents, 1002); assert.equal(result.estimate.count, 2);
        assert.deepEqual(result.selected_candidate_ids, ordinary.map(row => `ebay:${row.itemId}`));
        assert.equal(new Set(result.candidates.map(candidate => candidate.image!.sha256)).size, 2);
        assert.equal(result.sale_details!.requests.length, 2);
        for (const candidate of result.candidates) {
          assert.equal(candidate.best_offer_accepted, null); assert.equal(candidate.accepted_offer, undefined); assert.equal(candidate.source_eligible, true);
          const proof = candidate.ordinary_sale_detail!; assert.ok(proof);
          assert.equal(proof.search.offer_field, candidate.id.endsWith('0') ? 'absent' : 'null');
          assert.equal(proof.search.sold_price, candidate.sold_price); assert.equal(proof.detail.price, candidate.sold_price);
          assert.equal(proof.search.response_sha256, sourceReceipts.get(phase)![0]); assert.equal(proof.detail.response_sha256, detailReceipts.get(proof.item_id));
          const receipt = result.sale_details!.requests.find(request => request.item_id === proof.item_id)!;
          assert.equal(receipt.status, 'observed'); assert.equal(receipt.response_sha256, proof.detail.response_sha256); assert.equal(receipt.completed_at, proof.detail.retrieved_at);
        }
      } else {
        assert.equal(result.estimate.status, 'unknown'); assert.equal(result.estimate.value_cents, null); assert.deepEqual(result.selected_candidate_ids, []);
        assert.ok(result.candidates.every(candidate => candidate.ordinary_sale_detail === undefined));
        if (phase === 'controls') {
          assert.deepEqual(result.sale_details!.requests, []);
          for (const row of controls.slice(0, 4)) assert.equal(result.comparison_assessments!.find(value => value.candidate_id === `ebay:${row.itemId}`)!.classification, 'rejected');
          const offer = result.candidates.find(candidate => candidate.id === `ebay:${controls[4].itemId}`)!;
          const active = result.candidates.find(candidate => candidate.id === `ebay:${controls[5].itemId}`)!;
          assert.equal(offer.best_offer_accepted, true); assert.equal(offer.source_eligible, false); assert.equal(offer.sold_price_cents, null);
          assert.equal(active.sale_evidence!.status, 'active'); assert.equal(active.source_eligible, false);
          const reasons = result.diagnostics!.candidates.flatMap(candidate => candidate.decision_codes);
          for (const reason of ['CARD_NUMBER_CONFLICT', 'VARIANT_TITLE_CONFLICT', 'CONDITION_MISMATCH']) assert.ok(reasons.includes(reason));
        } else {
          assert.ok(elapsed >= 5900 && elapsed < 20_000, `Unmodified six-second optional deadline must finish durably (${elapsed}ms).`);
          assert.equal(timeoutAborts, 1); assert.equal(activeDetails, 0); assert.ok(lateDetail);
          assert.deepEqual(result.sale_details!.requests.map(request => [request.item_id, request.status, request.error_code, request.response_sha256]), [
            [ordinary[0].itemId, 'failed', 'provider_error', null], [ordinary[1].itemId, 'failed', 'timeout', null],
          ]);
          assert.ok(result.candidates.every(candidate => candidate.sold_price_cents === null && !candidate.source_eligible));
          assert.equal(result.research_queries!.length, 3); assert.ok(result.research_queries!.every(query => query.status === 'completed'));
          const prior = database.canonical(result); lateDetail();
          await new Promise<void>(done => setImmediate(done)); await new Promise<void>(done => setImmediate(done));
          assert.equal(database.canonical(result), prior); assert.equal((await raw(activeUnit)).result, stored.result);
        }
      }
      assert.equal(worker.staffInventoryResearchWorkerDependencies, defaultDependencies);
      const counts = { ...calls }; assert.equal((await save(input)).outcome, 'REPLAY');
      assert.deepEqual((await callCron()).body, { ok: true, claimed: 0, completed: 0, failed: 0, superseded: 0 });
      const replay = await raw(activeUnit); assert.equal(replay.result, stored.result); assert.equal(replay.resultHash, stored.resultHash);
      assert.deepEqual(replay.attempts, stored.attempts); assert.deepEqual(calls, counts); assert.equal(await history(), before);
      persisted.push({ unitId: activeUnit, result: stored.result, resultHash: stored.resultHash, attempts: stored.attempts });
      outcomes.push({ phase, unit_id: activeUnit, attempt_count: stored.attemptCount, result_hash: stored.resultHash, estimate: result.estimate.status, elapsed_ms: elapsed });
    }
    assert.equal(observedClaims.size, 3); assert.ok([...observedClaims.values()].every(claim => claim.attempt === 1));
    assert.equal(new Set([...observedClaims.values()].map(claim => claim.leaseToken)).size, 3); assert.equal(maxActiveDetails, 2);
    assert.deepEqual(perPhase, { positive: { searches: 1, details: 2, models: 1, images: 2 }, controls: { searches: 1, details: 0, models: 1, images: 6 }, 'optional-failure': { searches: 3, details: 2, models: 3, images: 2 } });
    assert.deepEqual(calls, { heads: 6, photoReads: 6, references: 3, archives: 10, searches: 5, details: 4, models: 5, images: 10, unexpected: 0 });
    const beforeDisable = await history(); process.env.STAFF_INVENTORY_RESEARCH_SALE_DETAILS = 'false';
    try {
      for (const prior of persisted) {
        const visible = await read(prior.unitId), stored = await raw(prior.unitId);
        assert.equal(visible.result!.engine_version, 'staff-inventory-research-v6'); assert.equal(database.canonical(visible.result), prior.result);
        assert.equal(stored.resultHash, prior.resultHash); assert.deepEqual(stored.attempts, prior.attempts);
      }
      const counts = { ...calls }; assert.deepEqual((await callCron()).body, { ok: true, claimed: 0, completed: 0, failed: 0, superseded: 0 }); assert.deepEqual(calls, counts);
      assert.equal(await history(), beforeDisable);
    } finally { process.env.STAFF_INVENTORY_RESEARCH_SALE_DETAILS = 'true'; }
    const optional = await db.$queryRawUnsafe<Array<{ proposals: bigint; publications: bigint }>>('SELECT (SELECT count(*) FROM "SetCatalogObservationProposal") AS proposals, (SELECT count(*) FROM "SetCatalogEvidencePublication") AS publications');
    assert.deepEqual(optional, [{ proposals: 0n, publications: 0n }]);
    await writeFile(resultFile, JSON.stringify({ schema_version: 1, real_provider_calls: 0, claims: observedClaims.size, durable_completions: persisted.length,
      per_phase: perPhase, transports: calls, max_concurrent_details: maxActiveDetails, timeout_aborts: timeoutAborts,
      disabled_reader_unchanged: true, late_result_unchanged: true, source_histories_unchanged: true, outcomes }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    t.diagnostic('Three real disposable saves/claims and V5 durable completions; four synthetic detail requests; exact wrong-card/parallel/grade/raw, offer and active controls; optional 429/six-second timeout cached across three searches; flag-off readers and late-response persistence unchanged. Zero real provider calls. Functional evidence only.');
  } finally {
    try { await database?.prisma.$disconnect(); }
    finally {
      for (const restore of restoration.reverse()) restore();
      for (const [path, original] of savedModules) { if (original) require.cache[path] = original; else delete require.cache[path]; }
    }
  }
});
