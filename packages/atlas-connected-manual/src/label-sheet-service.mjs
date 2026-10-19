import { canonical, digest, object, requireThat, uuid, revision } from '@atlas/manual-service/contract';
import { renderLabelV4, renderLabelV4Png, LABEL_V4_RENDERER_PROFILE_HASH } from '@atlas/finishing/label-v4';
import { renderLabelSheetPng, renderLabelBlackInkSvg, renderLabelBlackInkPreviewSvg,
  LABEL_EXPORT_PROFILE_V1, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1,
  LABEL_BLACK_INK_EXPORT_PROFILE_V1, LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1 } from '@atlas/finishing/label-sheet';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { labelFailureHash } from './label-sheet-repository.mjs';
import { labelReplacementIntent, assertLabelRefreshSnapshot } from './label-replacement-intent.mjs';
const jigHash = LABEL_JIG_V1.jigHash;

export const LABEL_EXPORT_PROFILES = Object.freeze({ SHEET: LABEL_EXPORT_PROFILE_V1.id, SINGLE: LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.id });
export const LABEL_BLACK_INK_EXPORT_PROFILES = Object.freeze({ SHEET: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id, SINGLE: LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.id });
const exportProfiles = Object.freeze({
  SHEET: Object.freeze([LABEL_EXPORT_PROFILES.SHEET, LABEL_BLACK_INK_EXPORT_PROFILES.SHEET]),
  SINGLE: Object.freeze([LABEL_EXPORT_PROFILES.SINGLE, LABEL_BLACK_INK_EXPORT_PROFILES.SINGLE]),
});
const hash = value => requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 400, 'LABEL_HASH_INVALID');
const exact = (input, required, optional = []) => {
  requireThat(input && Object.getPrototypeOf(input) === Object.prototype && required.every(k => Object.hasOwn(input,k))
    && Object.keys(input).every(k => required.includes(k) || optional.includes(k)), 400, 'LABEL_REQUEST_INVALID');
};
const binding = row => ({ exportId: row.id, manifestHash: row.manifest_hash, kind: row.kind });

