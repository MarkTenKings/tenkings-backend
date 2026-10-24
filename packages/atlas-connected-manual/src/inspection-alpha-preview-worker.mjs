// This short-lived native child receives only verified source bytes on stdin.
// No credentials, arbitrary paths, storage operations or environment loading.
import sharp from 'sharp';

const maxSourceBytes = 50 * 1024 * 1024, maxOutputBytes = 1024 * 1024;
sharp.cache(false);
sharp.concurrency(1);
try {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > maxSourceBytes) throw Error('SOURCE_LIMIT');
    chunks.push(chunk);
  }
  if (!length) throw Error('SOURCE_EMPTY');
  const source = Buffer.concat(chunks, length);
  const options = { limitInputPixels: 1350 * 1858, failOn: 'warning', animated: false };
  const metadata = await sharp(source, options).metadata();
  if (metadata.format !== 'webp' || metadata.width !== 1350 || metadata.height !== 1858
    || (metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1) throw Error('SOURCE_DIMENSIONS');
  // Preserve the inspection alpha exactly at resized resolution. Flattening
  // first would bake the old white presentation fringe into the card pixels.
  const bytes = await sharp(source, options).resize(558, 768, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha().webp({ quality: 78, alphaQuality: 100, effort: 4 }).toBuffer();
  if (!bytes.length || bytes.length > maxOutputBytes) throw Error('OUTPUT_LIMIT');
  process.stdout.end(bytes);
} catch {
  process.exitCode = 1;
}
