import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { archiveApprovedMedia } from '../src/approved-card-media.mjs';
import { LABEL_APPROVED_B_RENDERER_PROFILE_HASH } from '@atlas/finishing/label-approved-b';

const hash = character => character.repeat(64);
function fixture() {
  const input = { cardId: randomUUID(), approvalActionId: randomUUID(), publicToken: `ar_${'A'.repeat(24)}`,
    approvalVersion: 3, publicationState: 'PUBLISHED', publicHash: hash('a'), reportHash: hash('b'),
    sourceRevision: 12, sourceHash: hash('c') };
  input.labelItem = { id: randomUUID(), card_id: input.cardId, action_id: input.approvalActionId,
    approval_version: input.approvalVersion, state: 'READY', source_revision: input.sourceRevision,
    source_hash: input.sourceHash, report_hash: input.reportHash, public_hash: input.publicHash,
    artwork_hash: hash('d'), renderer_profile_hash: hash('e'), material_profile_id: 'atlas-v4-gold-v1',
    private_field: 'must not escape' };
  const value = { version: 'atlas-report-presentation-v1', binding: { publicToken: input.publicToken,
    approvalVersion: input.approvalVersion, publicHash: input.publicHash }, revision: 2,
    updatedAt: '2026-10-20T12:00:00.000Z', slabPhoto: {
      url: `/api/reports/${input.publicToken}/presentation/image?v=${input.approvalVersion}&revision=2`,
      sha256: hash('f'), byteCount: 12500, contentType: 'image/webp', width: 1200, height: 2000,
      alt: 'Photograph of the actual finished card' } };
  const presentation = canonical(value);
  input.presentation = { card_id: input.cardId, approval_action_id: input.approvalActionId,
    revision: 2, presentation, presentation_hash: digest(presentation), media: 'private-storage-key' };
  return input;
}
function alterPresentation(input, change) {
  const value = JSON.parse(input.presentation.presentation); change(value);
  input.presentation.presentation = canonical(value);
  input.presentation.presentation_hash = digest(input.presentation.presentation);
}

test('archive projects the exact versioned pair, optional actual slab photo and retained label without mutation', () => {
  const input = fixture(), before = structuredClone(input), result = archiveApprovedMedia(input);
  assert.deepEqual(Object.keys(result), ['FRONT', 'BACK', 'SLAB', 'LABEL']);
  for (const side of ['FRONT', 'BACK']) {
    assert.equal(result[side].url, `/api/reports/${input.publicToken}/images/${side}?v=3`);
    assert.equal(result[side].provenance, 'APPROVED_GRADING_PHOTOGRAPH');
  }
  assert.equal(result.SLAB.sha256, hash('f')); assert.equal(result.SLAB.presentationRevision, 2);
  assert.equal(result.SLAB.provenance, 'ACTUAL_SLAB_PHOTOGRAPH');
  assert.equal(result.LABEL.url, `/admin/api/staff/manual-connected/labels/${input.labelItem.id}/artwork?mode=preview`);
  assert.equal(result.LABEL.artworkHash, hash('d')); assert.equal(result.LABEL.sha256, undefined);
  assert.equal(result.LABEL.provenance, 'REPORT_BOUND_LABEL_ARTWORK');
  assert.equal(result.LABEL.layoutVersion, undefined); assert.equal(result.LABEL_BACK, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private|actor|original|nfcVerified|printed|humanApproved/);
  assert.deepEqual(input, before); assert.deepEqual(archiveApprovedMedia(input), result);
});

test('only the exact approved-B saved profile projects paired labels with the same approval-bound item', () => {
  const input = fixture(); input.labelItem.renderer_profile_hash = LABEL_APPROVED_B_RENDERER_PROFILE_HASH;
  const before = structuredClone(input), result = archiveApprovedMedia(input);
  assert.equal(result.LABEL.layoutVersion, 'atlas-approved-b-v1');
  assert.deepEqual(result.LABEL_BACK, { ...result.LABEL,
    url: `/admin/api/staff/manual-connected/labels/${input.labelItem.id}/artwork?mode=preview-back` });
  assert.equal(result.LABEL_BACK.itemId, input.labelItem.id); assert.equal(result.LABEL_BACK.sha256, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private_field|snapshot|actor_id|print_svg|preview_svg/);
  assert.deepEqual(input, before);
  // Untrusted snapshot/display claims cannot upgrade an old renderer profile.
  input.labelItem.renderer_profile_hash = hash('e'); input.labelItem.layoutVersion = 'atlas-approved-b-v1';
  input.labelItem.snapshot = canonical({ layoutVersion: 'atlas-approved-b-v1' }); input.labelItem.snapshot_hash = digest(input.labelItem.snapshot);
  const historical = archiveApprovedMedia(input);
  assert.equal(historical.LABEL.layoutVersion, undefined); assert.equal(historical.LABEL_BACK, undefined);
});

