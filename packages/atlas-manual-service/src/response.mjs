/** Browser-safe wire contract. Whitespace is transport liveness only; the
 * complete terminal envelope owns the result and its actual HTTP status. */
export const MANUAL_STREAM_HEADER = 'x-atlas-manual-stream';
export const MANUAL_STREAM_PROTOCOL = 'atlas-manual-response-v1';

/** Revoked browser access must also release private in-memory image grants.
 * Server callers have no window and ordinary validation errors retain work. */
export function notifyManualAccessFailure(status, code) {
  if (status === 401 || ['SIGN_IN_REQUIRED', 'MANUAL_STAFF_CHANGED', 'STAFF_ACCESS_NOT_ENABLED'].includes(code)) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function')
      window.dispatchEvent(new Event('atlas:verified-image-access-ended'));
  }
}

export async function readManualResponse(response) {
  // HTTP 401 is authoritative even when a proxy supplied an empty or malformed body.
  const accessDenied = response.status === 401;
  if (accessDenied) notifyManualAccessFailure(401);
  let body = await response.json(), status = response.status;
  const protocol = response.headers?.get?.(MANUAL_STREAM_HEADER);
  if (!Number.isInteger(status) || status < 200 || status >= 600
    || protocol == null && body?.protocol === MANUAL_STREAM_PROTOCOL)
    throw Object.assign(new Error('Save outcome unknown'), { code: 'MANUAL_RESPONSE_INVALID' });
  if (protocol != null) {
    if (protocol !== MANUAL_STREAM_PROTOCOL || response.status !== 200
      || !body || body.protocol !== MANUAL_STREAM_PROTOCOL
      || Object.keys(body).sort().join(',') !== 'body,protocol,status'
      || !Number.isInteger(body.status) || body.status < 200 || body.status >= 600
      || body.status >= 300 && body.status < 400
      || !body.body || typeof body.body !== 'object' || Array.isArray(body.body))
      throw Object.assign(new Error('Save outcome unknown'), { code: 'MANUAL_RESPONSE_INVALID' });
    status = body.status; body = body.body;
  }
  if (status < 200 || status >= 300) {
    if (!accessDenied) notifyManualAccessFailure(status, body?.error);
    throw Object.assign(new Error(body?.error ?? 'Save unavailable'), { status, code: body?.error, fields: body?.fields,
      ...(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body?.reference ?? '')
        ? { reference: body.reference } : {}) });
  }
  return body;
}
