// Reproducible selected-A template derived only from the pinned approved-B mask.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = new URL('../assets/approved-b/', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
const original = await readFile(new URL('front-black.png', root));
if (sha(original) !== manifest.files['front-black.png'].sha256) throw Error('SOURCE_CHANGED');
const image = `<image id="source" width="68.342" height="20.082" href="data:image/png;base64,${original.toString('base64')}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6458" height="1898" viewBox="0 0 68.342 20.082"><defs>
<filter id="letters" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="3.8" y="16.05" width="10.1" height=".77" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -1 1"/><feMorphology operator="dilate" radius=".01"/></filter>
<mask id="grading" maskUnits="userSpaceOnUse" x="3.8" y="16.05" width="10.1" height=".77" style="mask-type:alpha"><use href="#source" filter="url(#letters)"/></mask>
<mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/><g transform="translate(8.8523,16.48) scale(1.25) translate(-8.8523,-16.436825)"><rect x="3.8" y="16.05" width="10.1" height=".77" fill="black" mask="url(#grading)"/></g></mask>
</defs><g mask="url(#cut)">${image}<rect x="3.7" y="15.94" width="10.35" height="1.07" fill="black"/><path fill="black" d="M.65 13.57 H1.8 V17.05 H17.5 V16.75 H47.3 V19.6 H.65Z"/><rect x="1.6" y="19.15" width="15.9" height=".75" fill="black"/></g></svg>`;
const normal = await sharp(Buffer.from(svg)).png({palette:true,colours:256,effort:10,dither:0,compressionLevel:9}).toBuffer();
const { data, info } = await sharp(normal).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for (let i=0;i<data.length;i+=4) { data[i]=data[i+1]=data[i+2]=0; data[i+3]=255-data[i+3]; }
const edge = Buffer.from('<svg width="6458" height="1898" viewBox="0 0 68.342 20.082"><rect width="68.342" height="20.082" rx="1.6" fill="black"/></svg>');
const inverted = await sharp(data,{raw:info}).composite([{input:edge,blend:'dest-in'}]).png({palette:true,colours:256,effort:10,dither:0,compressionLevel:9}).toBuffer();
const files = {'style-front-black.png':normal,'style-front-inverted.png':inverted};
for (const [name,bytes] of Object.entries(files)) await writeFile(new URL(name,root),bytes);
await writeFile(new URL('style-artwork-manifest.json',root),JSON.stringify({version:'atlas-selected-a-template-v1',source:manifest.files['front-black.png'].sha256,
  generatorSha256:sha(await readFile(new URL(import.meta.url))),widthMm:68.342,heightMm:20.082,
  grading:{scale:1.25,outwardWeightMm:.0125},files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{sha256:sha(bytes),byteCount:bytes.length}]))},null,2)+'\n');
