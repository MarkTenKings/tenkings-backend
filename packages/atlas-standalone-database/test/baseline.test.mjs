import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sql=await readFile(new URL('../sql/baseline.sql',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../baseline.manifest.json',import.meta.url),'utf8'));
test('standalone installer is sealed and contains no legacy/shared-data compatibility bridge',()=>{
 assert.equal(createHash('sha256').update(sql).digest('hex'),manifest.sqlSha256);
 assert.equal(manifest.schemas.length,7);assert.equal(manifest.tables.length,108);
 assert.doesNotMatch(sql,/public\s*\.|AiGrader|StaffSpecimen|StaffWorkspace|StaffPublicReport|CustomerSubmission|dblink|postgres_fdw|CREATE SERVER/i);
});
test('current customer commerce and accounts, private gateways, image reader and immutable lifecycle survive extraction',()=>{
 for(const name of ['atlas_customer.CommerceOrder','atlas_customer.CommercePayment','atlas_customer.CustomerAccount','atlas_staff.StaffIdentity','atlas_staff.StaffOperationsGrant','atlas_staff.PublicReaderControl','atlas_manual_connected.card_image_binding','atlas_manual.learning_release_member'])assert(manifest.tables.includes(name),name);
 for(const name of ['atlas_customer.customer_call(','atlas_customer.customer_private_call(','atlas_dealer.order_desk_call(','atlas_manual_connected.read_grading_photo('])assert(manifest.functions.some(f=>f.name.startsWith(name)),name);
 assert.equal(manifest.changes.length,2);
 for(const schema of manifest.schemas)assert(sql.includes(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "${schema}" FROM PUBLIC;`));
});
