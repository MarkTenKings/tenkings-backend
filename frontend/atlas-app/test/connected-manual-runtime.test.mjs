import test from 'node:test';
import assert from 'node:assert/strict';
import {manualRuntimeSettings} from '../lib/server/connected-manual-runtime.mjs';
import {staffContentSecurityPolicy} from '../lib/content-security.mjs';
import {privateManualAccessConfig,productionAccessConfig} from '../lib/server/access/config.mjs';
const config={mode:'PRODUCTION',databaseUrl:'postgresql://staff:password@db.example.com:5432/atlas?schema=atlas_staff&sslmode=require'};
const env={ATLAS_MANUAL_ENABLED:'true',ATLAS_MANUAL_DATABASE_URL:'postgresql://manual:password@db.example.com:5432/atlas?schema=atlas_manual&sslmode=require',
 ATLAS_MANUAL_STORAGE_ENDPOINT:'https://nyc3.digitaloceanspaces.com',ATLAS_MANUAL_UPLOAD_ORIGIN:'https://example.nyc3.digitaloceanspaces.com',ATLAS_MANUAL_STORAGE_BUCKET:'example',ATLAS_MANUAL_STORAGE_REGION:'nyc3',ATLAS_MANUAL_STORAGE_PREFIX:'atlas/manual/v1',ATLAS_MANUAL_PYTHON:'/opt/atlas-python/bin/python',ATLAS_MANUAL_STORAGE_ACCESS_KEY:'test-access-key',ATLAS_MANUAL_STORAGE_SECRET_KEY:'test-secret-key-is-fictional'};
test('connected runtime is explicitly disabled or requires isolated encrypted manual role and exact private origins',()=>{
 assert.equal(manualRuntimeSettings({},config),null);assert.equal(manualRuntimeSettings(env,config).keyPrefix,'atlas/manual/v1');
 for(const change of [{VERCEL:'1'},{AWS_LAMBDA_FUNCTION_NAME:'function'},{ATLAS_MANUAL_DATABASE_URL:env.ATLAS_MANUAL_DATABASE_URL.replace('sslmode=require','sslmode=disable')},
  {ATLAS_MANUAL_DATABASE_URL:env.ATLAS_MANUAL_DATABASE_URL.replace('manual:password','manual')},{ATLAS_MANUAL_DATABASE_URL:env.ATLAS_MANUAL_DATABASE_URL.replace('manual:password','staff:password')},
  {ATLAS_MANUAL_DATABASE_URL:env.ATLAS_MANUAL_DATABASE_URL.replace('db.example.com','other.example.com')},{ATLAS_MANUAL_STORAGE_ENDPOINT:'https://example.com/path'},
  {ATLAS_MANUAL_UPLOAD_ORIGIN:'https://example.com/path'},{ATLAS_MANUAL_STORAGE_PREFIX:'../escape'},{ATLAS_MANUAL_PYTHON:'python'},{ATLAS_MANUAL_STORAGE_SECRET_KEY:''}])
  assert.throws(()=>manualRuntimeSettings({...env,...change},config));
});
test('private CPU auth binds the actual approved web deployment without pretending to be Vercel',()=>{
 const base={NODE_ENV:'production',ATLAS_STAFF_RUNTIME:'postgres',ATLAS_STAFF_ORIGIN:'https://atlasgrading.com',ATLAS_STAFF_BASE_PATH:'/admin',
  ATLAS_DATABASE_URL:config.databaseUrl,ATLAS_AUTH_TWILIO_ACCOUNT_SID:`AC${'1'.repeat(32)}`,ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID:`VA${'2'.repeat(32)}`,
  ATLAS_AUTH_SESSION_KEY:Buffer.alloc(32,1).toString('base64'),ATLAS_AUTH_PHONE_KEY:Buffer.alloc(32,2).toString('base64'),ATLAS_STAFF_ROUTER_KEY:Buffer.alloc(32,3).toString('base64'),ATLAS_ADMIN_PHONES:'+12025550141'};
 const web=productionAccessConfig({...base,VERCEL_ENV:'production',VERCEL_URL:'atlas-test.vercel.app',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)});
 const privateEnv={...base,ATLAS_MANUAL_RUNTIME:'private-cpu',ATLAS_MANUAL_WEB_DEPLOYMENT:'atlas-test.vercel.app',ATLAS_MANUAL_WEB_RELEASE_SHA:'a'.repeat(40)};
 assert.equal(privateManualAccessConfig(privateEnv).configHash,web.configHash);
 for(const bad of [{VERCEL_ENV:'production'},{ATLAS_MANUAL_WEB_DEPLOYMENT:'other.example.com'},{ATLAS_MANUAL_RUNTIME:'web'},{ATLAS_LOCAL_SYNTHETIC:'1'}])assert.throws(()=>privateManualAccessConfig({...privateEnv,...bad}));
});
test('runtime document CSP keeps both approved upload origins and does not accept paths or injected directives',()=>{
 const policy=staffContentSecurityPolicy({uploadOrigins:['https://old.example.com','https://new.example.com','https://old.example.com']});
 assert(policy.includes('https://old.example.com https://new.example.com'));assert(!policy.includes("'unsafe-eval'"));
 assert.equal(policy.match(/https:\/\/old.example.com/g).length,2);
 for(const origin of ['http://new.example.com','https://new.example.com/path',"https://new.example.com; script-src *",'https://user:pass@new.example.com'])
  assert.throws(()=>staffContentSecurityPolicy({uploadOrigins:[origin]}));
});
