import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateLabelStylePng } from './label-style-png.mjs';

const root = new URL('../assets/approved-b/', import.meta.url);
export const LABEL_STYLE_ARTWORK = JSON.parse(readFileSync(new URL('style-artwork-manifest.json', root)));
const hash = value => createHash('sha256').update(value).digest('hex');
const images = Object.fromEntries(Object.entries(LABEL_STYLE_ARTWORK.files).map(([name, descriptor]) => {
  const bytes = readFileSync(new URL(name, root));
  if (hash(bytes) !== descriptor.sha256) throw Error('LABEL_STYLE_ARTWORK_CHANGED');
  return [name, `<image width="68.342" height="20.082" href="data:image/png;base64,${bytes.toString('base64')}"/>`];
}));
const marker = 'data-label-style="atlas-photo-style-v1"';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const opening = `<svg xmlns="http://www.w3.org/2000/svg" width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082" data-atlas-artwork="PRINT" data-renderer="atlas-approved-b-label-v1" data-side="FRONT" ${marker} role="img">`;
export const isLabelStyleArtwork = svg => typeof svg === 'string' && svg.startsWith(opening);

export function buildLabelStyleFront({title,primary,support,accents,defs='',inverted=false}) {
  const field = inverted ? images['style-front-inverted.png'] : images['style-front-black.png'];
  const dynamic = inverted ? `<g fill="#090a0b">${primary}</g>` : '';
  const mask = `<mask id="style-primary-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/><g fill="black">${inverted?'':primary}</g></mask>`;
  return `${opening}<title>${esc(title)}</title><defs>${mask}${defs}</defs><g data-style-field="${inverted?'foil':'black'}" mask="url(#style-primary-cutout)">${field}</g>${dynamic}<g data-style-support="true" fill="${inverted?'#090a0b':'#ffffff'}">${support}</g><g data-style-accents="true">${accents}</g></svg>`;
}

