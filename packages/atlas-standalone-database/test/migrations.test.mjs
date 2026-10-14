import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registeredMigrations,validateLedger} from '../registered-migrations.mjs';
const baseline=JSON.parse(await readFile(new URL('../baseline.manifest.json',import.meta.url),'utf8'));
test('registered additive suffix seals SQL independently of original baseline',async()=>{
 const migrations=await registeredMigrations();assert.equal(migrations.length,3);
 assert.equal(migrations[0].version,'atlas-standalone-002-variant-label-retry');
 assert.match(migrations[0].sql,/SECURITY DEFINER/);assert.doesNotMatch(migrations[0].sql,/CREATE TABLE|ALTER TABLE|DROP TABLE|DELETE FROM|TRUNCATE/i);
 assert.equal(migrations[1].version,'atlas-standalone-003-report-image-retry');
 assert.equal(migrations[2].version,'atlas-standalone-004-label-sheets');
 assert.match(migrations[2].sql,/CREATE TABLE atlas_manual_connected.label_item/);
 assert.doesNotMatch(migrations[2].sql,/DROP TABLE|DELETE FROM|INSERT INTO atlas_manual\.(?:card|approval)|UPDATE atlas_manual\./i);
 assert.match(migrations[1].sql,/SECURITY DEFINER/);assert.doesNotMatch(migrations[1].sql,/CREATE TABLE|DROP TABLE|DELETE FROM|TRUNCATE/i);
});
test('ledger accepts exact known prefix only; rejects tampered, unknown and missing baseline',async()=>{
 const m=await registeredMigrations(),b={version:baseline.version,checksum:baseline.sqlSha256},v={version:m[0].version,checksum:m[0].sqlSha256};
 assert.equal(validateLedger([b],baseline,m).size,1);assert.equal(validateLedger([v,b],baseline,m).size,2);
 for(const rows of [[],[v],[b,{...v,checksum:'0'.repeat(64)}],[b,{version:'unknown',checksum:v.checksum}],[b,b]])assert.throws(()=>validateLedger(rows,baseline,m),/LEDGER_INVALID/);
});
