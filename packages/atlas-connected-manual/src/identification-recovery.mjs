import { parseCardIdentificationInput, parseCardIdentificationOcrOutput } from '@tenkings/card-identification-core';
import { CARD_IDENTIFICATION_VERSION_V2 } from '@tenkings/card-identification-core/v2';
import { digest, object, requireThat } from '@atlas/manual-service/contract';

const refuse = ok => requireThat(ok, 409, 'IDENTIFICATION_RETRY_NOT_ALLOWED');
function decoded(base64, maximum) {
  refuse(typeof base64 === 'string' && base64.length <= Math.ceil(maximum / 3) * 4);
  const bytes = Buffer.from(base64, 'base64');
  refuse(bytes.length > 0 && bytes.length <= maximum && bytes.toString('base64') === base64);
  return bytes;
}

/** These artifacts have already passed the immutable store's full-byte and
 * lineage checks. Bind their internal envelopes to the exact durable effect. */
export async function recordedIdentificationEffect(row, stage, { events, artifact }) {
  const rows = await events(row);
  const dispatch = rows.find(value => value.stage === stage && value.event === 'DISPATCH');
  const response = rows.find(value => value.stage === stage && value.event === 'RESPONSE');
  refuse(dispatch && response && dispatch.attempt_id === row.id && response.attempt_id === row.id
    && dispatch.request_hash === response.request_hash);
  const request = await artifact(row, 'IDENTIFICATION_REQUEST', JSON.parse(dispatch.evidence));
  object(request, ['engineVersion', 'attemptId', 'stage', 'requestHash', 'requestJson']);
  refuse(request.engineVersion === CARD_IDENTIFICATION_VERSION_V2 && request.attemptId === row.id
    && request.stage === stage && typeof request.requestJson === 'string'
    && digest(request.requestJson) === dispatch.request_hash && request.requestHash === dispatch.request_hash);
  const reply = await artifact(row, 'IDENTIFICATION_RESPONSE', JSON.parse(response.evidence));
  object(reply, ['engineVersion', 'attemptId', 'stage', 'status', 'base64', 'sha256', 'usage']);
  refuse(reply.engineVersion === CARD_IDENTIFICATION_VERSION_V2 && reply.attemptId === row.id
    && reply.stage === stage && Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599);
  const bytes = decoded(reply.base64, 262144);
  refuse(digest(bytes) === reply.sha256);
  return { requestJson: request.requestJson, requestHash: request.requestHash, status: reply.status, bytes };
}

export function isCreditBalanceRejection(reply) {
  if (reply.status !== 429) return false;
  try {
    const body = JSON.parse(reply.bytes.toString('utf8'));
    return body?.error?.type === 'insufficient_quota' && body.error.code === 'credit_balance_exhausted'
      && body.error.param === null;
  } catch { return false; }
}

/** Recovery never infers OCR or substitutes photos. The original model request
 * contains the exact JPEGs whose hashes are in the immutable engine input. */
export async function prepareIdentificationRecovery(row, access, model = null) {
  refuse(row.state === 'UNKNOWN' && row.result === null && row.finished_at != null);
  model ??= await recordedIdentificationEffect(row, 'MODEL', access);
  refuse(isCreditBalanceRejection(model));
  const root = row.evidence_attempt_id ? await access.attempt(row.evidence_attempt_id) : row;
  refuse(root && root.retry_of == null && root.evidence_attempt_id == null
    && root.card_id === row.card_id && root.source_hash === row.source_hash && root.input === row.input);
  const envelope = JSON.parse(root.input);
  object(envelope, ['engineVersion', 'input']);
  refuse(envelope.engineVersion === CARD_IDENTIFICATION_VERSION_V2);
  const input = parseCardIdentificationInput(envelope.input);
  refuse(input.subject.id === row.card_id && input.subject.revision === row.source_hash);
  const original = root.id === row.id ? model : await recordedIdentificationEffect(root, 'MODEL', access);
  refuse(isCreditBalanceRejection(original) && original.requestJson === model.requestJson
    && original.requestHash === model.requestHash);
  const request = JSON.parse(original.requestJson), loaded = new Map(), ocr = {};
  for (const [index, side] of ['front', 'back'].entries()) {
    const part = request?.input?.[0]?.content?.[index * 2 + 1];
    refuse(part?.type === 'input_image' && part.detail === 'high'
      && typeof part.image_url === 'string' && part.image_url.startsWith('data:image/jpeg;base64,'));
    const bytes = decoded(part.image_url.slice('data:image/jpeg;base64,'.length), 3 * 1024 * 1024);
    const photo = input.photos[side];
    refuse(bytes.length === photo.byteCount && digest(bytes) === photo.sha256);
    loaded.set(photo.ref, bytes);
    const reply = await recordedIdentificationEffect(root, `OCR_${side.toUpperCase()}`, access);
    refuse(reply.status >= 200 && reply.status < 300);
    parseCardIdentificationOcrOutput(JSON.parse(reply.bytes.toString('utf8')));
    ocr[side] = reply;
  }
  return { rootId: root.id, loaded, ocr, model: original };
}
