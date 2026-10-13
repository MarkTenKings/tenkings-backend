// Finite owned PostgreSQL only; never accepts a serving database or provider.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {disposablePostgres} from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
const output=process.env.ATLAS_SCHEMA86_EVIDENCE;assert(output&&resolve(output)===output);await mkdir(output,{recursive:true,mode:0o700});
const sha=value=>createHash('sha256').update(value).digest('hex'),save=(name,value)=>writeFile(join(output,name+'.json'),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
async function census(sql){
 const names=(await sql("SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) name,c.relacl::text acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='public' OR n.nspname LIKE 'atlas_%') AND c.relname<>'_prisma_migrations' ORDER BY 1")).rows;
 const tables=[];for(const table of names){const [row]=(await sql(`SELECT count(*)::int count,encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') hash FROM ${table.name} t`)).rows;tables.push({...table,...row});}
 const functions=(await sql("SELECT p.proname name,pg_get_function_identity_arguments(p.oid) args,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS \"sourceSha256\",p.prosecdef AS \"securityDefiner\",p.proconfig config,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_manual_connected' AND p.proname IN ('variant_job_guard','read_grading_photo') ORDER BY p.proname")).rows;
 const constraints=(await sql("SELECT c.relname AS table_name,p.conname AS name,pg_get_constraintdef(p.oid) AS definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='atlas_manual_connected' AND c.relname IN ('report_image_job','variant_job','variant_contribution') ORDER BY 1,2")).rows;
 const indexes=(await sql("SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='atlas_manual_connected' AND tablename='report_image_job' ORDER BY 1")).rows;
 const staffLedger=(await sql('SELECT * FROM atlas_staff._prisma_migrations ORDER BY migration_name,id')).rows,publicLedger=(await sql('SELECT * FROM public._prisma_migrations ORDER BY migration_name,id')).rows;
 return {tables,functions,constraints,indexes,staffLedger,publicLedger};
}
let before,after;
const cluster=await disposablePostgres(process.argv.slice(2),{
 async beforeUpgradeFrom83({sql}){
  const owner=randomUUID(),card=randomUUID(),content=JSON.stringify({source:{sourceHash:sha(card)},identityRevision:1,identity:{cardName:'Preserved schema86 fixture'}});
  await sql('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",name) VALUES($1,$2,$3)',[owner,sha(owner),'Schema86 fixture reviewer']);
  await sql('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)',[card,content,sha(content),owner]);
  before=await census(sql);assert.equal(before.staffLedger.length,83);await save('before',before);
 },
 async afterUpgradeTo86({sql,directory,source}){
  after=await census(sql);assert.equal(after.staffLedger.length,86);assert.deepEqual(after.staffLedger.slice(0,83),before.staffLedger);assert.deepEqual(after.publicLedger,before.publicLedger);assert.deepEqual(after.tables,before.tables);
  const removedConstraint='report_image_job_source_hash_recipe_hash_key';
  const expectedConstraints=before.constraints.filter(c=>c.name!==removedConstraint).map(c=>({...c,definition:c.definition
   .replace(/octet_length\(catalog\) <= 1048576/g,'octet_length(catalog) <= 4194304')
   .replace(/octet_length\(result\) <= 2097152/g,'octet_length(result) <= 8388608')
   .replace(/octet_length\(payload\) <= 2097152/g,'octet_length(payload) <= 8388608')}));
  assert.deepEqual(after.constraints,expectedConstraints);
  assert.deepEqual(after.indexes.filter(i=>i.name!=='report_image_upload_recipe'),before.indexes.filter(i=>i.name!==removedConstraint));
  const index=after.indexes.find(i=>i.name==='report_image_upload_recipe');assert(index);assert.match(index.definition,/UNIQUE INDEX/);assert.match(index.definition,/source_hash, recipe_hash/);assert.match(index.definition,/uploadId/);
  assert.deepEqual(after.functions.map(f=>f.name),['read_grading_photo','variant_job_guard']);assert.equal(after.functions[0].securityDefiner,true);assert.deepEqual(after.functions[0].config,['search_path=pg_catalog']);
  const [publicExecute]=(await sql("SELECT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='atlas_manual_connected.read_grading_photo(uuid,uuid,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') allowed")).rows;assert.equal(publicExecute.allowed,false);
  await save('after',after);await save('result',{status:'REGISTERED83_TO86_PREFIX_PRESERVED',before:before.staffLedger,after:after.staffLedger,inventory:source.staffMigrations,publicLedgerPreserved:true,oldRowsAndTableGrantsPreserved:true,registeredNoopVerified:true,expectedConstraintAndIndexChangesOnly:true,functions:after.functions,externalProviderCalls:0,fixtureDirectory:directory});
 }
});
try{console.log(JSON.stringify({status:'REGISTERED83_TO86_PREFIX_PRESERVED',staff:86,public:cluster.source.publicMigrations.length,providerCalls:0}));}finally{await cluster.stop();}
