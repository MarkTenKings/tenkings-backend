import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LABEL_25_PROFILE_DEFINITIONS, LABEL_25_CURRENT_PROFILE_DEFINITIONS, LABEL_25_SUPPORTED_PROFILE_DEFINITIONS, getLabel25Profile } from '../../../packages/atlas-finishing/src/label-sheet-25.mjs';
import { LABEL_JIG_V1 } from '../../../packages/atlas-finishing/src/label-sheet-geometry.mjs';
import { LABEL_EXPORT_PROFILE_V1, LABEL_SHEET_EXPORT_PROFILES, LABEL_SINGLE_EXPORT_PROFILES } from '../../../packages/atlas-finishing/src/label-sheet.mjs';
import { createLabelSheetsClient, labelArtworkHref, labelSupportsPrintFormat, labelSheetProfile, labelPrintFormatForProfile, LABEL_SHEETS_PATH, LABEL_EXPORT_PROFILE, LABEL_PRINT_FORMATS } from '../lib/label-sheets-client.mjs';
const sheetId = randomUUID(), itemId = randomUUID(), exportId = randomUUID(), staffId = randomUUID();
const hash = 'a'.repeat(64), sheet = { sheetId, revision: 8, jigHash: LABEL_JIG_V1.jigHash, items: [{ itemId, slot: 1 }] }, output = { exportId, sheetId, exportProfileId: LABEL_EXPORT_PROFILE, state: 'READY', sha256: hash, manifestHash: 'b'.repeat(64) };
const item = { itemId, state: 'READY', labelHash: hash };
const legacyFrontProfiles = [
  ['atlas-v4-sheet-800ppi-diagnostic-v2', 'original'],
  ['atlas-v4-sheet-800ppi-black-ink-transparent-v1', 'foil'],
  ['atlas-approved-b-sheet-800ppi-color-front-v1', 'color'],
  ...LABEL_25_PROFILE_DEFINITIONS.filter(profile => profile.side === 'FRONT').map(profile => [profile.id,
    profile.mode === 'black-ink-transparent' ? 'foil' : profile.mode === 'color' ? 'color' : 'original']),
];
test('every client print format maps to the registered sheet and individual export profiles', () => {
  assert.deepEqual([...Object.values(LABEL_PRINT_FORMATS).map(format => format.sheet), ...legacyFrontProfiles.slice(0, 3).map(([id]) => id),
    ...LABEL_25_SUPPORTED_PROFILE_DEFINITIONS.map(profile => profile.id)].sort(), LABEL_SHEET_EXPORT_PROFILES.map(profile => profile.id).sort());
  assert.deepEqual(Object.values(LABEL_PRINT_FORMATS).map(format => format.individual).sort(), LABEL_SINGLE_EXPORT_PROFILES.map(profile => profile.id).sort());
});
function fixture(request, shared = new Map()) {
  const calls = [], storage = { getItem: key => shared.get(key) ?? null, setItem: (key, value) => shared.set(key, value), removeItem: key => shared.delete(key) };
  const options = { staffId, csrf: 'actual-csrf', storage, cryptoImpl: { randomUUID }, request: async (path, options) => { calls.push({ path, ...options }); const result = await request(path, options); return result && typeof result === 'object' ? { ...(path.endsWith('/exports') ? { exportProfileId: options.body.exportProfileId } : path.endsWith('/download') ? { exportProfileId: path.includes('/label-sheets/') ? LABEL_PRINT_FORMATS.original.sheet : LABEL_PRINT_FORMATS.original.individual } : {}), ...result } : result; } };
  return { calls, shared, options, client: createLabelSheetsClient(options) };
}
test('partial export binds current sheet revision and preserves the same request after a lost reply and reload', async () => {
  const f = fixture(async () => { throw Object.assign(Error('lost'), { status: 503 }); });
  await assert.rejects(f.client.exportSheet(sheet));
  const original = f.client.pending(); assert.equal(original.kind, 'export'); assert.equal(original.body.expectedSheetRevision, 8);
  assert.equal(LABEL_EXPORT_PROFILE, 'atlas-v4-sheet-800ppi-diagnostic-v3');
  assert.equal(LABEL_EXPORT_PROFILE_V1.id, 'atlas-v4-sheet-800ppi-diagnostic-v2');
  assert.notEqual(LABEL_EXPORT_PROFILE, LABEL_EXPORT_PROFILE_V1.id);
  assert.equal(original.body.exportProfileId, LABEL_EXPORT_PROFILE);
  assert.equal(f.calls[0].csrf, 'actual-csrf');
  await assert.rejects(f.client.recordPrint(sheet, output, [1]), { code: 'LABEL_REQUEST_PENDING' });
  const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => { assert.equal(path, f.calls[0].path); assert.deepEqual(options.body, original.body); return { ...output, exportProfileId: original.body.exportProfileId }; } });
  await next.resume(); assert.equal(next.pending(), null);
});
test('a sheet download issues only the exact saved-export request and never records physical printing', async () => {
  const f = fixture(async () => ({ url: 'https://objects.example/export.png?signed=1', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  await f.client.downloadSheet(sheet, output);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, `${LABEL_SHEETS_PATH}/${sheetId}/exports/${exportId}/download`);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['expectedExportSha256', 'requestId']);
  assert.equal(f.calls[0].body.expectedExportSha256, hash); assert.equal(f.client.pending(), null);
});
test('physical print confirmation is explicit, exact and supports a subset of occupied positions', async () => {
  const f = fixture(async () => ({ eventId: randomUUID(), exportId }));
  await f.client.recordPrint({ ...sheet, items: [...sheet.items, { itemId: randomUUID(), slot: 9 }] }, output, [9]);
  const body = f.calls[0].body; assert.deepEqual(body.successfulSlots, [9]); assert.deepEqual(body.failedSlots, []);
  assert.equal(body.exportId, exportId); assert.equal(body.exportSha256, hash); assert.equal(body.manifestHash, output.manifestHash);
  assert.throws(() => f.client.recordPrint(sheet, output, [2]), { code: 'LABEL_REPLY_INVALID' });
  assert.throws(() => f.client.recordPrint(sheet, output, [1, 1]), { code: 'LABEL_REPLY_INVALID' });
});
test('single-label export stays distinct from full-sheet export and reuses exact artwork', async () => {
  const f = fixture(async () => ({ ...output, itemId, sheetId: null, exportProfileId: LABEL_PRINT_FORMATS.original.individual }));
  const result = await f.client.exportLabel(item);
  assert.equal(result.itemId, itemId); assert.match(f.calls[0].path, /labels\/[^/]+\/exports$/);
  assert.equal(f.calls[0].body.expectedLabelHash, hash); assert.equal(f.calls[0].body.exportProfileId, 'atlas-v4-individual-2400ppi-v1');
});
test('exact known CAS refusals release a stale intent; ambiguous failures retain it', async () => {
  for (const code of ['LABEL_REVISION_CHANGED', 'LABEL_REQUEST_CONFLICT', 'LABEL_SOURCE_SUPERSEDED', 'LABEL_SOURCE_CHANGED', 'LABEL_PUBLISHED_PRODUCTION_REQUIRED', 'LABEL_EXPORT_RETRY_LIMIT', 'LABEL_EXPORT_CHANGED', 'LABEL_REPRINT_SOURCE_INVALID', 'LABEL_NOT_READY']) {
    const f = fixture(async () => { throw { status: 409, code }; });
    await assert.rejects(f.client.exportSheet(sheet)); assert.equal(f.client.pending(), null);
  }
  const f = fixture(async () => { throw { status: 503, code: 'LABEL_REVISION_CHANGED' }; });
  await assert.rejects(f.client.exportSheet(sheet)); assert.ok(f.client.pending());
});
test('definite approved-B eligibility refusals release export intents while ambiguous outcomes retain them', async () => {
  for (const status of [400, 409, 503]) for (const kind of ['sheet', 'label']) {
    const f = fixture(async () => { throw { status, code: 'LABEL_APPROVED_B_REQUIRED' }; });
    await assert.rejects(kind === 'sheet' ? f.client.exportSheet(sheet) : f.client.exportLabel(item));
    assert.equal(Boolean(f.client.pending()), status === 503);
  }
});
test('verified access and deletion refusals release unavailable intents; ambiguous statuses do not', async () => {
  for (const [status, code] of [[404, 'LABEL_EXPORT_NOT_FOUND'], [404, 'LABEL_ITEM_NOT_FOUND'], [404, 'LABEL_SHEET_NOT_FOUND'], [404, 'MANUAL_CARD_NOT_FOUND'], [410, 'INTAKE_CARD_DELETED'], [403, 'LABEL_ACCESS_DENIED']]) {
    const f = fixture(async () => { throw { status, code }; });
    await assert.rejects(f.client.exportSheet(sheet)); assert.equal(f.client.pending(), null);
    const unknown = fixture(async () => { throw { status: 503, code }; });
    await assert.rejects(unknown.client.exportSheet(sheet)); assert.ok(unknown.client.pending());
  }
});
test('a definite failed export permits an explicit new retry intent instead of replaying the completed attempt', async () => {
  const f = fixture(async () => ({ ...output, state: 'FAILED', sha256: null }));
  await f.client.exportSheet(sheet); assert.equal(f.client.pending(), null);
  await f.client.exportSheet(sheet); assert.notEqual(f.calls[0].body.requestId, f.calls[1].body.requestId);
  assert.equal(f.calls[0].body.expectedSheetRevision, f.calls[1].body.expectedSheetRevision);
});
test('storage failure prevents a mutation from being dispatched', async () => {
  const f = fixture(async () => output), client = createLabelSheetsClient({ ...f.options, storage: { getItem: () => null, setItem() { throw Error('disabled'); } } });
  await assert.rejects(client.exportSheet(sheet), { code: 'LABEL_STORAGE_UNAVAILABLE' }); assert.equal(f.calls.length, 0);
});
test('late success cannot erase a newer request saved by another tab', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const operation = f.client.exportSheet(sheet); await Promise.resolve();
  const saved = f.client.pending(), newer = { ...saved, body: { ...saved.body, requestId: randomUUID() } };
  f.shared.set(`atlas-label-sheets:${staffId}:pending`, JSON.stringify(newer));
  complete(output); await operation; assert.deepEqual(f.client.pending(), newer);
});
test('parallel gestures cannot dispatch a second request and account journals are separate', async () => {
  let complete;
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const operation = f.client.exportSheet(sheet); await Promise.resolve();
  await assert.rejects(f.client.exportSheet(sheet), { code: 'LABEL_REQUEST_PENDING' }); assert.equal(f.calls.length, 1);
  const other = createLabelSheetsClient({ ...f.options, staffId: randomUUID() }); assert.equal(other.pending(), null);
  complete(output); await operation;
});
test('invalid replies and unsafe or expired URLs retain their exact download intent', async () => {
  for (const url of ['javascript:alert(1)', 'https://user:password@objects.example/file', 'https://objects.example/file']) {
    const f = fixture(async () => ({ url, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await assert.rejects(f.client.downloadSheet(sheet, output), { code: 'LABEL_DOWNLOAD_INVALID' }); assert.ok(f.client.pending());
  }
});
test('read-only sheet listing does not allocate or mutate, and duplicate positions are rejected', async () => {
  const f = fixture(async () => ({ version: 'atlas-label-sheets-v1', sheets: [{ sheetId, revision: 8, capacity: 50, jigHash: LABEL_JIG_V1.jigHash }], pending: [] }));
  await f.client.list(); assert.equal(f.calls[0].method, undefined); assert.equal(f.client.pending(), null);
  const bad = fixture(async () => ({ ...sheet, capacity: 50, items: [{ slot: 1 }, { slot: 1 }] }));
  await assert.rejects(bad.client.sheet(sheetId), { code: 'LABEL_REPLY_INVALID' });
});
test('artwork URL is an authenticated exact item path with explicit preview versus true ink', () => {
  assert.equal(labelArtworkHref(item, '/admin'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview`);
  assert.match(labelArtworkHref(item, '/admin', 'print'), /mode=print$/);
  assert.equal(labelArtworkHref({ ...item, state: 'NEEDS_LAYOUT' }), null);
  assert.equal(labelArtworkHref({ ...item, itemId: '../unauthorized' }), null);
});


test('a different saved jig cannot be displayed as the current physical layout', async () => {
  const f = fixture(async () => ({ ...sheet, jigHash: 'f'.repeat(64), capacity: 50 }));
  await assert.rejects(f.client.sheet(sheetId), { code: 'LABEL_JIG_CHANGED' });
});

test('layout recovery binds the exact failure and renderer and resumes the same request after a lost reply', async () => {
  const failed = { itemId, state: 'NEEDS_LAYOUT', purpose: 'ORIGINAL', failureHash: hash }, profile = 'b'.repeat(64);
  const f = fixture(async () => { throw { status: 503, code: 'NETWORK_LOST' }; });
  await assert.rejects(f.client.retryLayout(failed, profile));
  const saved = f.client.pending();
  assert.equal(saved.path, `/api/staff/manual-connected/labels/${itemId}/layout-retries`);
  assert.equal(saved.body.expectedFailureHash, hash); assert.equal(saved.body.expectedRendererProfileHash, profile);
  const successor = { itemId: randomUUID(), originalItemId: itemId, purpose: 'LAYOUT_RETRY', state: 'PENDING_RENDER' };
  const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => {
    assert.equal(path, saved.path); assert.deepEqual(options.body, saved.body); return successor;
  } });
  assert.deepEqual(await next.resume(), { kind: 'layout-retry', result: successor }); assert.equal(next.pending(), null);
  for (const invalid of [{ ...failed, state: 'READY' }, { ...failed, purpose: 'REPRINT' }, { ...failed, failureHash: null }]) {
    assert.throws(() => next.retryLayout(invalid, profile), { code: 'LABEL_REPLY_INVALID' });
  }
});

test('only definite layout refusals and rejected export profiles release the saved request', async () => {
  const failed = { itemId, state: 'NEEDS_LAYOUT', purpose: 'LAYOUT_RETRY', failureHash: hash };
  for (const code of ['LABEL_LAYOUT_ALREADY_RETRIED', 'LABEL_LAYOUT_RETRY_UNAVAILABLE', 'LABEL_LAYOUT_RETRY_LIMIT', 'LABEL_FAILURE_CHANGED', 'LABEL_RENDERER_CHANGED']) {
    for (const status of [409, 503]) {
      const f = fixture(async () => { throw { status, code }; }); await assert.rejects(f.client.retryLayout(failed, hash));
      assert.equal(Boolean(f.client.pending()), status !== 409);
    }
  }
  for (const status of [400, 503]) {
    const f = fixture(async () => { throw { status, code: 'LABEL_PROFILE_INVALID' }; });
    await assert.rejects(f.client.exportLabel(item)); assert.equal(Boolean(f.client.pending()), status !== 400);
  }
  const unrelated = fixture(async () => { throw { status: 400, code: 'LABEL_PROFILE_INVALID' }; });
  await assert.rejects(unrelated.client.recordPrint(sheet, output, [1])); assert.ok(unrelated.client.pending());
});

test('an unverified layout successor does not consume the saved retry intent', async () => {
  const failed = { itemId, state: 'NEEDS_LAYOUT', purpose: 'ORIGINAL', failureHash: hash };
  const f = fixture(async () => ({ itemId: randomUUID(), originalItemId: randomUUID(), purpose: 'LAYOUT_RETRY', state: 'READY' }));
  await assert.rejects(f.client.retryLayout(failed, hash), { code: 'LABEL_REPLY_INVALID' }); assert.ok(f.client.pending());
});

test('black-only profiles are explicit, kind-bound and retained in an uncertain request', async () => {
  const f = fixture(async () => { throw { status: 503, code: 'UNKNOWN' }; });
  await assert.rejects(f.client.exportLabel(item, LABEL_PRINT_FORMATS.foil.individual));
  assert.equal(f.client.pending().body.exportProfileId, LABEL_PRINT_FORMATS.foil.individual);
  assert.throws(() => f.client.exportLabel(item, LABEL_PRINT_FORMATS.foil.sheet), { code: 'LABEL_PROFILE_INVALID' });
  assert.throws(() => f.client.exportSheet(sheet, LABEL_PRINT_FORMATS.foil.individual), { code: 'LABEL_PROFILE_INVALID' });
  const wrong = fixture(async () => ({ ...output, exportProfileId: LABEL_PRINT_FORMATS.original.sheet }));
  await assert.rejects(wrong.client.exportSheet(sheet, LABEL_PRINT_FORMATS.foil.sheet), { code: 'LABEL_REPLY_INVALID' });
  assert.equal(wrong.client.pending().body.exportProfileId, LABEL_PRINT_FORMATS.foil.sheet);
});
test('foil preview and print URLs are exact authenticated modes', () => {
  assert.equal(labelArtworkHref(item, '/admin', 'preview-card-foil'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview-card-foil`);
  assert.equal(labelArtworkHref(item, '/admin', 'print-card-foil'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=print-card-foil`);
  assert.equal(labelSheetProfile(), LABEL_PRINT_FORMATS.cardFoil.sheet);
  assert.equal(labelArtworkHref(item, '/admin', 'print-foil'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=print-foil`);
  assert.equal(labelArtworkHref(item, '/admin', 'preview-foil'), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview-foil`);
  assert.equal(labelArtworkHref(item, '/admin', 'unrecognized'), null);
});

test('approved-B color and back artwork use explicit modes while historical labels retain only saved front modes', () => {
  const approved = { ...item, snapshot: { layoutVersion: 'atlas-approved-b-v1' } };
  for (const format of ['color', 'foilBack', 'originalBack', 'colorBack']) {
    assert.equal(labelSupportsPrintFormat(approved, format), true); assert.equal(labelSupportsPrintFormat(item, format), false);
    const value = LABEL_PRINT_FORMATS[format];
    for (const mode of [value.previewMode, value.printMode])
      assert.equal(labelArtworkHref(approved, '/admin', mode), `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=${mode}`);
  }
  for (const mode of ['print-color', 'preview-back', 'print-back', 'preview-back-foil', 'print-back-foil', 'print-back-color'])
    assert.equal(labelArtworkHref(item, '/admin', mode), null);
  for (const mode of ['preview', 'print', 'preview-foil', 'print-foil']) assert.ok(labelArtworkHref(item, '/admin', mode));
  assert.equal(labelSupportsPrintFormat(approved, 'unknown'), false);
});

test('each approved-B print format binds the exact individual or sheet profile and rejects legacy/mixed sources before requests', async () => {
  const approved = { ...item, snapshot: { layoutVersion: 'atlas-approved-b-v1' } }, approvedSheet = { ...sheet, items: [approved] };
  for (const key of ['color', 'foilBack', 'originalBack', 'colorBack']) {
    const format = LABEL_PRINT_FORMATS[key], f = fixture(async (_, options) => ({ ...output, exportProfileId: options.body.exportProfileId }));
    assert.throws(() => f.client.exportLabel(item, format.individual), { code: 'LABEL_PROFILE_UNAVAILABLE' });
    assert.throws(() => f.client.exportSheet(sheet, format.sheet), { code: 'LABEL_PROFILE_UNAVAILABLE' });
    assert.throws(() => f.client.exportSheet({ ...approvedSheet, items: [approved, item] }, format.sheet), { code: 'LABEL_PROFILE_UNAVAILABLE' });
    assert.equal(f.calls.length, 0); assert.equal(f.client.pending(), null);
    await f.client.exportLabel(approved, format.individual); assert.equal(f.calls.at(-1).body.exportProfileId, format.individual);
    await f.client.exportSheet(approvedSheet, format.sheet); assert.equal(f.calls.at(-1).body.exportProfileId, format.sheet);
    assert.throws(() => f.client.exportLabel(approved, format.sheet), { code: 'LABEL_PROFILE_INVALID' });
  }
});

test('approved-B saved downloads retain their exact recognized format and refuse a cross-kind response', async () => {
  for (const key of ['color', 'foilBack', 'originalBack', 'colorBack']) {
    const format = LABEL_PRINT_FORMATS[key], response = { url: 'https://objects.example/exact.png', expiresAt: new Date(Date.now() + 60000).toISOString() };
    const f = fixture(async () => ({ ...response, exportProfileId: format.sheet }));
    const result = await f.client.downloadSheet(sheet, { ...output, exportProfileId: format.sheet }); assert.equal(result.result.exportProfileId, format.sheet);
    const g = fixture(async () => ({ ...response, exportProfileId: format.individual }));
    const individual = await g.client.downloadLabel(item, output); assert.equal(individual.result.exportProfileId, format.individual);
    const bad = fixture(async () => ({ ...response, exportProfileId: format.individual }));
    await assert.rejects(bad.client.downloadSheet(sheet, output), { code: 'LABEL_DOWNLOAD_INVALID' }); assert.ok(bad.client.pending());
  }
});

test('a saved legacy download identifies its original ink format and wrong-kind profiles are refused', async () => {
  const response = { url: 'https://objects.example/exact.png', expiresAt: new Date(Date.now() + 60000).toISOString(), exportProfileId: LABEL_PRINT_FORMATS.original.sheet };
  const f = fixture(async () => response); const reply = await f.client.downloadSheet(sheet, output);
  assert.equal(reply.result.exportProfileId, LABEL_PRINT_FORMATS.original.sheet);
  const wrong = fixture(async () => ({ ...response, exportProfileId: LABEL_PRINT_FORMATS.foil.individual }));
  await assert.rejects(wrong.client.downloadSheet(sheet, output), { code: 'LABEL_DOWNLOAD_INVALID' }); assert.ok(wrong.client.pending());
});

test('current 25-position profiles replace only front defaults and retain every historical profile', () => {
  const ids = [1, 2].flatMap(page => Object.keys(LABEL_PRINT_FORMATS).map(format => {
    const id = labelSheetProfile(format, '25', page);
    assert.equal(labelPrintFormatForProfile(id), LABEL_PRINT_FORMATS[format]); return id;
  }));
  assert.deepEqual(ids.sort(), LABEL_25_CURRENT_PROFILE_DEFINITIONS.map(profile => profile.id).sort());
  assert.equal(LABEL_25_SUPPORTED_PROFILE_DEFINITIONS.length, 20);
  for (const historical of LABEL_25_PROFILE_DEFINITIONS) {
    assert.match(historical.id, /-v1$/); assert.equal(historical.compositor, undefined);
    assert.equal(getLabel25Profile(historical.id), historical);
    const current = LABEL_25_CURRENT_PROFILE_DEFINITIONS.find(profile => profile.page === historical.page
      && profile.mode === historical.mode && profile.side === historical.side);
    if (historical.side === 'BACK') assert.equal(current, historical);
    else {
      assert.equal(current.id, historical.id.replace(/-v1$/, '-v2'));
      assert.equal(current.compositor, 'slot-fragment-references-v2');
      const { id, compositor, ...geometry } = current;
      const { id: oldId, ...oldGeometry } = historical;
      assert.deepEqual(geometry, oldGeometry);
    }
    assert.equal(labelPrintFormatForProfile(historical.id), labelPrintFormatForProfile(current.id));
  }
  assert.equal(labelSheetProfile('foil', '25', 3), null);
  assert.equal(labelSheetProfile('unknown'), null);
  assert.equal(labelSheetProfile('foil', 'unknown'), null);
});

test('legacy sheet downloads keep their exact profile and reject a substituted current export', async () => {
  for (const [profile, format] of legacyFrontProfiles) {
    assert.equal(labelPrintFormatForProfile(profile), LABEL_PRINT_FORMATS[format]);
    const pageProfile = getLabel25Profile(profile), current = labelSheetProfile(format, pageProfile ? '25' : '50', pageProfile?.page ?? 1);
    assert.notEqual(current, profile);
    const expected = { ...output, exportProfileId: profile };
    const response = { url: 'https://objects.example/retained.png', expiresAt: new Date(Date.now() + 60000).toISOString() };
    const f = fixture(async () => ({ ...response, exportProfileId: current }));
    await assert.rejects(f.client.downloadSheet(sheet, expected), { code: 'LABEL_DOWNLOAD_INVALID' });
    const saved = f.client.pending();
    assert.equal(saved.expectedExportProfileId, profile);
    const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => {
      assert.equal(path, saved.path); assert.deepEqual(options.body, saved.body);
      return { ...response, exportProfileId: profile };
    } });
    assert.equal((await next.resume()).result.exportProfileId, profile);
    assert.equal(next.pending(), null);
  }
});

test('legacy export journals replay their exact body across the current-profile upgrade', async () => {
  for (const [profile] of legacyFrontProfiles) {
    const sourceSlot = getLabel25Profile(profile)?.firstSourceSlot ?? 1;
    const source = { ...sheet, items: [{ ...item, slot: sourceSlot, snapshot: { layoutVersion: 'atlas-approved-b-v1' } }] };
    const f = fixture(async () => { throw { status: 503, code: 'LOST' }; });
    await assert.rejects(f.client.exportSheet(source, profile));
    const key = `atlas-label-sheets:${staffId}:pending`, raw = f.shared.get(key), saved = JSON.parse(raw);
    assert.equal(saved.body.exportProfileId, profile);
    const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => {
      assert.equal(f.shared.get(key), raw);
      assert.equal(path, saved.path); assert.deepEqual(options.body, saved.body);
      return { ...output, exportProfileId: profile };
    } });
    assert.deepEqual(next.pending(), saved); assert.equal(f.shared.get(key), raw);
    await next.resume(); assert.equal(next.pending(), null);
  }
});
test('25-position export validates only its page artwork, preserves source revision, and replays the exact profile after reload', async () => {
  const approved = { ...item, slot: 26, snapshot: { layoutVersion: 'atlas-approved-b-v1' } };
  const source = { ...sheet, items: [...sheet.items, approved] }, profile = labelSheetProfile('foil', '25', 2);
  const f = fixture(async () => { throw { status: 503, code: 'LOST' }; });
  await assert.rejects(f.client.exportSheet(source, profile));
  const original = f.client.pending();
  assert.equal(original.body.exportProfileId, profile); assert.equal(original.body.expectedSheetRevision, sheet.revision);
  assert.equal(source.items[1].slot, 26);
  const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => {
    assert.equal(path, original.path); assert.deepEqual(options.body, original.body); return { ...output, exportProfileId: profile };
  } });
  await next.resume(); assert.equal(next.pending(), null);
  assert.throws(() => next.exportSheet(source, labelSheetProfile('color', '25', 1)), { code: 'LABEL_PROFILE_UNAVAILABLE' });
  assert.throws(() => next.exportSheet(sheet, profile), { code: 'LABEL_SHEET_PAGE_EMPTY' });
  assert.throws(() => next.exportSheet({ ...sheet, items: [] }), { code: 'LABEL_SHEET_PAGE_EMPTY' });
});
test('25-position downloads bind the page profile through uncertain replies and explicit resume', async () => {
  const profile = labelSheetProfile('colorBack', '25', 2), expected = { ...output, exportProfileId: profile };
  const response = { url: 'https://objects.example/page2.png', expiresAt: new Date(Date.now() + 60000).toISOString() };
  const f = fixture(async () => ({ ...response, exportProfileId: labelSheetProfile('colorBack', '25', 1) }));
  await assert.rejects(f.client.downloadSheet(sheet, expected), { code: 'LABEL_DOWNLOAD_INVALID' });
  const saved = f.client.pending(); assert.equal(saved.expectedExportProfileId, profile);
  assert.deepEqual(Object.keys(saved.body).sort(), ['expectedExportSha256', 'requestId']);
  const next = createLabelSheetsClient({ ...f.options, request: async (path, options) => {
    assert.equal(path, saved.path); assert.deepEqual(options.body, saved.body); return { ...response, exportProfileId: profile };
  } });
  assert.equal((await next.resume()).result.exportProfileId, profile); assert.equal(next.pending(), null);
});
test('page-two print confirmation accepts original source slots and refuses physical slots or the other page', async () => {
  const source = { ...sheet, items: [{ ...item, slot: 1 }, { ...item, slot: 26 }, { ...item, slot: 50 }] };
  const expected = { ...output, exportProfileId: labelSheetProfile('foil', '25', 2) };
  const f = fixture(async () => ({ eventId: randomUUID(), exportId }));
  assert.throws(() => f.client.recordPrint(source, expected, [1]), { code: 'LABEL_REPLY_INVALID' });
  await f.client.recordPrint(source, expected, [50, 26]);
  assert.deepEqual(f.calls[0].body.successfulSlots, [26, 50]);
});
test('only a definite empty-page refusal clears a saved export request', async () => {
  for (const status of [409, 503]) {
    const f = fixture(async () => { throw { status, code: 'LABEL_SHEET_PAGE_EMPTY' }; });
    await assert.rejects(f.client.exportSheet(sheet)); assert.equal(Boolean(f.client.pending()), status === 503);
  }
});

test('25-position original and black front pages retain historical V4 export support', async () => {
  for (const key of ['original', 'foil']) {
    const profile = labelSheetProfile(key, '25', 1);
    const f = fixture(async () => ({ ...output, exportProfileId: profile }));
    await f.client.exportSheet(sheet, profile); assert.equal(f.calls[0].body.exportProfileId, profile);
  }
  for (const key of ['color', 'foilBack', 'originalBack', 'colorBack']) {
    const f = fixture(async () => output);
    assert.throws(() => f.client.exportSheet(sheet, labelSheetProfile(key, '25', 1)), { code: 'LABEL_PROFILE_UNAVAILABLE' });
    assert.equal(f.calls.length, 0);
  }
});
