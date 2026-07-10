const RASTER_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PRIVATE_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]);
const PRIVATE_WEBP_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const SAFE_PNG_ANCILLARY_CHUNKS = new Set(["tRNS", "gAMA", "cHRM", "sRGB", "pHYs", "bKGD", "sBIT"]);
const SAFE_WEBP_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

function normalizedContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
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

export async function assertAiGraderBrowserRaster(bytes: ArrayBuffer, contentType: string) {
  const normalized = normalizedContentType(contentType);
  if (!isAiGraderRasterBytes(bytes, normalized)) {
    throw new Error("AI Grader report image bytes do not match the approved raster content type.");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot verify AI Grader report image decoding.");
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: normalized }));
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("Decoded image dimensions are invalid.");
  } catch {
    throw new Error("AI Grader report image could not be decoded as the approved raster content type.");
  } finally {
    bitmap?.close();
  }
}
