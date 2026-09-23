import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createManualLabelPdfRenderer } from '../src/label-pdf.mjs';
import { samplePlan } from '../test/manual-fixture.mjs';

// Explicit local optical test. Poppler + pinned OpenCV are supplied by the
// owned acceptance runtime, never installed or invoked on ordinary import.
const { ATLAS_PDFTOPPM: poppler, ATLAS_MEASUREMENT_PYTHON: python } = process.env;
assert.ok(poppler?.startsWith('/') && python?.startsWith('/'), 'Explicit Poppler and Python paths required');
const directory=await mkdtemp(join(tmpdir(),'atlas-label-pdf-'));
try{
  const plan=samplePlan({mode:'LOCAL_FIXTURE'});
  for(const rotation of [0,180]){
    const render=createManualLabelPdfRenderer({layout:{version:'atlas-label-sheet-v1',widthPoints:196.56,heightPoints:59.76,
      pages:['FRONT','REVERSE'].map(face=>({placements:[{face,x:0,y:0,rotation}]}))}});
    const result=await render(plan),pdf=join(directory,`label-${rotation}.pdf`),prefix=join(directory,`label-${rotation}`);
    await writeFile(pdf,result.bytes);
    execFileSync(poppler,['-r','300','-png',pdf,prefix],{timeout:60000,stdio:'pipe'});
    execFileSync(python,['-c',`import cv2,sys
image=cv2.imread(sys.argv[1])
assert image.shape[:2] == (249,819), image.shape
value,points,_=cv2.QRCodeDetector().detectAndDecode(image)
assert value == sys.argv[2], repr(value)
assert points is not None
`,`${prefix}-2.png`,plan.label.url],{timeout:15000,stdio:'pipe'});
  }
  console.log(JSON.stringify({status:'LABEL_PDF_OPTICAL_PASS',checks:['exact physical page dimensions','reproducible vector rendering','QR decoded at 300dpi in both qualified rotations'],hardwareEffects:0}));
}finally{await rm(directory,{recursive:true});}
