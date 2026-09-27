import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../../..');
const require=createRequire(path.join(repo,'packages/atlas-manual-workspace/package.json'));
const {build}=require('esbuild');
await build({entryPoints:[path.join(here,'report-embed.jsx')],outfile:path.join(here,'report-embed.js'),bundle:true,format:'esm',platform:'browser',target:['es2022'],jsx:'automatic',minify:true,legalComments:'linked',define:{'process.env.NODE_ENV':'"production"'},alias:{react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json')),'@atlas/grading-core/scoring':require.resolve('@atlas/grading-core/scoring'),'@atlas/grading-core/trace-codec':require.resolve('@atlas/grading-core/trace-codec')},metafile:true}).then(r=>{
if(Object.keys(r.metafile.inputs).some(p=>/server\/|atlas-operator|atlasWorkspace|private-runtime/.test(p)))throw Error('Unexpected private renderer dependency');
console.log('ATLAS Inspect bundled: '+Object.keys(r.metafile.inputs).length+' browser-only inputs');
});
