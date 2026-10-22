import { requireValue } from './contract.mjs';

const contexts = new WeakSet();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SYNTHETIC = 'SYNTHETIC_LOCAL';
function branded(value) { contexts.add(value); return Object.freeze(value); }
const local = branded({ environment: SYNTHETIC, evidenceOrigin: null, evidencePathPrefixes: Object.freeze(['/demo/']), qualificationRefs: null });

/** Server-only configuration value, never reconstructed from an HTTP body or
 * persisted JSON. Qualification references are required inputs, not proof of
 * those approvals; the service must independently gate each authority port.
 */
export function createAuthorityContext({ environment = SYNTHETIC, evidenceOrigin, evidencePathPrefixes, qualificationRefs } = {}) {
  requireValue(['SYNTHETIC_LOCAL', 'PROVIDER_SANDBOX', 'PRODUCTION'].includes(environment), 'AUTHORITY_CONTEXT_INVALID');
  if (environment === SYNTHETIC) {
    requireValue(evidenceOrigin === undefined && evidencePathPrefixes === undefined && qualificationRefs === undefined, 'AUTHORITY_CONTEXT_INVALID');
    return local;
  }
  let origin;
  try { origin = new URL(evidenceOrigin); } catch { requireValue(false, 'AUTHORITY_CONTEXT_INVALID'); }
  requireValue(origin.protocol === 'https:' && origin.origin === evidenceOrigin && !origin.username && !origin.password && !origin.hash && !origin.search, 'AUTHORITY_CONTEXT_INVALID');
  requireValue(Array.isArray(evidencePathPrefixes) && evidencePathPrefixes.length > 0 && evidencePathPrefixes.length <= 8 && evidencePathPrefixes.every(path => typeof path === 'string' && /^\/[A-Za-z0-9_/-]+\/$/.test(path) && !path.includes('//') && !path.startsWith('/demo/')), 'AUTHORITY_CONTEXT_INVALID');
  const refs = ['fingerprintRef', 'titlePolicyRef', 'marketplacePolicyRef', 'evidenceContractRef'];
  requireValue(qualificationRefs && Object.keys(qualificationRefs).length === refs.length && refs.every(key => typeof qualificationRefs[key] === 'string' && qualificationRefs[key].trim() === qualificationRefs[key] && qualificationRefs[key].length > 0 && qualificationRefs[key].length <= 500), 'AUTHORITY_QUALIFICATION_REQUIRED');
  return branded({ environment, evidenceOrigin, evidencePathPrefixes: Object.freeze([...evidencePathPrefixes]), qualificationRefs: Object.freeze({ ...qualificationRefs }) });
}

export function authorityContext(value) {
  if (value === undefined || value === null) return local;
  requireValue(contexts.has(value), 'UNTRUSTED_AUTHORITY_CONTEXT', 'Only server-created authority configuration may select the domain environment.');
  return value;
}
export const contextFor = tx => authorityContext(tx?.context);

export function domainId(value, label = 'identifier', suppliedContext) {
  const context = authorityContext(suppliedContext);
  if (context.environment === SYNTHETIC) {
    requireValue(typeof value === 'string' && /^demo_[a-zA-Z0-9_-]{1,100}$/.test(value), 'SYNTHETIC_ID_REQUIRED', `${label} must identify an explicit local synthetic fixture.`);
  } else {
    requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) && !value.startsWith('demo_') && !['constructor', 'prototype'].includes(value), 'DOMAIN_ID_INVALID', `${label} must be a retained non-synthetic identifier.`);
  }
  return value;
}
export function authorityId(value, label, suppliedContext) {
  const context = authorityContext(suppliedContext);
  if (context.environment === SYNTHETIC) return domainId(value, label, context);
  requireValue(typeof value === 'string' && UUID.test(value), 'AUTHORITY_ID_INVALID', `${label} must retain its approved UUID.`);
  return value;
}
export function approvedEvidenceUrl(value, suppliedContext) {
  const context = authorityContext(suppliedContext);
  if (context.environment === SYNTHETIC) {
    requireValue(typeof value === 'string' && /^\/demo\/[a-zA-Z0-9_./?-]+$/.test(value) && !value.includes('..'), 'EVIDENCE_URL_INVALID', 'Synthetic evidence must stay on the local demo route.');
    return value;
  }
  requireValue(typeof value === 'string' && value.length <= 2000 && !/[\s\\%]/.test(value) && !value.includes('..') && !value.startsWith('//'), 'EVIDENCE_URL_INVALID');
  let url;
  try { url = new URL(value, context.evidenceOrigin); } catch { requireValue(false, 'EVIDENCE_URL_INVALID'); }
  requireValue(url.origin === context.evidenceOrigin && !url.username && !url.password && !url.hash && context.evidencePathPrefixes.some(path => url.pathname.startsWith(path)), 'EVIDENCE_URL_INVALID', 'Approved evidence must remain on the exact server-pinned origin and route.');
  return value;
}
