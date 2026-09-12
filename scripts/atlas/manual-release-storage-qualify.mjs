// Owned local PostgreSQL qualification only; cannot accept a live DB URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOwnedManualFixture } from '../../packages/atlas-manual-service/scripts/owned-fixture.mjs';
import { manualGrantSQL } from '../../packages/atlas-manual-service/src/staff-auth.mjs';
import { intakeGrantSQL } from '../../packages/atlas-manual-intake/src/repository.mjs';
import { connectedGrantSQL } from '../../packages/atlas-connected-manual/src/details.mjs';
import { runConnectedIntegration } from '../../packages/atlas-connected-manual/test/connected.test.mjs';

const output=process.env.ATLAS_CONNECTED_EVIDENCE, pythonExecutable=process.env.ATLAS_FIXTURE_PYTHON;
assert(output && resolve(output)===output && pythonExecutable && resolve(pythonExecutable)===pythonExecutable);
await mkdir(output,{recursive:true,mode:0o700});
const fixture=await createOwnedManualFixture(process.argv.slice(2));
try {
  const grants=[manualGrantSQL,intakeGrantSQL,connectedGrantSQL].map(fn=>fn('atlas_fixture_manual')).join('\n');
  await fixture.cluster.sql(grants,[],fixture.database.name);
  const connection=fixture.connect(), db=connection.manualClient;
  const [role]=await db.$queryRawUnsafe(`SELECT current_user AS name,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) memberships,
    has_database_privilege(current_user,current_database(),'CREATE') create_database_objects
    FROM pg_roles r WHERE rolname=current_user`);
  assert.equal(role.name,'atlas_fixture_manual');
  assert(Object.entries(role).filter(([key])=>key!=='name').every(([,value])=>value===false));
  const columns=await db.$queryRawUnsafe(`SELECT n.nspname AS schema,c.relname AS table,a.attname AS column,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') sel,
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') ins,
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') upd,
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') refs,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') extra,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE c.relkind IN('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY 1,2,a.attnum`);
  const updates={
    'atlas_manual.card':['revision','content','content_hash','updated_at'],
    'atlas_manual.action':[], 'atlas_manual.approval':[],
    'atlas_manual_intake.card':['revision','front_version','back_version','front_upload_id','back_upload_id','updated_at'],
    'atlas_manual_intake.upload':['verification','verification_hash','source','source_hash'],
    'atlas_manual_connected.details':['revision','content','content_hash'],
    'atlas_manual_connected.details_action':[],
    'atlas_manual_connected.identification':['state','result','error','finished_at'],
    'atlas_manual_connected.effect':[],
  };
  const seen=new Set();
  for(const row of columns) {
    const key=`${row.schema}.${row.table}`, allowed=Object.hasOwn(updates,key);
    assert.equal(row.sel,allowed,key);assert.equal(row.ins,allowed,key);
    assert.equal(row.upd,allowed&&updates[key].includes(row.column),`${key}.${row.column}`);
    assert.equal(row.refs,false);assert.equal(row.extra,false);assert.equal(row.owner,false);
    if(allowed)seen.add(key);
  }
  assert.equal(seen.size,9);
  const schemas=await db.$queryRawUnsafe(`SELECT nspname,has_schema_privilege(current_user,oid,'USAGE') usage,
    has_schema_privilege(current_user,oid,'CREATE') create_objects FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname`);
  assert(schemas.every(row=>!row.create_objects));
  assert(schemas.every(row=>row.usage===(row.nspname==='public'||Object.keys(updates).some(key=>key.startsWith(row.nspname+'.')))));
  const functions=await db.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname,oidvectortypes(p.proargtypes) args,p.prosecdef,
    pg_get_userbyid(p.proowner) owner,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname LIKE 'atlas_%' AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE') ORDER BY 1,2`);
  assert.deepEqual(functions.map(row=>`${row.schema}.${row.proname}`),['atlas_manual.authenticate','atlas_manual_connected.append_receipt']);
  assert(functions.every(row=>row.prosecdef&&row.owner!=='atlas_fixture_manual'&&row.proconfig.some(value=>value.startsWith('search_path=pg_catalog,'))));
  const catalog=await fixture.cluster.sql(`SELECT n.nspname,c.relname,c.relacl::text,pg_get_userbyid(c.relowner) owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_manual%' ORDER BY 1,2`,[],fixture.database.name);
  await fixture.cluster.sql(grants,[],fixture.database.name);
  const replay=await fixture.cluster.sql(`SELECT n.nspname,c.relname,c.relacl::text,pg_get_userbyid(c.relowner) owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_manual%' ORDER BY 1,2`,[],fixture.database.name);
  assert.deepEqual(replay.rows,catalog.rows);
  await writeFile(join(output,'privilege-catalog.json'),JSON.stringify({status:'PASS',node:process.version,
    checkedColumns:columns.length,manualTables:[...seen],role,schemas,functions,exactGrantReplay:'NO_CHANGE',
    source:fixture.cluster.source},null,2)+'\n',{mode:0o600,flag:'wx'});
  await connection.close();
  const result=await runConnectedIntegration({fixture,pythonExecutable,output});
  for(const name of ['source.json','ledgers.json','validation.log'])await copyFile(join(fixture.cluster.directory,name),join(output,name));
  console.log(JSON.stringify({status:'PASS',node:process.version,connectedAssertions:result.assertions,checkedColumns:columns.length,manualTables:seen.size,output}));
} finally {
  await fixture.stop();
  await copyFile(join(fixture.cluster.directory,'cleanup.json'),join(output,'database-cleanup.json'));
  await writeFile(join(output,'cleanup.json'),JSON.stringify({ownedDatabaseStoppedVerified:true,directory:fixture.cluster.directory,at:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});
}
