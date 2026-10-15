// One explicit paid Photoroom edit; no database, worker or production storage.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createReportImageProvider } from '../src/report-image-provider.mjs';
const args = process.argv.slice(2), allowed = new Set(['--ack-paid-image-edit', '--source', '--source-sha256', '--content-type', '--output']);
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  assert(allowed.has(args[i]) && !seen.has(args[i]), 'Unknown or repeated canary argument'); seen.add(args[i]);
  if (args[i] !== '--ack-paid-image-edit') assert(args[++i] && !args[i].startsWith('--'));
}
assert(args.includes('--ack-paid-image-edit'), 'Explicit paid edit acknowledgement required');
const option = name => { const i = args.indexOf(name); assert(i >= 0 && args[i + 1], `${name} required`); return args[i + 1]; };
const source = resolve(option('--source')), output = resolve(option('--output')), bytes = await readFile(source), expected = option('--source-sha256');
assert.equal(digest(bytes), expected, 'Exact approved source SHA required');
const provider = createReportImageProvider({ apiKey: process.env.ATLAS_PHOTOROOM_API_KEY });
const input = { bytes, sourceSha256: expected, contentType: option('--content-type') };
const sourceValidation = await provider.validateInput(input);
await mkdir(output, { recursive: true, mode: 0o700 });
const requestId = randomUUID();
// A retained request fences re-running this output directory, including after a
// lost response. Inspect its receipt; never silently buy another removal.
await writeFile(join(output, 'request.json'), JSON.stringify({ requestId, sourceSha256: expected, recipe: provider.recipe,
  source: sourceValidation, state: 'REQUESTED', at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
try {
  const result = await provider.edit({ ...input, width: sourceValidation.width, height: sourceValidation.height, requestId });
  await writeFile(join(output, 'receipt.json'), JSON.stringify(result.receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, 'response.png'), result.bytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, 'validation.json'), JSON.stringify(result.output, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ status: 'IMAGE_BYTES_QUALIFIED', requestId, output, ...result.output,
    visualAcceptance: 'REQUIRES_REVIEW', productionWrites: false }));
} catch (error) {
  // The original response remains reviewable even when strict fidelity rejects
  // it. These files are evidence only; no rejected PNG is installed for grading.
  if (error.receipt) await writeFile(join(output, 'receipt.json'), JSON.stringify(error.receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  if (Buffer.isBuffer(error.responseBytes)) await writeFile(join(output, 'response.png'), error.responseBytes, { mode: 0o600, flag: 'wx' });
  const record = { requestId, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'REPORT_IMAGE_CANARY_FAILED',
    disposition: error.disposition ?? 'FAILED', receipt: error.receipt ?? null, validation: error.validation ?? null, productionWrites: false };
  await writeFile(join(output, 'failure.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.error(JSON.stringify(record)); process.exitCode = 1;
}
