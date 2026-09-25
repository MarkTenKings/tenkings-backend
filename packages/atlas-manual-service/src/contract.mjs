import { createHash } from 'node:crypto';

export class ManualServiceError extends Error {
  constructor(status, code) { super(code); this.name = 'ManualServiceError'; this.status = status; this.code = code; }
}
export function requireThat(ok, status = 400, code = 'MANUAL_REQUEST_INVALID') {
  if (!ok) throw new ManualServiceError(status, code);
}
export function object(value, keys) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export function uuid(value) {
  requireThat(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
  return value;
}
export function revision(value) { requireThat(Number.isSafeInteger(value) && value > 0 && value < 2147483647); return value; }
export const digest = value => createHash('sha256').update(value).digest('hex');
/** P2028 text may contain SQL, URLs or credentials. Only known failure kinds
 * and bounded duration integers may cross a diagnostic boundary. This does not
 * classify retryability or change transaction/authentication deadlines. */
export function safeTransactionDiagnostic(error) {
  try {
    if (error?.code !== 'P2028') return {};
    const categories = ['START_WAIT', 'ACTIVE_TIMEOUT', 'CLOSED', 'UNKNOWN'];
    const duration = value => Number.isSafeInteger(value) && value >= 0 && value <= 86400000;
    const texts = [error?.meta?.error, error.message].filter(value => typeof value === 'string' && value.length <= 8192);
    let category;
    for (const text of texts) {
      if (/Unable to start a transaction in the given time\./i.test(text)) { category = 'START_WAIT'; break; }
      if (/Transaction already closed:[^\r\n]{0,256}\bexpired transaction\b/i.test(text)) { category = 'ACTIVE_TIMEOUT'; break; }
      if (/Transaction already closed/i.test(text)) category ??= 'CLOSED';
    }
    category ??= categories.includes(error.transactionFailureCategory) ? error.transactionFailureCategory : 'UNKNOWN';
    const result = { transactionFailureCategory: category };
    if (category === 'ACTIVE_TIMEOUT') {
      const match = texts.map(text => /The timeout for this transaction was (\d{1,8}) ms, however (\d{1,8}) ms passed since the start of the transaction\b/i.exec(text)).find(Boolean);
      if (match) {
        if (duration(Number(match[1]))) result.transactionTimeoutMs = Number(match[1]);
        if (duration(Number(match[2]))) result.transactionElapsedMs = Number(match[2]);
      } else {
        // A worker may already have removed the original exception text.
        for (const key of ['transactionTimeoutMs', 'transactionElapsedMs']) {
          if (duration(error[key])) result[key] = error[key];
        }
      }
    }
    return result;
  } catch { return {}; } // Diagnostic getters cannot interrupt durable recovery.
}
const forbidden = /^(?:actor|actorId|actorKind|principal|sessionHash|authority)$/i;
const binary = /^(?:bytes|pixels|bitmap|mask|rle|traceBitmap|traceWire|maskRle)$/i;

/** JSON only, finite depth/size, no binary photo/mask payloads or expiring URLs.
 * Geometry provenance may contain actor labels, so authority filtering applies
 * to public action envelopes separately, never to persisted domain history.
 */
export function canonical(value, { maxBytes = 262144, publicAction = false } = {}) {
  const visit = (entry, depth) => {
    requireThat(depth <= 40, 413, 'MANUAL_DOCUMENT_TOO_LARGE');
    if (entry === null || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') { requireThat(Number.isFinite(entry)); return JSON.stringify(entry); }
    if (typeof entry === 'string') {
      requireThat(entry.length <= 8192 && !/^data:|^https?:.*[?&](?:x-amz-|signature|token=)/i.test(entry), 413, 'MANUAL_OBJECT_REFERENCE_REQUIRED');
      return JSON.stringify(entry);
    }
    if (Array.isArray(entry)) return `[${entry.map(item => visit(item, depth + 1)).join(',')}]`;
    requireThat(entry && Object.getPrototypeOf(entry) === Object.prototype);
    const keys = Object.keys(entry).sort();
    for (const key of keys) {
      requireThat(!binary.test(key), 413, 'MANUAL_OBJECT_REFERENCE_REQUIRED');
      if (publicAction) requireThat(!forbidden.test(key), 400, 'MANUAL_CLIENT_AUTHORITY_FORBIDDEN');
    }
    return `{${keys.map(key => `${JSON.stringify(key)}:${visit(entry[key], depth + 1)}`).join(',')}}`;
  };
  const result = visit(value, 0);
  requireThat(Buffer.byteLength(result) <= maxBytes, 413, 'MANUAL_DOCUMENT_TOO_LARGE');
  return result;
}
export function inputCommand(input) {
  object(input, ['actionId', 'expectedRevision', 'action']);
  uuid(input.actionId); revision(input.expectedRevision);
  requireThat(input.action && Object.getPrototypeOf(input.action) === Object.prototype
    && typeof input.action.type === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(input.action.type));
  const text = canonical(input, { maxBytes: 65536, publicAction: true });
  return { input: JSON.parse(text), requestHash: digest(text) };
}
export function stateDocument(draft) {
  const text = canonical(draft); requireThat(draft && !Array.isArray(draft));
  return { text, hash: digest(text), draft: JSON.parse(text) };
}
export function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
