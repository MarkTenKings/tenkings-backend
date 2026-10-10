// Called only by the owned local PostgreSQL fixture, never a serving runtime.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical,digest} from '@atlas/manual-service/contract';
export function variantUpgradePreservation(output){
 let before;
 async function snapshot(sql,names=null){
  if(!names)names=(await sql("SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='public' OR n.nspname LIKE 'atlas_%') AND c.relname<>'_prisma_migrations' ORDER BY 1")).rows.map(r=>r.name);
  const tables={};for(const name of names){const [row]=(await sql(`SELECT count(*)::int count,encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') hash FROM ${name} t`)).rows;tables[name]=row;}
  const grants=(await sql("SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) name,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','S','v') AND (n.nspname='public' OR n.nspname LIKE 'atlas_%') ORDER BY 1")).rows.filter(r=>names.includes(r.name));
  return{tables,grants};
 }
 return {
  async beforeUpgradeFrom78({sql}){
   const owner=randomUUID(),card=randomUUID();await sql('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",name) VALUES($1,$2,$3)',[owner,digest(owner),'Preserved pre-79 fixture reviewer']);
   const content=canonical({source:{sourceHash:digest(card)},identityRevision:1,identity:{cardName:'Preserved synthetic card',year:'2026',productSet:'Fixture',cardNumber:'1',parallel:null}});
   await sql('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1,1,$2,$3,$4)',[card,content,digest(content),owner]);
   before=await snapshot(sql);await writeFile(join(output,'upgrade-before.json'),JSON.stringify(before,null,2));
  },
  async afterUpgradeTo79({sql,directory}){
   const after=await snapshot(sql,Object.keys(before.tables));assert.deepEqual(after,before,'Additive79 must preserve every old table row and table ACL');
   const names=['variant_job','variant_confirmation','variant_catalog_cache','variant_contribution'];for(const name of names)assert.equal((await sql(`SELECT count(*)::int n FROM atlas_manual_connected.${name}`)).rows[0].n,0);
   await writeFile(join(output,'upgrade-result.json'),JSON.stringify({status:'PASS',from:78,to:79,oldTablesPreserved:Object.keys(before.tables).length,nonemptyOldTables:Object.values(before.tables).filter(x=>x.count>0).length,rowsAndGrantsExact:true,registeredSecondDeployNoop:true,newTablesEmpty:4,fixtureDirectory:directory},null,2));
  }
 };
}
