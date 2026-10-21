import test from 'node:test';
import assert from 'node:assert/strict';
import { reportIdentityRows } from '../src/report-presentation-ui.mjs';
import { emptyAtlasSportsAttributes, atlasPrintedSerial, projectAtlasSportsAttributes } from '@atlas/grading-core/identity';
test('staff and public report details retain exact reviewed sports facts without displaying private observations',()=>{
 const value=emptyAtlasSportsAttributes(),proof={side:'BACK',imageSha256:'a'.repeat(64),observation:'Private review observation'};
 value.serial={presence:'PRESENT',...atlasPrintedSerial('007/099'),evidence:[proof]};value.autograph={presence:'PRESENT',type:'FACSIMILE',evidence:[proof]};value.relic={presence:'PRESENT',evidence:[proof],windows:[{position:'Upper left',material:'Fabric',manufacturerStatement:'The enclosed material is not associated with any specific player, game, or event.',use:'NOT_ASSOCIATED',evidence:[proof]}]};
 const original={cardProfile:'SPORTS',identity:{playerName:'Synthetic specimen',cardNumber:'007'},finalGrade:8.5},before=JSON.stringify(original);
 assert.deepEqual(reportIdentityRows(original),[['Name','Synthetic specimen'],['Category','Sports cards'],['Card number','007']]);
 const staff=reportIdentityRows({...original,identity:{...original.identity,sportsAttributes:value}}),pub=reportIdentityRows({...original,identity:{...original.identity,sportsAttributes:projectAtlasSportsAttributes(value)}});
 assert.deepEqual(pub,staff);assert.deepEqual(pub.find(([name])=>name==='Printed serial'),['Printed serial','007/099']);
 assert.match(pub.find(([name])=>name==='Autograph')[1],/Facsimile.*presence is not authentication/);
 assert.ok(pub.find(([name])=>name==='Relic · Upper left')[1].includes(value.relic.windows[0].manufacturerStatement));
 assert.doesNotMatch(JSON.stringify(pub),/Private review observation|imageSha256/);assert.equal(JSON.stringify(original),before);
});
