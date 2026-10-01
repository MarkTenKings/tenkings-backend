// One explicit paid edit; no database, worker activation, or production storage.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createReportImageProvider } from '../src/report-image-provider.mjs';
import { inspectReportImage } from '../src/report-images.mjs';
const args = process.argv.slice(2), allowed = new Set(['--ack-paid-image-edit','--source','--source-sha256','--content-type','--output']);
for (let i = 0; i < args.length; i++) { assert(allowed.has(args[i]), 'Unknown canary argument'); if (args[i] !== '--ack-paid-image-edit') assert(args[++i] && !args[i].startsWith('--')); }
assert(args.includes('--ack-paid-image-edit'), 'Explicit paid edit acknowledgement required');
const option = name => { const i = args.indexOf(name); assert(i >= 0 && args[i + 1], `${name} required`); return args[i + 1]; };
const source = resolve(option('--source')), output = resolve(option('--output')), bytes = await readFile(source), expected = option('--source-sha256');
assert.equal(digest(bytes), expected, 'Exact approved source SHA required');
await mkdir(output, { recursive: true, mode: 0o700 });
const provider = createReportImageProvider({ apiKey: process.env.ATLAS_MANUAL_REPORT_IMAGES_OPENAI_KEY ?? process.env.ATLAS_MANUAL_OPENAI_KEY });
const requestId = randomUUID();
await writeFile(join(output, `${requestId}.request.json`), JSON.stringify({ requestId, sourceSha256: expected, recipe: provider.recipe,
  state: 'REQUESTED', at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
try {
  const result = await provider.edit({ bytes, sourceSha256: expected, contentType: option('--content-type'), requestId });
  // Save the known paid receipt even if downstream image qualification fails.
  await writeFile(join(output, `${requestId}.receipt.json`), JSON.stringify(result.receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, `${requestId}.png`), result.bytes, { mode: 0o600, flag: 'wx' });
  const validation = await inspectReportImage(result.bytes);
  await writeFile(join(output, `${requestId}.validation.json`), JSON.stringify(validation, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: 'IMAGE_BYTES_QUALIFIED', requestId, output, ...validation,
    visualAcceptance: 'REQUIRES_REVIEW', productionWrites: false }));
} catch (error) {
  const record = { requestId, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'REPORT_IMAGE_CANARY_FAILED',
    disposition: error.disposition ?? 'FAILED', receipt: error.receipt ?? null };
  await writeFile(join(output, `${requestId}.failure.json`), JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.error(JSON.stringify(record)); process.exitCode = 1;
}
