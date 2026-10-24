import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { canonical, digest } from '@atlas/manual-service/contract';
import { renderApprovedBLabel, LABEL_APPROVED_B_RENDERER_PROFILE_HASH } from '@atlas/finishing/label-approved-b';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { createLabelService } from '../src/label-sheet-service.mjs';
import { LABEL_REFRESH_REASON, labelRefreshRequestId, labelRefreshRequestHash,
  labelReplacementIntent, assertLabelRefreshSnapshot } from '../src/label-replacement-intent.mjs';
import { createApprovedLabelStyler } from '../src/label-style-service.mjs';
import { createLabelStyleCache } from '../src/label-style-cache.mjs';
import { LABEL_STYLE_MODEL } from '../src/label-style-contract.mjs';
import { LABEL_WORDMARK_VERIFY_MODEL } from '../src/label-wordmark-contract.mjs';

function serviceFixture({ styler, finalGrade = 9, approvedSource = null, recheck = null, renderer = renderApprovedBLabel } = {}) {
  const packet = approvedSource?.packet ?? { report: { cardProfile: 'SPORTS', identity: { playerName: 'TreVeyon Henderson', year: '2025',
    manufacturer: 'Panini', productSet: 'Rookies & Stars - Thrillers', cardNumber: '20', parallel: 'ICE' }, finalGrade },
  reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, publicToken: `ar_${'A'.repeat(24)}`, reportHash: digest('approved-report') };
  const publicHash = approvedSource?.publicHash ?? digest(JSON.stringify(packet));
  const row = approvedSource?.row ?? { card_id: randomUUID(), action_id: randomUUID(), public_hash: publicHash };
  const source = approvedSource ?? { packet, publicHash, row };
  const item = { id: randomUUID(), actor_id: randomUUID(), access_version: 1, card_id: row.card_id, action_id: row.action_id,
    purpose: 'ORIGINAL', approval_version: packet.approvalVersion, source_revision: 1, source_hash: digest('source'),
    report_hash: packet.reportHash, public_hash: publicHash };
  const saved = [], failures = [], events = []; let loads = 0, renders = 0, deferred = 0, pending = true;
  const repository = {
    pendingCandidates: async () => pending ? [{ ...item, kind: 'ITEM' }] : [], claimItem: async () => item,
    finishItem: async (_staff, _claimed, result) => { canonical(result.snapshot); saved.push(result); pending = false; events.push('finish'); },
    deferItem: async () => { deferred++; events.push('defer'); },
    failItem: async (...args) => { failures.push(args); events.push('fail'); },
  };
  const finishing = { async loadPacket() { loads++; events.push('load'); return loads > 1 && recheck ? recheck(source) : source; } };
  const service = createLabelService({ boundary: { machineOwner: value => value }, repository, finishing, styler,
    storage: { write() { assert.fail('label rendering cannot export'); }, download() { assert.fail('label rendering cannot sign downloads'); } },
    renderer: { label: async (input, options) => { renders++; events.push('render'); return renderer(input, options); },
      sheet() { assert.fail('no sheet export'); }, individual() { assert.fail('no individual export'); } } });
  return { service, repository, source, packet, item, saved, failures, events,
    get loads() { return loads; }, get renders() { return renders; }, get deferred() { return deferred; } };
}

