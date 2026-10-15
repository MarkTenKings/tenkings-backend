import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const binding = { publicToken: z.string().regex(/^ar_[A-Za-z0-9_-]{24}$/),
  approvalVersion: z.number().int().positive().max(2147483647), publicHash: sha };
const shared = { ...binding,
  side: z.enum(['FRONT', 'BACK']), sourceSha256: sha, sha256: sha,
  contentType: z.literal('image/png'), url: z.string().max(256), transparent: z.literal(true), presentationOnly: z.literal(true),
};
const historicalReportImageSchema = z.strictObject({ ...shared,
  side: z.enum(['FRONT', 'BACK']), sourceSha256: sha, sha256: sha,
  generationSourceSha256: sha.optional(), originalSha256: sha.optional(),
  width: z.number().int().min(2).max(4096), height: z.number().int().min(2).max(4096),
  byteCount: z.number().int().positive().max(4 * 1024 * 1024), contentType: z.literal('image/png'),
  url: z.string().max(256), transparent: z.literal(true), presentationOnly: z.literal(true),
  preservesOriginalRGB: z.literal(false), alignment: z.literal('approximate-frame-fit'),
  promptVersion: z.string().regex(/^[a-z0-9-]{1,100}$/), model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).nullable(),
  execution: z.enum(['OPENAI_IMAGES_API', 'OPENAI_BUILT_IN']),
});
const backgroundRemovedReportImageSchema = z.strictObject({ ...shared,
  segmentationSourceSha256: sha.optional(), originalSha256: sha.optional(),
  width: z.number().int().min(2).max(5000), height: z.number().int().min(2).max(5000),
  byteCount: z.number().int().positive().max(101 * 1024 * 1024),
  preservesOriginalRGB: z.literal(false), preservesOpaqueRGB: z.literal(true),
  foregroundRGBValidation: z.literal('bounded-edge-rgb-v1'), alignment: z.literal('original-frame'),
  recipeVersion: z.string().regex(/^[a-z0-9-]{1,100}$/), execution: z.literal('PHOTOROOM_PLUS_API'),
});
export const reportImageSchema = z.union([historicalReportImageSchema, backgroundRemovedReportImageSchema]);
export const reportImagesSchema = z.strictObject({ version: z.literal('atlas-report-images-v1'), ...binding,
  images: z.strictObject({ FRONT: reportImageSchema.optional(), BACK: reportImageSchema.optional() }) });
export function reportImageURL({ publicToken, approvalVersion, side, sha256 }) {
  return `/api/reports/${publicToken}/presentation/${side}?v=${approvalVersion}&sha=${sha256}`;
}
/** Auxiliary allowlist. This never changes the immutable approved packet. */
export function parseReportImages(value, { packet, publicHash } = {}) {
  const parsed = reportImagesSchema.parse(value);
  if (packet && (parsed.publicToken !== packet.publicToken || parsed.approvalVersion !== packet.approvalVersion
    || parsed.publicHash !== publicHash)) throw new Error('REPORT_IMAGES_BINDING_INVALID');
  for (const [side, image] of Object.entries(parsed.images)) {
    const cleaned = image.execution === 'PHOTOROOM_PLUS_API';
    if (image.side !== side || ['publicToken', 'approvalVersion', 'publicHash'].some(key => image[key] !== parsed[key])
      || image.url !== reportImageURL(image) || image.width * image.height > (cleaned ? 25_000_000 : 8_294_400)
      || (image.execution === 'OPENAI_IMAGES_API' && image.model === null)
      || (image[cleaned ? 'segmentationSourceSha256' : 'generationSourceSha256'] === undefined) !== (image.originalSha256 === undefined)
      || (packet && image.sourceSha256 !== packet.images[side].sha256)) throw new Error('REPORT_IMAGES_BINDING_INVALID');
  }
  return parsed;
}
