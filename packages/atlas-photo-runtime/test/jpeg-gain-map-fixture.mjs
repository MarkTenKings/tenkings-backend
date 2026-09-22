// Synthetic structural fixture only. No user photo or EXIF location.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
export const ISO = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
export const XMP = Buffer.from('http://ns.adobe.com/xap/1.0/\0');
export const ICC = Buffer.from('ICC_PROFILE\0');
export function segment(marker, data) {
  const header = Buffer.alloc(4); header[0] = 255; header[1] = marker; header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}
export const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0.0">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/" xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/">
<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>
<HDRGainMap:HDRGainMapHeadroom>2.000000</HDRGainMap:HDRGainMapHeadroom>
<apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
export async function fixture({ change = () => {}, little = false } = {}) {
  const pixels = Buffer.alloc(24 * 18 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 71 + Math.floor(i / 72) * 13) % 256;
  const primary = await sharp(pixels, { raw: { width: 24, height: 18, channels: 3 } }).jpeg().toBuffer();
  const aux = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#555555' } })
    .toColourspace('b-w').jpeg().toBuffer();
  const gain = Buffer.alloc(61); gain[4] = 0x40;
  for (const [at, value] of [[5, 0], [13, 1], [21, 0], [29, 1], [37, 1], [45, 0], [53, 0]]) {
    gain.writeUInt32BE(value, at); gain.writeUInt32BE(1, at + 4);
  }
  const spec = { primary, aux, primaryIso: Buffer.alloc(4), gain, xml,
    icc: await readFile(new URL('./fixtures/DisplayP3-v4.icc', import.meta.url)),
    primaryExtra: [], auxExtra: [], patchIndex: () => {}, trailing: Buffer.alloc(0), gap: Buffer.alloc(0) };
  change(spec);
  const secondary = Buffer.concat([spec.aux.subarray(0, 2), segment(225, Buffer.concat([XMP, Buffer.from(spec.xml)])),
    segment(226, Buffer.concat([ISO, spec.gain])), ...spec.auxExtra, spec.aux.subarray(2)]);
  const tiff = Buffer.alloc(82); tiff.write(little ? 'II' : 'MM');
  const u16 = (at, value) => little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
  const u32 = (at, value) => little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
  u16(2, 42); u32(4, 8); u16(8, 3);
  u16(10, 0xb000); u16(12, 7); u32(14, 4); tiff.write('0100', 18);
  u16(22, 0xb001); u16(24, 4); u32(26, 1); u32(30, 2);
  u16(34, 0xb002); u16(36, 7); u32(38, 32); u32(42, 50);
  const tail = Buffer.concat([segment(226, Buffer.concat([ISO, spec.primaryIso])),
    segment(226, Buffer.concat([ICC, Buffer.from([1, 1]), spec.icc])), ...spec.primaryExtra, spec.primary.subarray(2)]);
  const size = 2 + 4 + 4 + tiff.length + tail.length;
  u32(50, 0x00030000); u32(54, size); u32(70, secondary.length); u32(74, size - 10);
  spec.patchIndex({ tiff, u16, u32 });
  const first = Buffer.concat([spec.primary.subarray(0, 2), segment(226, Buffer.concat([Buffer.from('MPF\0'), tiff])), tail]);
  return { bytes: Buffer.concat([first, spec.gap, secondary, spec.trailing]), first, secondary, spec };
}
