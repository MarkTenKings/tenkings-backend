import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

async function fixture(work) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'atlas-customer-boundary-')));
  try {
    for(const path of ['scripts','.next/server/pages/api/customer','.next/static/chunks','.generated/customer-database'])await mkdir(join(root,path),{recursive:true});
    await writeFile(join(root,'scripts/check-boundary.mjs'),await readFile(new URL('../scripts/check-boundary.mjs',import.meta.url)));
    const paths=['/','/404','/_app','/_document','/_error','/api/customer/[...path]','/collection','/profile','/submit','/dealer','/dealer/handoff','/orders/[id]','/verify-email'];
    await writeFile(join(root,'.next/server/pages-manifest.json'),JSON.stringify(Object.fromEntries(paths.map(p=>[p,p==='/api/customer/[...path]'?'pages/api/customer/[...path].js':'unused.js']))));
    await writeFile(join(root,'.next/routes-manifest.json'),JSON.stringify({basePath:'/account'}));
    const runtime=['schema.prisma','libquery_engine-fixture.node'];
    for(const file of runtime)await writeFile(join(root,'.generated/customer-database',file),'synthetic trace file; never loaded');
    await writeFile(join(root,'.next/server/pages/api/customer/[...path].js.nft.json'),JSON.stringify({files:runtime.map(file=>join(root,'.generated/customer-database',file))}));
    const chunk=join(root,'.next/static/chunks/customer.js');
    const run=()=>spawnSync(process.execPath,[join(root,'scripts/check-boundary.mjs')],{encoding:'utf8',env:{}});
    await work({chunk,run});
  } finally { await rm(root,{recursive:true,force:true}); }
}

test('actual boundary script accepts only its expected customer routes and packaged runtime with clean browser code',async()=>{
  await fixture(async({chunk,run})=>{await writeFile(chunk,'console.log("customer UI");');const result=run();assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS customer build/);});
});

test('actual boundary script rejects new history credential marker and existing server authority in browser chunks',async()=>{
  await fixture(async({chunk,run})=>{
    for(const marker of ['ATLAS_CUSTOMER_OWNERSHIP_HISTORY_DATABASE_URL','ATLAS_CUSTOMER_DATABASE_URL','ATLAS_CUSTOMER_SESSION_KEY','customer_read(','customer_call(']){
      await writeFile(chunk,JSON.stringify(marker));const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/Server-only customer authority leaked into a browser chunk/);
    }
  });
});
