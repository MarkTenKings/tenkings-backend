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

// A real 2×2 grid composed from four references to unchanged upstream HEVC tile
// bytes. A nonmultiple canvas exercises native removal of padded right/bottom tiles.
export function gridFixture(bytes, { primaryProperties=[], tileProperties=[], color=null, tileColor=color, padding=[3,5] }={}) {
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
  const u16=n=>{const d=Buffer.alloc(2);d.writeUInt16BE(n);return d;};
  const u32=n=>{const d=Buffer.alloc(4);d.writeUInt32BE(n);return d;};
  const infe=(id,type,hidden)=>box('infe',Buffer.concat([Buffer.from([2,0,0,hidden?1:0]),u16(id),u16(0),Buffer.from(type+'\0')]));
  const associations=(id,ids)=>Buffer.concat([u16(id),Buffer.from([ids.length,...ids.map(n=>0x80|n)])]);
  const iprp=box('iprp',Buffer.concat([box('ipco',Buffer.concat(all)),box('ipma',Buffer.concat([u32(0),u32(5),
    ...[1,2,3,4].map(id=>associations(id,tAssoc)),associations(5,pAssoc)]))]));
  const gridData=Buffer.concat([Buffer.from([0,0,1,1]),u16(width),u16(height)]);
  const ilocEntry=(id,offset,length)=>Buffer.concat([u16(id),u16(0),u32(offset),u16(1),u32(0),u32(length)]);
  const buildMeta=offset=>box('meta',Buffer.concat([u32(0),box('hdlr',meta.find(b=>b.type==='hdlr').data),box('pitm',Buffer.concat([u32(0),u16(5)])),
    box('iloc',Buffer.concat([u32(0),Buffer.from([0x44,0x40]),u16(5),...[1,2,3,4].map(id=>ilocEntry(id,offset,tile.length)),ilocEntry(5,offset+tile.length,8)])),
    box('iinf',Buffer.concat([u32(0),u16(5),...[1,2,3,4].map(id=>infe(id,'hvc1',true)),infe(5,'grid',false)])),
    box('iref',Buffer.concat([u32(0),box('dimg',Buffer.concat([u16(5),u16(4),u16(1),u16(2),u16(3),u16(4)]))])),iprp]));
  const ftyp=box('ftyp',roots[0].data),length=buildMeta(0).length;
  return Buffer.concat([ftyp,buildMeta(ftyp.length+length+8),box('mdat',Buffer.concat([tile,gridData]))]);
}
