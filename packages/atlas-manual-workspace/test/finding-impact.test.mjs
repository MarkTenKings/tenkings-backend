import test from 'node:test';
import assert from 'node:assert/strict';
import {findingImpact,traceAreaPreview} from '../src/finding-impact.mjs';
import {calculateAtlasReview} from '@atlas/grading-core/atlas-policy';
import {createEmptySpeedsterTrace} from '@atlas/grading-core/trace-editor';
test('saved category impact uses the approved factor once and excludes removed work',()=>{
 const findings=[{id:'corner',defectType:'VISIBLE_WHITENING',measurementRegions:[{zone:'CORNERS',measurement:{zonePercent:.128710702158}}]},
 {id:'removed',reviewResult:'REMOVED',defectType:'PEELING_HEAVY_DAMAGE',measurementRegions:[{zone:'CORNERS',measurement:{zonePercent:50}}]}];
 assert.deepEqual(findingImpact(findings,'corner'),[{zone:'CORNERS',damageMultiplier:.25,score:8,withoutScore:10,scoringPercent:.03217767554}]);
});
test('one finding spanning all categories uses each category factor and preserves saved measurements',()=>{
 const findings=[{id:'multi',defectType:'CHIPPING_EXPOSED_STOCK',measurementRegions:['CORNERS','EDGES','SURFACE'].map(zone=>({zone,measurement:{zonePercent:.02}}))}];
 const before=structuredClone(findings);
 assert.deepEqual(findingImpact(findings,'multi'),[
  {zone:'CORNERS',damageMultiplier:.25,score:10,withoutScore:10,scoringPercent:.0075},
  {zone:'EDGES',damageMultiplier:.25,score:10,withoutScore:10,scoringPercent:.0075},
  {zone:'SURFACE',damageMultiplier:2,score:6,withoutScore:10,scoringPercent:.06},
 ]);
 assert.deepEqual(findings,before);
});
test('raw corner stroke remains visible while material preview distinguishes background without changing pixels',()=>{
 const trace=createEmptySpeedsterTrace();trace[0]=1;trace[64]=1;const before=trace.slice();
 assert.deepEqual(traceAreaPreview(trace,'ROUNDED_3_18_MM'),{rawPixels:2,onCardPixels:1,outsidePixels:1,rawAreaMm2:.005,onCardAreaMm2:.0025});assert.deepEqual(trace,before);
 const contour=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];assert.equal(traceAreaPreview(trace,'ROUNDED_3_18_MM',contour).onCardPixels,2);
});

test('live corner impact normalizes measured damage before the category factor at a threshold',()=>{
 const zonePercent=.0400000000016;
 const finding={id:'boundary',side:'FRONT',zone:'CORNERS',defectType:'VISIBLE_WHITENING',reviewResult:'ACCEPTED',
  measurement:{areaMm2:zonePercent,zonePercent,widthMm:1,heightMm:1,multiplier:1,weightedAreaMm2:zonePercent,subgradeEffect:0}};
 const centeringBorders={leftMm:1,rightMm:1,topMm:1,bottomMm:1};
 const review=calculateAtlasReview({front:{centeringBorders},back:{centeringBorders}},[finding]);
 assert.equal(review.grade.front.corners.weightedDamagePercent,.040000000002);
 const [impact]=findingImpact([finding],'boundary');
 assert.equal(impact.score,9.5);assert.equal(impact.score,review.grade.front.corners.score);
 assert.equal(impact.scoringPercent,.010000000001);
});
