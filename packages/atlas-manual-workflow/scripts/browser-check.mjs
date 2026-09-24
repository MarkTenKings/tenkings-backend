import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const output = process.env.ATLAS_BROWSER_EVIDENCE;
if (!output) throw new Error('Owned browser evidence directory required');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }), checks = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } }), page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const wait = async predicate => { for (let i = 0; i < 160; i++) { if (await predicate()) return; await new Promise(done => setTimeout(done, 100)); } throw new Error('Browser condition timed out'); };
const state = () => page.evaluate(() => window.manualFixture?.state());
const front = page.getByRole('region', { name: 'Front defects' }), back = page.getByRole('region', { name: 'Back defects' });
const confirm = page.getByRole('button', { name: 'Confirm findings', exact: true });
async function settled() { await wait(async () => { const view = await state(); return view && !view.defects.sides.FRONT.pending && !view.defects.sides.BACK.pending; }); }
async function stroke(region, points) {
  const box = await region.locator('.ad-plane').boundingBox();
  const pixel = ([x, y]) => ({ x: box.x + x / 1269 * box.width, y: box.y + y / 1777 * box.height });
  const first = pixel(points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const value of points.slice(1)) { const p = pixel(value); await page.mouse.move(p.x, p.y, { steps: 5 }); }
  await page.mouse.up();
}
try {
  await page.goto('http://127.0.0.1:4318');
  await page.getByRole('button', { name: 'Send test code' }).click();
  await page.getByLabel('Verification code').fill('424242'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const geometryConfirm = page.getByRole('button', { name: 'Confirm both sides', exact: true });
  await wait(() => geometryConfirm.isEnabled());
  await page.getByRole('button', { name: 'Printed border', exact: true }).click();
  const geometryBefore = await state();
  await page.getByRole('button', { name: 'FRONT printed border Top left', exact: true }).press('ArrowRight');
  await page.getByRole('region', { name: 'Front geometry' }).getByRole('button', { name: 'Save outline', exact: true }).click();
  await wait(async () => (await state()).card.revision === geometryBefore.card.revision + 1);
  const geometrySaved = await state(); assert.deepEqual(geometrySaved.geometry.sides.BACK, geometryBefore.geometry.sides.BACK);
  await page.reload(); await wait(() => geometryConfirm.isEnabled());
  assert.deepEqual((await state()).geometry, geometrySaved.geometry);
  await geometryConfirm.click(); await wait(() => front.getByRole('button', { name: 'Add finding', exact: true }).isEnabled());
  checks.push('Actual ordinary staff browser/code/cookie authentication, PostgreSQL geometry save/reload, paired confirmation and defect progression.');

  const cardId = (await state()).card.cardId, anonymous = await browser.newContext();
  const denied = await anonymous.request.get(`http://127.0.0.1:4318/api/staff/manual/cards/${cardId}/view`);
  assert.equal(denied.status(), 401); await anonymous.close();
  const csrfDenied = await page.request.post(`http://127.0.0.1:4318/api/staff/manual/cards/${cardId}/actions`, { data: {}, headers: { Origin: 'http://127.0.0.1:4318' } });
  assert.equal(csrfDenied.status(), 403);
  checks.push('Unauthenticated full-workspace read and missing-CSRF write denied by actual local staff boundary.');

  for (const fault of ['missing', 'hash', 'load', 'dimensions']) {
    await page.evaluate(value => window.manualFixture.imageFault(value), fault);
    await wait(() => front.getByRole('checkbox', { name: 'I inspected Front', exact: true }).isDisabled());
    assert.equal(await confirm.isEnabled(), false);
    await page.evaluate(() => window.manualFixture.imageFault('none'));
    await wait(() => front.getByRole('button', { name: 'Add finding', exact: true }).isEnabled());
  }
  checks.push('Missing, wrong-hash, failed and wrong-size inspection images block human review and confirmation.');
  await page.screenshot({ path: `${output}/paired-defects.png`, fullPage: true });

  const beforeTrace = await state();
  await front.getByRole('button', { name: 'Add finding', exact: true }).click();
  await front.getByLabel('Front brush width', { exact: true }).selectOption('16');
  await stroke(front, [[580, 630], [660, 680]]);
  assert.equal(await page.getByRole('button', { name: 'Geometry', exact: true }).isEnabled(), false);
  assert.equal(await confirm.isEnabled(), false);
  await page.screenshot({ path: `${output}/trace-editor.png`, fullPage: true });
  // This deliberately refused request never reaches CPU. It proves a saved
  // candidate survives failed measurement transport; native timeout is tested
  // separately by measurement-runtime against the real worker.
  const failMeasurement = async route => {
    const body = route.request().postDataJSON();
    if (body?.action?.type === 'MEASURE_SIDE') await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'MEASUREMENT_UNAVAILABLE' }) });
    else await route.continue();
  };
  await page.route('**/actions', failMeasurement);
  await front.getByRole('button', { name: 'Save trace', exact: true }).click();
  await wait(() => front.getByRole('button', { name: 'Retry measurement', exact: true }).isVisible());
  const candidate = await state();
  assert.equal(candidate.card.revision, beforeTrace.card.revision + 1); assert.equal(candidate.defects.sides.FRONT.pending.action.type, 'TRACE_SAVE');
  assert.ok(JSON.stringify(candidate.card.draft).length < 4000); assert.equal(JSON.stringify(candidate.card.draft).includes('traceWire'), false);
  assert.deepEqual(candidate.defects.sides.BACK, beforeTrace.defects.sides.BACK);
  await page.unroute('**/actions', failMeasurement); await page.reload();
  await wait(() => front.getByRole('button', { name: 'Retry measurement', exact: true }).isEnabled());
  assert.deepEqual((await state()).defects, candidate.defects);
  await front.getByRole('button', { name: 'Retry measurement', exact: true }).click(); await settled();
  const added = await state(), finding = added.defects.sides.FRONT.findings[0];
  assert.ok(finding.finalTrace); assert.equal(finding.traceProvenance.finalTraceSha256, finding.finalTrace.sha256);
  assert.equal(added.defects.sides.FRONT.measurement.receipt.version, 'atlas-manual-cpu-measurement-v1');
  const raster = decodeSpeedsterTraceRleV1(finding.finalTrace), count = raster.reduce((n, pixel) => n + pixel, 0);
  const area = finding.measurementRegions.reduce((n, region) => n + region.measurement.areaMm2, 0);
  assert.equal(area, count / 400);
  checks.push('Drawn bitmap is staged in immutable storage, candidate saved before CPU, reload retains pending work; real CPU retry adopts exact mask area and provenance with compact PostgreSQL refs.');

  await front.getByRole('button', { name: /^1\. Light scratch/ }).click();
  let lost = 0;
  const loseResponse = async route => {
    const body = route.request().postDataJSON();
    if (body?.action?.type === 'DEFECT_EDIT' && body.action.edit.type === 'CHANGE_TYPE' && lost++ === 0) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  };
  await page.route('**/actions', loseResponse);
  const typeBefore = (await state()).card.revision;
  await front.getByLabel('Front finding type', { exact: true }).selectOption('DENT_MATERIAL_DAMAGE');
  await wait(async () => (await state()).defects.sides.FRONT.findings[0]?.defectType === 'DENT_MATERIAL_DAMAGE'); await settled();
  assert.equal((await state()).card.revision, typeBefore + 2);
  assert.equal((await state()).defects.sides.FRONT.findings[0].finalTrace.sha256, finding.finalTrace.sha256);
  await page.unroute('**/actions', loseResponse);
  checks.push('Lost response after actual type-change commit reconciles the original action once, reloads current state, then remeasures without changing the exact trace.');

  await front.getByRole('button', { name: 'Edit trace', exact: true }).click();
  await front.getByLabel('Front defect zoom', { exact: true }).selectOption('2');
  await front.getByRole('button', { name: 'Pan Front left', exact: true }).click();
  await stroke(front, [[660, 680], [700, 690]]);
  await front.getByRole('button', { name: 'Undo stroke', exact: true }).click();
  await stroke(front, [[660, 680], [700, 690]]);
  await front.getByRole('button', { name: 'Eraser', exact: true }).click();
  await stroke(front, [[600, 642], [610, 649]]);
  await front.getByRole('button', { name: 'Save trace', exact: true }).click();
  await wait(async () => { const f = (await state()).defects.sides.FRONT.findings[0]; return f?.finalTrace.sha256 !== finding.finalTrace.sha256; }); await settled();
  const reshaped = (await state()).defects.sides.FRONT.findings[0];
  assert.equal(reshaped.traceProvenance.finalTraceSha256, reshaped.finalTrace.sha256);
  assert.equal(reshaped.defectType, 'DENT_MATERIAL_DAMAGE');
  await front.getByLabel('Front defect zoom', { exact: true }).selectOption('1');
  const beforeRemove = (await state()).defects.sides.BACK;
  await front.getByRole('button', { name: 'Remove finding', exact: true }).click();
  await wait(async () => (await state()).defects.sides.FRONT.findings[0].reviewResult === 'REMOVED'); await settled();
  await front.getByRole('button', { name: 'Restore finding', exact: true }).click();
  await wait(async () => (await state()).defects.sides.FRONT.findings[0].reviewResult !== 'REMOVED'); await settled();
  assert.deepEqual((await state()).defects.sides.BACK, beforeRemove);
  checks.push('Zoomed/panned reshape, undo stroke, eraser, remove and restore use existing CPU measurements; Front changes preserve Back.');

  await front.getByRole('checkbox', { name: 'I inspected Front', exact: true }).click();
  await wait(async () => Boolean((await state()).defects.sides.FRONT.inspection)); assert.equal(await confirm.isEnabled(), false);
  await back.getByRole('checkbox', { name: 'I inspected Back', exact: true }).click(); await wait(() => confirm.isEnabled());
  await confirm.click(); await wait(() => page.getByRole('button', { name: 'Review draft report', exact: true }).isEnabled());
  assert.equal((await state()).approval, null);
  await page.screenshot({ path: `${output}/confirmed-findings.png`, fullPage: true });
  await page.getByRole('button', { name: 'Review draft report', exact: true }).click();
  await page.getByRole('button', { name: 'Approve final report', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/draft-report.png`, fullPage: true });
  const approvalBefore = await state();
  await page.getByRole('button', { name: 'Approve final report', exact: true }).click();
  await page.getByText('Report approved and saved.', { exact: true }).waitFor();
  const approved = await state();
  assert.equal(approved.card.revision, approvalBefore.card.revision + 1); assert.equal(approved.card.contentHash, approvalBefore.card.contentHash);
  assert.equal(approved.approval.sourceHash, approved.card.contentHash); assert.equal(approved.approval.report.report.ref.kind, 'REPORT');
  await page.reload(); await wait(() => page.getByRole('button', { name: 'Review draft report', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Review draft report', exact: true }).click(); await page.getByText('Report approved and saved.', { exact: true }).waitFor();
  assert.deepEqual((await state()).approval, approved.approval);
  checks.push('Both current inspections enable one Confirm findings action; separate trained-human report approval stores an immutable REPORT reference and survives reload.');

  await page.getByRole('button', { name: 'Back to findings', exact: true }).click();
  await page.getByRole('button', { name: 'Geometry', exact: true }).click();
  const beforePhysical = await state();
  await page.getByRole('button', { name: 'FRONT physical edge Top left', exact: true }).press('ArrowRight');
  await page.getByRole('region', { name: 'Front geometry' }).getByRole('button', { name: 'Save outline', exact: true }).click();
  await wait(async () => (await state()).geometry.sides.FRONT.preparationRevision > beforePhysical.geometry.sides.FRONT.preparationRevision);
  await wait(() => geometryConfirm.isEnabled());
  const prepared = await state();
  assert.notEqual(prepared.geometry.sides.FRONT.prepared.frame.inspection.sha256, beforePhysical.geometry.sides.FRONT.prepared.frame.inspection.sha256);
  assert.deepEqual(prepared.defects.sides.BACK, beforePhysical.defects.sides.BACK); assert.equal(prepared.defects.sides.FRONT.findings.length, 0);
  assert.equal(prepared.defects.confirmation, null); assert.equal(prepared.defects.sides.FRONT.inspection, null);
  assert.notEqual(prepared.card.contentHash, prepared.approval.sourceHash); assert.deepEqual(prepared.approval, approved.approval);
  await geometryConfirm.click(); await wait(() => front.getByRole('button', { name: 'Add finding', exact: true }).isEnabled());
  assert.equal(await confirm.isEnabled(), false);
  checks.push('Physical outline save runs real CPU preparation, replaces only Front evidence/findings, requires fresh Front inspection and preserves the earlier immutable approval as history.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
    sides: [...document.querySelectorAll('.ad-side')].map(n => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom })) }));
  assert.ok(dimensions.width <= dimensions.viewport); assert.ok(dimensions.sides[1].top >= dimensions.sides[0].bottom);
  checks.push('390-pixel layout stacks Front and Back without horizontal overflow.');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ passed: true, checks, browser: await browser.version(), errors,
    finalCardRevision: approved.card.revision, finalDraftHash: approved.card.contentHash, fullArtifactSha256: approved.card.draft.defects.ref.sha256,
    finalReportSha256: approved.approval.report.report.ref.sha256 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.json`, JSON.stringify({ message: error.message, stack: error.stack, checks, errors, text: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await browser.close(); }
