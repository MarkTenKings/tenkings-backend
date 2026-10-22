import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLabelRepository} from '../src/label-sheet-repository.mjs';

test('sheet eligibility receives full immutable artwork and rejects before sealing or export reservation',async()=>{
 const actor=randomUUID(),card=randomUUID(),action=randomUUID(),sheetId=randomUUID(),writes=[];
 const item={id:randomUUID(),actor_id:actor,card_id:card,action_id:action,approval_version:1,source_revision:1,
  source_hash:'source',report_hash:'report',public_hash:'public',state:'READY',print_svg:'retained print',snapshot:'retained snapshot',slot:1};
 const published={card_id:card,action_id:action,latest_action_id:action,version:1,source_revision:1,
  source_hash:'source',report_hash:'report',public_hash:'public',state:'PUBLISHED',mode:'PRODUCTION'};
 const sentinel=new Error('historical profile rejected');let checked=false;
 const tx={async $executeRawUnsafe(sql){assert.match(sql,/SELECT pg_advisory_xact_lock/);return 1;},async $queryRawUnsafe(sql){
  if(sql.startsWith('SELECT * FROM atlas_manual_connected.label_export'))return [];
  if(sql.startsWith('SELECT * FROM atlas_manual_connected.label_sheet'))return[{id:sheetId,actor_id:actor,state:'OPEN',revision:2}];
  if(sql.includes('FROM atlas_manual_connected.label_item i WHERE sheet_id=')){assert.match(sql,/^SELECT i\.\*,/);return[item];}
  if(sql.startsWith('SELECT id,owner_id,approvers'))return[{id:card,owner_id:actor,approvers:[]}];
  if(sql.startsWith('SELECT card_id FROM atlas_manual_intake.discarded_card'))return [];
  if(sql.startsWith('SELECT p.*,a.source_revision'))return[published];
  if(/^(INSERT|UPDATE)/.test(sql))writes.push(sql);
  assert.fail('Unexpected query');
 }};
 const repository=createLabelRepository({boundary:{transaction:async(_staff,work)=>work({tx,principal:{id:actor,role:'REVIEWER'}})}});
 await assert.rejects(repository.prepareExport({}, {kind:'SHEET',id:sheetId,input:{requestId:randomUUID(),expectedSheetRevision:2,exportProfileId:'approved-b-back'},
  validateItems(items){checked=true;assert.equal(items[0].print_svg,item.print_svg);assert.equal(items[0].snapshot,item.snapshot);throw sentinel;}}),error=>error===sentinel);
 assert.equal(checked,true);assert.deepEqual(writes,[]);
});
