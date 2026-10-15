import sharp from 'sharp';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { canonical, digest } from '@atlas/manual-service/contract';
// Historical data fixture, deliberately independent of today's dispatch recipe.
const historical = { model: 'gpt-image-2.5-sunburst-2026-09-08', promptVersion: 'atlas-background-grading-api-v3' };

export async function savedGradingPhoto(photo) {
  const bytes = await sharp({ create: { width: 40, height: 56, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 30, height: 46, channels: 4, background: '#abcdef' } }).png().toBuffer(), left: 5, top: 5 }]).png().toBuffer();
  const key = digest(photo.original.uploadId), recipeHash = digest(canonical(historical));
  const frame = parseDecodedFrame({ schemaVersion: 3, kind: 'decoded-frame', id: `grading-image:${key}`,
    originalDescriptorSha256: descriptorSha256(photo.original), decodePlanSha256: descriptorSha256(photo.decodePlan),
    raster: { content: { mime: 'image/png', sha256: digest(bytes), byteCount: bytes.length }, dimensions: { width: 40, height: 56 },
      object: { key: `synthetic/derived/${key}/grading.png`, versionId: null } }, sourceToFrame: [1,0,0,0,1,0,0,0,1],
    treatment: { decoder: 'openai-images-edit', version: historical.model, policyVersion: 'atlas-generated-grading-image-v1',
      channels: 4, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: 'not-present' },
    generation: { sourceFrame: photo.workingFrame, recipeHash, model: historical.model, promptVersion: historical.promptVersion },
  }, photo.original, photo.decodePlan);
  const result = { version: 'atlas-report-image-result-v1', sourceSha256: photo.workingFrame.raster.content.sha256, recipeHash,
    media: { frame, original: photo.original, decodePlan: photo.decodePlan }, output: { sha256: digest(bytes) } };
  return { bytes, frame, result, row: { key, state: 'READY', result: canonical(result), result_hash: digest(canonical(result)),
    source_hash: result.sourceSha256, recipe_hash: recipeHash, bound_original_sha256: photo.original.content.sha256 } };
}

export async function savedBackgroundRemovedPhoto(photo, sourceBytes) {
  const { data, info } = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // A fixed local mask changes only alpha, including a partially transparent
  // edge, to exercise the downstream contract without a provider request.
  const pixelCount = info.width * info.height, transparent = Math.ceil(pixelCount * 0.001);
  for (let p = 0; p < transparent; p++) data[p * 4 + 3] = 0;
  data[transparent * 4 + 3] = 127;
  const bytes = await sharp(data, { raw: info }).png().toBuffer(), key = digest(`segmented:${photo.original.uploadId}`);
  const recipeHash = digest('synthetic-photoroom-plus-recipe');
  const frame = parseDecodedFrame({ schemaVersion: 4, kind: 'decoded-frame', id: `grading-image:${key}`,
    originalDescriptorSha256: descriptorSha256(photo.original), decodePlanSha256: descriptorSha256(photo.decodePlan),
    raster: { content: { mime: 'image/png', sha256: digest(bytes), byteCount: bytes.length }, dimensions: { width: info.width, height: info.height },
      object: { key: `synthetic/derived/${key}/grading.png`, versionId: null } }, sourceToFrame: photo.workingFrame.sourceToFrame,
    treatment: { decoder: 'photoroom-plus-hd-background-removal', version: 'plus-hd-auto', policyVersion: 'atlas-background-removal-grading-image-v1',
      channels: 4, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'preserved', hdrTreatment: 'not-present' },
    segmentation: { sourceFrame: photo.workingFrame, recipeHash, provider: 'PHOTOROOM_PLUS', endpoint: 'https://image-api.photoroom.com/v2/edit',
      foregroundRGB: { validation: 'bounded-edge-rgb-v1', visiblePixels: pixelCount - transparent, opaquePixels: pixelCount - transparent - 1,
        fractionalPixels: 1, comparedChannels: 3, mismatchedPixels: 0, mismatchedChannels: 0, opaqueMismatchedPixels: 0, minChannelDelta: 0, maxChannelDelta: 0 },
      alphaBoundary: { validation: 'exterior-alpha-band-v1', connectivity: 4, distanceMetric: 'manhattan', maxFractionalDistance: 1,
        enclosedTransparentPixels: 0, enclosedFractionalPixels: 0 } },
  }, photo.original, photo.decodePlan);
  const result = { version: 'atlas-report-image-result-v1', sourceSha256: photo.workingFrame.raster.content.sha256, recipeHash,
    media: { frame, original: photo.original, decodePlan: photo.decodePlan }, output: { sha256: digest(bytes) } };
  return { bytes, frame, result, row: { key, state: 'READY', result: canonical(result), result_hash: digest(canonical(result)),
    source_hash: result.sourceSha256, recipe_hash: recipeHash, bound_original_sha256: photo.original.content.sha256 } };
}
