import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
test('obsolete submissions and specimen routes are absent before authentication or writes',async()=>{
  const handler=createHandler({assertRequest(){},auth:{call(){assert.fail('Retired customer effect');}},config:{origin:'https://atlasgrading.com'}});
  for(const method of ['GET','POST'])for(const path of ['submissions','submissions/11111111-1111-4111-8111-111111111111','submission-requests/11111111-1111-4111-8111-111111111111','cards/11111111-1111-4111-8111-111111111111']){
    const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
    await handler({method,url:'/api/customer/'+path,headers:{}},res);assert.equal(res.code,404);assert.equal(res.value.error,'NOT_FOUND');
  }
});
