import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyAtlasSportsAttributes, atlasPrintedSerial, projectAtlasSportsAttributes } from '@atlas/grading-core/identity';
import { sportsAttributeSearch, matchSportsAttributeEvidence } from '../src/sports-attribute-comps.mjs';
import { cardIdentitySearchQuery } from '../src/sold-query-identity.mjs';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { publishedMarketQuery, createPresentationMarket } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { digest } from '@atlas/manual-service/contract';
const proof={side:'BACK',imageSha256:'a'.repeat(64),observation:'Synthetic card text for isolated tests.'};
function attributes(){const value=emptyAtlasSportsAttributes();value.serial={presence:'PRESENT',...atlasPrintedSerial('007/099'),evidence:[proof]};value.autograph={presence:'PRESENT',type:'ON_CARD',evidence:[proof]};return projectAtlasSportsAttributes(value);}
test('live full-set PSA query retains checklist zeros while reviewed numbering uses denominator only',async()=>{
 const sportsAttributes=attributes(),identity={playerName:'Synthetic Player',year:'2026',manufacturer:'Fixture',productSet:'Full Sports Set',cardNumber:'007',parallel:null,insert:null};
 assert.equal(cardIdentitySearchQuery({category:'SPORTS',manufacturer:identity.manufacturer,year:identity.year,setName:identity.productSet,name:identity.playerName,cardNumber:identity.cardNumber,sportsAttributes}),'Fixture 2026 Full Sports Set Synthetic Player #007 /99 auto');
 const f=await publicationFixture({identity});await f.publication.publish({},f.cardId,f.actionId);const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 const before=JSON.stringify(packet),old=publishedMarketQuery({packet,publicHash:digest(before)});
 assert.equal(old.query,`Fixture 2026 Full Sports Set Synthetic Player #007 psa ${packet.report.finalGrade}`);
 packet.report.identity.sportsAttributes=sportsAttributes;const source={packet,publicHash:digest(JSON.stringify(packet))},current=publishedMarketQuery(source);
 assert.equal(current.query,`Fixture 2026 Full Sports Set Synthetic Player #007 /99 auto psa ${packet.report.finalGrade}`);
 assert.deepEqual(current.input.variantIdentity,{serialDenominator:99,autograph:true});
 assert.equal(publishedMarketQuery(source,{savedQuery:current.query,savedInput:current.input}).query,current.query);
 assert.deepEqual(JSON.parse(before).report.identity,identity);
});
test('serial denominator and signature types distinguish explicit contradictions from missing evidence',()=>{
 const value=attributes();
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player 045/099 on-card auto PSA 9'}).status,'MATCH');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /25 on-card auto PSA 9'}).status,'CONTRADICTORY');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 sticker auto PSA 9'}).status,'CONTRADICTORY');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 facsimile signature'}).status,'CONTRADICTORY');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player auto PSA 9'}).status,'UNKNOWN');
 assert.deepEqual(sportsAttributeSearch(undefined),{terms:[],variantIdentity:undefined});
});
test('relic use and material distinctions remain tied to explicit statements, never guessed from a window',()=>{
 const value=attributes();value.relic={presence:'PRESENT',windows:[{position:'Left',material:'Fabric',manufacturerStatement:'Player-worn material.',use:'PLAYER_WORN'}]};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto player-worn jersey relic'}).status,'MATCH');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto game-used jersey relic'}).status,'CONTRADICTORY');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto player-worn bat relic'}).status,'CONTRADICTORY');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto jersey relic'}).status,'UNKNOWN');
});

test('ordinary grading labels do not imply a sticker autograph',()=>{
 const value=attributes();
 for(const title of ['Player /99 PSA label','Player /99 grading label','Player /99 sticker']) {
  assert.equal(matchSportsAttributeEvidence(value,{title}).status,'UNKNOWN');
  assert.ok(!matchSportsAttributeEvidence(value,{title}).reasonCodes.includes('AUTOGRAPH_TYPE_MISMATCH'));
 }
 value.autograph={presence:'ABSENT',type:'UNKNOWN'};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 PSA label'}).status,'MATCH');
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 sticker autograph'}).status,'CONTRADICTORY');
});

test('multiple relic windows cannot be matched by aggregate material and use sets',()=>{
 const value=attributes();value.relic={presence:'PRESENT',windows:[
  {position:'Left',material:'Fabric',manufacturerStatement:'Game-used.',use:'GAME_USED'},
  {position:'Right',material:'Wood',manufacturerStatement:'Player-worn.',use:'PLAYER_WORN'}]};
 const swapped=matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto left player-worn jersey relic; right game-used bat relic'});
 assert.equal(swapped.status,'UNKNOWN');assert.ok(swapped.reasonCodes.includes('RELIC_WINDOW_ASSOCIATION_UNVERIFIED'));
 value.relic.windows[1]={...value.relic.windows[1],manufacturerStatement:'Not associated with a specific game.',use:'NOT_ASSOCIATED'};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto game-used jersey relic and wood relic not associated with a specific game'}).status,'UNKNOWN');
});

