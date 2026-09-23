import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualFinishingPlan } from '../src/manual.mjs';
import { renderManualLabel, MANUAL_LABEL_GEOMETRY } from '../src/label.mjs';
import { dispatchApprovedFinishing } from '../src/dispatch.mjs';

import { samplePlan } from './manual-fixture.mjs';
const measureText = (value, size) => value.length * size * .52;
const qr = { size: 37, get: (row, column) => (row + column) % 2 === 0 };
test('exact immutable publication generates one deterministic pair of independent intents', () => {
  const a = samplePlan(), b = samplePlan(); assert.deepEqual(a, b); assert.ok(Object.isFrozen(a.label.identity));
  assert.equal(a.label.finalGrade, 9.5); assert.ok(a.nfc.url.endsWith('?v=3')); assert.notEqual(a.print.intentId, a.nfc.intentId);
  assert.notEqual(a.id, samplePlan({ version: 4 }).id); assert.equal(validateManualFinishingPlan(a), a);
  const changed = structuredClone(a); changed.binding.publicHash = 'd'.repeat(64); assert.throws(() => validateManualFinishingPlan(changed));
  assert.ok(!JSON.stringify(a).includes('certificate')); assert.ok(!JSON.stringify(a).includes('owner'));
});
test('label is exact-size escaped vector art and never truncates identity to fit', () => {
  const plan = samplePlan({ mode: 'LOCAL_FIXTURE' }); const rendered = renderManualLabel({ label: plan.label, measureText, qr });
  assert.match(rendered.front, /width="2.73in" height="0.83in"/); assert.match(rendered.front, /EXAMPLE/); assert.match(rendered.reverse, /NOT ISSUED/);
  assert.match(rendered.front, />9.5<\/text>/); assert.equal(MANUAL_LABEL_GEOMETRY.nfcReserve.diameterMm, 11); assert.equal(MANUAL_LABEL_GEOMETRY.nfcReserve.guideDiameterMm, 9);
  const label = structuredClone(plan.label); label.identity.playerName = 'A <B> & "C"';
  assert.match(renderManualLabel({ label, measureText, qr }).front, /A &lt;B&gt; &amp; &quot;C&quot;/);
  label.identity.playerName = 'W'.repeat(180); assert.throws(() => renderManualLabel({ label, measureText, qr }), /REQUIRES_LAYOUT/);
});
test('layout accepts only the exact versioned ATLAS URL and unchanged final award', () => {
  const label = structuredClone(samplePlan().label); label.url += '&other=1'; assert.throws(() => renderManualLabel({ label, measureText, qr }));
  label.url = samplePlan().label.url; label.finalGrade = 9.7; assert.throws(() => renderManualLabel({ label, measureText, qr }));
});
test('print and NFC preparation overlap without inventing physical completion', async () => {
  const plan = samplePlan(); let printStarted = false, nfcStarted = false, releasePrint;
  const printReady = new Promise(resolve => { releasePrint = resolve; });
  const association = { planHash: plan.planHash, cardId: plan.binding.cardId, approvalActionId: plan.binding.approvalActionId,
    stationId: 'test-station', armed: true, expiresAt: 1500 };
  const result = await dispatchApprovedFinishing({ plan, association, now: 1000,
    printer: { capability: { qualified: true }, prepare: async () => { printStarted = true; await printReady; return { planHash: plan.planHash, intentId: plan.print.intentId, state: 'SPOOL_ACCEPTED' }; } },
    nfc: { capability: { qualified: true, profile: plan.nfc.requiredProfile }, prepare: async () => { nfcStarted = true; assert.equal(printStarted, true); releasePrint(); return { planHash: plan.planHash, intentId: plan.nfc.intentId, state: 'WAITING_FOR_TAG' }; } },
  });
  assert.equal(nfcStarted, true); assert.equal(result.assembly, 'NOT_RECORDED'); assert.equal(result.print.state, 'SPOOL_ACCEPTED');
  const absent = await dispatchApprovedFinishing({ plan, association, now: 1000 }); assert.equal(absent.nfc.reason, 'MAC_NFC_QUALIFICATION_REQUIRED');
  await assert.rejects(dispatchApprovedFinishing({ plan, association: { ...association, cardId: 'another' }, now: 1000 }), /ASSOCIATION/);
  await assert.rejects(dispatchApprovedFinishing({ plan, association, now: 1500 }), /ASSOCIATION/);
  await assert.rejects(dispatchApprovedFinishing({ plan: samplePlan({ mode: 'LOCAL_FIXTURE' }), association, now: 1000 }), /FIXTURE/);
});
