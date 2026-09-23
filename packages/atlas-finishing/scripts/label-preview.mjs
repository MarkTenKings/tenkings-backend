import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { samplePlan } from '../test/manual-fixture.mjs';

// Generates a standalone, explicitly synthetic design proof. No HTTP server,
// provider, print dialog, actual spool, reader or production identifier is used.
const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const QRCode = require('qrcode');
const label = samplePlan({ mode: 'LOCAL_FIXTURE' }).label;
const modules = QRCode.create(label.url, { errorCorrectionLevel: 'M' }).modules;
const rows = Array.from({ length: modules.size }, (_, row) => Array.from({ length: modules.size }, (_, col) => modules.get(row, col)));
const source = (await readFile(new URL('../src/label.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
const output = resolve(process.argv[2] || '/tmp/atlas-label-design.html');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS label design · example only</title><style>
*{box-sizing:border-box}body{margin:0;background:#101310;color:#ece9dd;font:14px Arial,sans-serif}main{max-width:1200px;padding:70px 40px;margin:auto}header{display:flex;justify-content:space-between;align-items:start;border-bottom:1px solid #bba16a40;padding-bottom:28px}.eyebrow{font-size:10px;letter-spacing:.3em;color:#d2b26b}h1{font:52px Georgia,serif;letter-spacing:-1.5px;margin:18px 0 12px}.note{font-size:12px;color:#acb19f;line-height:1.6}.badge{font-size:10px;border:1px solid #d2b26b60;border-radius:100px;padding:9px 13px;color:#d2b26b}h2{font-size:10px;font-weight:400;letter-spacing:.2em;color:#d2b26b;margin:38px 0 16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.face{padding:28px 20px;background:#080a08;border-radius:12px;border:1px solid #ffffff0b}.face>svg{display:block;width:100%;height:auto;filter:drop-shadow(0 9px 13px #000)}.legend{display:flex;gap:24px;margin-top:20px;color:#989f8d;font-size:11px}.actual{display:flex;gap:18px;flex-wrap:wrap;padding:28px;background:#fff;width:fit-content;border-radius:10px}.actual svg{display:block;width:2.73in;height:.83in}.footer{border-top:1px solid #bba16a30;margin-top:35px;padding-top:20px;color:#979f8c;font-size:11px;line-height:1.7}footer b{color:#d2b26b}@media(max-width:700px){main{padding:35px 20px}h1{font-size:40px}.pair{grid-template-columns:1fr}.badge{max-width:95px;line-height:1.4}.legend{flex-wrap:wrap;gap:10px}}@media print{@page{size:letter;margin:1in}body{background:white}main{padding:0}header,.pair,.legend,.footer,h2{display:none}.actual{padding:0;background:white;border:0;display:block}.actual svg{margin-bottom:.25in;print-color-adjust:exact;-webkit-print-color-adjust:exact;break-inside:avoid}}
</style><main><header><div><div class="eyebrow">ATLAS · LABEL DESIGN 01</div><h1>A small label.<br>A strong signature.</h1><div class="note">Noir, warm gold, precise identity.<br>Vector artwork. Same approved report. Ready to scale.</div></div><div class="badge">EXAMPLE ONLY</div></header><h2>BLACK + GOLD · FRONT / REVERSE</h2><div class="pair" id="noir"></div><div class="legend"><span>2.73 × 0.83 in per face</span><span>11 mm NFC reserve · 9 mm guide</span><span>Exact approved report QR</span></div><h2>MONOCHROME · PRINTER ALTERNATIVE</h2><div class="pair" id="mono"></div><h2>ACTUAL SIZE · EXAMPLE PROOF</h2><div class="actual" id="actual"></div><div class="footer">The number is a report reference. This example issues no certificate and makes no authenticity claim.<br>Printer, material, margins and NFC placement require physical acceptance before production use.</div></main><script type="module">
${source}
const label = ${JSON.stringify(label)}, rows = ${JSON.stringify(rows)}, context = document.createElement('canvas').getContext('2d');
const measureText = (value,size,weight) => { context.font = weight+' '+size+'px Arial'; return context.measureText(value).width; };
const qr = {size:rows.length,get:(row,column)=>rows[row][column]};
for(const [id,palette] of [['noir','NOIR_GOLD'],['mono','MONOCHROME']]){const result=renderManualLabel({label,measureText,qr,palette});document.getElementById(id).innerHTML='<div class="face">'+result.front+'</div><div class="face">'+result.reverse+'</div>';if(id==='noir')document.getElementById('actual').innerHTML=result.front+result.reverse;}
window.labelPreviewReady=true;
</script></html>`;
await writeFile(output, html, { mode: 0o600 }); console.log(output);
