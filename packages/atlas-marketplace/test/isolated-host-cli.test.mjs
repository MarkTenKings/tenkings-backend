import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,readFile,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runIsolatedHostQualificationCli} from '../scripts/qualify-isolated-host.mjs';

test('isolated CLI is inert without enablement and refuses missing or extra executable inputs',async()=>{
  assert.equal((await runIsolatedHostQualificationCli([])).status,'DISABLED');
  await assert.rejects(runIsolatedHostQualificationCli(['--enabled']),{code:'EXPLICIT_SYNTHETIC_ENABLE_REQUIRED'});
  await assert.rejects(runIsolatedHostQualificationCli(['--enable-synthetic-host-qualification']),{code:'EXPLICIT_QUALIFICATION_PATHS_REQUIRED'});
  await assert.rejects(runIsolatedHostQualificationCli(['--enable-synthetic-host-qualification','--provider-key','/not-accepted']),{code:'INVALID_QUALIFICATION_ARGUMENTS'});
});

test('receipt admission refuses overwrite and symlink directories before loading any cluster dependency',async t=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'atlas-host-cli-'));await chmod(directory,0o700);
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const receipt=join(directory,'retained.json');await writeFile(receipt,'retained-original',{mode:0o600});
  const args=path=>['--enable-synthetic-host-qualification','--pg-module','/nonexistent/pg/lib/index.js','--postgres-bin','/nonexistent/postgres/bin','--receipt',path];
  await assert.rejects(runIsolatedHostQualificationCli(args(receipt)),{code:'EEXIST'});
  assert.equal(await readFile(receipt,'utf8'),'retained-original');
  const alias=join(directory,'alias');await symlink(directory,alias);
  await assert.rejects(runIsolatedHostQualificationCli(args(join(alias,'new.json'))),{code:'PRIVATE_RECEIPT_DIRECTORY_REQUIRED'});
  await assert.rejects(readFile(join(directory,'new.json')),{code:'ENOENT'});
});
