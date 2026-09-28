// Offline qualification only. The manifest and complete originals stay private;
// this command has no storage/database/provider adapter or network capability.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { inspectContainer } from '../src/container.mjs';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame, createReviewDisplay } from '../src/index.mjs';
import { orient } from '../test/helpers.mjs';
const [manifestPath, outputPath, fixtureDirectory] = process.argv.slice(2);
assert(manifestPath && outputPath, 'Usage: qualify-retained-jpegs.mjs private-manifest.json new-result.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = { maxInputBytes: 256 * 1024 * 1024, maxPixels: 52_000_000, maxRasterBytes: 512 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024, timeoutMs: 90000 };
const rows = JSON.parse(await readFile(manifestPath, 'utf8')), results = [];
assert.equal(rows.length, 3);
const fixtures=[];
if(fixtureDirectory)await mkdir(fixtureDirectory,{mode:0o700});
for (const row of rows) {
  const bytes = await readFile(row.path), started = performance.now();
  assert.equal(bytes.length, row.byteCount); assert.equal(sha(bytes), row.sha256);
  const inspected = inspectContainer(bytes, { allowAppleJpegSdrBase: true });
  assert(inspected.jpegHdr); const base = bytes.subarray(0, inspected.jpegHdr.selection.primaryByteCount);
  const metadata = await sharp(base).metadata();
  // Independent orientation permutation. RGB comes only from the separately
  // bounded SDR primary; the actual runtime separately validates gain-map bytes.
  const unoriented = await sharp(base).pipelineColourspace('srgb').withIccProfile('srgb').toColourspace('srgb').raw().toBuffer();
  const expected = orient(unoriented, metadata.width, metadata.height, 3, metadata.orientation ?? 1);
  const decoded = await verifyAndDecodePhoto({ bytes, uploadPlan: row.uploadPlan, observedObject: row.observedObject,
    limits, jpegHdrPolicy: 'retain-hdr-use-sdr-base', heicHdrPolicy: 'retain-hdr-use-sdr-base' });
  const working = await deriveSdrWorkingPhoto(decoded), decodeMs = performance.now() - started;
  assert.equal(sha(bytes), row.sha256); assert.equal(decoded.original.content.sha256, row.sha256);
  assert.equal(decoded.original.metadata.crop, null); assert.equal(decoded.original.metadata.dynamicRange, 'HDR');
  const actual = await sharp(working.png, { ignoreIcc: true }).raw().toBuffer();
  assert.deepEqual(actual, expected); assert.deepEqual(working.raster.dimensions, { width: 3024, height: 4032 });
  const frame = describeDecodedFrame(working, { id: 'offline-qualified', object: { key: 'offline/working.png', versionId: null } });
  const display = await createReviewDisplay({ bytes: working.png, frame, original: working.original, decodePlan: working.decodePlan, limits });
  assert.deepEqual(await sharp(display.full.bytes, { ignoreIcc: true }).raw().toBuffer(), expected);
  if(fixtureDirectory){
    const id=`jpeg-${results.length+1}`,files={};
    for(const kind of ['full','preview']){const path=join(fixtureDirectory,`${id}-${kind}.${kind==='full'?'webp':'jpg'}`);
      await writeFile(path,display[kind].bytes,{flag:'wx',mode:0o600});files[kind]={path,...display[kind].content,...display[kind].dimensions};}
    fixtures.push({id,source:{sha256:sha(working.png),byteCount:working.png.length,...working.raster.dimensions},...files});
  }
  results.push({ originalSha256: row.sha256, originalBytes: bytes.length, originalUnchanged: true,
    dimensions: working.raster.dimensions, orientation: metadata.orientation ?? 1, colorSpace: inspected.jpegHdr.colorSpace,
    treatment: working.treatment, workingSha256: sha(working.png), workingBytes: working.png.length,
    rgbSha256: sha(actual), orientedSdrSampleMismatches: 0, fullDisplaySampleMismatches: 0,
    fullDisplayBytes: display.full.bytes.length, contextBytes: display.preview.bytes.length, decodeAndWorkingMs: Math.round(decodeMs) });
}
const evidence = { status: 'COMPLETE_RETAINED_JPEG_QUALIFICATION_PASS', providerCalls: 0, databaseWrites: 0,
  sourceSha256: sha(await readFile(new URL('../src/jpeg.mjs', import.meta.url))), node: process.version, sharp: sharp.versions,
  results };
await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if(fixtureDirectory)await writeFile(join(fixtureDirectory,'manifest.json'),JSON.stringify({policyVersion:'atlas-review-display-lossless-v1',fixtures},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(evidence));
