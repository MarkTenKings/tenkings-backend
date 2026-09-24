/** Browser-safe wire contract. Whitespace is transport liveness only; the
 * complete terminal envelope owns the result and its actual HTTP status. */
export const MANUAL_STREAM_HEADER = 'x-atlas-manual-stream';
export const MANUAL_STREAM_PROTOCOL = 'atlas-manual-response-v1';

export async function readManualResponse(response) {
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
  if (status < 200 || status >= 300)
    throw Object.assign(new Error(body?.error ?? 'Save unavailable'), { status, code: body?.error, fields: body?.fields });
  return body;
}
