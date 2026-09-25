// Explicit, offline throughput measurement. Original files/manifest stay out of
// Git. Repeated fixtures do not represent distinct cards or provider capacity.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto } from '../../packages/atlas-photo-runtime/src/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = process.env.ATLAS_BENCH_ORIGINALS, output = process.env.ATLAS_SCALABLE_EVIDENCE;
assert(manifestPath && resolve(manifestPath) === manifestPath && output && resolve(output) === output);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert(Array.isArray(manifest) && manifest.length > 0 && manifest.length <= 25);
const originals = await Promise.all(manifest.map(async value => {
  assert(resolve(value.path) === value.path && /^[a-f0-9]{64}$/.test(value.sha256));
  const bytes = await readFile(value.path); assert.equal(sha(bytes), value.sha256);
  return { bytes, sha256: value.sha256 };
}));
const limits = { maxInputBytes: 100000000, maxPixels: 52000000, maxRasterBytes: 512 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024, timeoutMs: 90000 };
const count = 25, concurrency = 2, results = [], start = performance.now();
let index = 0, parentPeakRssBytes = 0;
const sample = setInterval(() => { parentPeakRssBytes = Math.max(parentPeakRssBytes, process.memoryUsage().rss); }, 50);
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < count) {
      const ordinal = index++, input = originals[ordinal % originals.length], began = performance.now();
      const key = `offline-benchmark/original/${ordinal}`;
      const plan = { schemaVersion: 1, uploadId: randomUUID(), binding: { cardId: randomUUID(), pairId: randomUUID(), side: ordinal % 2 ? 'BACK' : 'FRONT', version: 1 },
        object: { key, versionId: null }, expected: { byteCount: input.bytes.length, sha256: input.sha256 } };
      const decoded = await verifyAndDecodePhoto({ uploadPlan: plan, observedObject: { key, versionId: 'owned-fixture-v1' }, bytes: input.bytes, limits,
        jpegHdrPolicy: 'retain-hdr-use-sdr-base', heicHdrPolicy: 'retain-hdr-use-sdr-base' });
      const decodedMs = performance.now() - began, working = await deriveSdrWorkingPhoto(decoded);
      assert.equal(decoded.original.content.sha256, input.sha256); assert.equal(sha(input.bytes), input.sha256);
      assert.deepEqual(working.raster.dimensions, decoded.raster.dimensions);
      assert(working.raster.dimensions.width * working.raster.dimensions.height >= 12000000, 'Benchmark requires actual full-resolution >=12MP original');
      results.push({ ordinal: ordinal + 1, originalBytes: input.bytes.length, originalSha256: input.sha256,
        dimensions: working.raster.dimensions, decodedMs, totalMs: performance.now() - began,
        workingBytes: working.png.length, originalUnchanged: true });
    }
  }));
} finally { clearInterval(sample); }
const elapsedMs = performance.now() - start;
for (let at = 0; at < originals.length; at++) assert.equal(sha(await readFile(manifest[at].path)), originals[at].sha256);
const sorted = results.map(row => row.totalMs).sort((a, b) => a - b);
const result = { status: 'PASS', at: new Date().toISOString(), platform: platform(), arch: arch(), node: process.version,
  cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, tasks: count, distinctOriginals: originals.length, concurrency,
  elapsedMs, imagesPerMinute: count * 60000 / elapsedMs, target25ImagesPerMinuteMetOnThisMachine: elapsedMs <= 60000,
  p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], parentPeakRssBytes,
  networkCalls: 0, providerCalls: 0, databaseWrites: 0,
  limitations: ['Offline decoding plus full-dimension working-image conversion only; no upload, object storage, geometry, OCR or grading.',
    'Repeated retained originals are controlled work items, not 25 distinct cards.', 'Desktop CPU and memory are not the production container allocation.',
    'Sampled RSS covers the parent only; disposable decoder child memory is not included.'], results: results.sort((a, b) => a.ordinal - b.ordinal) };
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(join(output, 'full-resolution-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: result.status, tasks: count, distinctOriginals: originals.length, elapsedMs, imagesPerMinute: result.imagesPerMinute, output }));