async function originalStylerFixture() {
  const photos = {}, images = {}, media = {}, storageValues = new Map();
  for (const [side, background] of [['FRONT', '#225eae'], ['BACK', '#cccccc']]) {
    const bytes = await sharp({ create: { width: 32, height: 48, channels: 3, background } }).png().toBuffer();
    const sha256 = digest(bytes); photos[side] = bytes; storageValues.set(sha256, bytes);
    images[side] = { sha256, contentType: 'image/png', width: 32, height: 48, byteCount: bytes.length };
    media[side] = { descriptor: { raster: { content: { sha256 } } } };
  }
  const packet = { report: { cardProfile: 'SPORTS', identity: { playerName: 'TreVeyon Henderson', year: '2025', manufacturer: 'Panini',
    productSet: 'Rookies & Stars - Thrillers', parallel: 'ICE', cardNumber: '20' }, finalGrade: 9 },
  images, reportHash: digest('fixture-approved-report'), reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, publicToken: `ar_${'A'.repeat(24)}` };
  const publicHash = digest(JSON.stringify(packet)), mediaHash = digest(JSON.stringify(media));
  const manifest = canonical({ media: { ref: { sha256: mediaHash }, sourceHash: mediaHash } });
  const row = { card_id: randomUUID(), action_id: randomUUID(), public_hash: publicHash, manifest, manifest_hash: digest(manifest) };
  const generated = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/><rect x="200" y="400" width="650" height="180"/><rect x="930" y="430" width="120" height="120"/></svg>')).png().toBuffer();
  const values = new Map(), calls = [];
  const cache = createLabelStyleCache({ read: async key => values.get(key) ?? null,
    putIfAbsent: async (key, bytes) => { if (values.has(key)) return false; values.set(key, Buffer.from(bytes)); return true; } });
  const complete = (model, value) => Response.json({ model, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  const styler = createApprovedLabelStyler({ apiKey: 'offline-fixture-key-not-a-real-key', imageApiKey: 'dedicated-image-fixture-key-not-real', cache,
    artifacts: { async read(ref) { assert.equal(ref.sha256, mediaHash); return structuredClone(media); } },
    storage: { async readDerivative({ descriptor }) { return { bytes: storageValues.get(descriptor.raster.content.sha256) }; } },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      assert.equal(options.headers.Authorization, url.endsWith('/images/generations')
        ? 'Bearer dedicated-image-fixture-key-not-real' : 'Bearer offline-fixture-key-not-a-real-key');
      if (url.endsWith('/images/generations')) return Response.json({ data: [{ b64_json: generated.toString('base64') }] });
      if (body.text.format.name === 'atlas_wordmark_reading') return complete(LABEL_WORDMARK_VERIFY_MODEL, {
        transcription: 'THRILLERS ICE', singleLine: true, extraMarks: false, confidence: 'HIGH',
        words: [{ text: 'THRILLERS', x: 200, y: 400, width: 650, height: 180 }, { text: 'ICE', x: 930, y: 430, width: 120, height: 120 }] });
      assert.equal(body.text.format.name, 'atlas_label_style_v1');
      const data = JSON.parse(body.input[1].content[0].text);
      const source = basis => ({ side: 'FRONT', sha256: images.FRONT.sha256, box: { x: .1, y: .2, width: .5, height: .2 },
        basis, confidence: 'HIGH', observation: 'Synthetic generic brush strokes and flat blue card field.' });
      return complete(LABEL_STYLE_MODEL, { lines: data.lines.map(line => ({ role: line.role,
        letteringMode: line.role === 'variant' ? 'ORIGINAL_WORDMARK' : 'CATALOG',
        letteringDescription: line.role === 'variant' ? 'Bold rough brush strokes with an upright baseline.' : '',
        letteringTraits: line.role === 'variant' ? ['BRUSH', 'BOLD', 'ROUGH'] : [],
        fontId: line.role === 'variant' ? null : 'roboto-condensed', fontSource: source('PRINTED_LETTERING'),
        emphasis: 'NORMAL', normalizeWordInkHeight: line.role === 'variant',
        spans: line.role === 'variant' ? [{ start: 0, end: line.text.length, baseColor: '#225eae', accentColor: '#accdef',
          pattern: 'NONE', opticalScale: 1, source: source('CARD_FIELD') }] : [] })) });
    } });
  return { styler, source: { packet, row, publicHash }, calls, values };
}

test('READY photo style passes render-only assets and preserves approved facts in a canonical-safe immutable snapshot', async () => {
  const styled = await originalStylerFixture(), before = structuredClone(styled.source);
  const preparedStyle = await styled.styler.resolve(styled.source);
  assert.equal(preparedStyle.state, 'READY'); canonical(preparedStyle.receipt);
  renderApprovedBLabel({ ...styled.source.packet.report, reportNumber: styled.source.packet.reportNumber, approvalVersion: 1 },
    { styleSpec: preparedStyle.styleSpec, textures: preparedStyle.textures, wordmarks: preparedStyle.wordmarks });
  let optionsSeen;
  const f = serviceFixture({ approvedSource: styled.source, styler: styled.styler,
    renderer(input, options) { optionsSeen = options; return renderApprovedBLabel(input, options); } });
  assert.equal(await f.service.runPending(), 1); assert.equal(f.failures.length, 0); assert.equal(styled.calls.length, 3);
  assert.equal(f.loads, 2); assert.deepEqual(f.events, ['load', 'load', 'render', 'finish']);
  assert.ok(optionsSeen.wordmarks.variant.descriptor.mask.sha256); assert.ok(optionsSeen.wordmarks.variant.maskBase64);
  assert.equal(optionsSeen.wordmarks.variant.sourceText, 'THRILLERS · ICE');
  assert.equal(optionsSeen.wordmarks.variant.descriptor.text, 'THRILLERS ICE');
  const saved = f.saved[0], snapshot = canonical(saved.snapshot);
  assert.equal(saved.state, 'READY'); assert.equal(saved.rendererProfileHash, LABEL_APPROVED_B_RENDERER_PROFILE_HASH);
  assert.deepEqual(saved.snapshot.identity, before.packet.report.identity); assert.equal(saved.snapshot.grade, 9);
  assert.equal(saved.snapshot.reportNumber, before.packet.reportNumber); assert.equal(saved.snapshot.approvalVersion, 1);
  assert.equal(saved.snapshot.labelStyle.wordmarks.variant.alphaSha256, optionsSeen.wordmarks.variant.descriptor.mask.sha256);
  assert.equal(saved.snapshot.labelStyle.wordmarks.variant.artifactHash, optionsSeen.wordmarks.variant.descriptor.artifactHash);
  assert.doesNotMatch(snapshot, /"(?:mask|bytes|pixels|pngBase64|maskBase64)":|data:image/);
  assert.deepEqual(styled.source, before); assert.equal(await f.service.runPending(), 0); assert.equal(styled.calls.length, 3);
});

test('PENDING style defers the claimed item without rendering, finishing, export or failure', async () => {
  let calls = 0;
  const f = serviceFixture({ styler: { async resolve(source, { signal }) { calls++; assert.equal(source.packet.report.finalGrade, 9);
    assert.ok(signal instanceof AbortSignal); return { state: 'PENDING', code: 'LABEL_WORDMARK_GENERATION_PENDING' }; } } });
  const before = structuredClone(f.source);
  assert.equal(await f.service.runPending(), 0); assert.equal(calls, 1); assert.equal(f.deferred, 1);
  assert.equal(f.loads, 1); assert.equal(f.renders, 0); assert.equal(f.saved.length, 0); assert.equal(f.failures.length, 0);
  assert.deepEqual(f.events, ['load', 'defer']); assert.deepEqual(f.source, before);
});

test('source change or revoked access after style resolution blocks rendering and completion', async () => {
  for (const recheck of [source => ({ ...source, publicHash: digest('changed-publication') }),
    () => { throw Object.assign(new Error('revoked'), { code: 'MANUAL_CARD_NOT_FOUND' }); }]) {
    let calls = 0;
    const f = serviceFixture({ recheck, styler: { async resolve() { calls++; return { state: 'READY', receipt: { kind: 'TEST' } }; } } });
    assert.equal(await f.service.runPending(), 0); assert.equal(calls, 1); assert.equal(f.loads, 2);
    assert.equal(f.renders, 0); assert.equal(f.saved.length, 0); assert.equal(f.failures.length, 1); assert.equal(f.deferred, 0);
    assert.equal(f.failures[0][2].materialProfileId, 'atlas-v4-gold-v1');
  }
});

test('fractional new and valid REFRESH jobs fail before style resolution or provider dispatch', async () => {
  for (const purpose of ['ORIGINAL', 'REFRESH']) {
    const styled = await originalStylerFixture(); let styleCalls = 0;
    styled.source.packet.report.finalGrade = purpose === 'ORIGINAL' ? 8.5 : 9.5;
    styled.source.publicHash = digest(JSON.stringify(styled.source.packet));
    styled.source.row.public_hash = styled.source.publicHash;
    const f = serviceFixture({ approvedSource: styled.source, styler: { async resolve(...args) {
      styleCalls++; return styled.styler.resolve(...args);
    } } });
    let original;
    if (purpose === 'REFRESH') {
      const packet = f.packet, report = packet.report;
      const snapshot = canonical({ identity: report.identity, grade: report.finalGrade, finalGrade: report.finalGrade,
        cardProfile: report.cardProfile, reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion,
        reportHref: `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}` });
      original = { ...f.item, id: randomUUID(), state: 'READY', snapshot, snapshot_hash: digest(snapshot),
        print_svg: '<svg data-retained="historical-print"/>', preview_svg: '<svg data-retained="historical-preview"/>',
        renderer_profile_hash: digest('previous renderer'), material_profile_id: 'atlas-v4-gold-v1', jig_hash: LABEL_JIG_V1.jigHash };
      original.artwork_hash = digest(original.print_svg);
      const target = { rendererProfileHash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH,
        materialProfileId: original.material_profile_id, jigHash: original.jig_hash };
      f.item.purpose = 'REPRINT'; f.item.original_item_id = original.id; f.item.reason = LABEL_REFRESH_REASON;
      f.item.request_id = labelRefreshRequestId(original.id, original.artwork_hash, target);
      f.item.request_hash = labelRefreshRequestHash(original.id,
        { requestId: f.item.request_id, expectedLabelHash: original.artwork_hash }, target);
      Object.assign(f.item, { renderer_profile_hash: target.rendererProfileHash,
        material_profile_id: target.materialProfileId, jig_hash: target.jigHash });
      f.repository.item = async () => original;
      assert.equal(labelReplacementIntent(f.item, original).kind, 'REFRESH');
      assert.doesNotThrow(() => assertLabelRefreshSnapshot(original, packet));
    }
    const sourceBefore = structuredClone(f.source), originalBefore = structuredClone(original);
    assert.equal(await f.service.runPending(), 0);
    assert.equal(styleCalls, 0); assert.equal(styled.calls.length, 0); assert.equal(styled.values.size, 0);
    assert.equal(f.renders, 0); assert.equal(f.saved.length, 0); assert.equal(f.failures.length, 1); assert.equal(f.deferred, 0);
    assert.deepEqual(f.events, ['load', 'fail']); assert.deepEqual(f.source, sourceBefore); assert.deepEqual(original, originalBefore);
  }
});

test('historical COPY bypasses styler and renderer, preserving exact saved artwork, profile, stock and fractional grade', async () => {
  const f = serviceFixture({ finalGrade: 8.5, styler: { resolve() { assert.fail('COPY must never spend on styling'); } },
    renderer() { assert.fail('COPY must never regenerate historical artwork'); } });
  const snapshot = canonical({ identity: f.packet.report.identity, grade: 8.5, finalGrade: 8.5, originalReceipt: 'immutable historical source' });
  const original = { ...f.item, id: randomUUID(), state: 'READY', print_svg: '<svg data-retained="historical-print"/>',
    preview_svg: '<svg data-retained="historical-preview"/>', snapshot, snapshot_hash: digest(snapshot),
    renderer_profile_hash: 'a0491ff4f0a86166371f950c658c3e08397e688fe13f9e60f28abbda88b764ab', material_profile_id: 'retained-original-stock', jig_hash: 'f'.repeat(64) };
  original.artwork_hash = digest(original.print_svg); const before = structuredClone(original);
  f.item.purpose = 'REPRINT'; f.item.original_item_id = original.id; f.item.request_id = randomUUID(); f.item.reason = 'Replacement of damaged label';
  f.item.request_hash = digest(canonical({ itemId: original.id, requestId: f.item.request_id, expectedLabelHash: original.artwork_hash, reason: f.item.reason }));
  f.repository.item = async () => original;
  assert.equal(await f.service.runPending(), 1); assert.equal(f.loads, 1); assert.equal(f.renders, 0); assert.equal(f.failures.length, 0);
  const result = f.saved[0]; assert.equal(result.printSvg, original.print_svg); assert.equal(result.previewSvg, original.preview_svg);
  assert.equal(result.rendererProfileHash, original.renderer_profile_hash); assert.equal(result.materialProfileId, original.material_profile_id);
  assert.equal(result.jigHash, original.jig_hash); assert.equal(result.artworkHash, original.artwork_hash); assert.equal(canonical(result.snapshot), snapshot);
  assert.deepEqual(original, before);
});
