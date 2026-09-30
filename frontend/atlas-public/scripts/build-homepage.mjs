// Package the approved standalone presentation without coupling it to report/account runtimes.
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.resolve(app,'../..');
const study=path.join(repo,'docs/atlas/design/first-look');
const names=['index.html','study.css','submission-source.css','study.js','slab.js','hero-reports.js','hero-report-model.mjs','report-guidance.js','report-guidance.css','report-embed.js','chapter-stops.js','inspect-source/report-review.css'];
const inputs=await Promise.all(names.map(n=>readFile(path.join(study,n),'utf8')));
// Only the synthetic specimen is published. Historical approved card packets
// remain in source/audit custody and must never enter a homepage build.
const reportNames=['alakazam-demo.json'];
const hash=createHash('sha256').update(inputs.join('\n'));
for(const name of reportNames)hash.update(name).update(await readFile(path.join(study,'reports',name)));
const version=hash.digest('hex').slice(0,16);
const prefix='/homepage/'+version;
const output=path.join(app,'public',prefix);
await mkdir(output,{recursive:true});
const rebase=s=>s.replaceAll('/reports-data/',prefix+'/reports/').replaceAll('/assets/',prefix+'/assets/').replaceAll('/service/',prefix+'/service/').replaceAll('https://atlasgrading.com/account/submit','/account/submit');
for(let i=1;i<names.length;i++){await mkdir(path.dirname(path.join(output,names[i])),{recursive:true});await writeFile(path.join(output,names[i]),rebase(inputs[i]));}
for(const name of ['alakazam-reference.jpg','alakazam-label-sample.svg','oxanium.ttf','Oxanium-OFL.txt','vendor/three.core.js','vendor/three.module.js']){
 const target=path.join(output,'assets',name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(study,'assets',name),target);
}
for(const name of ['submission-kiosk.jpg','submission-fedex.jpg','submission-kiosk.mp4','submission-fedex.mp4']){
 const target=path.join(output,'service',name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(repo,'frontend/atlas-customer/public/atlas',name),target);
}
await mkdir(path.join(output,'reports'),{recursive:true});
for(const name of reportNames){const source=path.join(study,'reports',name),target=path.join(output,'reports',name);if(name.endsWith('.json'))await writeFile(target,rebase(await readFile(source,'utf8')));else await copyFile(source,target);}
await copyFile(path.join(study,'report-embed.js.LEGAL.txt'),path.join(output,'report-embed.js.LEGAL.txt'));
// Also expose the same optional teaching cue to the public report renderer.
for(const name of ['report-guidance.js','report-guidance.css'])await copyFile(path.join(study,name),path.join(app,'public',name));
let html=rebase(inputs[0]);
for(const name of names.slice(1))html=html.replaceAll('\"/'+name+'\"','\"'+prefix+'/'+name+'\"');
html=html .replace('DESIGN STUDY 10 / EVERY DETAIL LEAVES A SIGNATURE.','EVERY DETAIL LEAVES A SIGNATURE.')
 .replace('</title>','</title><meta name="description" content="Go beyond the grade. Explore the ATLAS fingerprint, tap-to-report technology and card submission options."><link rel="canonical" href="https://atlasgrading.com/">');
await writeFile(path.join(app,'public/homepage/index.html'),html);
await writeFile(path.join(app,'public/homepage/release.json'),JSON.stringify({version,presentation:'study10',illustrativeReport:true,approvedReportCount:0})+'\n');
console.log(JSON.stringify({status:'HOMEPAGE_PACKAGED',version,prefix}));
