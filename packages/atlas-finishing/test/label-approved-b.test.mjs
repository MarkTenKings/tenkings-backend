import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderApprovedBLabel, LABEL_APPROVED_B_RENDERER_PROFILE_HASH } from '../src/label-approved-b.mjs';
import { approvedBHash, validateApprovedBArtwork } from '../src/label-approved-b-artwork.mjs';
import { renderLabelV4 } from '../src/label-v4.mjs';
import { renderLabelV4Png, renderLabelSheetPng, renderLabelExportSvg,
  LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_COLOR_INDIVIDUAL_EXPORT_PROFILE_V1,
  LABEL_BACK_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_COLOR_BACK_EXPORT_PROFILE_V1 } from '../src/label-sheet.mjs';
import { labelPointOnSheet } from '../src/label-sheet-geometry.mjs';
const input = { identity: { playerName: 'Michael Jordan', year: '1998–99', productSet: 'Black Diamond', cardNumber: '8' },
  finalGrade: 8, reportNumber: 'ATLAS-031200997F31', approvalVersion: 1, cardProfile: 'SPORTS' };
const label = () => renderApprovedBLabel(input);
function physical(bytes, w, h, mmW, mmH) {
  assert.equal(bytes.readUInt32BE(16), w); assert.equal(bytes.readUInt32BE(20), h);
  const i = bytes.indexOf(Buffer.from('pHYs')); assert(i > 0);
  assert.equal(bytes.readUInt32BE(i + 4), Math.round(w / (mmW / 1000)));
  assert.equal(bytes.readUInt32BE(i + 8), Math.round(h / (mmH / 1000))); assert.equal(bytes[i + 12], 1);
}

test('approved assets are accepted only by exact bytes; preview, changed URI and active SVG are rejected', () => {
  const result = label(); assert.equal(result.state, 'READY');
  assert.equal(result.rendererProfileHash, LABEL_APPROVED_B_RENDERER_PROFILE_HASH);
  assert.equal(validateApprovedBArtwork(result), result.printSvg);
  assert.equal(validateApprovedBArtwork({ printSvg: result.backPrintSvg, artworkHash: approvedBHash(result.backPrintSvg) }), result.backPrintSvg);
  for (const svg of [result.previewSvg, result.printSvg.replace('data:image/png;base64,', 'https://example.com/'),
    result.printSvg.replace('<defs>', '<defs><script>alert(1)</script>'), result.printSvg.replace('role="img"', 'role="img" onload="alert(1)"'),
    result.printSvg.replace('<defs>', '<defs><image href="data:image/png;base64,INVALID"/>'), result.printSvg.replace('</svg>', '<foreignObject/></svg>')]) {
    assert.throws(() => validateApprovedBArtwork({ printSvg: svg, artworkHash: approvedBHash(svg) }), /ARTWORK_INVALID/);
  }
  assert.throws(() => validateApprovedBArtwork({ ...result, artworkHash: 'f'.repeat(64) }), /ARTWORK_INVALID/);
  assert.throws(() => renderLabelExportSvg(renderLabelV4(input), { side: 'BACK' }), /APPROVED_B_REQUIRED/);
  assert.throws(() => renderLabelExportSvg(renderLabelV4(input), { color: true }), /APPROVED_B_REQUIRED/);
  assert.throws(() => renderLabelExportSvg({ ...result, previewMaterial: undefined }, { color: true }), /MATERIAL_INVALID/);
});

test('actual 2400ppi black/white/color/front/back exports preserve dimensions, white knockouts and fixed geometry', async () => {
  const original = label(), before = original.printSvg;
  const white = await renderLabelV4Png(original);
  const black = await renderLabelV4Png(original, { exportProfileId: LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.id });
  const color = await renderLabelV4Png(original, { exportProfileId: LABEL_COLOR_INDIVIDUAL_EXPORT_PROFILE_V1.id });
  const back = await renderLabelV4Png(original, { exportProfileId: LABEL_BACK_INDIVIDUAL_EXPORT_PROFILE_V1.id });
  for (const result of [white, black, color, back]) {
    physical(result.bytes, 6458, 1898, 68.342, 20.082);
    assert.equal(result.manifest.artworkHash, original.artworkHash);
    assert.equal(result.manifest.rasterReceipt.alphaBinary, true);
  }
  const [w,b,c,k] = await Promise.all([white,black,color,back].map(result => sharp(result.bytes).ensureAlpha().raw().toBuffer()));
  let whiteReveals=0,backInk=0;
  for(let i=0;i<b.length;i+=4){
    if(b[i]||b[i+1]||b[i+2]||![0,255].includes(b[i+3]))assert.fail('Black output must contain only black/clear pixels');
    if(!w[i+3])assert.equal(b[i+3],0,'Existing cuts stay transparent');
    if(w[i]===255&&w[i+1]===255&&w[i+2]===255&&w[i+3]===255){assert.equal(b[i+3],0);whiteReveals++;}
    assert.equal(c[i+3],255,'Color output includes stock throughout its exact rectangular canvas');
    if(k[i]||k[i+1]||k[i+2]||![0,255].includes(k[i+3]))assert.fail('Shared back contains no white ink');
    if(k[i+3])backInk++;
  }
  assert(whiteReveals>50000);assert(backInk>100000);
  const pixel=(data,x,y)=>[...data.subarray((Math.floor(y/20.082*1898)*6458+Math.floor(x/68.342*6458))*4,(Math.floor(y/20.082*1898)*6458+Math.floor(x/68.342*6458))*4+4)];
  assert.deepEqual(pixel(b,51.8,9.75),[0,0,0,0]); assert.deepEqual(pixel(c,51.8,9.75),[207,173,88,255]);
  assert.deepEqual(pixel(b,44.7,12),[0,0,0,255]); assert.deepEqual(pixel(b,0,0),[0,0,0,0]);
  assert.equal(original.printSvg,before); assert.equal(approvedBHash(before),original.artworkHash);
});

test('partial color back sheet retains first/last occupied slots and transparent unused jig positions', async () => {
  const item=label(), items=[{...item,slot:50},{...item,slot:1}];
  const result=await renderLabelSheetPng(items,{exportProfileId:LABEL_COLOR_BACK_EXPORT_PROFILE_V1.id});
  physical(result.bytes,9764,12598,310,400);
  assert.equal(result.manifest.side,'BACK');assert.equal(result.manifest.outputMode,'COLOR_PRINT');
  assert.deepEqual(result.manifest.orderedArtwork.map(row=>row.slot),[1,50]);
  for(const [slot,expected]of [[1,[207,173,88,255]],[50,[207,173,88,255]],[25,[0,0,0,0]]]){
    const p=labelPointOnSheet(slot,1,1),raw=await sharp(result.bytes).extract({left:Math.floor(p.xMm/310*9764),top:Math.floor(p.yMm/400*12598),width:1,height:1}).raw().toBuffer();
    assert.deepEqual([...raw],expected);
  }
});


test('unconfirmed identity fields remain absent without inventing label data', () => {
  const identity = { playerName: null, cardName: null, year: null, productSet: null, manufacturer: null, cardNumber: null, parallel: null, insert: null };
  const result = renderApprovedBLabel({ ...input, identity });
  assert.equal(result.state, 'READY');
  assert.deepEqual(result.source.identity, identity);
  assert.deepEqual(result.diagnostics.name.lines, []);
  assert.deepEqual(result.diagnostics.metadata.lines, []);
  assert(!result.printSvg.includes('Unknown'));
});