export function createLabelService({ boundary, repository, finishing, storage,
  renderer = { label: renderLabelV4, sheet: renderLabelSheetPng, individual: renderLabelV4Png },
  materials = { SPORTS: { id: 'atlas-v4-gold-v1', preview: 'gold' }, POKEMON: { id: 'atlas-v4-holo-v1', preview: 'holo' } } }) {
  requireThat(repository?.pendingCandidates && finishing?.loadPacket && storage?.write && storage?.download && boundary?.machineOwner
    && renderer?.label && renderer?.sheet && renderer?.individual, 500, 'LABEL_CONFIGURATION_INVALID');
  let running = null;
  async function renderItem(staff, id) {
    let attemptedProfile = { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH, jigHash, materialProfileId: null };
    const claimed = await repository.claimItem(staff, id, attemptedProfile); if (!claimed) return false;
    try {
      // This adapter proves exact approval/action/draft lineage and reauthenticates
      // after the immutable public packet is read from object storage.
      const { packet, row } = await finishing.loadPacket(staff, claimed.card_id, claimed.action_id);
      let result, replacement = null;
      if (claimed.purpose === 'REPRINT') {
        const original = await repository.item(staff, claimed.original_item_id);
        replacement = labelReplacementIntent(claimed, original);
        if (replacement.kind === 'COPY') result = { state: 'READY', snapshot: JSON.parse(original.snapshot), printSvg: original.print_svg, previewSvg: original.preview_svg,
          artworkHash: original.artwork_hash, rendererProfileHash: original.renderer_profile_hash, materialProfileId: original.material_profile_id, jigHash: original.jig_hash };
        else assertLabelRefreshSnapshot(original, packet);
      }
      if (!result) {
        const report = packet.report, material = materials[report.cardProfile];
        requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
        if (replacement?.kind === 'REFRESH') requireThat(replacement.target.rendererProfileHash === LABEL_V4_RENDERER_PROFILE_HASH
          && replacement.target.materialProfileId === material.id && replacement.target.jigHash === jigHash, 409, 'LABEL_RENDERER_CHANGED');
        attemptedProfile = { ...attemptedProfile, materialProfileId: material.id };
        const rendered = await renderer.label({ identity: report.identity, finalGrade: report.finalGrade,
          reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion, cardProfile: report.cardProfile }, { previewMaterial: material.preview });
        result = { ...rendered, rendererProfileHash: rendered.rendererProfileHash ?? LABEL_V4_RENDERER_PROFILE_HASH,
          code: rendered.diagnostics?.code ?? 'LABEL_NEEDS_LAYOUT', materialProfileId: material.id, jigHash,
          snapshot: { identity: report.identity, grade: report.finalGrade, finalGrade: report.finalGrade, cardProfile: report.cardProfile,
            reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion, reportHref: `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}`,
            previewMaterial: material.preview, source: rendered.source, diagnostics: rendered.diagnostics ?? [] } };
      }
      await repository.finishItem(staff, claimed, { ...result, row }); return true;
    } catch (error) { await repository.failItem(staff, claimed, attemptedProfile); throw error; }
  }
  async function recoverLayout(staff, id) {
    const item = await repository.item(staff, id);
    // item() verifies the immutable snapshot hash and current published approval.
    // Reserve first; ordinary rendering verifies the public packet and owns its
    // bounded attempts. A storage failure cannot create repeated generations.
    const snapshot = item.snapshot ? JSON.parse(item.snapshot) : null, material = materials[snapshot?.cardProfile];
    requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
    const key = digest(canonical({ operation: 'automatic-layout-recovery/v1', itemId: id, rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH }));
    const requestId = `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-${((parseInt(key[16],16)&3)|8).toString(16)}${key.slice(17,20)}-${key.slice(20,32)}`;
    await repository.retryLayout(staff, id, { requestId, expectedFailureHash: labelFailureHash(item), expectedRendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH },
      { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH, materialProfileId: material.id, jigHash }, { automatic: true });
    return true;
  }
  async function renderExport(staff, id) {
    const claimed = await repository.claimExport(staff, id); if (!claimed) return false;
    try {
      const labels = claimed.items.map(item => {
        requireThat(digest(item.print_svg) === item.artwork_hash, 503, 'LABEL_ARTWORK_INVALID');
        return { slot: claimed.row.kind === 'SHEET' ? item.slot : 1, artworkHash: item.artwork_hash, printSvg: item.print_svg };
      });
      const options = { exportProfileId: claimed.row.profile_id };
      const result = claimed.row.kind === 'SHEET' ? await renderer.sheet(labels, options) : await renderer.individual(labels[0], options);
      requireThat(Buffer.isBuffer(result.bytes) && digest(result.bytes) === result.sha256
        && result.manifest?.exportProfileId === claimed.row.profile_id, 503, 'LABEL_PNG_INVALID');
      // Recheck source and authority before storage, and again on completion.
      await repository.export(staff, id);
      const saved = await storage.write(binding(claimed.row), result.bytes, { sha256: result.sha256, contentType: 'image/png' });
      await repository.finishExport(staff, claimed, { ...saved, mapping: result.manifest }); return true;
    } catch (error) { await repository.failExport(staff, claimed); throw error; }
  }
  async function checkedExport(staff, { exportId, sheetId, itemId }, latest = true) {
    uuid(exportId); if (sheetId) uuid(sheetId); if (itemId) uuid(itemId);
    const result = await repository.export(staff, exportId, { latest });
    requireThat((sheetId ? result.row.kind === 'SHEET' && result.row.sheet_id === sheetId : true)
      && (itemId ? result.row.kind === 'SINGLE' && result.row.item_id === itemId : true), 404, 'LABEL_EXPORT_NOT_FOUND');
    return result;
  }
  return Object.freeze({
    list: async (staff, options) => ({ ...await repository.list(staff, { ...options, rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH }), rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH }),
    sheet: (staff, sheetId) => repository.sheet(staff, uuid(sheetId)),
    reconciliation: (staff, input) => repository.reconciliation(staff, input),
    async artwork(staff, { itemId, mode = 'preview' }) {
      requireThat(['preview','print','preview-foil','print-foil'].includes(mode), 400, 'LABEL_ARTWORK_MODE_INVALID');
      const item = await repository.item(staff, uuid(itemId)); requireThat(item.state === 'READY', 409, 'LABEL_NOT_READY');
      requireThat(typeof item.print_svg === 'string' && digest(item.print_svg) === item.artwork_hash, 503, 'LABEL_ARTWORK_INVALID');
      const artwork = { printSvg: item.print_svg, artworkHash: item.artwork_hash };
      let svg;
      if (mode === 'preview-foil') {
        const material = Object.values(materials).find(value => value.id === item.material_profile_id);
        requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
        svg = renderLabelBlackInkPreviewSvg(artwork, { previewMaterial: material.preview });
      } else svg = mode === 'print-foil' ? renderLabelBlackInkSvg(artwork) : mode === 'print' ? item.print_svg : item.preview_svg;
      requireThat(typeof svg === 'string' && Buffer.byteLength(svg) <= 1048576, 503, 'LABEL_ARTWORK_INVALID');
      return { bytes: Buffer.from(svg), contentType: 'image/svg+xml', sha256: digest(svg) };
    },
    prepareSheetExport(staff, sheetId, input) {
      exact(input, ['requestId','expectedSheetRevision','exportProfileId']); uuid(input.requestId); revision(input.expectedSheetRevision); uuid(sheetId);
      requireThat(exportProfiles.SHEET.includes(input.exportProfileId), 400, 'LABEL_PROFILE_INVALID');
      return repository.prepareExport(staff, { kind: 'SHEET', id: sheetId, input });
    },
    prepareIndividualExport(staff, itemId, input) {
      exact(input, ['requestId','expectedLabelHash','exportProfileId']); uuid(input.requestId); hash(input.expectedLabelHash); uuid(itemId);
      requireThat(exportProfiles.SINGLE.includes(input.exportProfileId), 400, 'LABEL_PROFILE_INVALID');
      return repository.prepareExport(staff, { kind: 'SINGLE', id: itemId, input });
    },
    async exportStatus(staff, target) { return (await checkedExport(staff, target, false)).view; },
    async download(staff, { input, ...target }) {
      exact(input, ['requestId','expectedExportSha256']); uuid(input.requestId); hash(input.expectedExportSha256);
      const { row } = await checkedExport(staff, target);
      requireThat(row.state === 'READY' && row.sha256 === input.expectedExportSha256, 409, 'LABEL_EXPORT_NOT_READY');
      const result = await storage.download(binding(row), { object: JSON.parse(row.object_ref), sha256: row.sha256, byteCount: row.byte_count, contentType: row.content_type });
      const after = await checkedExport(staff, target); requireThat(after.row.sha256 === row.sha256 && after.row.profile_id === row.profile_id, 409, 'LABEL_EXPORT_CHANGED');
      return { ...result, exportProfileId: row.profile_id };
    },
    async confirmPrint(staff, sheetId, input) {
      exact(input, ['requestId','exportId','exportSha256','manifestHash','successfulSlots'], ['failedSlots']);
      uuid(input.requestId); uuid(input.exportId); hash(input.exportSha256); hash(input.manifestHash);
      requireThat(Array.isArray(input.successfulSlots) && input.successfulSlots.length <= 50
        && (input.failedSlots === undefined || Array.isArray(input.failedSlots) && input.failedSlots.length <= 50), 400, 'LABEL_PRINT_SLOTS_INVALID');
      await checkedExport(staff, { exportId: input.exportId, sheetId: uuid(sheetId) });
      return repository.confirmPrint(staff, input);
    },
    async retryLayout(staff, itemId, input) {
      exact(input, ['requestId','expectedFailureHash','expectedRendererProfileHash']); uuid(input.requestId); uuid(itemId);
      hash(input.expectedFailureHash); hash(input.expectedRendererProfileHash);
      const item = await repository.item(staff, itemId);
      const { packet } = await finishing.loadPacket(staff, item.card_id, item.action_id);
      const material = materials[packet.report.cardProfile];
      requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
      return repository.retryLayout(staff, itemId, input, { rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH,materialProfileId:material.id,jigHash });
    },
    reprint(staff, itemId, input) {
      exact(input, ['requestId','expectedLabelHash','reason']); uuid(input.requestId); uuid(itemId); hash(input.expectedLabelHash);
      requireThat(typeof input.reason === 'string' && input.reason.trim() === input.reason && input.reason.length > 0 && input.reason.length <= 500, 400, 'LABEL_REPRINT_REASON_REQUIRED');
      return repository.reprint(staff, itemId, input);
    },
    async refreshLayout(staff, itemId, input) {
      exact(input, ['requestId','expectedLabelHash','expectedRendererProfileHash']); uuid(input.requestId); uuid(itemId);
      hash(input.expectedLabelHash); hash(input.expectedRendererProfileHash);
      const original = await repository.item(staff, itemId);
      const { packet } = await finishing.loadPacket(staff, original.card_id, original.action_id);
      assertLabelRefreshSnapshot(original, packet);
      const material = materials[packet.report.cardProfile];
      requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
      return repository.refreshLayout(staff, itemId, input,
        { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH, materialProfileId: material.id, jigHash });
    },
    runPending({ limit = 4 } = {}) {
      if (running) return running;
      running = (async () => {
        const candidates = await repository.pendingCandidates(limit, { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH }); let count = 0;
        for (const candidate of candidates) {
          try { const staff = boundary.machineOwner({ ownerId: candidate.actor_id, accessVersion: candidate.access_version });
            if (await (candidate.kind === 'ITEM' ? renderItem(staff, candidate.id)
              : candidate.kind === 'LAYOUT_RECOVERY' ? recoverLayout(staff, candidate.id) : renderExport(staff, candidate.id))) count++; }
          catch { /* Durable bounded state records failure; never emit SVG, identity, URL or native errors. */ }
        }
        return count;
      })().finally(() => { running = null; });
      return running;
    },
  });
}
