import sharp from 'sharp';
import { digest, requireThat } from '@atlas/manual-service/contract';

const PREFIX = 'ATLAS generated background-removed view: ';
const INSTRUCTION = 'This generated cutout is an additional visual aid. Compare it with the original photograph of the same side already supplied. Use the original for exact printed text, borders and physical-condition evidence if the generated view differs. This image does not establish a human decision.';

export async function identificationCleanViews({ pair, readCleanPhoto, signal }) {
  if (!readCleanPhoto) return [];
  const values = await Promise.all(['FRONT','BACK'].map(async side => {
    const clean = await readCleanPhoto({ cardId: pair.cardId, uploadId: pair.sides[side].upload.uploadId, side, signal, waitMs:0 });
    if (!clean) return null;
    requireThat(Buffer.isBuffer(clean.bytes) && digest(clean.bytes) === clean.sha256, 503, 'IDENTIFICATION_CLEAN_PHOTO_INVALID');
    const bytes = await sharp(clean.bytes, { limitInputPixels: 8_294_400, failOn: 'warning' })
      .resize(1400,1400,{ fit:'inside', withoutEnlargement:true }).webp({ quality:95 }).toBuffer();
    requireThat(bytes.length <= 2 * 1024 * 1024, 503, 'IDENTIFICATION_CLEAN_PHOTO_INVALID');
    return { role:'user', content:[
      { type:'input_text', text:`${PREFIX}${side}; generated SHA256 ${clean.sha256}; supplied SHA256 ${digest(bytes)}. ${INSTRUCTION}` },
      { type:'input_image', image_url:`data:image/webp;base64,${bytes.toString('base64')}`, detail:'high' },
    ] };
  }));
  return values.filter(Boolean);
}

/** Replay the exact auxiliary bytes from the retained paid request. Never
 * regenerate or reread a newer cutout while reconstructing that request. */
export function retainedIdentificationCleanViews(request) {
  const views = (request.input ?? []).filter(item => item?.content?.[0]?.type === 'input_text'
    && item.content[0].text?.startsWith(PREFIX));
  requireThat(views.length <= 2, 409, 'IDENTIFICATION_RETRY_NOT_ALLOWED');
  const sides = new Set();
  for (const item of views) {
    const match = item.content[0].text.match(/^ATLAS generated background-removed view: (FRONT|BACK); generated SHA256 ([a-f0-9]{64}); supplied SHA256 ([a-f0-9]{64})\. /);
    const image = item.content[1], encoded = image?.image_url?.slice('data:image/webp;base64,'.length);
    requireThat(item.role === 'user' && item.content.length === 2 && match && !sides.has(match[1])
      && image?.type === 'input_image' && image.detail === 'high'
      && image.image_url.startsWith('data:image/webp;base64,') && encoded.length <= Math.ceil(2 * 1024 * 1024 / 3) * 4,
    409, 'IDENTIFICATION_RETRY_NOT_ALLOWED');
    const bytes = Buffer.from(encoded,'base64');
    requireThat(bytes.length > 0 && bytes.toString('base64') === encoded && digest(bytes) === match[3],
      409, 'IDENTIFICATION_RETRY_NOT_ALLOWED');
    sides.add(match[1]);
  }
  return structuredClone(views);
}
