// One bounded HTTP operation inside the already authenticated private runtime.
// Called only by the experiment's durable, exclusive dispatch fence. No SDK
// retries, database/storage access, alternate endpoint or application changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = x => createHash('sha256').update(x).digest('hex');
const endpoint = 'https://api.openai.com/v1/responses';
let bytes = 0, chunks = [];
for await (const chunk of process.stdin) { bytes += chunk.length; assert(bytes <= 194 * 1024 * 1024); chunks.push(chunk); }
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); chunks = null;
assert(['POST', 'GET'].includes(input.method));
assert(/^[a-f0-9-]{36}$/.test(input.analysisId)); assert(/^[a-f0-9]{64}$/.test(input.requestHash));
const apiKey = process.env.ATLAS_MANUAL_OPENAI_KEY;
assert.equal(hash(JSON.stringify({ endpoint, projectId: null, keyHash: hash(apiKey) })), input.providerBindingHash, 'provider binding drift');
let body, url = endpoint;
if (input.method === 'POST') {
  body = input.requestText; assert.equal(hash(body), input.requestHash); assert(Buffer.byteLength(body) <= 192 * 1024 * 1024);
  const request = JSON.parse(body);
  assert.equal(request.model, 'gpt-6-astra'); assert.equal(request.reasoning.effort, 'xhigh');
  assert.equal(request.background, true); assert.equal(request.store, false); assert.equal(request.max_output_tokens, 32768);
  assert.deepEqual(Object.keys(request).sort(), ['background','input','max_output_tokens','model','reasoning','store','text'].sort());
  const content = request.input[1].content;
  assert.equal(JSON.parse(content[0].text).analysisId, input.analysisId);
  assert.equal(content.filter(x => x.type === 'input_text' && JSON.parse(x.text).kind === 'CURRENT_CARD').length, 10);
  assert(content.filter(x => x.type === 'input_image').every(x => x.detail === 'original' && x.image_url.startsWith('data:image/png;base64,')));
} else {
  assert(/^resp_[A-Za-z0-9_-]{1,180}$/.test(input.responseId)); url += `/${input.responseId}`;
}
const startedAt = new Date().toISOString();
let result;
try {
  const response = await fetch(url, { method: input.method, redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Client-Request-Id': input.analysisId },
    ...(body ? { body } : {}), signal: AbortSignal.timeout(input.method === 'POST' ? 60000 : 30000) });
  const reader = response.body.getReader(), parts = []; let length = 0;
  while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; assert(length <= 1048576); parts.push(part.value); }
  const received = Buffer.concat(parts), responseText = received.toString('utf8');
  result = { state: 'RECEIVED', startedAt, receivedAt: new Date().toISOString(), httpStatus: response.status,
    providerRequestId: response.headers.get('x-request-id'), responseSha256: hash(received), responseText };
} catch {
  result = { state: 'UNKNOWN', startedAt, receivedAt: new Date().toISOString(), code: 'EXPERIMENT_PROVIDER_OUTCOME_UNKNOWN_NO_REDISPATCH' };
}
process.stdout.write(JSON.stringify({ analysisId: input.analysisId, requestHash: input.requestHash, method: input.method, ...result }));
