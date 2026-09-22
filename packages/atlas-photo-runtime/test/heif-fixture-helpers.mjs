import assert from 'node:assert/strict';
import { boxes } from '../src/heif-container.mjs';

export function box(type, data) {
  const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(type,4);
  return Buffer.concat([header,data]);
}
// Controlled variants preserve every compressed HEVC byte; only test properties,
// box lengths and the necessary media base offset change.
export function withProperties(bytes, added) {
  const roots = boxes(bytes), meta = roots.find(b=>b.type==='meta');
  const children = boxes(meta.data,4), iprp = children.find(b=>b.type==='iprp');
  const parts = boxes(iprp.data), ipco = parts.find(b=>b.type==='ipco'), ipma = parts.find(b=>b.type==='ipma');
  const prior = boxes(ipco.data).length, association = ipma.data;
  assert.equal(association.readUInt32BE(0),0); assert.equal(association.readUInt32BE(4),1);
  assert.equal(association.readUInt16BE(8),1); assert.equal(association.length,11+association[10]);
  const updated = Buffer.concat([association,Buffer.from(added.map((_,i)=>0x80|(prior+i+1)))]);
  updated[10] += added.length;
  const newIprp = box('iprp',Buffer.concat(parts.map(p=>p.type==='ipco'
    ? box('ipco',Buffer.concat([p.data,...added.map(([type,data])=>box(type,data))]))
    : p.type==='ipma' ? box('ipma',updated) : box(p.type,p.data))));
  const delta = newIprp.length-(iprp.end-iprp.start);
  const newMeta = box('meta',Buffer.concat([meta.data.subarray(0,4),...children.map(child=>{
    if(child.type==='iprp') return newIprp;
    if(child.type==='iloc') {
      const data=Buffer.from(child.data); assert.equal(data.toString('hex',0,8),'0000000044400001');
      assert.equal(data.length,26); const offset=data.readUInt32BE(12); data.writeUInt32BE(offset+delta,12);
      return box(child.type,data);
    }
    return box(child.type,child.data);
  })]));
  return Buffer.concat(roots.map(root=>root===meta?newMeta:bytes.subarray(root.start,root.end)));
}
export function cropProperty(width,height,xOffset=0,yOffset=0) {
  const data=Buffer.alloc(32);
  [width,1,height,1,xOffset,1,yOffset,1].forEach((v,i)=>i===4||i===6?data.writeInt32BE(v,i*4):data.writeUInt32BE(v,i*4));
  return ['clap',data];
}
export function primaryVariant(bytes,id) {
  const result=Buffer.from(bytes),meta=boxes(result).find(b=>b.type==='meta');
  const pitm=boxes(meta.data,4).find(b=>b.type==='pitm'); assert.equal(pitm.data[0],0);
  pitm.data.writeUInt16BE(id,4); return result;
}

// Test-only metadata addition for the v0 iloc fixtures above. No HEVC byte changes.
export function withExif(bytes, tiff, { prefix = Buffer.alloc(0), associatedId = null } = {}) {
  const roots = boxes(bytes), meta = roots.find(b => b.type === 'meta'), children = boxes(meta.data, 4);
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const infos = children.find(b => b.type === 'iinf').data;
  const ids = boxes(infos, 6).map(b => b.data.readUInt16BE(4)), id = Math.max(...ids) + 1;
  const primary = associatedId ?? children.find(b => b.type === 'pitm').data.readUInt16BE(4);
  const payload = Buffer.concat([u32(prefix.length), prefix, tiff]);
  const cdsc = box('cdsc', Buffer.concat([u16(id), u16(1), u16(primary)]));
  function build(delta) {
    const rewritten = children.map(child => {
      if (child.type === 'iloc') {
        const data = Buffer.from(child.data); assert.equal(data.toString('hex', 0, 6), '000000004440');
        const count = data.readUInt16BE(6); assert.equal(data.length, 8 + 18 * count);
        for (let i = 0; i < count; i++) data.writeUInt32BE(data.readUInt32BE(12 + i * 18) + delta, 12 + i * 18);
        data.writeUInt16BE(count + 1, 6);
        return box('iloc', Buffer.concat([data, u16(id), u16(0), u32(bytes.length + delta + 8), u16(1), u32(0), u32(payload.length)]));
      }
      if (child.type === 'iinf') {
        const data = Buffer.from(child.data); data.writeUInt16BE(ids.length + 1, 4);
        return box('iinf', Buffer.concat([data, box('infe', Buffer.concat([Buffer.from([2, 0, 0, 0]), u16(id), u16(0), Buffer.from('Exif\0')]))]));
      }
      if (child.type === 'iref') return box('iref', Buffer.concat([child.data, cdsc]));
      return box(child.type, child.data);
    });
    if (!children.some(b => b.type === 'iref')) rewritten.push(box('iref', Buffer.concat([u32(0), cdsc])));
    return box('meta', Buffer.concat([u32(0), ...rewritten]));
  }
  const delta = build(0).length - (meta.end - meta.start);
  return Buffer.concat([...roots.map(r => r === meta ? build(delta) : bytes.subarray(r.start, r.end)), box('mdat', payload)]);
}

