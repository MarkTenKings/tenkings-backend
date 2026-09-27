import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=await readFile(new URL('../study.js',import.meta.url),'utf8');
const recipe=source.split('// ATLAS_FINGERPRINT_V1_BEGIN')[1].split('\n').slice(1).join('\n').split('// ATLAS_FINGERPRINT_V1_END')[0];
const context=vm.createContext({});vm.runInContext(recipe,context);
const digest=text=>Promise.resolve(createHash('sha256').update(text).digest('hex'));
const make=input=>context.createAtlasFingerprint(input,digest);
const record={card:{edition:'Alakazam / A–001',widthMm:63,heightMm:88},defects:[{side:'front',kind:'CORNERS',outline:[[.034,.045],[.081,.039],[.098,.075],[.067,.103],[.035,.091]],measurement:.38,unit:'mm'},{side:'front',kind:'EDGES',outline:[[.015,.69],[.049,.697],[.063,.736],[.029,.75],[.018,.724]],measurement:.62,unit:'mm'},{side:'front',kind:'SURFACE',outline:[[.62,.35],[.651,.337],[.682,.369],[.663,.397],[.628,.382]],measurement:.24,unit:'mm²'}]};
test('identical input recreates byte-identical signature without mutating input',async()=>{const before=JSON.stringify(record),a=await make(record),b=await make(structuredClone(record));assert.equal(a.digest,b.digest);assert.equal(JSON.stringify(a.paths),JSON.stringify(b.paths));assert.equal(JSON.stringify(record),before);assert.equal(a.version,'atlas-fingerprint-v1');assert.equal(a.paths.some(p=>/NaN|Infinity/.test(p)),false);});
test('defect order, outline start point, closing point and winding do not change identity',async()=>{const a=await make(record),copy=structuredClone(record);copy.defects.reverse();for(const d of copy.defects){d.outline.reverse();d.outline.push(d.outline.shift());d.outline.push(d.outline[0]);}const b=await make(copy);assert.equal(a.canonical,b.canonical);assert.equal(a.digest,b.digest);assert.equal(JSON.stringify(a.paths),JSON.stringify(b.paths));});
for(const [name,mutate] of Object.entries({location:r=>r.defects[0].outline=r.defects[0].outline.map(([x,y])=>[x+.01,y+.02]),shape:r=>r.defects[0].outline[1][1]+=.004,size:r=>r.defects[0].measurement+=.01,card:r=>r.card.edition='Another edition',side:r=>r.defects[0].side='back',dimensions:r=>r.card.widthMm=64})){test(`changing ${name} changes the digest and visual pattern`,async()=>{const a=await make(record),copy=structuredClone(record);mutate(copy);const b=await make(copy);assert.notEqual(a.digest,b.digest);assert.notEqual(JSON.stringify(a.paths),JSON.stringify(b.paths));});}
test('invalid or missing evidence cannot produce a signature',async()=>{for(const mutate of [r=>r.defects=[],r=>r.defects[0].measurement=-1,r=>r.defects[0].outline[0][0]=NaN,r=>r.defects[0].outline[0][0]=2,r=>r.defects[0].outline=[[0,0],[1,1]],r=>r.card.widthMm=0]){const copy=structuredClone(record);mutate(copy);await assert.rejects(make(copy));}});
console.log('Fixture record digest:',(await make(record)).digest);
