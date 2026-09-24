import { createHash } from 'node:crypto';
import { validateManualLabel, CURRENT_LABEL_LAYOUT } from './label.mjs';
import { DEFAULT_LABEL_DESIGN } from './label-design.mjs';

const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const assert = (ok, code = 'MANUAL_FINISHING_SOURCE_INVALID') => { if (!ok) throw new Error(code); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Server only. The caller authenticates current card access and loads the exact
 * immutable approval + PUBLISHED packet. Never pass request-body authority.
 * This prepares physical work; it neither allocates a certificate nor performs it.
 */
export function createManualFinishingPlan({ cardId, approvalActionId, sourceRevision, sourceHash, packet, publicHash }) {
  assert(UUID.test(cardId) && UUID.test(approvalActionId) && Number.isSafeInteger(sourceRevision) && sourceRevision > 0 && SHA.test(sourceHash));
  assert(packet?.version === 'atlas-public-manual-report-v2' && SHA.test(publicHash)
    && hash(JSON.stringify(packet)) === publicHash, 'MANUAL_FINISHING_PUBLIC_HASH_MISMATCH');
  assert(SHA.test(packet.reportHash) && packet.report?.version === 'atlas-manual-draft-report-v2'
    && packet.report.finalGradePolicy === 'atlas-final-half-point-v1'
    && Number.isFinite(packet.report.grade?.overall?.rawGrade)
    && packet.report.finalGrade === Math.round(packet.report.grade.overall.rawGrade * 2) / 2);
  const label = validateManualLabel({ version: 'atlas-manual-label-v1', layoutVersion: CURRENT_LABEL_LAYOUT, design: { ...DEFAULT_LABEL_DESIGN }, mode: packet.mode,
    cardProfile: packet.report.cardProfile, identity: structuredClone(packet.report.identity), finalGrade: packet.report.finalGrade,
    finalGradePolicy: packet.report.finalGradePolicy, publicToken: packet.publicToken, reportNumber: packet.reportNumber,
    approvalVersion: packet.approvalVersion, url: `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}` });
  const binding = { cardId, approvalActionId, sourceRevision, sourceHash, reportHash: packet.reportHash, publicHash,
    publicToken: packet.publicToken, reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion };
  const planHash = hash(stable({ version: 'atlas-manual-finishing-plan-v1', binding, label }));
  return freeze({ version: 'atlas-manual-finishing-plan-v1', id: `afp_${planHash}`, planHash, binding, label,
    print: { intentId: `afprint_${planHash}`, layoutVersion: label.layoutVersion, physicalSizeInches: { width: 2.73, height: 0.83 }, faces: ['FRONT', 'REVERSE'] },
    nfc: { intentId: `afnfc_${planHash}`, url: label.url, requiredProfile: 'atlas-mac-f8215-production-v1', requiresQualification: true },
  });
}

export function validateManualFinishingPlan(plan) {
  assert(plan?.version === 'atlas-manual-finishing-plan-v1' && SHA.test(plan.planHash));
  validateManualLabel(plan.label);
  const binding = plan.binding;
  assert(binding && UUID.test(binding.cardId) && UUID.test(binding.approvalActionId) && Number.isSafeInteger(binding.sourceRevision) && binding.sourceRevision > 0
    && ['sourceHash', 'reportHash', 'publicHash'].every(key => SHA.test(binding[key]))
    && ['publicToken', 'reportNumber', 'approvalVersion'].every(key => binding[key] === plan.label[key]));
  assert(hash(stable({ version: plan.version, binding: plan.binding, label: plan.label })) === plan.planHash
    && plan.id === `afp_${plan.planHash}` && plan.print?.intentId === `afprint_${plan.planHash}`
    && plan.print.layoutVersion === plan.label.layoutVersion && plan.print.physicalSizeInches?.width === 2.73 && plan.print.physicalSizeInches?.height === 0.83
    && JSON.stringify(plan.print.faces) === '["FRONT","REVERSE"]'
    && plan.nfc?.intentId === `afnfc_${plan.planHash}` && plan.nfc.url === plan.label.url
    && plan.nfc.requiredProfile === 'atlas-mac-f8215-production-v1' && plan.nfc.requiresQualification === true);
  return plan;
}
