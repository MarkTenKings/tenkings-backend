import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.mjs';
import { staffContentSecurityPolicy } from '../lib/content-security.mjs';

const directives = policy => new Map(policy.split(';').map(value => value.trim().split(/\s+/)).map(([name,...sources]) => [name,sources]));
const catalogOrigins = ['https://images.scrydex.com','https://assets.tcgdex.net'];

test('saved public catalog artwork is allowed only as images in production and development',()=>{
 for(const development of [false,true]){
  const policy=directives(staffContentSecurityPolicy({development,uploadOrigins:['https://storage.example']}));
  assert.deepEqual(policy.get('img-src'),["'self'",'blob:','data:',...catalogOrigins,'https://storage.example']);
  for(const [directive,sources] of policy)if(directive!=='img-src')for(const origin of catalogOrigins)assert(!sources.includes(origin),`${directive} must not gain catalog access`);
  for(const url of ['https://images.scrydex.com/pokemon/xy12-51/large','https://assets.tcgdex.net/en/xy/xy12/51/high.webp'])assert(policy.get('img-src').includes(new URL(url).origin));
  for(const origin of ['http://images.scrydex.com','https://images.scrydex.com.example.org','https://api.scrydex.com','https://api.tcgdex.net'])assert(!policy.get('img-src').includes(origin));
  assert(policy.get('connect-src').includes('https://storage.example'));
 }
});

test('Next document headers carry the same narrow catalog image permission',async()=>{
 const rules=await config.headers();
 const policies=rules.flatMap(rule=>rule.headers.filter(header=>header.key.toLowerCase()==='content-security-policy'));
 assert.equal(policies.length,1);
 const policy=directives(policies[0].value);
 for(const origin of catalogOrigins){assert(policy.get('img-src').includes(origin));assert(!policy.get('connect-src').includes(origin));}
 assert.deepEqual(policy.get('object-src'),["'none'"]);
 assert.deepEqual(policy.get('frame-ancestors'),["'none'"]);
});
