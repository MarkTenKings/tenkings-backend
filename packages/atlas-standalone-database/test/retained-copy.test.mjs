import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { disabledRetainedControls, prepareRetainedCopy, retainedSourceSQL, retainedCopyHash } from '../retained-copy.mjs';
const manifest=JSON.parse(await readFile(new URL('../baseline.manifest.json',import.meta.url)));
const policy=JSON.parse(await readFile(new URL('../retained-copy-policy.json',import.meta.url)));
const tables=[...Object.values(policy.retainExact).flat(),...policy.rebindDisabledThenReview];
const binding={mode:'PRODUCTION',origin:'https://atlasgrading.com',deploymentId:'new-release.vercel.app',releaseSha:'1'.repeat(40),configHash:'2'.repeat(64)};
function fixture(){
 const source={writes:0,observation:{readOnly:'on',observedAt:'2026-10-13T05:33:11Z',counts:Object.fromEntries(manifest.tables.map(t=>[t,0])),rows:Object.fromEntries(tables.map(t=>[t,[]]))}};
 for(const t of policy.rebindDisabledThenReview){const row={id:'active',enabled:true,revision:4,updatedAt:'2026-10-01T00:00:00Z'};if(t.endsWith('.SmsPilotControl'))Object.assign(row,{pilotId:'old',binding:{old:true},activatedAt:'2026-10-01T00:00:00Z',expiresAt:'2026-10-08T00:00:00Z',publicCustomerAdmission:true});source.observation.rows[t]=[JSON.stringify(row)];source.observation.counts[t]=1;}
 const controls=disabledRetainedControls(source,{staff:binding,publicReader:binding,customer:binding,customerService:binding,commerce:{configHash:'3'.repeat(64)},at:'2026-10-13T00:00:00Z'});
 return {source,options:{controlRows:controls,geometryConcurrency:12,neutralReleaseId:'new-empty-release',reason:'Explicit owner-requested independent empty baseline.'}};
}
test('current export is read-only and never serializes old sessions, learned examples or cache rows',()=>{
 const sql=retainedSourceSQL();assert.match(sql,/REPEATABLE READ READ ONLY/);assert.match(sql,/ROLLBACK;$/);
 for(const t of ['atlas_staff.StaffSession','atlas_manual.learning_publication','atlas_manual_connected.variant_catalog_cache']){
  const quoted=t.split('.').map(v=>'"'+v+'"').join('.');assert(sql.includes(`count(*)::bigint n FROM ${quoted}`));assert(!sql.includes(`to_jsonb(t)::text rowtext FROM ${quoted}`));
 }
 assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE/);
});
test('fresh controls are disabled and old SMS approval windows cannot survive',()=>{
 const {source,options}=fixture();const original=structuredClone(source);
 const {plan,sha256}=prepareRetainedCopy(source,options);
 assert.equal(sha256,retainedCopyHash(plan));assert.deepEqual(source,original);
 assert.equal(plan.geometryConcurrency,12);assert.equal(JSON.parse(plan.neutralManifest).publications.length,0);
 for(const t of policy.rebindDisabledThenReview)assert(plan.rows[t].every(r=>JSON.parse(r).enabled===false));
 const sms=JSON.parse(plan.rows['atlas_staff.SmsPilotControl'][0]);assert.equal(sms.binding,null);assert.equal(sms.pilotId,null);assert.equal(sms.expiresAt,null);assert.equal(sms.publicCustomerAdmission,false);
 assert(!Object.hasOwn(plan.rows,'atlas_manual_connected.variant_catalog_cache'));
});
test('unexpected source tables, restored sessions and wrong geometry capacity cannot enter a reviewed plan',()=>{
 const {source,options}=fixture();const extra=structuredClone(source);extra.observation.rows['atlas_staff.StaffSession']=[];
 assert.throws(()=>prepareRetainedCopy(extra,options),/SOURCE_ROW_ALLOWLIST_DIFFERS/);
 const lesson=structuredClone(source);lesson.observation.counts['atlas_manual.learning_publication']=1;
 assert.throws(()=>prepareRetainedCopy(lesson,options),/SOURCE_MUST_BE_EMPTY/);
 assert.throws(()=>prepareRetainedCopy(source,{...options,geometryConcurrency:2}),/REVIEWED_R16_GEOMETRY_CAPACITY_MUST_BE_12/);
});
