import test from 'node:test';
import assert from 'node:assert/strict';
import {findingImpact,traceAreaPreview} from '../src/finding-impact.mjs';
import {createEmptySpeedsterTrace} from '@atlas/grading-core/trace-editor';
test('saved category impact uses the approved factor once and excludes removed work',()=>{
 const findings=[{id:'corner',defectType:'VISIBLE_WHITENING',measurementRegions:[{zone:'CORNERS',measurement:{zonePercent:.128710702158}}]},
 {id:'removed',reviewResult:'REMOVED',defectType:'PEELING_HEAVY_DAMAGE',measurementRegions:[{zone:'CORNERS',measurement:{zonePercent:50}}]}];
 assert.deepEqual(findingImpact(findings,'corner'),[{zone:'CORNERS',score:1,withoutScore:10,scoringPercent:.193066053237}]);
});
test('raw corner stroke remains visible while material preview distinguishes background without changing pixels',()=>{
 const trace=createEmptySpeedsterTrace();trace[0]=1;trace[64]=1;const before=trace.slice();
 assert.deepEqual(traceAreaPreview(trace,'ROUNDED_3_18_MM'),{rawPixels:2,onCardPixels:1,outsidePixels:1,rawAreaMm2:.005,onCardAreaMm2:.0025});assert.deepEqual(trace,before);
 const contour=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];assert.equal(traceAreaPreview(trace,'ROUNDED_3_18_MM',contour).onCardPixels,2);
});
