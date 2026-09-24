// Operator preparation only. Fixed live target; catalog and bucket reads only.
// Credentials remain in memory or the remote psql environment, never output.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = process.argv[2];
if (!output || !output.startsWith('/')) throw new Error('Absolute evidence output directory required');
mkdirSync(output, { recursive: true, mode: 0o700 });
const quote = text => "'" + text.replaceAll("'", "'\"'\"'") + "'";
const remote = request => {
  const program = String.raw`
import json,os,subprocess,sys,urllib.parse
try:
 request=json.load(sys.stdin)
 def env(name):
  obj=json.loads(subprocess.check_output(['docker','inspect',name],timeout=15))[0]
  return dict(x.split('=',1) for x in obj['Config']['Env'] if '=' in x)
 current=env('atlas-workspace-private-i-20260911')
 if request['kind']=='storage':
  binding=json.loads(current['ATLAS_PRIVATE_BINDINGS_JSON'])
  print(json.dumps({'ok':True,'storage':binding['storage'],'credentials':{'accessKeyId':current['ATLAS_PRIVATE_STORAGE_ACCESS_KEY_ID'],'secretAccessKey':current['ATLAS_PRIVATE_STORAGE_SECRET_ACCESS_KEY']},'manualKeysPresent':sorted(k for k in current if k.startswith('ATLAS_MANUAL_'))}))
 else:
  source=urllib.parse.urlparse(env('infra-bytebot-lite-service-1')['DATABASE_URL'])
  if source.hostname!='db-postgresql-nyc3-83816-do-user-27093151-0.f.db.ondigitalocean.com' or source.port!=25060 or source.path!='/defaultdb' or source.username!='doadmin': raise ValueError()
  environment={'PATH':'/usr/bin:/bin','PGHOST':source.hostname,'PGPORT':'25060','PGDATABASE':'defaultdb','PGUSER':'doadmin','PGPASSWORD':urllib.parse.unquote(source.password),'PGSSLMODE':'require','PGCONNECT_TIMEOUT':'8','PGAPPNAME':'atlas-manual-readiness-readonly','PGOPTIONS':'-c default_transaction_read_only=on'}
  child=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=request['sql'],env=environment,capture_output=True,text=True,timeout=35)
  if child.returncode: print(json.dumps({'ok':False,'code':'READONLY_SQL_REFUSED'}))
  else: print(json.dumps({'ok':True,'data':json.loads(child.stdout)}))
except Exception:
 print(json.dumps({'ok':False,'code':'READONLY_INVENTORY_FAILED'}))
`;
  const result = spawnSync('ssh', ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
    'root@104.131.27.245', `python3 -c ${quote(program)}`], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 45000, maxBuffer: 2*1024*1024,
  });
  if (result.error || result.status !== 0) throw new Error('READONLY_REMOTE_FAILED');
  const parsed = JSON.parse(result.stdout);
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed;
};
const save = (name, data) => writeFileSync(resolve(output, name), JSON.stringify(data,null,2)+'\n', {mode:0o600,flag:'wx'});
const sql = `BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1s';
SELECT jsonb_build_object(
 'at',clock_timestamp(),'database',current_database(),'role',current_user,'version',current_setting('server_version'),
 'readOnly',current_setting('transaction_read_only'),'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'maxConnections',current_setting('max_connections'),
 'connections',(SELECT count(*) FROM pg_stat_activity),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl)) FROM pg_namespace WHERE nspname LIKE 'atlas_%' OR nspname='public'),
 'publicMigrations',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM public._prisma_migrations),
 'staffMigrations',(SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM atlas_staff._prisma_migrations),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replicate',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'memberships',(SELECT coalesce(jsonb_agg(pg_get_userbyid(roleid)),'[]'::jsonb) FROM pg_auth_members WHERE member=r.oid))) FROM pg_roles r WHERE rolname LIKE 'atlas_%'),
 'defaultPrivileges',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',n.nspname,'type',defaclobjtype,'acl',defaclacl)) FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace),
 'manualObjects',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner))),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('atlas_manual','atlas_manual_intake','atlas_manual_connected')),
 'certificationCounts',(SELECT jsonb_build_object('activeReviewers',count(*) FILTER(WHERE role='REVIEWER' AND "revokedAt" IS NULL),'currentlyCertified',count(*) FILTER(WHERE role='REVIEWER' AND "revokedAt" IS NULL AND "certificationUntil">CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) FROM atlas_staff."StaffIdentity"),
 'rolePrivileges',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'schema',n.nspname,'createSchema',has_schema_privilege(r.oid,n.oid,'CREATE'),'useSchema',has_schema_privilege(r.oid,n.oid,'USAGE'),'ownTables',(SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relowner=r.oid),'readTables',(SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','v','m','p','f') AND has_table_privilege(r.oid,c.oid,'SELECT')),'deleteTables',(SELECT count(*) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','v','m','p','f') AND has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE')))) FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname LIKE 'atlas_%' AND (n.nspname LIKE 'atlas_%' OR n.nspname='public'))
); ROLLBACK;`;
const db = remote({kind:'database',sql}).data;
const sha = value => createHash('sha256').update(value).digest('hex');
db.localMigrationParity = ['public','staff'].map(scope=>{
  const dir = scope==='public'?'packages/database/prisma/migrations':'frontend/atlas-app/prisma/migrations';
  const rows=db[`${scope}Migrations`], applied=rows.filter(row=>row.finished&&!row.rolledBack);
  return {scope,ledgerRows:rows.length,applied:applied.length,rolledBack:rows.filter(x=>x.rolledBack).length,
    unfinished:rows.filter(x=>!x.finished&&!x.rolledBack).length,
    mismatches:applied.filter(row=>{try{return sha(readFileSync(resolve(root,dir,row.name,'migration.sql')))!==row.checksum;}catch{return true;}}).map(x=>x.name)};
});
save('database-inventory.json',db);
console.log(JSON.stringify({database:db.version,schemas:db.schemas.map(x=>x.name),migrationParity:db.localMigrationParity,certificationCounts:db.certificationCounts}));

const secret = remote({kind:'storage'});
// Reuse existing installed SDK read-only; no package install or app mutation.
const require = createRequire(resolve(root, 'packages/atlas-photo-storage/package.json'));
const sdk = require('@aws-sdk/client-s3');
const client = new sdk.S3Client({region:secret.storage.region,endpoint:secret.storage.endpoint,credentials:secret.credentials,maxAttempts:1});
const storage={at:new Date().toISOString(),configuredServingI:secret.storage,manualKeysPresent:secret.manualKeysPresent,productionWrites:false,reads:{}};
for(const name of ['HeadBucket','GetBucketCors','GetBucketVersioning','GetBucketAcl','GetBucketPolicy','GetPublicAccessBlock']){
 try{
  const response=await client.send(new sdk[`${name}Command`]({Bucket:secret.storage.bucket}),{abortSignal:AbortSignal.timeout(10000)});
  const { $metadata, ...data }=response;
  storage.reads[name]={status:$metadata.httpStatusCode,data};
 }catch(error){storage.reads[name]={status:error?.$metadata?.httpStatusCode??null,code:/^[A-Za-z0-9]+$/.test(error?.name??'')?error.name:'READ_FAILED'};}
}
client.destroy();
save('storage-config-inventory.json',storage);
console.log(JSON.stringify(storage));