test('approved-B reverse artwork is omitted together with any invalid or stale front-label binding', () => {
  for (const [field, value] of [['card_id', randomUUID()], ['action_id', randomUUID()], ['approval_version', 4],
    ['source_revision', 13], ['source_hash', hash('d')], ['report_hash', hash('d')], ['public_hash', hash('d')],
    ['artwork_hash', null], ['material_profile_id', 'unknown/value'], ['state', 'NEEDS_LAYOUT'], ['current', false]]) {
    const input = fixture(); input.labelItem.renderer_profile_hash = LABEL_APPROVED_B_RENDERER_PROFILE_HASH;
    input.labelItem[field] = value; const result = archiveApprovedMedia(input);
    assert.equal(result.LABEL, undefined, field); assert.equal(result.LABEL_BACK, undefined, field);
    assert.ok(result.FRONT && result.BACK, field);
  }
});

test('unpublished reports never expose media and missing optional assets leave only the approved pair', () => {
  for (const publicationState of ['PENDING', 'FAILED', 'SUPERSEDED', null]) {
    assert.deepEqual(archiveApprovedMedia({ ...fixture(), publicationState }), {});
  }
  assert.deepEqual(Object.keys(archiveApprovedMedia({ ...fixture(), labelItem: null, presentation: null })), ['FRONT', 'BACK']);
});

test('invalid publication selectors cannot create URLs or claim a published image', () => {
  for (const change of [v => { v.cardId = '../other'; }, v => { v.approvalActionId = randomUUID() + '/'; },
    v => { v.publicToken = `ar_${'A'.repeat(24)}?extra`; }, v => { v.approvalVersion = 0; },
    v => { v.approvalVersion = 2147483648; }, v => { v.sourceRevision = 0; },
    v => { v.publicHash = null; }, v => { v.reportHash = 'x'; }, v => { v.sourceHash = '0'.repeat(63); },
    v => { v.cardId = [v.cardId]; }, v => { v.publicToken = [v.publicToken]; }]) {
    const input = fixture(); change(input);
    assert.throws(() => archiveApprovedMedia(input), { code: 'ARCHIVE_MEDIA_BINDING_INVALID' });
  }
});

test('label requires the exact card, approval, source, report, renderer and ready retained item', () => {
  for (const [field, value] of [['id', '../label'], ['card_id', randomUUID()], ['action_id', randomUUID()],
    ['approval_version', 4], ['source_revision', 13], ['source_hash', hash('d')], ['report_hash', hash('d')],
    ['public_hash', hash('d')], ['artwork_hash', null], ['artwork_hash', [hash('d')]], ['renderer_profile_hash', 'unknown'],
    ['material_profile_id', 'https://other.test'], ['state', 'NEEDS_LAYOUT'], ['state', 'SUPERSEDED'], ['current', false]]) {
    const input = fixture(); input.labelItem[field] = value;
    const result = archiveApprovedMedia(input);
    assert.equal(result.LABEL, undefined, field); assert.ok(result.FRONT && result.BACK && result.SLAB, field);
  }
});

test('stale, swapped, corrupt or malformed slab evidence never replaces the bound approved pair', () => {
  const changes = [v => { v.presentation.card_id = randomUUID(); }, v => { v.presentation.approval_action_id = randomUUID(); },
    v => { v.presentation.revision = 3; }, v => { v.presentation.presentation_hash = hash('0'); },
    v => { v.presentation.presentation = '{'; v.presentation.presentation_hash = digest('{'); },
    v => alterPresentation(v, p => { p.binding.publicHash = hash('0'); }),
    v => alterPresentation(v, p => { p.binding.approvalVersion++; }),
    v => alterPresentation(v, p => { p.binding.publicToken = `ar_${'B'.repeat(24)}`; }),
    v => alterPresentation(v, p => { p.slabPhoto.url = 'https://example.com/unbound.webp'; }),
    v => alterPresentation(v, p => { p.slabPhoto.sha256 = 'bad'; }),
    v => alterPresentation(v, p => { p.slabPhoto.contentType = 'image/svg+xml'; }),
    v => alterPresentation(v, p => { p.slabPhoto.width = 0; }),
    v => alterPresentation(v, p => { p.slabPhoto.privateStorageKey = 'do not expose'; }),
    v => alterPresentation(v, p => { delete p.slabPhoto; })];
  for (const change of changes) {
    const input = fixture(); change(input); const result = archiveApprovedMedia(input);
    assert.equal(result.SLAB, undefined); assert.ok(result.FRONT && result.BACK && result.LABEL);
  }
});

test('label and slab failures are independent and never invent originals, rendered holders or physical NFC state', () => {
  const input = fixture(); input.presentation.presentation_hash = hash('0'); input.labelItem.state = 'QUEUED';
  const result = archiveApprovedMedia(input);
  assert.deepEqual(Object.keys(result), ['FRONT', 'BACK']);
  assert.doesNotMatch(JSON.stringify(result), /ORIGINAL|COMPOSITE|HOLDER|NFC|360|video/i);
});
