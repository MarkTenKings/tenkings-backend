import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Prisma } from '@prisma/client';
import type { StaffInventoryResearchReference } from '../lib/staffInventoryResearch';

const enabled = process.env.TEN_KINGS_RESEARCH_CRON_DISPOSABLE_VALIDATION === '1';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const optionalFlags = ['SET_CATALOG_EVIDENCE_ENABLED', 'STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE',
  'STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED', 'STAFF_INVENTORY_RESEARCH_SALE_DETAILS', 'STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES'];

// No application import occurs until the owned-cluster guard passes. This test
// deliberately imports the DEFAULT cron export; it never supplies run/worker
// dependencies and never replaces the engine or a durable writer.
test('authenticated default cron → default worker → real engine and durable PostgreSQL writers', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.ok(process.version.startsWith('v22.'));
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(databaseUrl.protocol, 'postgresql:'); assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname, '/tenkings_research_cron_disposable'); assert.ok(databaseUrl.port);
  assert.equal(databaseUrl.username, 'postgres'); assert.ok(databaseUrl.password);
  const receiptPath = await realpath(process.env.TEN_KINGS_RESEARCH_CRON_OWNERSHIP_FILE ?? '');
  assert.equal(basename(receiptPath), 'fixture-ownership.json'); assert.ok(basename(dirname(receiptPath)).startsWith('tk-research-cron-'));
  const ownership = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(databaseUrl.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_RESEARCH_CRON_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); assert.ok(Number.isSafeInteger(ownership.postgres_pid) && ownership.postgres_pid > 1);
  process.kill(ownership.postgres_pid, 0);
  assert.equal(process.env.OPENAI_API_KEY, 'fixture-openai-key'); assert.equal(process.env.SOLDCOMPS_API_KEY, 'fixture-sold-key');
  assert.match(process.env.CRON_SECRET ?? '', /^fixture-cron-[a-f0-9]{64}$/);
  assert.equal(process.env.CARD_STORAGE_MODE, 's3');
  for (const flag of optionalFlags) assert.equal(process.env[flag], undefined, `${flag} must remain absent/default OFF`);
  for (const key of Object.keys(process.env)) if (/^(?:AWS_|CARD_STORAGE_)/.test(key)) {
    assert.ok(['AWS_EC2_METADATA_DISABLED', 'CARD_STORAGE_MODE'].includes(key), `Unexpected storage credential/configuration: ${key}`);
  }
  assert.equal(Object.hasOwn(globalThis, 'prisma'), false, 'The guarded source Prisma singleton must not have been preloaded.');

  const bytes = await Promise.all(['white', 'blue', 'red', 'green'].map(background =>
    sharp({ create: { width: 60, height: 90, channels: 3, background } }).jpeg().toBuffer()));
  const photoKey = (data: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${digest(data)}.jpg`;
  const originals = new Map(bytes.slice(0, 2).map(data => [photoKey(data), data]));
  const storedImages = new Map<string, Buffer>();
  const calls = { heads: 0, photoReads: 0, references: 0, archives: 0, searches: 0, models: 0, images: 0, unexpected: 0 };
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
  const items = [0, 1].map(index => ({ itemId: `92111111111${index}`, url: `https://www.ebay.com/itm/92111111111${index}`,
    title: '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base Raw', soldPrice: index ? '10.02' : '10.01', soldCurrency: 'USD',
    bestOfferAccepted: false, listingType: 'sold', endedAt: '2026-09-08', condition: 'Ungraded',
    thumbnailUrl: `https://i.ebayimg.com/images/g/cron${index}/s-l225.jpg`, fullResThumbnailUrl: `https://i.ebayimg.com/images/g/cron${index}/s-l500.jpg` }));
  const oldFetch = globalThis.fetch;
  let phase: 'success' | 'rate-limit' | 'timeout' = 'success', activeUnit = '';
  const observedClaims: { jobId: string; leaseToken: string; attempt: number; unitId: string }[] = [];
  type Database = typeof import('@tenkings/database');
  let database: Database | undefined;
  globalThis.fetch = (async (url, init) => {
    const uri = String(url); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal); assert.equal(init.signal.aborted, false);
    if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) {
      calls.searches++; assert.equal(init.method, 'GET'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-sold-key');
      const params = new URL(uri).searchParams;
      assert.equal(params.get('keyword'), '2024 Fixture Cards Chrome Runner 007'); assert.equal(params.get('count'), '240');
      assert.equal(params.get('sold'), 'true'); assert.equal(params.get('hydrateBoa'), 'true');
      assert.ok(database);
      const rows = await database.prisma.$queryRawUnsafe<Array<{ id: string; unitId: string; leaseToken: string; leaseExpiresAt: Date; attemptCount: number }>>(
        'SELECT "id", "unitId", "leaseToken", "leaseExpiresAt", "attemptCount" FROM "StaffInventoryResearchJobV2" WHERE "unitId" = $1 AND status = $2', activeUnit, 'running');
      assert.equal(rows.length, 1); const running = rows[0]; assert.ok(running.leaseToken); assert.ok(running.leaseExpiresAt.getTime() > Date.now() + 140_000);
      observedClaims.push({ jobId: running.id, leaseToken: running.leaseToken, attempt: running.attemptCount, unitId: running.unitId });
      if (phase === 'rate-limit') return new Response('fixture provider secret must not persist', { status: 429 });
      if (phase === 'timeout') return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('fixture source abort')), { once: true }));
      return Response.json({ keyword: params.get('keyword'), page: 1, totalItems: 2, hasNextPage: false, items });
    }
    if (uri === 'https://api.openai.com/v1/responses') {
      calls.models++; assert.equal(init.method, 'POST'); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-openai-key');
      const body = JSON.parse(String(init.body)); assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.store, false); assert.equal(body.tools, undefined);
      const analysis = {
        identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The exact published base checklist and photographed circular mark agree.', reference_ids: [reference.id],
          photo_features: [{ side: 'back', photo_sha256: digest(bytes[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: circular base mark beneath 007.' }] },
        target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Both photos show an ungraded card without a slab label.' },
        refinement: null, selected_candidate_ids: items.map(item => `ebay:${item.itemId}`),
        comparisons: items.map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'matched', identity_match: true, variant_match: true, visual_match: true, condition_match: true, reason: 'The exact raw card identity and printed base mark match both original views.' })),
      };
      return Response.json({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] });
    }
    const index = items.findIndex(item => item.thumbnailUrl === uri);
    if (index >= 0) { calls.images++; return new Response(new Uint8Array(bytes[index + 2]), { headers: { 'content-type': 'image/jpeg' } }); }
    return denyNetwork(); // Includes optional details, full-resolution images, scope effects and any other URL.
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
    assert.deepEqual(identity, [{ database: 'tenkings_research_cron_disposable', host: '127.0.0.1', encoding: 'UTF8' }]);
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
    const location = await db.location.create({ data: { name: 'DISPOSABLE DEFAULT CRON FIXTURE', slug: 'default-cron-fixture', address: 'fixture', recentRips: [], locationType: 'hq' } });
    const command = () => ({ action: 'add', request_id: randomUUID(), effective_at: '2026-09-08T00:00:00.000Z', note: 'Disposable default worker qualification.',
      origin: 'purchase', quantity: 1, total_cost_cents: 123, cost_method: 'documented_unit', expected_price_cents: 456,
      destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed',
      description: { name: 'Fixture Runner', category: 'Sports cards', notes: '', photo_key: photoKey(bytes[0]), back_photo_key: photoKey(bytes[1]),
        card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: null, card_type: 'Baseball' }, planned_sales_channel: 'eBay' } });
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
    const first = command(); activeUnit = unit(first);
    assert.equal((await save(first)).outcome, 'RECORDED'); assert.equal((await save(first)).outcome, 'REPLAY');
    const before = await history(), queued = await raw(activeUnit); assert.equal(queued.status, 'queued'); assert.equal(queued.attemptCount, 0);
    for (const [options, code] of [[{ authorization: 'Bearer not-the-cron-capability' }, 401], [{ method: 'POST' }, 405], [{ query: { unit_id: activeUnit } }, 400]] as const) {
      assert.equal((await callCron(options)).code, code); assert.equal((await raw(activeUnit)).attemptCount, 0); assert.equal(calls.searches, 0);
    }
    const successful = await callCron(); assert.equal(successful.code, 200);
    assert.deepEqual(successful.body, { ok: true, claimed: 1, completed: 1, failed: 0, superseded: 0 });
    const stored = await raw(activeUnit), visible = await read(activeUnit);
    assert.equal(stored.status, 'complete'); assert.equal(stored.attemptCount, 1); assert.equal(stored.leaseToken, null); assert.equal(stored.leaseExpiresAt, null);
    assert.ok(stored.result); assert.equal(stored.resultHash, database.inventoryHash(JSON.parse(stored.result)));
    assert.equal(database.canonical(visible.result), stored.result); assert.equal(visible.result!.engine_version, 'staff-inventory-research-v6');
    assert.equal(visible.result!.estimate.value_cents, 1002); assert.equal(visible.result!.estimate.count, 2);
    assert.ok(visible.result!.candidates.every(({ image }) => image !== null && image.storage_key === `research-evidence/${image.sha256}.jpg`));
    assert.equal(Object.hasOwn(visible.result!, 'sale_details'), false); assert.equal(Object.hasOwn(visible.result!, 'catalog_context'), false);
    assert.deepEqual(stored.attempts.map(attempt => attempt.outcome), ['complete']); assert.equal(await history(), before);
    assert.deepEqual({ ...calls }, { heads: 2, photoReads: 2, references: 1, archives: 2, searches: 1, models: 1, images: 2, unexpected: 0 });
    const counts = { ...calls }; assert.equal((await save(first)).outcome, 'REPLAY');
    assert.deepEqual((await callCron()).body, { ok: true, claimed: 0, completed: 0, failed: 0, superseded: 0 });
    const replay = await raw(activeUnit); assert.equal(replay.result, stored.result); assert.equal(replay.resultHash, stored.resultHash);
    assert.deepEqual(replay.attempts, stored.attempts); assert.deepEqual(calls, counts); assert.equal(await history(), before);

    const second = command(); activeUnit = unit(second); await save(second); const secondHistory = await history(); phase = 'rate-limit';
    const failedAt = Date.now(), failed = await callCron(); assert.equal(failed.code, 200);
    assert.deepEqual(failed.body, { ok: true, claimed: 1, completed: 0, failed: 1, superseded: 0 });
    const retry = await raw(activeUnit), firstFailedClaim = observedClaims.at(-1)!;
    assert.equal(retry.status, 'queued'); assert.equal(retry.attemptCount, 1); assert.equal(retry.maxAttempts, 3);
    assert.equal(retry.errorCode, 'PROVIDER_ERROR'); assert.ok(retry.errorMessage); assert.equal(retry.errorMessage!.includes('fixture provider'), false);
    assert.equal(retry.leaseToken, null); assert.equal(retry.leaseExpiresAt, null); assert.equal(retry.result, null); assert.equal(retry.resultHash, null);
    assert.ok(retry.nextAttemptAt.getTime() >= failedAt + 29_000); assert.deepEqual(retry.attempts.map(attempt => attempt.outcome), ['failed']);
    const afterFailure = { ...calls }; assert.equal((await callCron()).body.claimed, 0); assert.deepEqual(calls, afterFailure);
    // Only this owned fixture job's availability is advanced. Production retry
    // calculation was already verified above; no source or attempt is rewritten.
    assert.equal(await db.$executeRawUnsafe('UPDATE "StaffInventoryResearchJobV2" SET "nextAttemptAt" = clock_timestamp() WHERE id = $1 AND status = $2 AND "attemptCount" = 1 AND "inputHash" = $3', retry.id, 'queued', retry.inputHash), 1);
    phase = 'success'; const retried = await callCron(); assert.equal(retried.code, 200); assert.equal(retried.body.completed, 1);
    const done = await raw(activeUnit), secondClaim = observedClaims.at(-1)!;
    assert.equal(secondClaim.attempt, 2); assert.notEqual(secondClaim.leaseToken, firstFailedClaim.leaseToken);
    assert.equal(done.status, 'complete'); assert.equal(done.attemptCount, 2); assert.deepEqual(done.attempts.map(attempt => attempt.outcome), ['failed', 'complete']);
    assert.equal(done.resultHash, database.inventoryHash(JSON.parse(done.result!))); assert.equal(await history(), secondHistory);
    const doneResult = (await read(activeUnit)).result!;
    assert.equal(await tx(client => database!.completeStaffInventoryResearchV2(client, { jobId: done.id, leaseToken: firstFailedClaim.leaseToken, result: doneResult })), false);
    assert.equal(await tx(client => database!.failStaffInventoryResearchV2(client, { jobId: done.id, leaseToken: firstFailedClaim.leaseToken, errorCode: 'PROVIDER_ERROR', errorMessage: 'Synthetic stale worker.', retryable: true })), false);
    assert.equal((await raw(activeUnit)).result, done.result); assert.equal((await raw(activeUnit)).resultHash, done.resultHash);

    const third = command(); activeUnit = unit(third); await save(third); const timeoutHistory = await history(); phase = 'timeout';
    const timeoutStarted = Date.now(), timedOut = await callCron(), elapsed = Date.now() - timeoutStarted;
    assert.equal(timedOut.code, 200); assert.deepEqual(timedOut.body, { ok: true, claimed: 1, completed: 0, failed: 1, superseded: 0 });
    assert.ok(elapsed >= 19_000 && elapsed < 30_000, `The actual default 20-second source deadline must bound the timeout (${elapsed}ms).`);
    const timeoutRow = await raw(activeUnit);
    assert.equal(timeoutRow.errorCode, 'TIMEOUT'); assert.equal(timeoutRow.status, 'queued'); assert.equal(timeoutRow.attemptCount, 1);
    assert.equal(timeoutRow.leaseToken, null); assert.equal(timeoutRow.leaseExpiresAt, null); assert.equal(timeoutRow.result, null);
    assert.equal(await history(), timeoutHistory); assert.equal((await callCron()).body.claimed, 0);
    assert.equal(calls.unexpected, 0); assert.equal(calls.searches, 4); assert.equal(calls.models, 2); assert.equal(calls.images, 4); assert.equal(calls.archives, 4);
    const optional = await db.$queryRawUnsafe<Array<{ proposals: bigint; publications: bigint }>>('SELECT (SELECT count(*) FROM "SetCatalogObservationProposal") AS proposals, (SELECT count(*) FROM "SetCatalogEvidencePublication") AS publications');
    assert.deepEqual(optional, [{ proposals: 0n, publications: 0n }]);
    assert.equal(worker.staffInventoryResearchWorkerDependencies, defaultDependencies);
    t.diagnostic('Three real saves; default authenticated cron; four actual claims; two durable completions; one provider failure and one real source timeout. Optional stages OFF; fixture transports only. This is a functional gate, not a responsiveness benchmark or live-provider/device qualification.');
  } finally {
    try { await database?.prisma.$disconnect(); }
    finally {
      for (const restore of restoration.reverse()) restore();
      for (const [path, original] of savedModules) { if (original) require.cache[path] = original; else delete require.cache[path]; }
    }
  }
});
