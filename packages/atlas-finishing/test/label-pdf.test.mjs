import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createManualLabelPdfRenderer } from '../src/label-pdf.mjs';
import { createCupsPrinter } from '../src/cups.mjs';
import { samplePlan } from './manual-fixture.mjs';
const layout = { version: 'atlas-label-sheet-v1', widthPoints: 196.56, heightPoints: 59.76,
  pages: ['FRONT', 'REVERSE'].map(face => ({ placements: [{ face, x: 0, y: 0, rotation: 0 }] })) };
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function legacyPlan() {
  const plan = structuredClone(samplePlan());
  plan.label.layoutVersion = 'atlas-noir-gold-v1'; delete plan.label.design;
  plan.planHash = sha(canonical({ version: plan.version, binding: plan.binding, label: plan.label }));
  plan.id = `afp_${plan.planHash}`; plan.print.intentId = `afprint_${plan.planHash}`;
  plan.print.layoutVersion = plan.label.layoutVersion; plan.nfc.intentId = `afnfc_${plan.planHash}`;
  return plan;
}
// Captured from the original committed v1 generator (06433690), before the v2
// changes. These are not derived from the implementation under test.
const legacyGold = { profile: '7002a99154a879c408d09fb68a13ea614cae9f732c4e8663a9c6ab625fdeed15',
  pdf: '8460806b9e54ea4121c2cffc9fef31387cd315c87b66505b1177ba9a84f03aac' };
test('explicit v1 mode retains the original plan, PDF bytes and render profiles for both palettes', async () => {
  const plan = legacyPlan();
  assert.equal(plan.planHash, 'fb12f6f08e78d582eabeb415e7c6c9124133c15c9ba42de8d4452c19abb6cd97');
  for (const [palette, expected] of [['NOIR_GOLD', legacyGold], ['MONOCHROME', {
    profile: 'ba6de38e454901ccd5865f6c8026e4e5721259c9f12fb4f4486876c699fb0216',
    pdf: 'df1daff5a0a6fa04da2fdb9e4b08148e758bb3fb11931d61bcc419fe0b28c1d6',
  }]]) {
    const render = createManualLabelPdfRenderer({ layout, palette, layoutVersion: 'atlas-noir-gold-v1' });
    const document = await render(plan);
    assert.equal(render.profileHash, expected.profile); assert.equal(document.renderProfileHash, expected.profile);
    assert.equal(document.sha256, expected.pdf); assert.equal(sha(document.bytes), expected.pdf);
    await assert.rejects(render(samplePlan()), /LABEL_PDF_LAYOUT_VERSION_MISMATCH/);
  }
  await assert.rejects(createManualLabelPdfRenderer({ layout })(plan), /LABEL_PDF_LAYOUT_VERSION_MISMATCH/);
  assert.throws(() => createManualLabelPdfRenderer({ layout, layoutVersion: 'unknown' }), /LABEL_PDF_LAYOUT_VERSION_INVALID/);
});
test('a saved v1 CUPS job survives renderer upgrade without profile conflict or another submission', async () => {
  const plan = legacyPlan(), render = createManualLabelPdfRenderer({ layout, layoutVersion: 'atlas-noir-gold-v1' });
  const config = { version: 'atlas-cups-printer-v1', qualified: true, printer: 'Atlas_Test', media: 'Letter',
    layoutVersion: 'atlas-noir-gold-v1', qualificationHash: 'e'.repeat(64), renderProfileHash: legacyGold.profile, actualSize: true };
  const profileHash = sha(JSON.stringify({ version: config.version, printer: config.printer, media: config.media,
    layoutVersion: config.layoutVersion, qualificationHash: config.qualificationHash, renderProfileHash: config.renderProfileHash, actualSize: true }));
  let saved = { version: 'atlas-cups-intent-v1', intentId: plan.print.intentId, planHash: plan.planHash,
    documentHash: legacyGold.pdf, profileHash, state: 'SPOOL_ACCEPTED', jobId: 17 };
  let submissions = 0;
  const printer = createCupsPrinter({ config, renderDocument: render,
    journal: { async reserve(record) {
      assert.equal(record.documentHash, saved.documentHash); assert.equal(record.profileHash, saved.profileHash);
      return { created: false, record: saved };
    }, async get() { return saved; }, async commit(record) { saved = record; } },
    transport: { async submit() { submissions++; throw new Error('Existing job must not resubmit'); },
      async inspect() { return { jobId: 17, name: plan.print.intentId, printer: config.printer, state: 9 }; } },
  });
  assert.equal((await printer.prepare({ plan })).state, 'SPOOL_COMPLETED');
  assert.equal((await printer.status(plan.print.intentId, plan.planHash)).state, 'SPOOL_COMPLETED'); assert.equal(submissions, 0);
});
test('same approved label produces exactly reproducible vector PDF at both physical face sizes', async () => {
  const plan = samplePlan(), render = createManualLabelPdfRenderer({ layout });
  const a = await render(plan), b = await createManualLabelPdfRenderer({ layout })(plan);
  assert.deepEqual(a.bytes, b.bytes); assert.equal(a.sha256, b.sha256);
  assert.equal(a.planHash, plan.planHash); assert.equal(a.renderProfileHash, render.profileHash);
  const pdf = a.bytes.toString('latin1'); assert.match(pdf, /^%PDF-/);
  assert.equal([...pdf.matchAll(/\/MediaBox \[0 0 196\.56 59\.76\]/g)].length, 2);
  assert.match(pdf, /\/Subtype \/Image/); // Exact owner-supplied raster logo, vector text/layout.
  const next = await render(samplePlan({ version: 4 })); assert.notEqual(next.sha256, a.sha256);
  const mono = createManualLabelPdfRenderer({ layout, palette: 'MONOCHROME' });
  assert.notEqual(mono.profileHash, render.profileHash); await assert.rejects(mono(plan), /MANUAL_LABEL_PALETTE_INVALID/);
});
test('layout refuses cropped/overlapping/missing faces and unsupported scripts rather than damaged identity', async () => {
  for (const invalid of [{ ...layout, widthPoints: 190 }, { ...layout, pages: [layout.pages[0]] },
    { ...layout, pages: [{ placements: [layout.pages[0].placements[0], layout.pages[1].placements[0]] }] },
    { ...layout, pages: [{ placements: [{ ...layout.pages[0].placements[0], rotation: 90 }] }, layout.pages[1]] }])
    assert.throws(() => createManualLabelPdfRenderer({ layout: invalid }));
  const plan = samplePlan({ identity: { playerName: '日本語', year: '2024', manufacturer: 'Panini', productSet: 'Prizm', parallel: null, insert: null, cardNumber: '24' } });
  await assert.rejects(createManualLabelPdfRenderer({ layout })(plan), /LABEL_PDF_FONT_UNSUPPORTED/);
});
