import {mkdtemp,mkdir,chmod,readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {loadR1CanonicalAuth} from '../src/host-r1.mjs';
import {createPostgresStore,emptyMarketplaceState,POSTGRES_STORE_FORMAT} from '../src/store-postgres.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {createMarketplaceCommerceFactory} from '../src/commerce-runtime.mjs';
import {hash,requireValue} from '../src/contract.mjs';
import {acceptsSiteRequest} from '../../atlas-site-router/server.mjs';
import {signRoute} from '../../atlas-site-router/proof.mjs';

const runFile=promisify(execFile),branded=new WeakSet(),ORIGIN='https://atlasgrading.com';
const DATABASE='atlas_r2_fixture',OWNER='atlas_r2_fixture_owner',WRITER='atlas_r2_fixture_writer',ADMIN='atlas_r2_fixture_admin';
const digest=value=>createHash('sha256').update(value).digest('hex');
const deny=code=>{const error=new Error(code);error.code=code;throw error;};
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Buffer.isBuffer(value)&&!(value instanceof Map)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const code=error=>/^[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ISOLATED_FIXTURE_OPERATION_FAILED';
const domainKeys=freeze({financial:['listings','reservations','receipts','journals','intents','orders','events','consent'],physical:['fulfillment','marketplaceProofUploads','marketplaceProofObjects','marketplaceProofReviews','shippingLifecycle']});
const domains=state=>Object.fromEntries(Object.entries(domainKeys).map(([name,keys])=>[name,hash(Object.fromEntries(keys.map(key=>[key,state[key]??null])))]));

export function assertIsolatedHostFixture(value){requireValue(branded.has(value),'ISOLATED_HOST_FIXTURE_REQUIRED');value.assertReady();return value;}

async function canonicalClasses(){
  // Resolve the one passive workspace export; never import an R1 runtime or
  // install a dependency. This hook exists only during explicit construction.
  const hook=registerHooks({resolve(specifier,context,next){return specifier==='@atlas/customer-intake/profile'?{url:new URL('../../atlas-customer-intake/src/profile.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});
  try{return await loadR1CanonicalAuth();}finally{hook.deregister();}
}

function fixtureRoleSQL(){
  // Standalone SYNTHETIC fixture recipe, applied only to the freshly owned
  // cluster below. The guarded review proposal is neither edited nor executed.
  return `-- SYNTHETIC ISOLATED R2 FIXTURE ONLY; NOT A TARGET MIGRATION.
BEGIN;
DO $$ BEGIN IF current_database()<>'${DATABASE}' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('${OWNER}','${WRITER}')) THEN RAISE EXCEPTION 'FIXTURE_DATABASE_NOT_FRESH'; END IF; END $$;
CREATE ROLE ${OWNER} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${WRITER} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE,TEMPORARY ON DATABASE ${DATABASE} FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE ${DATABASE} TO ${WRITER};
ALTER SCHEMA atlas_marketplace OWNER TO ${OWNER};
${['state','commits','journal','events','active_cards','active_reservations'].map(name=>`ALTER TABLE atlas_marketplace.${name} OWNER TO ${OWNER};`).join('\n')}
${['reject_change()','read_state()','lock_state()','commit_state(bigint,text,jsonb,text,bigint)'].map(name=>`ALTER FUNCTION atlas_marketplace.${name} OWNER TO ${OWNER};`).join('\n')}
REVOKE ALL ON SCHEMA atlas_marketplace FROM PUBLIC,${WRITER};
REVOKE ALL ON ALL TABLES IN SCHEMA atlas_marketplace FROM PUBLIC,${WRITER};
REVOKE ALL ON ALL SEQUENCES IN SCHEMA atlas_marketplace FROM PUBLIC,${WRITER};
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA atlas_marketplace FROM PUBLIC,${WRITER};
ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA atlas_marketplace TO ${WRITER};
GRANT EXECUTE ON FUNCTION atlas_marketplace.read_state(),atlas_marketplace.lock_state(),atlas_marketplace.commit_state(bigint,text,jsonb,text,bigint) TO ${WRITER};
COMMIT;`;
}

/** Explicit disposable LOCAL fixture only. Construction is inert unless enabled
 * is exactly true. No environment credentials, shared DB/port, external provider,
 * runtime bootstrap, label purchase or scheduler is available. Owned data is
 * deliberately retained after close; only this capability can restart it.
 */
export async function createIsolatedHostFixture(options={}){
  if(options.enabled!==true)return Object.freeze({enabled:false,assertReady(){deny('ISOLATED_FIXTURE_DISABLED');},async snapshot(){return{enabled:false,classification:'DISABLED'};},async close(){return{stopped:true,created:false};}});
  requireValue(Object.keys(options).every(key=>['enabled','pgModulePath','postgresBin','now'].includes(key)),'ISOLATED_FIXTURE_OPTIONS_INVALID');
  const {pgModulePath,postgresBin,now=Date.now()}=options;
  requireValue(isAbsolute(pgModulePath??'')&&isAbsolute(postgresBin??'')&&Number.isSafeInteger(now)&&now>0,'ISOLATED_FIXTURE_INPUT_REQUIRED');
  const pgPath=await realpath(pgModulePath),bin=await realpath(postgresBin),pgImport=await import(pathToFileURL(pgPath).href),pg=pgImport.default??pgImport;
  requireValue(typeof pg.Pool==='function'&&typeof pg.Client==='function','ISOLATED_FIXTURE_PG_REQUIRED');
  const version=(await runFile(join(bin,'postgres'),['--version'],{timeout:3000,maxBuffer:65536,env:{PATH:bin+':/usr/bin:/bin',LANG:'C',LC_ALL:'C'}})).stdout.trim();
  requireValue(/^postgres \(PostgreSQL\) 17\./.test(version),'ISOLATED_FIXTURE_PG17_REQUIRED');
  const parent=await realpath('/private/tmp');requireValue(parent==='/private/tmp','ISOLATED_FIXTURE_ROOT_REFUSED');
  const root=await mkdtemp(join(parent,'atlas-r2-staging-'));await chmod(root,0o700);
  const rootStat=await lstat(root),data=join(root,'data'),socket=join(root,'socket'),log=join(root,'postgres.log');
  const counters={providerCalls:0,commerceCalls:0,taxCalls:0,alertCalls:0,timerStarts:0,canonicalCustomerReads:0,canonicalStaffReads:0,canonicalIngressChecks:0,admissions:0,unexpectedAuthorityCalls:0};
  const owned={root,data,socket,log,bin,version,pgPath,rootDevice:rootStat.dev,rootInode:rootStat.ino,uid:process.getuid(),started:false,generation:0,now,counters,lastSnapshot:null,controlHash:null};
  const environment={PATH:bin+':/usr/bin:/bin',LANG:'C',LC_ALL:'C',TMPDIR:root};
  async function verifyOwned(){const stat=await lstat(root);requireValue(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===owned.uid&&(stat.mode&0o777)===0o700&&stat.dev===owned.rootDevice&&stat.ino===owned.rootInode&&await realpath(root)===root,'ISOLATED_FIXTURE_OWNERSHIP_CHANGED');}
  const command=(name,args,timeout=15000)=>runFile(join(bin,name),args,{timeout,maxBuffer:262144,env:environment});
  async function ownedPid(){await verifyOwned();let stat;try{stat=await lstat(join(data,'postmaster.pid'));}catch(error){if(error.code==='ENOENT')return null;throw error;}requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===owned.uid&&await realpath(data)===data,'ISOLATED_FIXTURE_PID_MISMATCH');const lines=(await readFile(join(data,'postmaster.pid'),'utf8')).trim().split('\n');requireValue(lines[1]===data&&/^[1-9][0-9]*$/.test(lines[0])&&(!owned.pid||Number(lines[0])===owned.pid),'ISOLATED_FIXTURE_PID_MISMATCH');return Number(lines[0]);}
  async function absent(path){try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
  async function stop(){await verifyOwned();const startedAt=Date.now(),pid=await ownedPid();let forced=false;if(pid){owned.pid=pid;try{await command('pg_ctl',['-D',data,'-m','fast','-w','-t','1','stop'],2000);}catch{forced=true;await command('pg_ctl',['-D',data,'-m','immediate','-w','-t','1','stop'],2000);}}
    let statusExit;try{await command('pg_ctl',['-D',data,'status'],1000);statusExit=0;}catch(error){statusExit=typeof error.code==='number'?error.code:null;}
    const pidAbsent=await absent(join(data,'postmaster.pid')),socketAbsent=await absent(join(socket,'.s.PGSQL.5432'));
    requireValue(pidAbsent&&socketAbsent&&(statusExit===3||await absent(join(data,'PG_VERSION'))),'ISOLATED_FIXTURE_STOP_UNCONFIRMED');owned.started=false;return{stopped:true,forced,statusExit,pidAbsent,socketAbsent,elapsedMs:Date.now()-startedAt};}
  async function failWithCleanup(error,phase){let cleanup;try{cleanup=await stop();}catch(failure){cleanup={stopped:false,code:code(failure),uncertain:true};}error.qualificationReceipt={classification:'SYNTHETIC_LOCAL_STARTUP_FAILURE',ownedCluster:{root,data,socket,database:DATABASE,postgresVersion:version,tcp:false},phase,cleanup,preserved:true};throw error;}
  async function start(){await verifyOwned();requireValue(!owned.started&&await absent(join(data,'postmaster.pid')),'ISOLATED_FIXTURE_ALREADY_STARTED');owned.pid=null;try{await command('pg_ctl',['-D',data,'-l',log,'-w','-t','5','start'],7000);owned.pid=await ownedPid();requireValue(owned.pid,'ISOLATED_FIXTURE_PID_MISMATCH');owned.started=true;}catch(error){return failWithCleanup(error,'STARTING');}}
  const connection=(user=WRITER,database=DATABASE)=>({host:socket,port:5432,user,database,password:'',ssl:false,connectionTimeoutMillis:1000,query_timeout:1500,statement_timeout:1500,idle_in_transaction_session_timeout:1500,application_name:'atlas_r2_isolated_fixture'});
  let canonical;
  try{
    await mkdir(socket,{mode:0o700});await command('initdb',['-D',data,'--username='+ADMIN,'--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C','--no-instructions']);
    const configuration=`# SYNTHETIC OWNED FIXTURE ONLY\nlisten_addresses = ''\nport = 5432\nunix_socket_directories = '${socket}'\nunix_socket_permissions = 0700\nmax_connections = 12\nshared_buffers = '16MB'\nfsync = on\nfull_page_writes = on\nsynchronous_commit = on\nssl = off\nstatement_timeout = 1500\nlock_timeout = 1000\nidle_in_transaction_session_timeout = 1500\n`;
    await writeFile(join(data,'postgresql.conf'),configuration,{mode:0o600});owned.controlHash=digest(configuration);await start();
    const admin=new pg.Client(connection(ADMIN,'postgres'));await admin.connect();try{await admin.query('CREATE DATABASE '+DATABASE);}finally{await admin.end();}
    const schema=await readFile(new URL('../sql/proposal.sql',import.meta.url),'utf8'),proposal=await readFile(new URL('../sql/r1-marketplace-role-proposal.sql',import.meta.url),'utf8'),roles=fixtureRoleSQL();
    requireValue(proposal.includes("RAISE EXCEPTION 'R1_MARKETPLACE_ROLE_PROPOSAL_NOT_APPROVED'"),'ISOLATED_FIXTURE_PROPOSAL_CHANGED');
    await writeFile(join(root,'synthetic-role-recipe.sql'),roles,{mode:0o600});
    const initialize=new pg.Client(connection(ADMIN));await initialize.connect();try{await initialize.query(schema);await initialize.query(roles);const state=emptyMarketplaceState();await initialize.query('INSERT INTO atlas_marketplace.state(id,format,environment,revision,document,state_hash) VALUES(true,$1,$2,0,$3::jsonb,$4)',[POSTGRES_STORE_FORMAT,'PROVIDER_SANDBOX',JSON.stringify(state),hash(state)]);const {rows:[actual]}=await initialize.query("SELECT current_setting('listen_addresses') AS listen,current_setting('unix_socket_directories') AS socket,current_setting('server_version_num') AS version,current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,current_setting('synchronous_commit') AS synchronous_commit");requireValue(actual.listen===''&&actual.socket===socket&&Number(actual.version)>=170000&&Number(actual.version)<180000,'ISOLATED_FIXTURE_NETWORK_REFUSED');requireValue(actual.fsync==='on'&&actual.full_page_writes==='on'&&actual.synchronous_commit==='on','ISOLATED_FIXTURE_DURABILITY_REFUSED');owned.observedSettings=actual;}finally{await initialize.end();}
    await writeFile(join(root,'ownership.json'),JSON.stringify({classification:'SYNTHETIC_CANONICAL_AUTH_WITH_REAL_ISOLATED_POSTGRES17',root,data,socket,database:DATABASE,owner:OWNER,writer:WRITER,postgresVersion:version,postgresBin:bin,pgModulePath:pgPath,schemaHash:digest(schema),guardedRoleProposalHash:digest(proposal),fixtureRoleRecipeHash:digest(roles),configurationHash:owned.controlHash,tcp:false},null,2)+'\n',{mode:0o600});
    canonical=await canonicalClasses();
  }catch(error){if(error.qualificationReceipt)throw error;return failWithCleanup(error,'INITIALIZING');}

  function newCapability(){
    const generation=++owned.generation;let closed=false,closing=null;
    const current=()=>{requireValue(!closed&&owned.started&&generation===owned.generation,'ISOLATED_FIXTURE_CLOSED');return true;};
    const refused=counter=>async()=>{counters[counter]++;deny('ISOLATED_EXTERNAL_EFFECT_REFUSED');};
    const rawPool=new pg.Pool({...connection(),max:4,idleTimeoutMillis:1000,allowExitOnIdle:true});rawPool.on('error',()=>{});
    const borrowers=new Set();
    const pool=Object.freeze({async connect(){current();const client=await rawPool.connect();try{current();}catch(error){client.release(true);throw error;}let released=false;const lease={query(...args){current();requireValue(!released,'ISOLATED_FIXTURE_CLIENT_CLOSED');return client.query(...args);},release(broken=false){if(!released){released=true;borrowers.delete(lease);client.release(broken);}}};borrowers.add(lease);return lease;}});
    const database={pool,expectedRole:WRITER,expectedDatabase:DATABASE,expectedFunctionOwner:OWNER},clock=()=>owned.now;
    const snapshotStore=createPostgresStore({...database,enabled:true,environment:'PROVIDER_SANDBOX',clock});
    const authorityRows=owned.authorityRows??new Map(),tokens=owned.tokens??new Map();
    if(!owned.authorityRows)for(const [index,name] of ['buyer','seller','staff'].entries()){
      const browser=randomBytes(32).toString('base64url'),session=randomBytes(32).toString('base64url');tokens.set(name,{browser,session});
      authorityRows.set(name,{name,id:randomUUID(),sessionHash:digest(session),browserHash:digest(browser),expiresAt:owned.now+300000,revoked:false,accessVersion:1,sessionAccessVersion:1,role:name==='staff'?'REVIEWER':name.toUpperCase(),phoneHash:digest('SYNTHETIC_STAFF_PHONE_'+index)});
    }
    owned.authorityRows=authorityRows;owned.tokens=tokens;
    owned.authKeys??=Object.fromEntries(['customer','staff'].map(zone=>[zone,{sessionKey:randomBytes(32),routerKey:randomBytes(32)}]));
    const configs=Object.fromEntries(['customer','staff'].map(zone=>{const value={mode:'PRODUCTION',origin:ORIGIN,deploymentId:'isolated-r2-'+zone+'.vercel.app',releaseSha:'a'.repeat(40),configHash:hash('SYNTHETIC_'+zone),databaseUrl:'postgresql://fixture@invalid/r2_fixture_'+zone+'_authority',cookies:{browser:'r2_fixture_'+zone+'_browser',session:'r2_fixture_'+zone+'_session'},...owned.authKeys[zone],...(zone==='staff'?{basePath:'/admin',phoneByHash:new Map([[authorityRows.get('staff').phoneHash,'SYNTHETIC_PHONE_NOT_ROUTABLE']])}:{deploymentHost:'isolated-r2-customer.vercel.app'})};value.binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(key=>[key,value[key]]));return[zone,value];}));
    const activeRow=(sessionHash,browserHash)=>{const row=[...authorityRows.values()].find(r=>r.sessionHash===sessionHash&&r.browserHash===browserHash);return row&&!row.revoked&&row.expiresAt>owned.now&&row.accessVersion===row.sessionAccessVersion?row:null;};
    const unexpected=()=>{counters.unexpectedAuthorityCalls++;deny('ISOLATED_AUTHORITY_CALL_REFUSED');};
    const customerClient={$transaction:async work=>{current();return work({$queryRaw:async(parts,...values)=>{const sql=parts.join('?');
      if(sql.includes('AS unsafe'))return[{unsafe:false}];
      if(sql.includes('AS schema_write'))return[{schema_write:false,table_access:false,sequence_access:false}];
      if(sql.includes('p.prosecdef AS definer'))return[{schema:'atlas_customer',name:'customer_call(text, jsonb, jsonb)',definer:true}];
      if(sql.includes('atlas_customer.customer_call')){counters.canonicalCustomerReads++;requireValue(values[0]==='marketplace_session_access'&&values[1]===JSON.stringify(configs.customer.binding),'ISOLATED_AUTHORITY_CALL_REFUSED');const input=JSON.parse(values[2]),row=activeRow(input.sessionHash,input.browserHash);return[{result:row&&row.name!=='staff'?{schema:'atlas-marketplace-session-access-v1',accountId:row.id,sessionHash:row.sessionHash,browserHash:row.browserHash,observedAt:owned.now,expiresAt:row.expiresAt}:{error:{status:401,code:'SIGN_IN_REQUIRED'}}}];}return unexpected();},$executeRaw:async parts=>{requireValue(parts.join('').trim()==='SET CONSTRAINTS ALL IMMEDIATE','ISOLATED_AUTHORITY_CALL_REFUSED');return 0;}});}};
    const customerAuth=new canonical.CustomerAuth({database:new canonical.CustomerDatabase(customerClient,configs.customer),config:configs.customer,provider:Object.freeze({start:refused('providerCalls'),check:refused('providerCalls')})});
    const staffContext=()=>{const row=authorityRows.get('staff'),browser={tokenHash:row.browserHash,controlRevision:1,expiresAt:new Date(row.expiresAt)},identity={id:row.id,name:'Synthetic Fixture Reviewer',role:row.role,phoneHash:row.phoneHash,accessVersion:row.accessVersion,revokedAt:row.revoked?new Date(owned.now):null},session={tokenHash:row.sessionHash,identityId:row.id,browserHash:row.browserHash,accessVersion:row.sessionAccessVersion,controlRevision:1,expiresAt:new Date(row.expiresAt),revokedAt:row.revoked?new Date(owned.now):null,browser,identity};return{now:new Date(owned.now),control:{revision:1},tx:{staffSession:{findUnique:async({where})=>where.tokenHash===row.sessionHash?clone(session):null},$queryRaw:async(parts,...values)=>{requireValue(parts.join('?').includes('FROM atlas_staff."StaffIdentity"')&&values[0]===row.id,'ISOLATED_AUTHORITY_CALL_REFUSED');return[clone(identity)];}}};};
    const staffDatabase={client:{},async transaction(work){current();counters.canonicalStaffReads++;return work(staffContext());}};
    const staffAuth=new canonical.DurableStaffAuth({database:staffDatabase,config:configs.staff,provider:Object.freeze({start:refused('providerCalls'),check:refused('providerCalls')})});
    const manualClient={$transaction:async work=>{current();return work({$executeRawUnsafe:async sql=>{requireValue(["SET LOCAL lock_timeout = '1500ms'","SET LOCAL statement_timeout = '3000ms'",'SET CONSTRAINTS ALL IMMEDIATE'].includes(sql),'ISOLATED_AUTHORITY_CALL_REFUSED');return 0;},$queryRawUnsafe:async(sql,...values)=>{if(sql.includes(' AS unsafe'))return[{unsafe:false}];requireValue(sql==='SELECT * FROM atlas_manual.authenticate($1,$2,$3::jsonb,$4::text[])','ISOLATED_AUTHORITY_CALL_REFUSED');const row=activeRow(values[0],values[1]);if(!row||row.name!=='staff')return[];requireValue(values[2]===JSON.stringify(configs.staff.binding)&&hash(values[3])===hash([...configs.staff.phoneByHash.keys()]),'ISOLATED_AUTHORITY_CALL_REFUSED');return[{id:row.id,name:'Synthetic Fixture Reviewer',role:row.role,access_version:row.accessVersion,certification_until:null,now_at:new Date(owned.now)}];}});}};
    const guard=zone=>req=>{current();counters.canonicalIngressChecks++;requireValue(acceptsSiteRequest(req,{zone,deploymentId:configs[zone].deploymentId,routerKey:configs[zone].routerKey},owned.now),'HOST_REFUSED');};
    const context=createAuthorityContext({environment:'PROVIDER_SANDBOX',evidenceOrigin:ORIGIN,evidencePathPrefixes:['/account/marketplace/api/evidence/'],qualificationRefs:Object.fromEntries(['fingerprintRef','titlePolicyRef','marketplacePolicyRef','evidenceContractRef'].map(k=>[k,'SYNTHETIC_FIXTURE_NO_GENUINE_AUTHORITY_'+k]))});
    const provider=Object.freeze({...Object.fromEntries(['getIdentity','getAccount','create','retrieve','discover','getPaymentCollection','createOnboardingLink','getAccountSnapshot','listBalanceTransactions','listRelatedObjects','retrieveDispute'].map(name=>[name,refused('providerCalls')])),acceptsAccount:id=>id==='acct_fixtureseller'});
    const marketplace={context,provider,platformAccountId:'acct_fixtureplatform',listingPolicy:{id:'synthetic_fixture_policy',version:1},financePolicy:{environment:'stripe-sandbox'},fulfillmentPolicy:{id:'synthetic_fixture_policy',version:1},assertRuntimeReady:current,readEvidence:refused('providerCalls'),validateEvidence:async()=>false,sellerAccount:refused('providerCalls'),onboarding:{},feeCalculator:{enabled:true,preview:refused('providerCalls'),assertCurrent:current}};
    marketplace.runtimeApproval={approved:true,binding:{environment:'PROVIDER_SANDBOX',platformAccountId:marketplace.platformAccountId,listingPolicyHash:hash(marketplace.listingPolicy),financePolicyHash:hash(marketplace.financePolicy),fulfillmentPolicyHash:hash(marketplace.fulfillmentPolicy),qualificationRefs:context.qualificationRefs}};
    const effectiveAt=new Date(owned.now-1000).toISOString(),expiresAt=new Date(owned.now+300000).toISOString(),from={name:'Synthetic Unshippable Fixture',phone:'+12025550123',line1:'123 Fixture Only Road',line2:null,city:'Sacramento',state:'CA',postalCode:'95827',country:'US',residential:'no'};
    const checkout={schema:'atlas-checkout-policy-v1',id:'fixture_checkout',version:'fixture-v1',environment:'PROVIDER_SANDBOX',currency:'USD',approvalRef:'SYNTHETIC_ONLY',effectiveAt,expiresAt,maxQuoteAgeMs:120000,shippingPolicyRef:'fixture_shipping',taxPolicyRef:'fixture_tax',taxResponsibleEntityRef:'SYNTHETIC_ONLY',taxBasis:'ITEM_AND_SHIPPING',allowedCountries:['US']};
    const common={environment:'PROVIDER_SANDBOX',approvalRef:'SYNTHETIC_ONLY',checkoutPolicyHash:hash(checkout),effectiveAt,expiresAt,maxQuoteAgeMs:120000};
    const shipping={...common,policyRef:'fixture_shipping',accountApprovalRef:'SYNTHETIC_ONLY',carrierId:'se-123',carrierCode:'ups',carrierAccountNumber:'SYNTHETIC_ONLY',serviceCode:'ups_ground',shipFrom:from,parcel:{weightOunces:1,lengthInches:1,widthInches:1,heightInches:1},measurementRef:'SYNTHETIC_NOT_MEASURED',shipDate:new Date(owned.now).toISOString().slice(0,10),shipDateTimeZone:'America/Los_Angeles',confirmation:'signature',coverage:{provider:'carrier',approvalRef:'SYNTHETIC_ONLY',termsRef:'SYNTHETIC_ONLY',coveredItemType:'GRADED_TRADING_CARD',valueBasis:'ITEM_PRICE',maxDeclaredValueCents:100000,disclosure:'Synthetic fixture only. No physical qualification or coverage.'}};
    const tax={...common,policyRef:'fixture_tax',accountId:marketplace.platformAccountId,apiVersion:'2025-03-31.basil',itemTaxCode:'txcd_99999999',shippingTaxCode:'txcd_99999998',taxBasis:'ITEM_AND_SHIPPING',responsibleEntityRef:'SYNTHETIC_ONLY',registrationApprovalRef:'SYNTHETIC_ONLY',shipFrom:from,allowedZeroTaxReasons:[]};
    marketplace.commerceConfig={environment:'PROVIDER_SANDBOX',platformAccountId:marketplace.platformAccountId,shipping,tax,checkout,taxLifecycleApprovalRef:'SYNTHETIC_ONLY',destinations:{id:'fixture_addresses',version:'1',environment:'PROVIDER_SANDBOX',approvalRef:'SYNTHETIC_ONLY',privacyRef:'SYNTHETIC_ONLY',allowedCountries:['US'],maxActive:3,receiptTtlMs:180000}};
    owned.commerceKey??=randomBytes(32);
    marketplace.createCommercePorts=createMarketplaceCommerceFactory({enabled:true,config:marketplace.commerceConfig,keyring:{activeKeyId:'fixture',keys:{fixture:owned.commerceKey}},shippingApiKey:'TEST_SYNTHETIC_FIXTURE_NOT_A_REAL_KEY',taxSecretKey:'sk_test_SYNTHETICFIXTURENOTAREALKEY',approvals:Object.fromEntries(['commerce','destinations','shipping','tax','checkout','taxLifecycle'].map(key=>[key,current])),shippingFetch:refused('commerceCalls'),taxFetch:refused('taxCalls')});
    const secrets=owned.webhookSecrets??={PLATFORM:'whsec_fixture_'+randomBytes(32).toString('hex'),CONNECTED:'whsec_fixture_'+randomBytes(32).toString('hex')};
    marketplace.webhook={endpoints:[{id:'we_fixture_platform',scope:'PLATFORM',secret:secrets.PLATFORM},{id:'we_fixture_connected',scope:'CONNECTED',secret:secrets.CONNECTED}],ingress:{enabled:true,maxRetained:20},allowedConnectedAccountIds:['acct_fixtureseller']};
    const host={enabled:true,clock,config:{approved:true,approvalRef:'SYNTHETIC_LOCAL_HOST_ONLY',environment:'PROVIDER_SANDBOX',origin:ORIGIN,maxDatabaseClockSkewMs:0,authPolicy:{approved:true,approvalRef:'SYNTHETIC_LOCAL_SESSION_ONLY',environment:'PROVIDER_SANDBOX',r1Mode:'PRODUCTION',staffRoles:['REVIEWER'],customerRoles:['BUYER','SELLER']},settlement:{enabled:true,approvalRef:'SYNTHETIC_ONLY'},routes:{public:{mountPath:'/marketplace/',catalogPath:'/marketplace/catalog'},buyer:{mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api'},seller:{mountPath:'/account/marketplace/seller/',apiPath:'/account/marketplace/seller/api'},staff:{mountPath:'/admin/marketplace/',apiPath:'/admin/marketplace/api'}}},r1:{staffState:{auth:staffAuth,assertRequest:guard('staff')},customerState:{auth:customerAuth,config:configs.customer,assertRequest:guard('customer')},publicConfig:{mode:'PRODUCTION',origin:ORIGIN,deploymentId:'isolated-r2-public.vercel.app',releaseSha:'a'.repeat(40),configHash:hash('SYNTHETIC_PUBLIC')},manualClient,admitRequest:async()=>{current();counters.admissions++;return true;},admitPublicRequest:async()=>{current();counters.admissions++;return true;}},database,marketplace,assertRuntimeReady:current,assertSettlementReady:current};
    const finance={enabled:true,assertRuntimeReady:current,timers:Object.freeze({setTimeout(){counters.timerStarts++;deny('ISOLATED_SCHEDULER_REFUSED');},clearTimeout(){}}),alertSender:Object.freeze({assertReady:current,send:refused('alertCalls'),lookup:refused('alertCalls')}),config:{environment:'PROVIDER_SANDBOX',platformAccountId:marketplace.platformAccountId,connectedAccountIds:['acct_fixtureseller'],activationRef:'SYNTHETIC_ONLY',operationsRef:'SYNTHETIC_ONLY',qualificationRefs:context.qualificationRefs,recovery:{approvalRef:'SYNTHETIC_ONLY',maxItems:1,concurrency:1,maxEvidenceAgeMs:60000,maxDurationMs:1000},finalizationBudgetMs:1000,schedule:{intervalMs:1000,pollIntervalMs:100,leaseMs:3000},alerts:{approvalRef:'SYNTHETIC_ONLY',destinationRef:'SYNTHETIC_NO_DELIVERY',maxItems:1,leaseMs:1000,staleIntentMs:1000,staleReportMs:1000},ingress:{enabled:true,maxItems:1,concurrency:1,maxAttempts:2,retryDelayMs:1000,leaseMs:3000,maxRoutingItems:10}}};
    // Freeze configuration and transport objects. Canonical instances/WeakMaps
    // remain genuine instances; host-r1 separately pins their methods/config.
    for(const cfg of Object.values(configs))freeze(cfg);freeze(host.config);freeze(host.r1.publicConfig);freeze(marketplace.commerceConfig);freeze(marketplace.runtimeApproval);freeze(marketplace.webhook);freeze(marketplace.listingPolicy);freeze(marketplace.financePolicy);freeze(marketplace.fulfillmentPolicy);freeze(finance);Object.freeze(database);Object.freeze(marketplace);Object.freeze(customerClient);Object.freeze(staffDatabase.client);Object.freeze(staffDatabase);Object.freeze(manualClient);Object.freeze(customerAuth.database);Object.freeze(customerAuth);Object.freeze(staffAuth);Object.freeze(host.r1.staffState);Object.freeze(host.r1.customerState);Object.freeze(host.r1);Object.freeze(host);
    const integrity=()=>hash([host.config,finance.config,...Object.values(configs).map(c=>[c.mode,c.origin,c.deploymentId,c.binding,c.cookies,c.sessionKey.toString('hex'),c.routerKey.toString('hex'),c.phoneByHash?[...c.phoneByHash]:null]),marketplace.webhook]);const pin=integrity();
    const assertReady=()=>{current();requireValue(integrity()===pin,'ISOLATED_FIXTURE_CHANGED');return true;};
    function retainSnapshot(row){const state=row.document;requireValue(hash(state)===row.state_hash,'ISOLATED_FIXTURE_STATE_HASH_MISMATCH');const result={enabled:!closed,classification:'SYNTHETIC_CANONICAL_AUTH_WITH_REAL_ISOLATED_POSTGRES17',generation,now:owned.now,...clone(counters),revision:Number(row.revision),stateHash:row.state_hash,stateHashMatches:true,domainKeys:clone(domainKeys),domainHashes:domains(state),financialAndPhysicalHash:hash(Object.fromEntries(['listings','reservations','receipts','journals','intents','orders','fulfillment','events','consent'].map(key=>[key,state[key]??null]))),webhookRows:clone(state.financeWebhookIngress??{}),financialDispatchCount:Object.values(state.intents).reduce((sum,r)=>sum+(r.dispatchCount??0),0),deadlines:{connectionMs:1000,clientQueryMs:1500,serverStatementDefaultMs:1500,serverStoreTransactionOverrideMs:15000,stopAttemptMs:2000,stopAttempts:2},ownedCluster:{root,data,socket,database:DATABASE,writer:WRITER,owner:OWNER,postgresVersion:version,tcp:false,pid:owned.pid,observedSettings:clone(owned.observedSettings)},stopped:!owned.started};owned.lastSnapshot=result;return clone(result);}
    const sessions=Object.freeze({cookie(name){assertReady();const token=tokens.get(name);requireValue(token,'ISOLATED_SESSION_UNKNOWN');const cfg=name==='staff'?configs.staff:configs.customer;return`${cfg.cookies.browser}=${token.browser}; ${cfg.cookies.session}=${token.session}`;},revoke(name){assertReady();requireValue(authorityRows.has(name),'ISOLATED_SESSION_UNKNOWN');authorityRows.get(name).revoked=true;},expire(name){assertReady();requireValue(authorityRows.has(name),'ISOLATED_SESSION_UNKNOWN');authorityRows.get(name).expiresAt=owned.now;},restore(name){assertReady();const row=authorityRows.get(name);requireValue(row,'ISOLATED_SESSION_UNKNOWN');row.revoked=false;row.expiresAt=owned.now+300000;row.sessionAccessVersion=row.accessVersion;},setStaffRole(role){assertReady();requireValue(['REVIEWER','OBSERVER'].includes(role),'ISOLATED_ROLE_INVALID');authorityRows.get('staff').role=role;}});
    const fixture={enabled:true,host,finance,sessions,assertReady,
      async signRequest({zone='customer',target,method='GET',session=zone==='staff'?'staff':'buyer'}={}){assertReady();requireValue(['customer','staff'].includes(zone),'ISOLATED_ZONE_INVALID');const cfg=configs[zone];return{host:'atlasgrading.com',origin:ORIGIN,'x-forwarded-proto':'https',...(session===null?{}:{cookie:sessions.cookie(session)}),...await signRoute({zone,deployment:'https://'+cfg.deploymentId,method,target,issuedAt:owned.now},cfg.routerKey.toString('base64'))};},
      signWebhook(rawBody,{scope='PLATFORM'}={}){assertReady();requireValue(Buffer.isBuffer(rawBody)&&rawBody.length<=262144&&Object.hasOwn(secrets,scope),'ISOLATED_WEBHOOK_INVALID');const timestamp=Math.floor(owned.now/1000);return{rawBody:Buffer.from(rawBody),signature:'t='+timestamp+',v1='+createHmac('sha256',secrets[scope]).update(String(timestamp)+'.').update(rawBody).digest('hex')};},
      async snapshot(){if(closed)return clone({...owned.lastSnapshot,enabled:false,stopped:!owned.started,...clone(counters)});assertReady();await snapshotStore.read();const client=await pool.connect();let row;try{({rows:[row]}=await client.query('SELECT revision,state_hash,document FROM atlas_marketplace.read_state()'));}finally{client.release();}return retainSnapshot(row);},
      close(){if(closing)return closing;closed=true;snapshotStore.close();const startedAt=Date.now(),interruptedClients=borrowers.size;for(const lease of [...borrowers])lease.release(true);
        closing=(async()=>{let snapshotError=null;try{const client=await rawPool.connect();try{const{rows:[row]}=await client.query('SELECT revision,state_hash,document FROM atlas_marketplace.lock_state()');retainSnapshot(row);}finally{client.release();}}catch(error){snapshotError=code(error);}const ending=rawPool.end();let stopped;try{stopped=await stop();}catch(error){error.qualificationReceipt={phase:'STOPPING',ownedCluster:{root,data,socket,tcp:false},cleanup:{stopped:false,uncertain:true,code:code(error)},preserved:true};throw error;}finally{await ending;}const receipt={...stopped,root,preserved:true,snapshotError,interruptedClients,totalElapsedMs:Date.now()-startedAt};await writeFile(join(root,'last-stop.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});return receipt;})();return closing;},
      async restart(){requireValue(closed&&closing&&generation===owned.generation,'ISOLATED_FIXTURE_CLOSE_REQUIRED');const stopped=await closing;await verifyOwned();requireValue(!stopped.snapshotError&&owned.lastSnapshot?.stateHash,'ISOLATED_FIXTURE_RESTART_SNAPSHOT_REQUIRED');const priorHash=owned.lastSnapshot.stateHash;requireValue(digest(await readFile(join(data,'postgresql.conf')) )===owned.controlHash,'ISOLATED_FIXTURE_CONFIGURATION_CHANGED');await start();let next;try{next=newCapability();const snapshot=await next.snapshot();requireValue(snapshot.stateHash===priorHash,'ISOLATED_FIXTURE_RESTART_STATE_CHANGED');return next;}catch(error){if(next)try{await next.close();}catch{}return failWithCleanup(error,'RESTARTING');}},
    };Object.freeze(fixture);branded.add(fixture);return fixture;
  }
  let fixture;try{fixture=newCapability();await fixture.snapshot();return fixture;}catch(error){if(fixture)try{await fixture.close();}catch{}return failWithCleanup(error,'QUALIFYING');}
}
