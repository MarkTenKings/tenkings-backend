import {verifiedImageContentKey} from './verified-image.mjs';

const key = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);

const positiveDimension = value => Number.isSafeInteger(value) && value > 0;
const transportDescriptor = value => verifiedImageContentKey(value) && Number.isSafeInteger(value.byteCount)
  && typeof value.url === 'string' && value.url.length > 0;

/** This optional transport encodes the exact full-frame pixels losslessly.
 * The server qualifies that equality; the client verifies each encoded hash. */
export function reviewImageDisplay(canonical, frame = null) {
  const display = canonical?.display;
  return display && transportDescriptor(display) && display.mime === 'image/webp'
    && display.policyVersion === 'atlas-review-display-lossless-v1'
    && display.sourceSha256 === canonical.sha256 && /^[a-f0-9]{64}$/.test(canonical.sha256)
    && positiveDimension(display.width) && positiveDimension(display.height)
    && (!frame || display.width === frame.width && display.height === frame.height)
    ? display : null;
}

/** Small context only. It never supplies full-detail readiness or editor pixels. */
export function reviewImagePreview(canonical, frame = null) {
  const display = reviewImageDisplay(canonical, frame), preview = display?.preview ?? canonical?.preview;
  const sourceWidth = display?.width ?? frame?.width, sourceHeight = display?.height ?? frame?.height;
  if (!preview || !transportDescriptor(preview) || preview.mime !== 'image/jpeg'
    || (!display && preview.sourceSha256 !== canonical?.sha256)
    || !positiveDimension(sourceWidth) || !positiveDimension(sourceHeight)
    || !positiveDimension(preview.width) || !positiveDimension(preview.height)
    || Math.max(preview.width, preview.height) > 768
    || preview.width > sourceWidth || preview.height > sourceHeight) return null;
  const scale = Math.min(preview.width / sourceWidth, preview.height / sourceHeight);
  return Math.abs(preview.width - sourceWidth * scale) <= 1
    && Math.abs(preview.height - sourceHeight * scale) <= 1 ? preview : null;
}

/** Frame lineage is checked here; the shared loader verifies actual bytes. */
export function geometryImage(state, side, kind, images) {
  const source = state.sides[side];
  const prepared = kind === 'PRINTED';
  const frame = prepared ? source.prepared?.frame.rectified : source.image;
  const image = images?.[side]?.[prepared ? 'rectified' : 'original'];
  const expected = prepared ? frame?.sha256 : frame?.frameSha256;
  if (!image || !frame || image.sha256 !== expected) return null;
  if (prepared && (typeof image.url !== 'string' || !image.url.length)) return null;
  const display = prepared ? null : reviewImageDisplay(image, frame);
  return { ...(display ?? image), sourceSha256: expected, width: frame.width, height: frame.height,
    preview: prepared ? null : reviewImagePreview(image, frame),
    ...(prepared ? {} : {displayState:image.displayState,previewState:image.previewState}) };
}

export function geometryImageBinding(state, side, kind, images) {
  const image = geometryImage(state, side, kind, images);
  return image ? key({ card: state.cardId, side, kind, image: { sha256: image.sourceSha256, width: image.width, height: image.height },
    revision: kind === 'PHYSICAL' ? state.sides[side].imageRevision : state.sides[side].preparationRevision }) : null;
}

