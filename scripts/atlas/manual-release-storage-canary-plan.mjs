// OFFLINE ONLY. Produces one reviewable plan and harmless local payloads.
// This file has no credentials, networking or execution mode for the live canary.
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output=process.argv[2];
if(!output||!output.startsWith('/'))throw new Error('Absolute new evidence directory required');
mkdirSync(output,{recursive:false,mode:0o700});
const id=randomUUID(),body=Buffer.from('ATLAS connected manual release canary: no card or customer data.\n','utf8');
const collision=Buffer.from(body);collision[0]=88;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=`atlas-connected-manual-v1/release-canaries/${id}/probe.bin`;
const binding=sha(Buffer.from(JSON.stringify({purpose:'connected-manual-release-canary',id,key})));
const plan={schemaVersion:1,status:'PREPARED_NOT_AUTHORIZED_NOT_EXECUTED',createdAt:new Date().toISOString(),id,
  target:{bucket:'atlas-grading-private-20260910',region:'nyc3',endpoint:'https://nyc3.digitaloceanspaces.com',
    uploadOrigin:'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com',staffOrigin:'https://atlasgrading.com',key},
  payload:{path:'payload.bin',utf8:body.toString('utf8'),bytes:body.length,sha256:sha(body),checksumBase64:Buffer.from(sha(body),'hex').toString('base64')},
  collisionPayload:{path:'collision-payload.bin',bytes:collision.length,sha256:sha(collision),checksumBase64:Buffer.from(sha(collision),'hex').toString('base64')},
  requiredHeaders:{'Content-Type':'application/octet-stream','If-None-Match':'*','x-amz-checksum-sha256':Buffer.from(sha(body),'hex').toString('base64'),
    'x-amz-meta-atlas-kind':'original','x-amz-meta-atlas-binding-sha256':binding},
  bounds:{uniqueKeys:1,maxPutAttempts:3,maxDeleteAttempts:2,maxHttpRequests:30,maxPutBodyBytes:body.length*3,maxGetBodyBytesPerResponse:4096,
    requestTimeoutMs:10000,totalDeadlineMs:300000,presignExpiresSeconds:300,sdkMaxAttempts:1},
  preconditions:['Separate explicit owner authorization for exactly this canary including cleanup/delete.',
    'Bucket and exact key agree; key is a diagnostic outside every real card plan. Initial authenticated HEAD is404; otherwise stop without deleting.',
    'GetBucketVersioning remains empty/unversioned. Unexpected versioning state stops before PUT.',
    'All three exact-origin CORS preflights pass required headers; existing policies/objects remain unchanged.',
    'Use reviewed private object credentials for PUT/GET and a separately available exact-key cleanup credential. Never print credentials or signed URLs.'],
  steps:[
    'HEAD key must404. Read bucket versioning and status; run PUT/GET/HEAD preflights (OPTIONS transport).',
    'PUT payload with its collision-payload checksum and If-None-Match:*; require checksum refusal400/BadDigest. If accepted or uncertain, do no later PUT; reconcile and clean only this task-created key.',
    'Authenticated HEAD must still404 after checksum rejection.',
    'Presign PUT with exact required headers and actual candidate unhoistable/signable header settings; upload payload once. Require2xx and record only normalized status/version/ETag hash.',
    `HEAD exact key; check${body.length}-byte length,octet-stream,metadata binding,not encoded,not a delete marker. Native SHA may be absent; a present checksum must match.`,
    'GET with If-Match from that HEAD (or returned exact VersionId if provider unexpectedly supplied one); stream at most4096bytes and require exact length/SHA.',
    'Presigned GET from the staff origin must return the same bytes and usable CORS. Preserve only origin/status/hash evidence,never URL.',
    'Anonymous GET and HEAD of this now-existing canary must deny access; cancel any response body immediately. A successful read fails privacy qualification.',
    'Attempt one collision PUT of collision-payload with its own checksum and If-None-Match:*; require412. No unconditional retry.',
    'HEAD and pinned GET must reproduce original metadata/version/ETag and original payload hash.',
    'GET with deliberately nonmatching If-Match must return412, establishing actual read pinning.',
    'In finally cleanup, authenticate the exact task-owned key and accepted payload hash,then DELETE only that key (or exactly the observed VersionId).',
    'Verify authenticated HEAD and GET both404. If DELETE outcome is uncertain,HEAD the exact key; allow at most one same-key cleanup retry after ownership re-verification. Never list/delete a prefix.'
  ],
  stopRules:['A preexisting key is never cleanup authority.','After any failure retain normalized evidence and execute only safe exact-key cleanup.',
    'An unknown PUT is reconciled by this exact key; never allocate another key or redispatch inference.',
    '403 after cleanup does not prove deletion. A successful DELETE without404 readback is not completion.',
    'No real card,photo,SQL row,provider inference,CORS setting,ACL,role or serving control is changed by this canary.'],
};
writeFileSync(resolve(output,'payload.bin'),body,{mode:0o600,flag:'wx'});
writeFileSync(resolve(output,'collision-payload.bin'),collision,{mode:0o600,flag:'wx'});
writeFileSync(resolve(output,'plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({status:plan.status,plan:resolve(output,'plan.json'),key,bytes:body.length,sha256:sha(body),maximumPutBodyBytes:body.length*3}));
