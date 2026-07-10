const RASTER_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PRIVATE_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]);
const PRIVATE_WEBP_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const SAFE_PNG_ANCILLARY_CHUNKS = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "pHYs", "bKGD", "sBIT"]);
const SAFE_WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

export type AiGraderRasterDimensions = {
  widthPx: number;
  heightPx: number;
};

function normalizedContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function safeRasterDimensions(widthPx: number, heightPx: number): AiGraderRasterDimensions | null {
  return Number.isSafeInteger(widthPx) &&
    widthPx > 0 &&
    widthPx <= 100_000 &&
    Number.isSafeInteger(heightPx) &&
    heightPx > 0 &&
    heightPx <= 100_000
    ? { widthPx, heightPx }
    : null;
}

/**
 * Reads dimensions from a bounded image prefix. The caller must separately
 * verify the complete object's storage checksum and byte size.
 */
export function readAiGraderRasterDimensions(
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): AiGraderRasterDimensions | null {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const normalized = normalizedContentType(contentType);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (normalized === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      data.length < 24 ||
      signature.some((value, index) => data[index] !== value) ||
      ascii(data, 12, 4) !== "IHDR"
    ) return null;
    return safeRasterDimensions(view.getUint32(16, false), view.getUint32(20, false));
  }
  if (normalized === "image/jpeg") {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
    const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset] !== 0xff) return null;
      while (offset < data.length && data[offset] === 0xff) offset += 1;
      if (offset >= data.length) return null;
      const marker = data[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) return null;
      const length = view.getUint16(offset, false);
      if (length < 2 || offset + length > data.length) return null;
      if (startOfFrameMarkers.has(marker)) {
        if (length < 7) return null;
        return safeRasterDimensions(view.getUint16(offset + 5, false), view.getUint16(offset + 3, false));
      }
      offset += length;
    }
    return null;
  }
  if (normalized === "image/webp") {
    if (data.length < 20 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WEBP") return null;
    let offset = 12;
    while (offset + 8 <= data.length) {
      const kind = ascii(data, offset, 4);
      const length = view.getUint32(offset + 4, true);
      const payload = offset + 8;
      if (kind === "VP8X" && length >= 10) {
        if (payload + 10 > data.length) return null;
        const widthPx = 1 + data[payload + 4] + (data[payload + 5] << 8) + (data[payload + 6] << 16);
        const heightPx = 1 + data[payload + 7] + (data[payload + 8] << 8) + (data[payload + 9] << 16);
        return safeRasterDimensions(widthPx, heightPx);
      }
      if (kind === "VP8L" && length >= 5 && data[payload] === 0x2f) {
        if (payload + 5 > data.length) return null;
        const widthPx = 1 + data[payload + 1] + ((data[payload + 2] & 0x3f) << 8);
        const heightPx = 1 + ((data[payload + 2] >> 6) | (data[payload + 3] << 2) | ((data[payload + 4] & 0x0f) << 10));
        return safeRasterDimensions(widthPx, heightPx);
      }
      if (
        kind === "VP8 " &&
        length >= 10 &&
        data[payload + 3] === 0x9d &&
        data[payload + 4] === 0x01 &&
        data[payload + 5] === 0x2a
      ) {
        if (payload + 10 > data.length) return null;
        return safeRasterDimensions(
          view.getUint16(payload + 6, true) & 0x3fff,
          view.getUint16(payload + 8, true) & 0x3fff,
        );
      }
      if (payload + length > data.length) return null;
      offset = payload + length + (length % 2);
    }
  }
  return null;
}

function validPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || signature.some((value, index) => bytes[index] !== value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (PRIVATE_PNG_CHUNKS.has(type)) return false;
    if ((type.charCodeAt(0) & 32) !== 0 && !SAFE_PNG_ANCILLARY_CHUNKS.has(type)) return false;
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return false;
      if (view.getUint32(offset + 8, false) < 1 || view.getUint32(offset + 12, false) < 1) return false;
    }
    if (type === "IEND") return length === 0 && end === bytes.length;
    offset = end;
    chunkIndex += 1;
  }
  return false;
}

function validJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let seenJfif = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return offset === bytes.length;
    if (marker === 0x00 || marker === 0xd8) return false;
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset, false);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 0xe0) {
      if (
        seenJfif ||
        length !== 16 ||
        ascii(bytes, offset + 2, 5) !== "JFIF\u0000" ||
        bytes[offset + 7] !== 1 ||
        bytes[offset + 8] > 2 ||
        bytes[offset + 9] > 2 ||
        view.getUint16(offset + 10, false) < 1 ||
        view.getUint16(offset + 12, false) < 1 ||
        bytes[offset + 14] !== 0 ||
        bytes[offset + 15] !== 0
      ) return false;
      seenJfif = true;
    }
    offset += length;
    if (marker !== 0xda) continue;

    let foundNextMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;
      const scanMarker = bytes[offset];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset += 1;
        continue;
      }
      offset = markerStart;
      foundNextMarker = true;
      break;
    }
    if (!foundNextMarker) return false;
  }
  return false;
}

function validWebp(bytes: Uint8Array) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    if (PRIVATE_WEBP_CHUNKS.has(type)) return false;
    if (!SAFE_WEBP_CHUNKS.has(type)) return false;
    const length = view.getUint32(offset + 4, true);
    offset += 8 + length + (length % 2);
    if (offset > bytes.length) return false;
  }
  return offset === bytes.length;
}

export function isAiGraderRasterBytes(bytes: ArrayBuffer, contentType: string) {
  const normalized = normalizedContentType(contentType);
  if (!RASTER_CONTENT_TYPES.has(normalized)) return false;
  const data = new Uint8Array(bytes);
  if (normalized === "image/png") return validPng(data);
  if (normalized === "image/jpeg") return validJpeg(data);
  return validWebp(data);
}

function assertSafePlannedDimensions(dimensions: AiGraderRasterDimensions) {
  if (
    !Number.isSafeInteger(dimensions.widthPx) ||
    dimensions.widthPx < 1 ||
    dimensions.widthPx > 100_000 ||
    !Number.isSafeInteger(dimensions.heightPx) ||
    dimensions.heightPx < 1 ||
    dimensions.heightPx > 100_000
  ) {
    throw new Error("AI Grader report image plan is missing valid pixel dimensions.");
  }
}

export async function assertAiGraderBrowserRaster(
  bytes: ArrayBuffer,
  contentType: string,
  plannedDimensions?: AiGraderRasterDimensions,
): Promise<AiGraderRasterDimensions> {
  if (plannedDimensions) assertSafePlannedDimensions(plannedDimensions);
  const normalized = normalizedContentType(contentType);
  if (!isAiGraderRasterBytes(bytes, normalized)) {
    throw new Error("AI Grader report image bytes do not match the approved raster content type.");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot verify AI Grader report image decoding.");
  }
  let bitmap: ImageBitmap | undefined;
  let decodedDimensions: AiGraderRasterDimensions | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: normalized }));
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Decoded image dimensions are invalid.");
    decodedDimensions = { widthPx: bitmap.width, heightPx: bitmap.height };
  } catch {
    throw new Error("AI Grader report image could not be decoded as the approved raster content type.");
  } finally {
    bitmap?.close();
  }
  if (
    plannedDimensions &&
    (decodedDimensions.widthPx !== plannedDimensions.widthPx ||
      decodedDimensions.heightPx !== plannedDimensions.heightPx)
  ) {
    throw new Error(
      `AI Grader report image dimensions do not match the upload plan (${decodedDimensions.widthPx}x${decodedDimensions.heightPx} decoded; ${plannedDimensions.widthPx}x${plannedDimensions.heightPx} planned).`,
    );
  }
  return decodedDimensions;
}