const attrs = {
  svg: 'xmlns width height viewBox data-atlas-artwork data-renderer data-side data-label-style role', title: '', defs: '',
  mask: 'id maskUnits x y width height', rect: 'x y width height rx ry fill fill-opacity stroke stroke-width mask transform',
  g: 'fill fill-opacity stroke stroke-width stroke-linejoin paint-order transform mask clip-path data-style-field data-style-support data-style-accents data-style-span data-part',
  path: 'd transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linejoin mask',
  pattern: 'id patternUnits x y width height', linearGradient: 'id x1 y1 x2 y2 color-interpolation', stop: 'offset stop-color stop-opacity',
  clipPath: 'id clipPathUnits', image: 'id data-label-texture data-label-wordmark x y width height preserveAspectRatio transform href',
  use: 'href filter', filter: 'id filterUnits x y width height', feMorphology: 'operator radius',
};
const children = {
  svg: ['title','defs','g','rect','path'], defs: ['mask','pattern','linearGradient','clipPath','image','filter'],
  mask: ['rect','g','path','use'], g: ['g','rect','path','use'], pattern: ['rect','path','image'],
  linearGradient: ['stop'], clipPath: ['rect','g','path'], filter: ['feMorphology'],
};
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;
const number = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
function validateDynamicSvg(source, fail) {
  const ids = new Map(), refs = [], nodes = [], stack = [];
  const numeric = value => number.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1000000;
  const reference = (node, value, kind, direct = false) => {
    const match = direct ? /^#([A-Za-z][A-Za-z0-9_-]{0,119})$/.exec(value) : /^url\(#([A-Za-z][A-Za-z0-9_-]{0,119})\)$/.exec(value);
    if (!match) fail(); refs.push({ owner: [...stack, node].findLast(n => n.a.id)?.a.id, target: match[1], kind });
  };
  let at = 0, rootSeen = false;
  while (at < source.length) {
    const next = source.indexOf('<', at), end = next < 0 ? source.length : next, text = source.slice(at, end);
    if (text.trim() && (stack.at(-1)?.tag !== 'title' || /&(?!amp;|lt;|gt;|quot;|apos;)/.test(text))) fail();
    if (next < 0) { at = source.length; break; }
    const close = source.indexOf('>', next); if (close < 0) fail();
    const token = source.slice(next, close + 1); at = close + 1;
    if (/^<\//.test(token)) {
      const match = /^<\/([A-Za-z][\w:-]*)>$/.exec(token);
      if (!match || stack.pop()?.tag !== match[1]) fail(); continue;
    }
    const match = /^<([A-Za-z][\w:-]*)([^<>]*?)(\/?)>$/.exec(token);
    if (!match || !Object.hasOwn(attrs, match[1]) || nodes.length >= 10000) fail();
    const tag = match[1], a = {}, fields = /\s+([A-Za-z][\w:-]*)="([^"<>]*)"/gy; let index = 0;
    while (index < match[2].length) {
      if (!match[2].slice(index).trim()) break;
      fields.lastIndex = index; const field = fields.exec(match[2]);
      if (!field || Object.hasOwn(a, field[1]) || !attrs[tag].split(' ').includes(field[1])) fail();
      a[field[1]] = field[2]; index = fields.lastIndex;
    }
    if (!stack.length) { if (rootSeen || tag !== 'svg') fail(); rootSeen = true; }
    else if (!children[stack.at(-1).tag]?.includes(tag)) fail();
    const node = { tag, a, childCount: 0 }; if (stack.length) stack.at(-1).childCount++;
    nodes.push(node);
    if (a.id) { if (!identifier.test(a.id) || ids.has(a.id)) fail(); ids.set(a.id, node); }
    for (const [key, value] of Object.entries(a)) {
      if (['x','y','x1','y1','x2','y2','width','height','rx','ry','stroke-width','offset'].includes(key) && tag !== 'svg') {
        if (!numeric(value) || ['width','height'].includes(key) && Number(value) <= 0 || ['rx','ry','stroke-width'].includes(key) && Number(value) < 0) fail();
      } else if (['fill','stroke','stop-color'].includes(key)) {
        if (value.startsWith('url(')) reference(node, value, 'paint');
        else if (!/^(?:#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?|black|white|none)$/.test(value)) fail();
      } else if (['fill-opacity','stroke-opacity','stop-opacity'].includes(key)) { if (!numeric(value) || Number(value) < 0 || Number(value) > 1) fail(); }
      else if (['mask','filter','clip-path'].includes(key)) reference(node, value, key);
      else if (key === 'transform') {
        const operations = /\s*(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)\s*/gy; let pos = 0;
        while (pos < value.length) {
          operations.lastIndex = pos; const op = operations.exec(value); if (!op) fail();
          const values = op[2].trim().split(/[\s,]+/);
          if (!values.every(numeric) || !({ matrix: [6], translate: [1,2], scale: [1,2], rotate: [1,3], skewX: [1], skewY: [1] }[op[1]].includes(values.length))) fail();
          pos = operations.lastIndex;
        }
        if (!pos) fail();
      } else if (key === 'd' && !/^[-+eE0-9.,\sMmLlHhVvCcSsQqTtAaZz]*$/.test(value)) fail();
      else if (['maskUnits','patternUnits','clipPathUnits','filterUnits'].includes(key) && value !== 'userSpaceOnUse') fail();
      else if (key === 'stroke-linejoin' && !['round','miter','bevel'].includes(value)) fail();
      else if (key === 'paint-order' && value !== 'stroke fill') fail();
      else if (key === 'fill-rule' && !['evenodd','nonzero'].includes(value)) fail();
      else if (key === 'color-interpolation' && value !== 'sRGB') fail();
      else if (key === 'preserveAspectRatio' && value !== 'none') fail();
      else if (key === 'data-style-field' && !['foil','black'].includes(value)) fail();
      else if (['data-style-support','data-style-accents'].includes(key) && value !== 'true') fail();
      else if (key === 'data-style-span' && !/^(?:-1|\d{1,2})$/.test(value)) fail();
      else if (key === 'data-part' && !['name','grade','descriptor','certificate','grade-report','metadata','variant'].includes(value)) fail();
    }
    if (tag === 'image') {
      const wordmark = Object.hasOwn(a, 'data-label-wordmark'), marker = wordmark ? 'data-label-wordmark' : 'data-label-texture';
      if (!token.startsWith(`<image ${marker}="`) || !/^[a-f0-9]{64}$/.test(a[marker]) || wordmark === Object.hasOwn(a, 'data-label-texture')
        || !a.href?.startsWith('data:image/png;base64,') || wordmark && (!a.id || stack.at(-1)?.tag !== 'defs')
        || !wordmark && (a.id || stack.at(-1)?.tag !== 'pattern')) fail();
      const base64 = a.href.slice('data:image/png;base64,'.length), bytes = Buffer.from(base64,'base64');
      if (bytes.length < 24) fail();
      try { validateLabelStylePng({ pngBase64: base64, sha256: a[marker], width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, wordmark
        ? { maxWidth: 4096, maxHeight: 512, maxBytes: 262144, colorTypes: [6], maxChunks: 128 } : undefined); }
      catch { fail(); }
      if (wordmark && (Number(a.width) !== bytes.readUInt32BE(16) || Number(a.height) !== bytes.readUInt32BE(20))) fail();
    } else if (tag === 'use') { if (!a.href) fail(); reference(node, a.href, 'image', true); }
    else if (tag === 'feMorphology') { if (a.operator !== 'dilate' || !numeric(a.radius) || Number(a.radius) <= 0 || Number(a.radius) > 20) fail(); }
    if (!match[3]) stack.push(node);
    else if (children[tag] && tag === 'svg') fail();
  }
  if (!rootSeen || stack.length) fail();
  for (const n of nodes) if (n.tag === 'filter' && (n.childCount !== 1 || !n.a.id || n.a.filterUnits !== 'userSpaceOnUse'
    || !['x','y','width','height'].every(k => numeric(n.a[k])) || Number(n.a.width) > 4136 || Number(n.a.height) > 552)) fail();
  const graph = new Map([...ids.keys()].map(id => [id, []]));
  for (const ref of refs) {
    const target = ids.get(ref.target), expected = { paint: ['pattern','linearGradient'], mask: ['mask'], filter: ['filter'], 'clip-path': ['clipPath'], image: ['image'] }[ref.kind];
    if (!target || !expected.includes(target.tag) || ref.kind === 'image' && !target.a['data-label-wordmark']) fail();
    if (ref.owner) graph.get(ref.owner).push(ref.target);
  }
  const active = new Set(), done = new Set();
  const visit = id => { if (active.has(id)) fail(); if (done.has(id)) return; active.add(id); graph.get(id).forEach(visit); active.delete(id); done.add(id); };
  graph.forEach((_, id) => visit(id));
}

export function validateLabelStyleArtwork({printSvg,artworkHash}) {
  const fail=()=>{throw Error('LABEL_PRINT_ARTWORK_INVALID');};
  if (!isLabelStyleArtwork(printSvg) || hash(printSvg)!==artworkHash || Buffer.byteLength(printSvg)>1048576) fail();
  let safe=printSvg, count=0;
  for(const image of Object.values(images)) { const n=safe.split(image).length-1;if(n>1)fail();count+=n;safe=safe.replace(image,''); }
  if(count!==1 || !safe.includes('data-style-support="true"') || !safe.includes('data-style-accents="true"')) fail();
  validateDynamicSvg(safe, fail);
  return printSvg;
}

/** Explicit monochrome foil mode. Color output retains the saved texture;
 * monochrome output knocks the complete accent glyphs through the black field. */
export function labelStyleBlackInk(item) {
  const svg=validateLabelStyleArtwork(item), inverted=svg.includes('data-style-field="foil"');
  if(svg.includes('<g data-style-support="true" fill="black">'))return svg;
  const tail=svg.match(/<g data-style-support="true" fill="[^"]+">([^]*)<\/g><g data-style-accents="true">([^]*)<\/g><\/svg>$/);
  if(!tail)throw Error('LABEL_BLACK_INK_ARTWORK_INVALID');
  const black=value=>value.replace(/fill="(?!none")[^"]+"/g,'fill="black"').replace(/stroke="(?!none")[^"]+"/g,'stroke="black"');
  const support=black(tail[1]),accents=black(tail[2]),solid=support+accents;
  if(inverted)return svg.slice(0,tail.index).replace('<g fill="#090a0b">','<g fill="black">')+`<g data-style-support="true" fill="black">${support}</g><g data-style-accents="true">${accents}</g></svg>`;
  return svg.slice(0,tail.index).replace('</defs>',`<mask id="style-support-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="68.342" height="20.082"><rect width="68.342" height="20.082" fill="white"/>${solid}</mask></defs>`)
    .replace('<g data-style-field="black"','<g mask="url(#style-support-cutout)"><g data-style-field="black"')+'</g><g data-style-support="true" fill="black"></g><g data-style-accents="true"></g></svg>';
}
