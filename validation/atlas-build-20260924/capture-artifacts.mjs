import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative,resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
const app = process.env.ATLAS_VALIDATION_APP;
assert(['atlas-customer','atlas-public','atlas-app'].includes(app));
const root = `/build/frontend/${app}`;
const files = directory => readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.name === 'cache' ? [] : entry.isDirectory() ? files(join(directory,entry.name)) : [join(directory,entry.name)]);
const built = [...files(join(root,'.next')),...files(join(root,'.generated'))].sort();
const artifactHash = createHash('sha256');
let bytes = 0, traces = 0, tracedFiles = 0;
for (const path of built) {
  const data = readFileSync(path); bytes += data.length;
  artifactHash.update(relative(root,path)+'\0'+createHash('sha256').update(data).digest('hex')+'\n');
  if (path.endsWith('.nft.json')) {
    traces++;
    for (const target of JSON.parse(data).files) {
      assert(resolve(dirname(path),target).startsWith('/build/'), `External trace: ${target}`);
      tracedFiles++;
    }
  }
}
const source = readFileSync('/build/source-manifest.json');
console.log(JSON.stringify({app,node:process.version,platform:process.platform,architecture:process.arch,
  sourceManifestSha256:createHash('sha256').update(source).digest('hex'),
  artifactSha256:artifactHash.digest('hex'),artifactFileCount:built.length,artifactBytes:bytes,
  buildId:readFileSync(join(root,'.next/BUILD_ID'),'utf8').trim(),
  pages:JSON.parse(readFileSync(join(root,'.next/server/pages-manifest.json'),'utf8')),
  basePath:JSON.parse(readFileSync(join(root,'.next/routes-manifest.json'),'utf8')).basePath,
  serverTraces:traces,tracedFiles,externalTracePaths:0},null,2));
