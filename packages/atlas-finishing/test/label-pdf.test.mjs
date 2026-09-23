import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualLabelPdfRenderer } from '../src/label-pdf.mjs';
import { samplePlan } from './manual-fixture.mjs';
const layout = { version: 'atlas-label-sheet-v1', widthPoints: 196.56, heightPoints: 59.76,
  pages: ['FRONT', 'REVERSE'].map(face => ({ placements: [{ face, x: 0, y: 0, rotation: 0 }] })) };
test('same approved label produces exactly reproducible vector PDF at both physical face sizes', async () => {
  const plan = samplePlan(), render = createManualLabelPdfRenderer({ layout });
  const a = await render(plan), b = await createManualLabelPdfRenderer({ layout })(plan);
  assert.deepEqual(a.bytes, b.bytes); assert.equal(a.sha256, b.sha256);
  assert.equal(a.planHash, plan.planHash); assert.equal(a.renderProfileHash, render.profileHash);
  const pdf = a.bytes.toString('latin1'); assert.match(pdf, /^%PDF-/);
  assert.equal([...pdf.matchAll(/\/MediaBox \[0 0 196\.56 59\.76\]/g)].length, 2);
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
  const next = await render(samplePlan({ version: 4 })); assert.notEqual(next.sha256, a.sha256);
  const mono = createManualLabelPdfRenderer({ layout, palette: 'MONOCHROME' });
  assert.notEqual(mono.profileHash, render.profileHash); assert.notEqual((await mono(plan)).sha256, a.sha256);
});
test('layout refuses cropped/overlapping/missing faces and unsupported scripts rather than damaged identity', async () => {
  for (const invalid of [{ ...layout, widthPoints: 190 }, { ...layout, pages: [layout.pages[0]] },
    { ...layout, pages: [{ placements: [layout.pages[0].placements[0], layout.pages[1].placements[0]] }] },
    { ...layout, pages: [{ placements: [{ ...layout.pages[0].placements[0], rotation: 90 }] }, layout.pages[1]] }])
    assert.throws(() => createManualLabelPdfRenderer({ layout: invalid }));
  const plan = samplePlan({ identity: { playerName: '日本語', year: '2024', manufacturer: 'Panini', productSet: 'Prizm', parallel: null, insert: null, cardNumber: '24' } });
  await assert.rejects(createManualLabelPdfRenderer({ layout })(plan), /LABEL_PDF_FONT_UNSUPPORTED/);
});
