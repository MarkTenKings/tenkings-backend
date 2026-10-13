import test from 'node:test';
import assert from 'node:assert/strict';
import { intakePhotoAttention } from '../lib/manual-review-attention.mjs';

test('photo setup marks only missing or unprepared sources',()=>{
 const saved={card:{sides:{FRONT:{upload:{verification:{verified:true}}},BACK:{upload:{source:{}}}}}};
 assert.deepEqual(intakePhotoAttention(saved).map(issue=>issue.side),['FRONT']);
 saved.card.sides.FRONT.upload.source={};assert.deepEqual(intakePhotoAttention(saved),[]);
});

test('failed geometry never redirects review through paired-photo attention',()=>{
 const saved={card:{sides:{FRONT:{upload:{uploadId:'front',source:{}}},BACK:{upload:{uploadId:'back',source:{}}}}},earlyGeometry:{FRONT:{uploadId:'front',state:'FAILED'},BACK:{uploadId:'back',state:'NEEDS_REVIEW',machineUsable:false}}};
 for(const manual of [null,{current:false},{current:true}]){saved.manual=manual;assert.deepEqual(intakePhotoAttention(saved),[]);}
});
