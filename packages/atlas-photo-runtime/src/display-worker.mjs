import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inspectContainer } from './container.mjs';
import { PhotoRuntimeError } from './process.mjs';

const POLICY = 'atlas-review-display-lossless-v1';
const ICC = 'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, code = 'PHOTO_SOURCE_MISMATCH') => { if (!ok) throw new PhotoRuntimeError(code); };

async function display({ inputPath, fullPath, previewPath, source, limits, output = 'both' }) {
  need(['both', 'preview', 'full'].includes(output), 'PHOTO_DECODE_INVALID');
  need((await stat(inputPath)).size <= limits.maxInputBytes, 'PHOTO_DECODE_LIMIT');
  const bytes = await readFile(inputPath);
  need(bytes.length === source.content.byteCount && sha(bytes) === source.content.sha256);
  const container = inspectContainer(bytes);
  need(container.mime === 'image/png' && container.bitDepth === 8, 'PHOTO_COLOR_UNSUPPORTED');
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { throw new PhotoRuntimeError('PHOTO_DECODER_UNAVAILABLE'); }
  need(sharp.versions.sharp === '0.33.5', 'PHOTO_DECODER_UNAVAILABLE');
  sharp.cache(false); sharp.concurrency(1);
  const options = { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true };
  const meta = await sharp(bytes, options).metadata(), { width, height } = source.dimensions;
  need(meta.width === width && meta.height === height && meta.orientation === undefined && (meta.pages ?? 1) === 1);
  need(meta.channels === 3 && !meta.hasAlpha && meta.depth === 'uchar'
    && meta.icc && sha(meta.icc) === ICC, 'PHOTO_COLOR_UNSUPPORTED');
  need(width <= 16383 && height <= 16383 && width * height <= limits.maxPixels
    && width * height * 8 <= limits.maxRasterBytes, 'PHOTO_DECODE_LIMIT');
  async function pixelHash(input) {
    const digest = createHash('sha256'), expected = width * height * 3; let count = 0;
    await pipeline(sharp(input, { ...options, ignoreIcc: true }).raw(), new Writable({ write(data, _encoding, done) {
      count += data.length;
      if (count > expected) { done(new PhotoRuntimeError('PHOTO_SOURCE_MISMATCH')); return; }
      digest.update(data); done();
    } }));
    need(count === expected); return digest.digest('hex');
  }

  let total = 0;
  async function encode(image, path) {
    let count = 0;
    const bounded = new Transform({ transform(data, _encoding, done) {
      count += data.length; total += data.length;
      done(total > limits.maxOutputBytes ? new PhotoRuntimeError('PHOTO_DECODE_LIMIT') : null,
        total > limits.maxOutputBytes ? undefined : data);
    } });
    await pipeline(image, bounded, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    const size = (await stat(path)).size;
    need(size === count && size > 0 && total <= limits.maxOutputBytes, 'PHOTO_DECODE_LIMIT');
    const output = await readFile(path);
    need(output.length === count); return output;
  }
  const result = { ok: true, policyVersion: POLICY, sourceSha256: source.content.sha256 };
  const describe = (data, mime, dimensions) => ({ content: { mime, byteCount: data.length, sha256: sha(data) }, dimensions });
  // A preview-only job never waits for full-size lossless encoding or its RGB
  // comparison. Both jobs verify the exact encoded source and color contract.
  if (output !== 'full') {
    const previewBytes = await encode(sharp(bytes, options).keepIccProfile()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, chromaSubsampling: '4:4:4' }), previewPath);
    const previewMeta = await sharp(previewBytes, options).metadata();
    need(previewMeta.format === 'jpeg' && previewMeta.channels === 3 && !previewMeta.hasAlpha
      && previewMeta.orientation === undefined && (previewMeta.pages ?? 1) === 1
      && previewMeta.icc && sha(previewMeta.icc) === ICC
      && previewMeta.width >= 2 && previewMeta.height >= 2 && previewMeta.width <= Math.min(width, 768)
      && previewMeta.height <= Math.min(height, 768));
    result.preview = describe(previewBytes, 'image/jpeg', { width: previewMeta.width, height: previewMeta.height });
  }
  if (output !== 'preview') {
    const sourcePixels = await pixelHash(bytes);
    // Effort changes cost/size only. Every full generation independently proves
    // RGB equality; no thumbnail or partially checked bytes become authority.
    const fullBytes = await encode(sharp(bytes, options).keepIccProfile()
      .webp({ lossless: true, effort: 0 }), fullPath);
    const fullMeta = await sharp(fullBytes, options).metadata();
    need(inspectContainer(fullBytes).mime === 'image/webp' && fullMeta.width === width && fullMeta.height === height
      && fullMeta.channels === 3 && !fullMeta.hasAlpha && fullMeta.depth === 'uchar'
      && fullMeta.orientation === undefined && (fullMeta.pages ?? 1) === 1 && fullMeta.icc && sha(fullMeta.icc) === ICC);
    need(await pixelHash(fullBytes) === sourcePixels);
    result.full = describe(fullBytes, 'image/webp', { width, height });
  }
  return result;
}

try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString('utf8'); need(Buffer.byteLength(raw) <= 32_768, 'PHOTO_DECODE_INVALID');
  }
  process.stdout.write(JSON.stringify(await display(JSON.parse(raw))));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? 'PHOTO_DECODE_INVALID' }));
}
