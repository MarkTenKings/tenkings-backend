import { canonical, digest, object, requireThat, uuid, revision } from '@atlas/manual-service/contract';
import { renderLabelV4, renderLabelV4Png } from '@atlas/finishing/label-v4';
import { renderLabelSheetPng, LABEL_EXPORT_PROFILE_V1, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1 } from '@atlas/finishing/label-sheet';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
const jigHash = LABEL_JIG_V1.jigHash;

export const LABEL_EXPORT_PROFILES = Object.freeze({ SHEET: LABEL_EXPORT_PROFILE_V1.id, SINGLE: LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.id });
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
    const claimed = await repository.claimItem(staff, id); if (!claimed) return false;
    try {
      // This adapter proves exact approval/action/draft lineage and reauthenticates
      // after the immutable public packet is read from object storage.
      const { packet, row } = await finishing.loadPacket(staff, claimed.card_id, claimed.action_id);
      let result;
      if (claimed.purpose === 'REPRINT') {
        const original = await repository.item(staff, claimed.original_item_id);
        requireThat(original.state === 'READY' && original.snapshot && digest(original.print_svg) === original.artwork_hash, 409, 'LABEL_REPRINT_SOURCE_INVALID');
        result = { state: 'READY', snapshot: JSON.parse(original.snapshot), printSvg: original.print_svg, previewSvg: original.preview_svg,
          artworkHash: original.artwork_hash, rendererProfileHash: original.renderer_profile_hash, materialProfileId: original.material_profile_id, jigHash: original.jig_hash };
      } else {
        const report = packet.report, material = materials[report.cardProfile];
        requireThat(material && ['gold','holo'].includes(material.preview), 503, 'LABEL_MATERIAL_UNCONFIGURED');
        const rendered = await renderer.label({ identity: report.identity, finalGrade: report.finalGrade,
          reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion, cardProfile: report.cardProfile }, { previewMaterial: material.preview });
        result = { ...rendered, code: rendered.diagnostics?.code ?? 'LABEL_NEEDS_LAYOUT', materialProfileId: material.id, jigHash,
          snapshot: { identity: report.identity, grade: report.finalGrade, finalGrade: report.finalGrade, cardProfile: report.cardProfile,
            reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion, reportHref: `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}`,
            previewMaterial: material.preview, source: rendered.source, diagnostics: rendered.diagnostics ?? [] } };
      }
      await repository.finishItem(staff, claimed, { ...result, row }); return true;
    } catch (error) { await repository.failItem(staff, claimed); throw error; }
  }
  async function renderExport(staff, id) {
    const claimed = await repository.claimExport(staff, id); if (!claimed) return false;
    try {
      const labels = claimed.items.map(item => {
        requireThat(digest(item.print_svg) === item.artwork_hash, 503, 'LABEL_ARTWORK_INVALID');
        return { slot: claimed.row.kind === 'SHEET' ? item.slot : 1, artworkHash: item.artwork_hash, printSvg: item.print_svg };
      });
      const result = claimed.row.kind === 'SHEET' ? await renderer.sheet(labels, { exportProfileId: claimed.row.profile_id }) : await renderer.individual(labels[0]);
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
    list: (staff, options) => repository.list(staff, options),
    sheet: (staff, sheetId) => repository.sheet(staff, uuid(sheetId)),
    reconciliation: (staff, input) => repository.reconciliation(staff, input),
    async artwork(staff, { itemId, mode = 'preview' }) {
      requireThat(['preview','print'].includes(mode), 400, 'LABEL_ARTWORK_MODE_INVALID');
      const item = await repository.item(staff, uuid(itemId)); requireThat(item.state === 'READY', 409, 'LABEL_NOT_READY');
      const svg = mode === 'print' ? item.print_svg : item.preview_svg;
      requireThat(typeof svg === 'string' && Buffer.byteLength(svg) <= 1048576 && digest(item.print_svg) === item.artwork_hash, 503, 'LABEL_ARTWORK_INVALID');
      return { bytes: Buffer.from(svg), contentType: 'image/svg+xml', sha256: digest(svg) };
    },
    prepareSheetExport(staff, sheetId, input) {
      exact(input, ['requestId','expectedSheetRevision','exportProfileId']); uuid(input.requestId); revision(input.expectedSheetRevision); uuid(sheetId);
      requireThat(input.exportProfileId === LABEL_EXPORT_PROFILES.SHEET, 400, 'LABEL_PROFILE_INVALID');
      return repository.prepareExport(staff, { kind: 'SHEET', id: sheetId, input });
    },
    prepareIndividualExport(staff, itemId, input) {
      exact(input, ['requestId','expectedLabelHash','exportProfileId']); uuid(input.requestId); hash(input.expectedLabelHash); uuid(itemId);
      requireThat(input.exportProfileId === LABEL_EXPORT_PROFILES.SINGLE, 400, 'LABEL_PROFILE_INVALID');
      return repository.prepareExport(staff, { kind: 'SINGLE', id: itemId, input });
    },
    async exportStatus(staff, target) { return (await checkedExport(staff, target, false)).view; },
    async download(staff, { input, ...target }) {
      exact(input, ['requestId','expectedExportSha256']); uuid(input.requestId); hash(input.expectedExportSha256);
      const { row } = await checkedExport(staff, target);
      requireThat(row.state === 'READY' && row.sha256 === input.expectedExportSha256, 409, 'LABEL_EXPORT_NOT_READY');
      const result = await storage.download(binding(row), { object: JSON.parse(row.object_ref), sha256: row.sha256, byteCount: row.byte_count, contentType: row.content_type });
      const after = await checkedExport(staff, target); requireThat(after.row.sha256 === row.sha256, 409, 'LABEL_EXPORT_CHANGED');
      return result;
    },
    async confirmPrint(staff, sheetId, input) {
      exact(input, ['requestId','exportId','exportSha256','manifestHash','successfulSlots'], ['failedSlots']);
      uuid(input.requestId); uuid(input.exportId); hash(input.exportSha256); hash(input.manifestHash);
      requireThat(Array.isArray(input.successfulSlots) && input.successfulSlots.length <= 50
        && (input.failedSlots === undefined || Array.isArray(input.failedSlots) && input.failedSlots.length <= 50), 400, 'LABEL_PRINT_SLOTS_INVALID');
      await checkedExport(staff, { exportId: input.exportId, sheetId: uuid(sheetId) });
      return repository.confirmPrint(staff, input);
    },
    reprint(staff, itemId, input) {
      exact(input, ['requestId','expectedLabelHash','reason']); uuid(input.requestId); uuid(itemId); hash(input.expectedLabelHash);
      requireThat(typeof input.reason === 'string' && input.reason.trim() === input.reason && input.reason.length > 0 && input.reason.length <= 500, 400, 'LABEL_REPRINT_REASON_REQUIRED');
      return repository.reprint(staff, itemId, input);
    },
    runPending({ limit = 4 } = {}) {
      if (running) return running;
      running = (async () => {
        const candidates = await repository.pendingCandidates(limit); let count = 0;
        for (const candidate of candidates) {
          try { const staff = boundary.machineOwner({ ownerId: candidate.actor_id, accessVersion: candidate.access_version });
            if (await (candidate.kind === 'ITEM' ? renderItem(staff, candidate.id) : renderExport(staff, candidate.id))) count++; }
          catch { /* Durable bounded state records failure; never emit SVG, identity, URL or native errors. */ }
        }
        return count;
      })().finally(() => { running = null; });
      return running;
    },
  });
}
