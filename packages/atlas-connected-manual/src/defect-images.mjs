import sharp from 'sharp';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { planDefectCrops } from '@atlas/defect-analysis';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const SIDES = ['FRONT', 'BACK'];
const dimensions = { inspection: [1350, 1858], rectified: [1270, 1778] };

/** Decode only verified prepared images. Every crop preserves source pixels;
 * the PNG hash and original preparation hash describe different encodings. */
export function createDefectImageEffects({ readPrepared, artifacts, limited = work => work() }) {
  async function decode(staff, card, side, kind, expectedHash) {
    const found = await readPrepared(staff, card, side, kind);
    const bytes = Buffer.from(found.bytes);
    requireThat(digest(bytes) === expectedHash, 409, 'DEFECT_IMAGE_STALE');
    const [width, height] = dimensions[kind];
    const metadata = await sharp(bytes, { limitInputPixels: 1350 * 1858, failOn: 'warning' }).metadata();
    requireThat(metadata.width === width && metadata.height === height && (metadata.pages ?? 1) === 1,
      503, 'DEFECT_IMAGE_INVALID');
    return { bytes, width, height };
  }
  async function png(source, rectangle = null) {
    let image = sharp(source.bytes, { limitInputPixels: 1350 * 1858, failOn: 'warning' });
    if (rectangle) image = image.extract({ left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height });
    const { data, info } = await image.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
    return { mime: 'image/png', sha256: digest(data), width: info.width, height: info.height, bytes: data };
  }
  async function store(content, cardId, kind) {
    const sourceHash = digest(JSON.stringify(content));
    return { ref: await artifacts.write(content, { cardId, kind, sourceHash }), sourceHash };
  }
  return Object.freeze({
    currentImages: (staff, card, binding) => limited(async () => {
      const result = [];
      for (const side of SIDES) {
        const sourceSha256 = binding.sides[side].frame.inspectionImageSha256;
        const source = await decode(staff, card, side, 'inspection', sourceSha256);
        const whole = { ...await png(source), sourceSha256 }, crops = [];
        for (const rectangle of planDefectCrops(side)) crops.push({ ...rectangle, ...await png(source, rectangle) });
        result.push({ side, whole, crops });
      }
      return result;
    }),
    createExemplar: input => limited(async () => {
      const { staff, card, side, frame, cropTransform, trace } = input;
      const source = await decode(staff, card, side, 'rectified', frame.rectifiedImageSha256);
      requireThat(cropTransform.imageSha256 === frame.rectifiedImageSha256
        && cropTransform.coordinateSpace === 'RECTIFIED_CARD_PIXELS'
        && cropTransform.sourceWidth === source.width && cropTransform.sourceHeight === source.height
        && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(cropTransform[k]))
        && cropTransform.x >= 0 && cropTransform.y >= 0 && cropTransform.width > 0 && cropTransform.height > 0
        && cropTransform.x + cropTransform.width <= source.width && cropTransform.y + cropTransform.height <= source.height,
      503, 'DEFECT_CROP_INVALID');
      const image = await png(source, cropTransform);
      const crop = await store({ version: 'atlas-reviewed-png-v1', pngBase64: image.bytes.toString('base64'),
        sha256: image.sha256, width: image.width, height: image.height, cropTransform }, card.cardId, 'REVIEWED_CROP');
      const retainedTrace = await store(trace, card.cardId, 'REVIEWED_TRACE');
      return { crop: { ...crop, mime: image.mime, sha256: image.sha256, width: image.width, height: image.height },
        trace: { ...retainedTrace, sha256: trace.sha256 }, cropTransform };
    }),
    async lessonImages(knowledge) {
      // Only a server-produced, validated retrieval can select old published
      // exemplars. No public route accepts arbitrary historical artifact refs.
      const result = [];
      for (const lesson of knowledge.lessons) {
        const descriptor = lesson.exemplar.crop;
        const saved = await artifacts.read(descriptor.ref, { cardId: lesson.source.cardId,
          kind: 'REVIEWED_CROP', sourceHash: descriptor.sourceHash });
        requireThat(digest(JSON.stringify(saved)) === descriptor.sourceHash && saved.version === 'atlas-reviewed-png-v1'
          && saved.sha256 === descriptor.sha256 && saved.width === descriptor.width && saved.height === descriptor.height
          && canonical(saved.cropTransform) === canonical(lesson.exemplar.cropTransform), 503, 'DEFECT_LESSON_UNVERIFIED');
        const bytes = Buffer.from(saved.pngBase64, 'base64');
        requireThat(bytes.toString('base64') === saved.pngBase64 && digest(bytes) === descriptor.sha256, 503, 'DEFECT_LESSON_UNVERIFIED');
        const traceDescriptor = lesson.exemplar.trace;
        const retained = await artifacts.read(traceDescriptor.ref, { cardId: lesson.source.cardId,
          kind: 'REVIEWED_TRACE', sourceHash: traceDescriptor.sourceHash });
        requireThat(digest(JSON.stringify(retained)) === traceDescriptor.sourceHash && retained.sha256 === traceDescriptor.sha256,
          503, 'DEFECT_LESSON_UNVERIFIED');
        const mask = decodeSpeedsterTraceRleV1(retained), transform = lesson.exemplar.cropTransform;
        const annotation = Buffer.alloc(descriptor.width * descriptor.height * 4);
        for (let y = 0; y < descriptor.height; y++) for (let x = 0; x < descriptor.width; x++) {
          if (!mask[(y + transform.y) * retained.width + x + transform.x]) continue;
          const i = (y * descriptor.width + x) * 4;
          annotation[i] = 0; annotation[i + 1] = 220; annotation[i + 2] = 255; annotation[i + 3] = 110;
        }
        const overlay = await sharp(bytes).composite([{ input: annotation,
          raw: { width: descriptor.width, height: descriptor.height, channels: 4 } }]).png().toBuffer();
        result.push({ lessonId: lesson.id, mime: descriptor.mime, width: descriptor.width, height: descriptor.height,
          sha256: descriptor.sha256, bytes, traceOverlay: { mime: 'image/png', sha256: digest(overlay),
            width: descriptor.width, height: descriptor.height, bytes: overlay, traceSha256: retained.sha256 } });
      }
      return result;
    },
  });
}
