import sharp from 'sharp';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { canonical, digest } from '@atlas/manual-service/contract';
import { REPORT_IMAGE_RECIPE, reportImageRecipeHash } from '../src/report-image-provider.mjs';

export async function savedGradingPhoto(photo) {
  const bytes = await sharp({ create: { width: 40, height: 56, channels: 4, background: '#00000000' } })
    .composite([{ input: await sharp({ create: { width: 30, height: 46, channels: 4, background: '#abcdef' } }).png().toBuffer(), left: 5, top: 5 }]).png().toBuffer();
  const key = digest(photo.original.uploadId), recipeHash = reportImageRecipeHash(REPORT_IMAGE_RECIPE);
  const frame = parseDecodedFrame({ schemaVersion: 3, kind: 'decoded-frame', id: `grading-image:${key}`,
    originalDescriptorSha256: descriptorSha256(photo.original), decodePlanSha256: descriptorSha256(photo.decodePlan),
    raster: { content: { mime: 'image/png', sha256: digest(bytes), byteCount: bytes.length }, dimensions: { width: 40, height: 56 },
      object: { key: `synthetic/derived/${key}/grading.png`, versionId: null } }, sourceToFrame: [1,0,0,0,1,0,0,0,1],
    treatment: { decoder: 'openai-images-edit', version: REPORT_IMAGE_RECIPE.model, policyVersion: 'atlas-generated-grading-image-v1',
      channels: 4, bitDepth: 8, colorSpace: 'sRGB', colorTreatment: 'converted', hdrTreatment: 'not-present' },
    generation: { sourceFrame: photo.workingFrame, recipeHash, model: REPORT_IMAGE_RECIPE.model, promptVersion: REPORT_IMAGE_RECIPE.promptVersion },
  }, photo.original, photo.decodePlan);
  const result = { version: 'atlas-report-image-result-v1', sourceSha256: photo.workingFrame.raster.content.sha256, recipeHash,
    media: { frame, original: photo.original, decodePlan: photo.decodePlan }, output: { sha256: digest(bytes) } };
  return { bytes, frame, result, row: { key, state: 'READY', result: canonical(result), result_hash: digest(canonical(result)),
    source_hash: result.sourceSha256, recipe_hash: recipeHash, bound_original_sha256: photo.original.content.sha256 } };
}
