import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { uploadPrivateChecksumBuffer, presignReadUrl, getStorageMode } from '../../../../../lib/server/storage';
import { MAX_INVENTORY_PHOTO_BYTES, verifyInventoryPhoto } from '../../../../../lib/server/inventoryPhoto';

export const config = { api: { bodyParser: { sizeLimit: '4.1mb' } } };
const MAX_PHOTO_BYTES = MAX_INVENTORY_PHOTO_BYTES;
class InvalidPhotoError extends Error {}

/** Validate browser-prepared photos independently and strip metadata before private upload.
 * HEIC/HEIF decoding stays in the browser: Vercel's prebuilt Sharp has no HEVC guarantee. */
export async function prepareInventoryPhoto(encoded: unknown) {
  if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(MAX_PHOTO_BYTES / 3) + 23) throw new InvalidPhotoError();
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded);
  if (!match) throw new InvalidPhotoError();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES || bytes.toString('base64') !== match[2]) throw new InvalidPhotoError();
  try {
    const input = sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' });
    const metadata = await input.metadata();
    if (metadata.format !== match[1] || (metadata.pages ?? 1) !== 1) throw new InvalidPhotoError();
    const photo = await input.rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    if (!photo.length || photo.length > MAX_PHOTO_BYTES) throw new InvalidPhotoError();
    const checksum = createHash('sha256').update(photo).digest('hex');
    return { photo, checksum };
  } catch { throw new InvalidPhotoError(); }
}

export function createStaffInventoryPhotoHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  storageMode: typeof getStorageMode;
  upload: typeof uploadPrivateChecksumBuffer;
  sign: typeof presignReadUrl;
  verifyPhoto: typeof verifyInventoryPhoto;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      await deps.requireAdmin(req);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      // The existing local storage mode writes into public/. Staff photos require private S3.
      if (deps.storageMode() !== 's3') return res.status(503).json({ message: 'Private photo storage is unavailable. Your inventory entry is preserved.' });
      const { photo, checksum } = await prepareInventoryPhoto(req.body?.image);
      const key = `inventory-photos/${randomUUID()}/${checksum}.jpg`;
      await deps.upload(key, photo, 'image/jpeg', { checksumSha256: checksum, cacheControl: 'private, no-store' });
      if (!await deps.verifyPhoto(key)) throw new Error('Stored inventory photo could not be verified.');
      return res.status(200).json({ photo_key: key, photo_url: await deps.sign(key) });
    } catch (error) {
      const status = error instanceof InvalidPhotoError ? 400 : error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ message: status === 401 || status === 403 ? 'Sign in with your Ten Kings admin account.' : status === 400 ? 'The prepared photo could not be read. Select your photo again or take a new photo. Your entry is preserved.' : 'The photo could not be uploaded. Your entry is preserved; please retry.' });
    }
  };
}

export default createStaffInventoryPhotoHandler({ requireAdmin: requireInventoryAdminSession, storageMode: getStorageMode, upload: uploadPrivateChecksumBuffer, sign: presignReadUrl, verifyPhoto: verifyInventoryPhoto });