test('explicit numbered copy contradicts a reviewed unnumbered card',()=>{
 const value=attributes();value.serial={presence:'ABSENT',printed:null,numerator:null,denominator:null};value.autograph={presence:'UNKNOWN',type:'UNKNOWN'};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player Gold 07/25 PSA 9'}).status,'CONTRADICTORY');
});

test('negated manufacturer use never establishes game-used or player-worn material',()=>{
 const value=attributes();value.relic={presence:'PRESENT',windows:[{position:'Left',material:'Fabric',manufacturerStatement:'Game-used material.',use:'GAME_USED'}]};
 for(const phrase of ['not game used','not game-worn','non-game-used','not actually game-used','not game used or player worn'])
  assert.notEqual(matchSportsAttributeEvidence(value,{title:`Player /99 on-card auto jersey relic ${phrase}`}).status,'MATCH');
 value.relic.windows[0]={...value.relic.windows[0],manufacturerStatement:'Player-worn material.',use:'PLAYER_WORN'};
 for(const phrase of ['not player worn','not player-worn','not game used or player worn','not associated with a specific player, game or event'])
  assert.notEqual(matchSportsAttributeEvidence(value,{title:`Player /99 on-card auto jersey relic ${phrase}`}).status,'MATCH');
});

test('new reviewed-attribute guidance excludes vague, contradictory, lot, reprint and undisclosed-offer rows',async()=>{
 const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 packet.report.identity.sportsAttributes=attributes();const source={packet,publicHash:digest(JSON.stringify(packet))},context=publishedMarketQuery(source);
 const titles=['Player /99 on-card auto','Player /99 on-card auto','Player /99 on-card auto lot of 3','Player /25 on-card auto','Player auto','Player /99 on-card auto reprint'];
 const items=titles.map((title,index)=>({id:`atlas-sale:${index}`,title,listingUrl:null,imageUrl:`https://i.ebayimg.com/images/g/fixture${index}/s-l1600.jpg`,soldDate:'2026-10-20',reportedPrice:'10.00',soldPriceCents:1000,currency:'USD',priceBasis:index===1?'UPPER_BOUND':'EXACT'}));
 const result={responsePolicy:'ATLAS_SLAB_V1',source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:context.query,retrievedAt:'2026-10-20T12:00:00Z',items,acquisitionDiagnostics:{returnedItemCount:items.length},imageMatch:{policy:'atlas-market-slab-label-v1',counts:{},readings:items.map(item=>({rowId:item.id,sha256:digest(item.id),imageUrl:item.imageUrl,gradingCompany:'PSA',numericGrade:context.atlasGrade,labelText:item.title,identityMatch:'MATCH',evidenceKind:'SLABBED',reason:'Synthetic local comparison fixture.'}))}};
 const ready=createPresentationMarket().project(source,result);assert.equal(ready.preview.counts.recommended,1);assert.equal(ready.preview.candidates[0].recommended,true);
 assert.equal(ready.preview.candidates[3].match,'DIFFERENT');assert.equal(ready.preview.candidates[4].match,'UNCERTAIN');assert.ok(ready.preview.candidates.slice(1).every(row=>!row.recommended));
 assert.equal(result.imageMatch.readings[3].identityMatch,'MATCH','source evidence remains immutable');
});

test('negated serial, autograph type and relic presence cannot become positive matching evidence',()=>{
 const value=attributes();
 for(const phrase of ['not an autograph','not signed','not on-card auto','not a sticker auto','unsigned','not numbered /99'])
  assert.notEqual(matchSportsAttributeEvidence(value,{title:`Player /99 ${phrase}`}).status,'MATCH');
 value.relic={presence:'PRESENT',windows:[{position:'Left',material:'Fabric',manufacturerStatement:'Game-used material.',use:'GAME_USED'}]};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto game-used jersey but not a relic'}).status,'CONTRADICTORY');
});

test('unrecognized material remains unresolved instead of silently dropping a reviewed distinction',()=>{
 const value=attributes();value.relic={presence:'PRESENT',windows:[{position:'Left',material:'Composite hockey stick',manufacturerStatement:'Game-used material.',use:'GAME_USED'}]};
 assert.equal(matchSportsAttributeEvidence(value,{title:'Player /99 on-card auto game-used relic'}).status,'UNKNOWN');
});