export function orientationExif(orientation, littleEndian = false) {
  const data = Buffer.from('4d4d002a00000008000101120003000000010001000000000000', 'hex');
  if (!littleEndian) { data.writeUInt16BE(orientation, 18); return data; }
  return Buffer.from([0x49,0x49,42,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
}

// A real 2×2 grid composed from four references to unchanged upstream HEVC tile
// bytes. A nonmultiple canvas exercises native removal of padded right/bottom tiles.
export function gridFixture(bytes, { primaryProperties=[], tileProperties=[], color=null, tileColor=color, tileColorIds=[1,2,3,4], padding=[3,5], auxiliaryType=null }={}) {
  const roots=boxes(bytes), meta=boxes(roots.find(b=>b.type==='meta').data,4);
  const props=boxes(boxes(meta.find(b=>b.type==='iprp').data).find(b=>b.type==='ipco').data);
  const tile=roots.find(b=>b.type==='mdat').data;
  const ispe=props.find(p=>p.type==='ispe').data,tw=ispe.readUInt32BE(4),th=ispe.readUInt32BE(8);
  const width=tw*2-padding[0],height=th*2-padding[1];
  const size=(w,h)=>{const data=Buffer.alloc(12);data.writeUInt32BE(w,4);data.writeUInt32BE(h,8);return box('ispe',data);};
  const all=[box('hvcC',props.find(p=>p.type==='hvcC').data),size(tw,th),size(width,height)];
  const tAssoc=[1,2],pAssoc=[3];
  for(const [values,associated] of [[tileProperties,tAssoc],[primaryProperties,pAssoc]]) for(const [kind,data]of values){all.push(box(kind,data));associated.push(all.length);}
  for(const [profile,associated]of[[tileColor,tAssoc],[color,pAssoc]]) if(profile){all.push(box('colr',profile));associated.push(all.length);}
  const tileColorIndex=tileColor?tAssoc.at(-1):null;
  const auxiliaryAssoc=[1,2];
  if(auxiliaryType){all.push(box('auxC',Buffer.concat([Buffer.alloc(4),Buffer.from(auxiliaryType+'\0')])));auxiliaryAssoc.push(all.length);}
  const itemCount=auxiliaryType?6:5;
  const u16=n=>{const d=Buffer.alloc(2);d.writeUInt16BE(n);return d;};
  const u32=n=>{const d=Buffer.alloc(4);d.writeUInt32BE(n);return d;};
  const infe=(id,type,hidden)=>box('infe',Buffer.concat([Buffer.from([2,0,0,hidden?1:0]),u16(id),u16(0),Buffer.from(type+'\0')]));
  const associations=(id,ids)=>Buffer.concat([u16(id),Buffer.from([ids.length,...ids.map(n=>0x80|n)])]);
  const iprp=box('iprp',Buffer.concat([box('ipco',Buffer.concat(all)),box('ipma',Buffer.concat([u32(0),u32(itemCount),
    ...[1,2,3,4].map(id=>associations(id,tAssoc.filter(index=>index!==tileColorIndex||tileColorIds.includes(id)))),associations(5,pAssoc),...(auxiliaryType?[associations(6,auxiliaryAssoc)]:[])]))]));
  const gridData=Buffer.concat([Buffer.from([0,0,1,1]),u16(width),u16(height)]);
  const ilocEntry=(id,offset,length)=>Buffer.concat([u16(id),u16(0),u32(offset),u16(1),u32(0),u32(length)]);
  const buildMeta=offset=>box('meta',Buffer.concat([u32(0),box('hdlr',meta.find(b=>b.type==='hdlr').data),box('pitm',Buffer.concat([u32(0),u16(5)])),
    box('iloc',Buffer.concat([u32(0),Buffer.from([0x44,0x40]),u16(itemCount),...[1,2,3,4].map(id=>ilocEntry(id,offset,tile.length)),ilocEntry(5,offset+tile.length,8),...(auxiliaryType?[ilocEntry(6,offset,tile.length)]:[])])),
    box('iinf',Buffer.concat([u32(0),u16(itemCount),...[1,2,3,4].map(id=>infe(id,'hvc1',true)),infe(5,'grid',false),...(auxiliaryType?[infe(6,'hvc1',true)]:[])])),
    box('iref',Buffer.concat([u32(0),box('dimg',Buffer.concat([u16(5),u16(4),u16(1),u16(2),u16(3),u16(4)])),...(auxiliaryType?[box('auxl',Buffer.concat([u16(6),u16(1),u16(5)]))]:[])])),iprp]));
  const ftyp=box('ftyp',roots[0].data),length=buildMeta(0).length;
  return Buffer.concat([ftyp,buildMeta(ftyp.length+length+8),box('mdat',Buffer.concat([tile,gridData]))]);
}
