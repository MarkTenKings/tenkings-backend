import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const binding = { publicToken: z.string().regex(/^ar_[A-Za-z0-9_-]{24}$/),
  approvalVersion: z.number().int().positive().max(2147483647), publicHash: sha };
export const reportImageSchema = z.strictObject({ ...binding,
  side: z.enum(['FRONT', 'BACK']), sourceSha256: sha, sha256: sha,
  width: z.number().int().min(2).max(4096), height: z.number().int().min(2).max(4096),
  byteCount: z.number().int().positive().max(4 * 1024 * 1024), contentType: z.literal('image/png'),
  url: z.string().max(256), transparent: z.literal(true), presentationOnly: z.literal(true),
  preservesOriginalRGB: z.literal(false), alignment: z.literal('approximate-frame-fit'),
  promptVersion: z.string().regex(/^[a-z0-9-]{1,100}$/), model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).nullable(),
  execution: z.enum(['OPENAI_IMAGES_API', 'OPENAI_BUILT_IN']),
});
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
    if (image.side !== side || ['publicToken', 'approvalVersion', 'publicHash'].some(key => image[key] !== parsed[key])
      || image.url !== reportImageURL(image) || image.width * image.height > 8_294_400
      || (image.execution === 'OPENAI_IMAGES_API' && image.model === null)
      || (packet && image.sourceSha256 !== packet.images[side].sha256)) throw new Error('REPORT_IMAGES_BINDING_INVALID');
  }
  return parsed;
}
