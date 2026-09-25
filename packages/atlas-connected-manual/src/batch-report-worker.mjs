import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildMachineReport } from './batch-preparation.mjs';

const MAX_BYTES = 16 * 1024 * 1024, hash = bytes => createHash('sha256').update(bytes).digest('hex');
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
function requireThat(ok, code = 'BATCH_REPORT_PROTOCOL') { if (!ok) throw Object.assign(new Error(code), { code }); }
async function main() {
  let metadata = '', count = 0;
  for await (const chunk of process.stdin) { count += chunk.length; requireThat(count <= 32768); metadata += chunk.toString('utf8'); }
  const request = JSON.parse(metadata), directory = process.cwd();
  requireThat(Object.keys(request).sort().join(',') === 'inputByteCount,inputPath,inputSha256,outputPath'
    && process.env.TMPDIR === directory && request.inputPath === join(directory, 'input.json')
    && request.outputPath === join(directory, 'output.json') && dirname(request.outputPath) === directory);
  const size = (await stat(request.inputPath)).size;
  requireThat(size > 0 && size <= MAX_BYTES && size === request.inputByteCount, 'BATCH_REPORT_LIMIT');
  const bytes = await readFile(request.inputPath);
  requireThat(bytes.length === size && hash(bytes) === request.inputSha256);
  const input = JSON.parse(bytes.toString('utf8'));
  requireThat(Object.keys(input).sort().join(',') === 'analysis,card,measurementLimits,pythonExecutable,state');
  controller.signal.throwIfAborted();
  const report = await buildMachineReport({ ...input, signal: controller.signal });
  controller.signal.throwIfAborted();
  const output = Buffer.from(JSON.stringify(report));
  requireThat(output.length > 0 && output.length <= MAX_BYTES, 'BATCH_REPORT_LIMIT');
  await writeFile(request.outputPath, output, { flag: 'wx', mode: 0o600 });
  return { ok: true, inputSha256: request.inputSha256,
    output: { filename: 'output.json', byteCount: output.length, sha256: hash(output) } };
}
try { process.stdout.write(JSON.stringify(await main())); }
catch (error) {
  const code = controller.signal.aborted ? 'BATCH_INTERRUPTED'
    : typeof error.code === 'string' && /^(BATCH_|ATLAS_|MEASUREMENT_|MANUAL_)[A-Z0-9_]{1,90}$/.test(error.code) ? error.code : 'BATCH_REPORT_COMPUTE_INVALID';
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
  process.stdout.write(JSON.stringify({ ok: false, code, status }));
}
