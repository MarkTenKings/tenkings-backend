import { parsePublicManualReport } from './manual-public-contract.mjs';

export const APPROVED_FILM_VERSION = 'atlas-approved-film-v1';
export const FILM_TEMPLATE_VERSION = 'atlas-evidence-cinematic-v1';
export const FILM_DURATION = 16;
const HASH = /^[a-f0-9]{64}$/;
export {filmSelector} from './film-selector.mjs';
/** Read-only derivative recipe. No job state, output URL, or fabricated readiness. */
export function createApprovedFilmManifest({ packet: value, publicHash }) {
  const packet = parsePublicManualReport(value);
  if (!HASH.test(publicHash ?? '')) throw new Error('FILM_BINDING_INVALID');
  return { version: APPROVED_FILM_VERSION, templateVersion: FILM_TEMPLATE_VERSION,
    publicHash, packet, duration: FILM_DURATION,
    reportUrl: `/reports/${packet.publicToken}?v=${packet.approvalVersion}` };
}
export function parseApprovedFilmManifest(value, expectedUrl) {
  if (!value || Object.keys(value).sort().join() !== ['version','templateVersion','publicHash','packet','duration','reportUrl'].sort().join()
    || value.version !== APPROVED_FILM_VERSION || value.templateVersion !== FILM_TEMPLATE_VERSION
    || value.duration !== FILM_DURATION) throw new Error('FILM_MANIFEST_INVALID');
  const parsed = createApprovedFilmManifest(value);
  if (value.reportUrl !== parsed.reportUrl || expectedUrl && parsed.reportUrl !== expectedUrl) throw new Error('FILM_BINDING_INVALID');
  return parsed;
}
export function approvedFilmFilename(manifest, extension) {
  if (!['mp4', 'webm'].includes(extension)) throw new Error('FILM_FORMAT_INVALID');
  return `${manifest.packet.reportNumber}-v${manifest.packet.approvalVersion}.${extension}`;
}
