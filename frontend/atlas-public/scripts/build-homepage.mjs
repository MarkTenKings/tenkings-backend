// Package the approved standalone presentation without coupling it to report/account runtimes.
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.resolve(app,'../..');
const study=path.join(repo,'docs/atlas/design/first-look');
const names=['index.html','study.css','submission-source.css','study.js','slab.js'];
const inputs=await Promise.all(names.map(n=>readFile(path.join(study,n),'utf8')));
const version=createHash('sha256').update(inputs.join('\n')).digest('hex').slice(0,16);
const prefix='/homepage/'+version;
const output=path.join(app,'public',prefix);
await mkdir(output,{recursive:true});
const rebase=s=>s.replaceAll('/assets/',prefix+'/assets/').replaceAll('/service/',prefix+'/service/').replaceAll('https://atlasgrading.com/account/submit','/account/submit');
for(let i=1;i<names.length;i++)await writeFile(path.join(output,names[i]),rebase(inputs[i]));
for(const name of ['alakazam-reference.jpg','alakazam-label-sample.svg','oxanium.ttf','Oxanium-OFL.txt','vendor/three.core.js','vendor/three.module.js']){
 const target=path.join(output,'assets',name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(study,'assets',name),target);
}
for(const name of ['submission-kiosk.jpg','submission-fedex.jpg','submission-kiosk.mp4','submission-fedex.mp4']){
 const target=path.join(output,'service',name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(repo,'frontend/atlas-customer/public/atlas',name),target);
}
let html=rebase(inputs[0]).replaceAll('href="/study.css"',`href="${prefix}/study.css"`).replaceAll('href="/submission-source.css"',`href="${prefix}/submission-source.css"`).replaceAll('src="/study.js"',`src="${prefix}/study.js"`).replaceAll('src="/slab.js"',`src="${prefix}/slab.js"`)
 .replace('DESIGN STUDY 08 / EVERY DETAIL LEAVES A SIGNATURE.','EVERY DETAIL LEAVES A SIGNATURE.')
 .replace('</title>','</title><meta name="description" content="Go beyond the grade. Explore the ATLAS fingerprint, tap-to-report technology and card submission options."><link rel="canonical" href="https://atlasgrading.com/">');
await writeFile(path.join(app,'public/homepage/index.html'),html);
await writeFile(path.join(app,'public/homepage/release.json'),JSON.stringify({version,presentation:'study08',illustrativeReport:true})+'\n');
console.log(JSON.stringify({status:'HOMEPAGE_PACKAGED',version,prefix}));
